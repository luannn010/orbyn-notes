import type { AccountIdentity, NoteDocument } from "../domain/contracts";
import { validateDocument } from "../domain/validation";
import { lockVersion, onLock, requireSession } from "../account/session";
import type {
  CollectionsState,
  CollectionsStore,
  JournalEnvelope,
} from "./contracts";
import {
  onCollectionsClose,
  onCollectionsEpochChange,
  replaceJournal,
} from "./store";
import {
  createJournalEnvelope,
  emptyJournal,
  sealJournalData,
  unlockJournalEnvelope,
  validateJournalData,
  saveHabit,
} from "./journal";
import type { JournalData } from "./journal";
import {
  openProtectedForms,
  sealProtectedForms,
  validateHabitFormDraft,
  validateHabitFormInput,
  validateLinkFormInput,
  validateLinkFormDraft,
  validateProtectedForms,
} from "./journalViewDraft";
import type {
  ProtectedFormsEnvelope,
  HabitFormDraft,
  HabitFormInput,
  LinkFormInput,
  LinkFormDraft,
} from "./journalViewDraft";

export type JournalVaultStatus = {
  phase:
    | "locked"
    | "unlocking"
    | "unlocked"
    | "sealing"
    | "lock-error"
    | "revoked"
    | "closed";
  hasJournal: boolean;
  dirty: boolean;
  habitDraftDirty: boolean;
  linkDraftDirty: boolean;
  saving: boolean;
  pendingRecovery: boolean;
  conflict: boolean;
  error: string | null;
};
export interface JournalVault {
  status(): JournalVaultStatus;
  read(): JournalData;
  readHabitDraft(): HabitFormDraft | null;
  setHabitDraft(input: HabitFormInput): void;
  saveHabitDraft(): Promise<void>;
  /** Caller confirms cancellation when unsaved intent exists. */
  discardHabitDraft(): void;
  readLinkDraft(): LinkFormDraft | null;
  setLinkDraft(input: LinkFormInput): void;
  discardLinkDraft(): void;
  beginLinkApply(): string;
  completeLinkDraft(
    token: string,
    applied: { document: NoteDocument; changed: boolean },
  ): void;
  create(passphrase: string, initial?: JournalData): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  update(change: (data: JournalData) => JournalData): Promise<void>;
  retry(): Promise<void>;
  lock(): Promise<void>;
  /** Must follow explicit user confirmation when a draft/recovery exists. */
  discardAndReload(): Promise<void>;
  setAway(away: boolean): void;
  canClose(): boolean;
  subscribe(listener: () => void): () => void;
  close(): void;
}
type Recovery = { envelope: JournalEnvelope; version: number };
type PrivateRecovery = {
  data: JournalData;
  key: CryptoKey;
  kdf: JournalEnvelope["kdf"];
  proof: JournalEnvelope;
  version: number;
  dataDirty: boolean;
  habit: HabitFormDraft | null;
  link: LinkFormDraft | null;
};
type FormsRecovery = {
  envelope: ProtectedFormsEnvelope;
  proof: JournalEnvelope;
  dirty: boolean;
  habitDirty: boolean;
  linkDirty: boolean;
};
type Job = {
  generation: number;
  kind: "read" | "create" | "unlock" | "save" | "seal";
};
function sameEnvelope(
  a: JournalEnvelope | null,
  b: JournalEnvelope | null,
): boolean {
  return a === null || b === null
    ? a === b
    : a.version === b.version &&
        a.kdf.name === b.kdf.name &&
        a.kdf.iterations === b.kdf.iterations &&
        a.kdf.salt === b.kdf.salt &&
        a.iv === b.iv &&
        a.ciphertext === b.ciphertext;
}
function stale(): Error {
  return new Error("journal_stale: Journal access changed. Unlock it again.");
}

export async function openJournalVault(
  input: AccountIdentity,
  store: CollectionsStore,
): Promise<JournalVault> {
  const identity = structuredClone(input),
    accountVersion = lockVersion();
  requireSession(identity.accountId, identity.deviceId);
  let phase: JournalVaultStatus["phase"] = "locked",
    generation = 0;
  let baseline: CollectionsState | null = null;
  let draft: JournalData | null = null,
    key: CryptoKey | null = null,
    kdf: JournalEnvelope["kdf"] | null = null;
  let dirty = false,
    conflict = false,
    error: string | null = null,
    draftVersion = 0;
  let recovery: Recovery | null = null,
    privateRecovery: PrivateRecovery | null = null,
    attempt: Recovery | null = null;
  let saveTask: Promise<void> | null = null;
  let habitDraft: HabitFormDraft | null = null,
    formsRecovery: FormsRecovery | null = null,
    habitVersion = 0;
  let linkDraft: LinkFormDraft | null = null,
    linkVersion = 0;
  let linkApply: {
    token: string;
    generation: number;
    epoch: string;
    version: number;
    draftVersion: number;
    date: string;
    entryId: string | null;
    revision: number;
  } | null = null;
  const jobs = new Set<Job>(),
    listeners = new Set<() => void>();
  let stopAccount = () => {},
    stopEpoch = () => {},
    stopOwner = () => {},
    stopStore = () => {};
  let timer: ReturnType<typeof setTimeout> | null = null,
    awaySince: number | null = null,
    manualAway = false;
  let browserAway =
    typeof document !== "undefined" &&
    (document.hidden || !document.hasFocus());
  const browserEvents: Array<() => void> = [];

  function status(): JournalVaultStatus {
    return {
      phase,
      hasJournal: Boolean(baseline?.journal || recovery || privateRecovery),
      dirty,
      habitDraftDirty: habitDirty(),
      linkDraftDirty: linkDirty(),
      saving: [...jobs].some(
        (job) =>
          job.generation === generation &&
          (job.kind === "save" || job.kind === "create"),
      ),
      pendingRecovery: Boolean(
        recovery || privateRecovery || formsRecovery?.dirty,
      ),
      conflict,
      error,
    };
  }
  function habitDirty() {
    return Boolean(
      habitDraft?.dirty ||
      formsRecovery?.habitDirty ||
      privateRecovery?.habit?.dirty,
    );
  }
  function linkDirty() {
    return Boolean(
      linkDraft?.dirty ||
      formsRecovery?.linkDirty ||
      privateRecovery?.link?.dirty,
    );
  }
  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Observers never control crypto or commit outcomes. */
      }
    }
  }
  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function detach() {
    stopAccount();
    stopEpoch();
    stopOwner();
    stopStore();
    cancelTimer();
    for (const remove of browserEvents.splice(0)) remove();
  }
  function revoke(next: "revoked" | "closed") {
    generation++;
    phase = next;
    baseline = null;
    draft = null;
    key = null;
    kdf = null;
    recovery = null;
    privateRecovery = null;
    attempt = null;
    habitDraft = null;
    linkDraft = null;
    linkApply = null;
    linkVersion++;
    formsRecovery = null;
    habitVersion++;
    dirty = false;
    conflict = false;
    saveTask = null;
    error =
      next === "revoked"
        ? "journal_revoked: Journal access was revoked."
        : null;
    detach();
    notify();
    listeners.clear();
  }
  function assertActive() {
    if (phase === "closed" || phase === "revoked") throw stale();
    if (lockVersion() !== accountVersion) {
      revoke("revoked");
      throw stale();
    }
    requireSession(identity.accountId, identity.deviceId);
  }
  function current(token: number, epoch: string) {
    assertActive();
    if (generation !== token || baseline?.epoch !== epoch) throw stale();
    if (enforceAwayDeadline()) throw stale();
  }
  function job(kind: Job["kind"], token: number): () => void {
    const item = { kind, generation: token };
    jobs.add(item);
    notify();
    return () => {
      jobs.delete(item);
      notify();
    };
  }
  function begin() {
    assertActive();
    generation++;
    linkApply = null;
    saveTask = null;
    return generation;
  }
  function markConflict() {
    conflict = true;
    error =
      "journal_conflict: Journal changed in another window. Keep your draft or discard it explicitly before reloading.";
    notify();
  }
  async function latest(
    token: number,
    epoch: string,
  ): Promise<CollectionsState> {
    const state = await store.read();
    current(token, epoch);
    if (state.epoch !== epoch) {
      revoke("revoked");
      throw stale();
    }
    return state;
  }
  async function refreshForSave(token: number, epoch: string) {
    const state = await latest(token, epoch);
    if (attempt && sameEnvelope(state.journal, attempt.envelope)) {
      // A notification failure can leave the transaction committed but its result unknown.
      const version = attempt.version;
      baseline = state;
      attempt = null;
      if (draftVersion === version) {
        dirty = false;
        recovery = null;
      }
    } else if (sameEnvelope(state.journal, baseline!.journal)) baseline = state;
    else {
      markConflict();
      throw new Error(error!);
    }
  }
  async function commitEnvelope(
    envelope: JournalEnvelope,
    version: number,
    token: number,
    epoch: string,
  ) {
    current(token, epoch);
    attempt = { envelope: structuredClone(envelope), version };
    recovery = { envelope: structuredClone(envelope), version };
    const saved = await replaceJournal(store, baseline!, envelope, () =>
      current(token, epoch),
    );
    current(token, epoch);
    baseline = saved;
    attempt = null;
    if (draftVersion === version) {
      dirty = false;
      recovery = null;
    }
  }
  function save(): Promise<void> {
    assertActive();
    if (phase !== "unlocked" || !draft || !key || !kdf)
      return Promise.reject(stale());
    if (conflict) return Promise.reject(new Error(error!));
    if (saveTask) return saveTask;
    if (!dirty) return Promise.resolve();
    const token = generation,
      epoch = baseline!.epoch;
    const done = job("save", token);
    let task!: Promise<void>;
    task = (async () => {
      try {
        while (dirty) {
          current(token, epoch);
          await refreshForSave(token, epoch);
          current(token, epoch);
          if (!dirty) break;
          const version = draftVersion,
            data = validateJournalData(draft!);
          const envelope = await sealJournalData(
            key!,
            kdf!,
            data,
            { accountId: identity.accountId, epoch },
            () => current(token, epoch),
          );
          current(token, epoch);
          await latest(token, epoch);
          current(token, epoch);
          await commitEnvelope(envelope, version, token, epoch);
          current(token, epoch);
        }
        error = null;
        notify();
      } catch (cause) {
        if (generation === token && phase === "unlocked") {
          error = conflict
            ? error
            : "journal_save_failed: Your Journal draft is still in this window. Try again.";
          notify();
        }
        throw cause;
      } finally {
        if (saveTask === task) saveTask = null;
        done();
      }
    })();
    saveTask = task;
    return task;
  }
  async function create(passphrase: string, initial = emptyJournal()) {
    assertActive();
    if (phase !== "locked" || dirty || recovery || privateRecovery)
      throw stale();
    const data = validateJournalData(initial),
      token = begin(),
      epoch = baseline!.epoch;
    phase = "unlocking";
    error = null;
    notify();
    const done = job("create", token);
    try {
      const state = await latest(token, epoch);
      if (state.journal)
        throw new Error("journal_exists: Unlock the existing Journal.");
      baseline = state;
      const created = await createJournalEnvelope(
        passphrase,
        data,
        { accountId: identity.accountId, epoch },
        () => current(token, epoch),
      );
      current(token, epoch);
      const latestState = await latest(token, epoch);
      if (latestState.journal) {
        markConflict();
        throw new Error(error!);
      }
      baseline = latestState;
      draft = data;
      key = created.key;
      kdf = structuredClone(created.envelope.kdf);
      draftVersion++;
      dirty = true;
      // Establish authenticated recovery proof before any unlocked observer runs.
      attempt = {
        envelope: structuredClone(created.envelope),
        version: draftVersion,
      };
      phase = "unlocked";
      notify();
      await commitEnvelope(created.envelope, draftVersion, token, epoch);
      current(token, epoch);
      error = null;
      notify();
      refreshAway();
    } catch (cause) {
      if (generation === token) {
        if (!draft) phase = "locked";
        error =
          "journal_create_failed: Journal setup did not finish. Try again.";
        notify();
      }
      throw cause;
    } finally {
      done();
    }
  }
  async function unlock(passphrase: string) {
    assertActive();
    if (phase === "unlocked" || phase === "sealing") throw stale();
    const token = begin(),
      epoch = baseline!.epoch;
    const retained = privateRecovery,
      sealed = recovery,
      sealedForms = formsRecovery;
    phase = "unlocking";
    error = null;
    notify();
    const done = job("unlock", token);
    try {
      const state = await latest(token, epoch);
      if (!retained && !sealed && !sealedForms) baseline = state;
      const envelope =
        retained?.proof ??
        sealed?.envelope ??
        sealedForms?.proof ??
        state.journal;
      if (!envelope) throw new Error("journal_missing: Set up Journal first.");
      const opened = await unlockJournalEnvelope(
        envelope,
        passphrase,
        { accountId: identity.accountId, epoch },
        () => current(token, epoch),
      );
      current(token, epoch);
      let restoredForms = retained
        ? validateProtectedForms({
            version: 1,
            habit: retained.habit,
            link: retained.link,
          })
        : null;
      if (!restoredForms && sealedForms) {
        if (
          sealedForms.proof.kdf.salt !== envelope.kdf.salt ||
          sealedForms.proof.kdf.iterations !== envelope.kdf.iterations ||
          sealedForms.proof.kdf.name !== envelope.kdf.name
        )
          throw stale();
        restoredForms = await openProtectedForms(
          opened.key,
          sealedForms.envelope,
          { accountId: identity.accountId, epoch },
          () => current(token, epoch),
        );
        current(token, epoch);
      }
      const after = await latest(token, epoch);
      const ownCommitted =
        sealed && sameEnvelope(after.journal, sealed.envelope);
      const ownAttempt =
        attempt && sameEnvelope(after.journal, attempt.envelope);
      const foreign =
        !sameEnvelope(after.journal, baseline!.journal) &&
        !ownCommitted &&
        !ownAttempt;
      if (foreign && !retained && !sealed && !sealedForms)
        throw new Error(
          "journal_changed: Journal changed while unlocking. Try again.",
        );
      draft = retained ? validateJournalData(retained.data) : opened.data;
      key = opened.key;
      kdf = structuredClone(envelope.kdf);
      draftVersion = retained?.version ?? sealed?.version ?? draftVersion + 1;
      dirty = (retained?.dataDirty ?? Boolean(sealed)) && !ownCommitted;
      habitDraft = restoredForms?.habit ?? null;
      linkDraft = restoredForms?.link ?? null;
      linkApply = null;
      linkVersion++;
      formsRecovery = null;
      habitVersion++;
      privateRecovery = null;
      recovery = dirty && sealed ? sealed : null;
      attempt = null;
      if (!foreign) baseline = after;
      conflict = foreign;
      phase = "unlocked";
      error = null;
      if (foreign) markConflict();
      else notify();
      refreshAway();
    } catch (cause) {
      if (generation === token) {
        phase = privateRecovery ? "lock-error" : "locked";
        error =
          "journal_unlock_failed: Couldn’t unlock Journal. Check your passphrase and try again.";
        notify();
      }
      throw cause;
    } finally {
      done();
    }
  }
  async function update(change: (data: JournalData) => JournalData) {
    assertActive();
    if (
      phase !== "unlocked" ||
      !draft ||
      conflict ||
      typeof change !== "function"
    )
      throw stale();
    const token = generation,
      epoch = baseline!.epoch;
    const next = change(structuredClone(draft));
    current(token, epoch);
    if (
      next &&
      typeof (next as unknown as { then?: unknown }).then === "function"
    ) {
      void Promise.resolve(next).catch(() => {});
      throw new Error("journal_invalid: Journal edits must be synchronous.");
    }
    draft = validateJournalData(next);
    draftVersion++;
    dirty = true;
    recovery = null;
    error = null;
    notify();
    return save();
  }
  function assertUnlocked() {
    assertActive();
    enforceAwayDeadline();
    if (phase !== "unlocked" || !draft || !key || !kdf) throw stale();
  }
  function readHabitDraft(): HabitFormDraft | null {
    assertUnlocked();
    return habitDraft ? structuredClone(habitDraft) : null;
  }
  function setHabitDraft(input: HabitFormInput): void {
    assertUnlocked();
    if (conflict) throw stale();
    if (linkDirty())
      throw new Error(
        "journal_form_dirty: Finish or cancel the current link first.",
      );
    const token = generation,
      epoch = baseline!.epoch;
    const checked = validateHabitFormInput(input);
    current(token, epoch);
    const sameForm =
      habitDraft &&
      habitDraft.mode === checked.mode &&
      habitDraft.id === checked.id;
    if (habitDraft?.dirty && !sameForm)
      throw new Error(
        "journal_form_dirty: Save or discard the current habit changes first.",
      );
    const existing =
      checked.mode === "edit"
        ? draft!.habits.find(
            (habit) => habit.id === checked.id && !habit.archivedAt,
          )
        : undefined;
    if (checked.mode === "edit" && !existing)
      throw new Error("habit_missing: This habit is unavailable.");
    const originalName = sameForm
      ? habitDraft!.originalName
      : (existing?.name ?? "");
    const candidate = validateHabitFormDraft({
      ...checked,
      version: 1,
      originalName,
      dirty: checked.name !== originalName,
    });
    validateProtectedForms({ version: 1, habit: candidate, link: linkDraft });
    habitDraft = candidate;
    habitVersion++;
    notify();
  }
  function discardHabitDraft(): void {
    assertUnlocked();
    habitDraft = null;
    formsRecovery = null;
    habitVersion++;
    notify();
  }
  async function saveHabitDraft(): Promise<void> {
    assertUnlocked();
    if (!habitDraft || conflict) throw stale();
    const form = validateHabitFormDraft(habitDraft),
      token = generation,
      epoch = baseline!.epoch;
    const existing = form.id
      ? draft!.habits.find((habit) => habit.id === form.id)
      : undefined;
    if (!form.name.trim())
      throw new Error(
        "invalid_habit: Enter a habit name up to 200 characters.",
      );
    let id = form.id;
    if (!existing || existing.name !== form.name.trim()) {
      const next = saveHabit(
        draft!,
        form.name,
        new Date(),
        form.id ?? undefined,
      );
      id =
        form.id ??
        next.habits.find(
          (habit) => !draft!.habits.some((before) => before.id === habit.id),
        )!.id;
      current(token, epoch);
      draft = validateJournalData(next);
      draftVersion++;
      dirty = true;
      recovery = null;
    }
    habitDraft = validateHabitFormDraft({
      version: 1,
      mode: "edit",
      id,
      name: form.name,
      originalName: form.name,
      dirty: false,
    });
    const submitted = ++habitVersion;
    notify();
    await save();
    current(token, epoch);
    if (habitVersion === submitted) {
      habitDraft = null;
      habitVersion++;
      notify();
    }
  }
  function readLinkDraft(): LinkFormDraft | null {
    assertUnlocked();
    return linkDraft ? structuredClone(linkDraft) : null;
  }
  function setLinkDraft(input: LinkFormInput): void {
    assertUnlocked();
    if (conflict) throw stale();
    if (habitDirty())
      throw new Error(
        "journal_form_dirty: Finish or cancel the current habit first.",
      );
    const checked = validateLinkFormInput(input);
    const same =
      linkDraft &&
      checked.date === linkDraft.date &&
      checked.source === linkDraft.source &&
      checked.from === linkDraft.from &&
      checked.to === linkDraft.to &&
      JSON.stringify(checked.selection) === JSON.stringify(linkDraft.selection);
    if (linkDraft?.dirty && !same)
      throw new Error(
        "journal_form_dirty: Finish or cancel the current link first.",
      );
    if (same && checked.initialUrl !== linkDraft!.initialUrl) throw stale();
    const entry = draft!.entries.find((entry) => entry.date === checked.date);
    const candidate = validateLinkFormDraft({
      ...checked,
      version: 1,
      entryId: same ? linkDraft!.entryId : (entry?.id ?? null),
      entryRevision: same ? linkDraft!.entryRevision : (entry?.revision ?? 0),
      dirty: checked.url !== checked.initialUrl,
    });
    validateProtectedForms({ version: 1, habit: habitDraft, link: candidate });
    linkDraft = candidate;
    linkVersion++;
    linkApply = null;
    notify();
  }
  function discardLinkDraft(): void {
    assertUnlocked();
    linkDraft = null;
    linkApply = null;
    linkVersion++;
    notify();
  }
  function beginLinkApply(): string {
    assertUnlocked();
    if (conflict || !linkDraft) throw stale();
    const entry = draft!.entries.find(
      (entry) => entry.date === linkDraft!.date,
    );
    if (
      (entry?.id ?? null) !== linkDraft.entryId ||
      (entry?.revision ?? 0) !== linkDraft.entryRevision
    )
      throw new Error(
        "journal_link_stale: This text changed. Cancel this link and select the text again.",
      );
    const token = crypto.randomUUID();
    linkApply = {
      token,
      generation,
      epoch: baseline!.epoch,
      version: linkVersion,
      draftVersion,
      date: linkDraft.date,
      entryId: entry?.id ?? null,
      revision: entry?.revision ?? 0,
    };
    return token;
  }
  function completeLinkDraft(
    token: string,
    applied: { document: NoteDocument; changed: boolean },
  ): void {
    assertUnlocked();
    const ticket = linkApply;
    if (
      !ticket ||
      ticket.token !== token ||
      !linkDraft ||
      conflict ||
      ticket.version !== linkVersion ||
      ticket.generation !== generation ||
      ticket.epoch !== baseline!.epoch ||
      typeof applied.changed !== "boolean"
    )
      throw stale();
    const entry = draft!.entries.find((entry) => entry.date === ticket.date);
    if (applied.changed) {
      const document = validateDocument(applied.document);
      if (
        !entry ||
        entry.revision !== ticket.revision + 1 ||
        draftVersion !== ticket.draftVersion + 1 ||
        (ticket.entryId !== null && entry.id !== ticket.entryId) ||
        JSON.stringify(entry.document) !== JSON.stringify(document)
      )
        throw new Error(
          "journal_link_not_accepted: This link was not accepted into your Journal draft. Its URL is still here.",
        );
    } else if (
      linkDraft.dirty ||
      linkDraft.source !== "toolbar" ||
      draftVersion !== ticket.draftVersion ||
      (entry?.revision ?? 0) !== ticket.revision
    ) {
      throw new Error(
        "journal_link_not_accepted: This link was not applied. Its URL is still here.",
      );
    }
    linkDraft = null;
    linkApply = null;
    linkVersion++;
    notify();
  }
  async function lock() {
    assertActive();
    const retained = privateRecovery;
    const data = draft ?? retained?.data ?? null,
      activeKey = key ?? retained?.key ?? null,
      header = kdf ?? retained?.kdf ?? null;
    const form = habitDraft ?? retained?.habit ?? null;
    const link = linkDraft ?? retained?.link ?? null;
    const needsForm = Boolean(
      (form || link) && (form?.dirty || link?.dirty || dirty),
    );
    const proof =
      attempt?.envelope ??
      recovery?.envelope ??
      retained?.proof ??
      baseline?.journal ??
      null;
    const token = begin(),
      epoch = baseline!.epoch;
    cancelTimer();
    if ((!dirty && !needsForm) || !data || !activeKey || !header) {
      draft = null;
      key = null;
      kdf = null;
      habitDraft = null;
      linkDraft = null;
      phase = privateRecovery ? "lock-error" : "locked";
      notify();
      return;
    }
    // Hide before any asynchronous encryption. No read/projection API can reach this state.
    phase = "sealing";
    draft = null;
    key = null;
    kdf = null;
    habitDraft = null;
    linkDraft = null;
    if (!proof) {
      dirty = false;
      privateRecovery = null;
      recovery = null;
      formsRecovery = null;
      phase = "locked";
      error = "journal_create_failed: Set up Journal again.";
      notify();
      return;
    }
    privateRecovery = {
      data,
      key: activeKey,
      kdf: header,
      proof: structuredClone(proof),
      version: draftVersion,
      dataDirty: dirty,
      habit: needsForm ? structuredClone(form) : null,
      link: needsForm ? structuredClone(link) : null,
    };
    notify();
    const done = job("seal", token);
    try {
      const envelope = dirty
        ? await sealJournalData(
            activeKey,
            header,
            data,
            { accountId: identity.accountId, epoch },
            () => current(token, epoch),
          )
        : null;
      current(token, epoch);
      const sealedForms = needsForm
        ? await sealProtectedForms(
            activeKey,
            { version: 1, habit: form, link },
            { accountId: identity.accountId, epoch },
            () => current(token, epoch),
          )
        : null;
      current(token, epoch);
      await latest(token, epoch);
      current(token, epoch);
      recovery = envelope ? { envelope, version: draftVersion } : null;
      formsRecovery = sealedForms
        ? {
            envelope: sealedForms,
            proof: structuredClone(envelope ?? proof),
            dirty: Boolean(form?.dirty || link?.dirty),
            habitDirty: Boolean(form?.dirty),
            linkDirty: Boolean(link?.dirty),
          }
        : null;
      privateRecovery = null;
      phase = "locked";
      error = null;
      notify();
    } catch (cause) {
      if (generation === token) {
        phase = "lock-error";
        error =
          "journal_lock_failed: Journal is hidden. Unlock it to recover your draft.";
        notify();
      }
      throw cause;
    } finally {
      done();
    }
  }
  async function discardAndReload() {
    assertActive();
    const token = begin(),
      epoch = baseline!.epoch;
    // Explicit destructive recovery action, called only after the UI confirms discard.
    draft = null;
    key = null;
    kdf = null;
    recovery = null;
    privateRecovery = null;
    attempt = null;
    habitDraft = null;
    linkDraft = null;
    linkApply = null;
    linkVersion++;
    formsRecovery = null;
    habitVersion++;
    dirty = false;
    conflict = false;
    phase = "locked";
    error = null;
    notify();
    const done = job("read", token);
    try {
      baseline = await latest(token, epoch);
      current(token, epoch);
      notify();
    } finally {
      done();
    }
  }
  async function synchronize() {
    const token = generation,
      epoch = baseline?.epoch;
    if (!epoch) return;
    try {
      const state = await latest(token, epoch);
      if (sameEnvelope(state.journal, baseline!.journal)) {
        baseline = state;
        return;
      }
      if (attempt && sameEnvelope(state.journal, attempt.envelope)) return;
      if (dirty || recovery || privateRecovery || habitDirty() || linkDirty()) {
        markConflict();
        return;
      }
      generation++;
      saveTask = null;
      draft = null;
      key = null;
      kdf = null;
      habitDraft = null;
      linkDraft = null;
      linkApply = null;
      linkVersion++;
      formsRecovery = null;
      habitVersion++;
      baseline = state;
      phase = "locked";
      error =
        "journal_changed: Journal changed in another window. Unlock it again.";
      notify();
    } catch {
      /* Revocation is handled by the captured account/epoch subscriptions. */
    }
  }
  function enforceAwayDeadline(): boolean {
    if (
      awaySince !== null &&
      Date.now() - awaySince >= 60000 &&
      (phase === "unlocked" || phase === "unlocking")
    ) {
      // lock() hides synchronously and invalidates older crypto continuations.
      // Its ordinary sealing/recovery path handles dirty drafts after hiding.
      void lock().catch(() => {});
      return true;
    }
    return false;
  }
  function refreshAway() {
    // Timers may be suspended by background throttling or system sleep. Enforce
    // the recorded deadline BEFORE a returning-focus event clears the absence.
    enforceAwayDeadline();
    const away = manualAway || browserAway;
    if (!away) {
      awaySince = null;
      cancelTimer();
      return;
    }
    awaySince ??= Date.now();
    if (timer !== null || phase !== "unlocked") return;
    timer = setTimeout(
      () => {
        timer = null;
        if (phase === "unlocked") void lock().catch(() => {});
      },
      Math.max(0, 60000 - (Date.now() - awaySince)),
    );
  }
  function setAway(away: boolean) {
    assertActive();
    if (typeof away !== "boolean")
      throw new Error("journal_invalid: Invalid visibility state.");
    manualAway = away;
    refreshAway();
  }
  function close() {
    if (phase !== "closed") revoke("closed");
  }
  const vault: JournalVault = {
    status,
    read: () => {
      assertActive();
      enforceAwayDeadline();
      if (phase !== "unlocked" || !draft)
        throw new Error("journal_locked: Unlock Journal to read it.");
      return structuredClone(draft);
    },
    create,
    readHabitDraft,
    setHabitDraft,
    saveHabitDraft,
    discardHabitDraft,
    readLinkDraft,
    setLinkDraft,
    discardLinkDraft,
    beginLinkApply,
    completeLinkDraft,
    unlock,
    update,
    retry: async () => save(),
    lock,
    discardAndReload,
    setAway,
    canClose: () =>
      phase === "closed" ||
      phase === "revoked" ||
      (!dirty &&
        !habitDirty() &&
        !linkDirty() &&
        !recovery &&
        !privateRecovery &&
        phase !== "unlocking" &&
        phase !== "sealing" &&
        ![...jobs].some((item) => item.generation === generation)),
    subscribe: (listener) => {
      assertActive();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close,
  };
  // Register account, owner-close and epoch revocation before the first read.
  stopAccount = onLock(() => revoke("revoked"));
  try {
    stopOwner = onCollectionsClose(store, () => revoke("revoked"));
    stopEpoch = onCollectionsEpochChange(store, () => revoke("revoked"));
    stopStore = store.subscribe(() => {
      void synchronize();
    });
    const token = generation,
      state = await store.read();
    assertActive();
    if (generation !== token) throw stale();
    baseline = state;
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      const visible = () => {
        browserAway = document.hidden || !document.hasFocus();
        refreshAway();
      };
      const blur = () => {
        browserAway = true;
        refreshAway();
      };
      document.addEventListener("visibilitychange", visible);
      window.addEventListener("focus", visible);
      window.addEventListener("blur", blur);
      browserEvents.push(() => {
        document.removeEventListener("visibilitychange", visible);
        window.removeEventListener("focus", visible);
        window.removeEventListener("blur", blur);
      });
    }
    refreshAway();
    return vault;
  } catch (cause) {
    close();
    throw cause;
  }
}
