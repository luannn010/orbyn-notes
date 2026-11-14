import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MutableRefObject } from "react";
import { flushSync } from "react-dom";
import { strToU8, zipSync } from "fflate";
import type {
  JournalVault,
  JournalVaultStatus,
} from "../collections/journalVault";
import type { Habit, JournalData } from "../collections/journal";
import {
  archiveHabit,
  journalMonth,
  journalToday,
  setHabitCompletion,
  writeJournalEntry,
} from "../collections/journal";
import { exportJournalFiles } from "../collections/journalTransfer";
import type {
  HabitFormDraft,
  HabitFormInput,
} from "../collections/journalViewDraft";
import type { NoteDocument } from "../domain/contracts";
import { registerCloseGuard, trackOperation } from "../desktop/closeGuard";
import { Dialog } from "./primitives";
import { RichEditor, type EditorLinkControl } from "./RichEditor";
import { Menu } from "./Menu";
import { plainText } from "./model";
import "../styles/journal.css";

const EMPTY_DOCUMENT: NoteDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
};
const PROMPTS = [
  "What is one thing you want to remember from this week?",
  "What felt important today?",
  "What would you like to remember?",
  "What helped you today?",
];
const message = (value: string) => value.replace(/^[a-z_]+: /, "");
function dayDate(day: string) {
  return new Date(`${day}T12:00:00`);
}
function dayTitle(day: string) {
  return dayDate(day).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function monthTitle(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
type JournalForm =
  | { kind: "habit" }
  | { kind: "archive"; habit: Habit }
  | { kind: "settings" }
  | { kind: "export" };
type JournalNavigation = {
  selectedDay: string;
  month: { year: number; month: number };
  history: boolean;
};
function initialNavigation(): JournalNavigation {
  const selectedDay = journalToday(),
    date = dayDate(selectedDay);
  return {
    selectedDay,
    month: { year: date.getFullYear(), month: date.getMonth() + 1 },
    history: false,
  };
}
function readHabitDraft(vault: JournalVault) {
  try {
    return vault.status().phase === "unlocked" ? vault.readHabitDraft() : null;
  } catch {
    return null;
  }
}

function useVaultStatus(vault: JournalVault) {
  const active = useRef<JournalVault | null>(null);
  useLayoutEffect(() => {
    active.current = vault;
    return () => {
      if (active.current === vault) active.current = null;
    };
  }, [vault]);
  const external = useMemo(() => {
    let cached = vault.status();
    return {
      get: () => cached,
      subscribe: (notify: () => void) => {
        cached = vault.status();
        if (cached.phase === "closed" || cached.phase === "revoked")
          return () => {};
        let listening = true;
        const stop = vault.subscribe(() => {
          if (!listening || active.current !== vault) return;
          const next = vault.status();
          const hiding =
            (cached.phase === "unlocked" && next.phase !== "unlocked") ||
            (cached.phase !== next.phase &&
              (next.phase === "closed" || next.phase === "revoked"));
          cached = next;
          if (hiding) flushSync(notify);
          else notify();
        });
        cached = vault.status();
        return () => {
          listening = false;
          stop();
        };
      },
    };
  }, [vault]);
  return useSyncExternalStore(external.subscribe, external.get);
}

/** Metadata is the only state retained while Journal is locked. */
export function JournalView({
  vault,
  onReopen,
}: {
  vault: JournalVault;
  onReopen?: () => void;
}) {
  const status = useVaultStatus(vault);
  const formDirty = useRef(false);
  const [authPending, setAuthPending] = useState(false);
  const [navigation, setNavigation] = useState(initialNavigation);
  const owner = useMemo(() => crypto.randomUUID(), [vault]);
  useLayoutEffect(() => {
    setNavigation(initialNavigation());
    setAuthPending(false);
  }, [vault]);
  const [closeNotice, setCloseNotice] = useState("");
  useLayoutEffect(
    () =>
      registerCloseGuard(() => {
        if (!formDirty.current && vault.canClose()) return true;
        setCloseNotice(
          "Your Journal changes are still in this window. Save or cancel before leaving.",
        );
        return false;
      }),
    [vault],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (formDirty.current || !vault.canClose()) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [vault]);
  useLayoutEffect(() => {
    if (status.phase !== "unlocked") {
      formDirty.current = false;
      setCloseNotice("");
    }
    if (status.phase === "revoked" || status.phase === "closed")
      setNavigation(initialNavigation());
  }, [status.phase]);
  return (
    <section className="journal-view" aria-label="Journal">
      {closeNotice && (
        <p className="journal-banner" role="status">
          {closeNotice}
        </p>
      )}
      {status.phase === "unlocked" && !authPending ? (
        <JournalWorkspace
          key={owner}
          vault={vault}
          status={status}
          formDirty={formDirty}
          navigation={navigation}
          onNavigate={(patch) => {
            if (vault.status().phase === "unlocked")
              setNavigation((previous) => ({ ...previous, ...patch }));
          }}
        />
      ) : status.phase === "closed" || status.phase === "revoked" ? (
        <div className="journal-lock">
          <h1>Journal access changed</h1>
          <p>Journal is hidden. Reopen it to continue.</p>
          {onReopen && <button onClick={onReopen}>Reopen Journal</button>}
        </div>
      ) : (
        <Credentials
          key={owner}
          vault={vault}
          status={status}
          formDirty={formDirty}
          pending={authPending}
          onPending={setAuthPending}
        />
      )}
    </section>
  );
}

function Credentials({
  vault,
  status,
  formDirty,
  pending,
  onPending,
}: {
  vault: JournalVault;
  status: JournalVaultStatus;
  formDirty: MutableRefObject<boolean>;
  pending: boolean;
  onPending: (pending: boolean) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validation, setValidation] = useState("");
  const active = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      formDirty.current = false;
    };
  }, []);
  const creating = !status.hasJournal;
  const busy =
    pending || status.phase === "unlocking" || status.phase === "sealing";
  function clear() {
    setPassphrase("");
    setConfirmation("");
    setValidation("");
    formDirty.current = false;
  }
  async function submit() {
    if (active.current || busy) return;
    if (passphrase.length < 12 || passphrase.length > 1024) {
      setValidation("Use a passphrase of 12 to 1,024 characters.");
      return;
    }
    if (creating && passphrase !== confirmation) {
      setValidation("The passphrases don’t match. Enter them again.");
      setPassphrase("");
      setConfirmation("");
      formDirty.current = false;
      return;
    }
    const secret = passphrase;
    active.current = true;
    onPending(true);
    clear();
    try {
      await trackOperation(() =>
        creating ? vault.create(secret) : vault.unlock(secret),
      );
    } catch {
      if (mounted.current && !vault.status().error)
        setValidation(
          creating
            ? "Journal setup did not finish. Try again."
            : "Couldn’t unlock Journal. Check your passphrase and try again.",
        );
    } finally {
      active.current = false;
      if (mounted.current) onPending(false);
    }
  }
  return (
    <div className="journal-lock">
      <span className="journal-lock-icon" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        </svg>
      </span>
      <h1>{creating ? "Set a Journal passphrase" : "Journal is locked"}</h1>
      <p>
        {creating
          ? "If you forget it, Orbyn can’t unlock your Journal."
          : status.pendingRecovery
            ? "Your Journal draft is hidden in this window. Unlock it to save or recover it."
            : "It locks after 1 minute away. Your habits are locked too."}
      </p>
      {status.phase === "sealing" ? (
        <p role="status">Hiding and securing your draft…</p>
      ) : (
        <form
          className="journal-credentials"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Passphrase
            <input
              autoFocus
              type="password"
              autoComplete={creating ? "new-password" : "current-password"}
              minLength={12}
              maxLength={1024}
              required
              disabled={busy}
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                formDirty.current = !!event.target.value || !!confirmation;
              }}
            />
          </label>
          {creating && (
            <label>
              Confirm passphrase
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
                disabled={busy}
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  formDirty.current = !!event.target.value || !!passphrase;
                }}
              />
            </label>
          )}
          {(validation || status.error) && (
            <p role="alert" className="error">
              {validation || message(status.error!)}
            </p>
          )}
          <div className="journal-actions">
            <button type="button" disabled={busy} onClick={clear}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || passphrase.length < 12}
            >
              {busy
                ? "Unlocking…"
                : creating
                  ? "Lock Journal"
                  : "Unlock Journal"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function JournalWorkspace({
  vault,
  status,
  formDirty,
  navigation,
  onNavigate,
}: {
  vault: JournalVault;
  status: JournalVaultStatus;
  formDirty: MutableRefObject<boolean>;
  navigation: JournalNavigation;
  onNavigate: (patch: Partial<JournalNavigation>) => void;
}) {
  const { selectedDay, month, history } = navigation;
  const setSelectedDay = (value: string) => onNavigate({ selectedDay: value });
  const setMonth = (value: JournalNavigation["month"]) =>
    onNavigate({ month: value });
  const setHistory = (value: boolean) => onNavigate({ history: value });
  const [form, setForm] = useState<JournalForm | null>(() =>
    readHabitDraft(vault) ? { kind: "habit" } : null,
  );
  const [cancelHabitOpen, setCancelHabitOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lockRequested = useRef(false);
  const [savingShown, setSavingShown] = useState(false);
  const [actionError, setActionError] = useState("");
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      formDirty.current = false;
    };
  }, []);
  useEffect(() => {
    if (!status.saving) {
      setSavingShown(false);
      return;
    }
    const timer = setTimeout(() => setSavingShown(true), 1000);
    return () => clearTimeout(timer);
  }, [status.saving]);
  const data = useMemo(() => {
    try {
      return vault.status().phase === "unlocked" ? vault.read() : null;
    } catch {
      return null;
    }
  }, [vault, status]);
  const habitDraft = useMemo(() => readHabitDraft(vault), [vault, status]);
  const linkDraft = useMemo(() => {
    try {
      return vault.status().phase === "unlocked" ? vault.readLinkDraft() : null;
    } catch {
      return null;
    }
  }, [vault, status]);
  const days = useMemo(
    () => (data ? journalMonth(data, month.year, month.month) : []),
    [data, month.year, month.month],
  );
  if (!data) return null;
  const today = journalToday();
  const entry = data.entries.find((item) => item.date === selectedDay);
  const linkControl: EditorLinkControl = {
    draft: linkDraft?.date === selectedDay ? linkDraft : null,
    valid:
      !linkDraft ||
      (linkDraft.date === selectedDay &&
        linkDraft.entryId === (entry?.id ?? null) &&
        linkDraft.entryRevision === (entry?.revision ?? 0)),
    open: (draft) => vault.setLinkDraft({ ...draft, date: selectedDay }),
    change: (url) => {
      const current = vault.readLinkDraft();
      if (!current || current.date !== selectedDay)
        throw new Error("This link draft is no longer available.");
      const { date, source, from, to, selection, initialUrl } = current;
      vault.setLinkDraft({
        date,
        source,
        from,
        to,
        selection,
        initialUrl,
        url,
      });
    },
    cancel: () => vault.discardLinkDraft(),
    beginApply: () => {
      const token = vault.beginLinkApply();
      return (document, changed) =>
        vault.completeLinkDraft(token, { document, changed });
    },
    lock: () => {
      void lock();
    },
  };
  const prompt = entry?.prompt ?? PROMPTS[0]!;
  const activeHabits = data.habits
    .filter(
      (habit) =>
        habit.createdOn <= selectedDay &&
        (!habit.archivedOn || habit.archivedOn >= selectedDay),
    )
    .sort((a, b) => a.order - b.order);
  const completed = new Set(
    data.completions
      .filter((item) => item.date === selectedDay && item.done)
      .map((item) => item.habitId),
  );
  const written = days.filter((day) => day.written);
  const canEdit = !status.conflict;
  function openForm(next: JournalForm | { kind: "habit"; habit: Habit }) {
    try {
      if (next.kind === "habit") {
        const habit = "habit" in next ? next.habit : undefined;
        vault.setHabitDraft({
          mode: habit ? "edit" : "create",
          id: habit?.id ?? null,
          name: habit?.name ?? "",
        });
        formDirty.current = vault.status().habitDraftDirty;
        setForm({ kind: "habit" });
      } else {
        formDirty.current = false;
        setForm(next);
      }
      setActionError("");
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? message(cause.message)
          : "Couldn’t open this habit. Try again.",
      );
    }
  }
  function closeForm() {
    if (busy) return;
    if (form?.kind === "habit") {
      if (readHabitDraft(vault)?.dirty) {
        setCancelHabitOpen(true);
        return;
      }
      vault.discardHabitDraft();
    }
    formDirty.current = false;
    setForm(null);
    setActionError("");
  }
  async function operation(action: () => Promise<void>): Promise<boolean> {
    setActionError("");
    try {
      await trackOperation(action);
      return mounted.current && vault.status().phase === "unlocked";
    } catch (cause) {
      if (
        mounted.current &&
        vault.status().phase === "unlocked" &&
        !vault.status().error
      )
        setActionError(
          cause instanceof Error
            ? message(cause.message)
            : "Couldn’t save Journal. Your draft is still here. Try again.",
        );
      return false;
    }
  }
  function write(document: NoteDocument) {
    const at = new Date();
    // update accepts the entire current edit synchronously before its first await.
    void operation(() =>
      vault.update((current) => {
        const existing = current.entries.find(
          (item) => item.date === selectedDay,
        );
        return writeJournalEntry(
          current,
          selectedDay,
          document,
          existing?.prompt ??
            (current.preferences.promptEnabled ? PROMPTS[0]! : null),
          at,
        );
      }),
    );
  }
  function newPrompt() {
    const at = new Date();
    void operation(() =>
      vault.update((current) => {
        const existing = current.entries.find(
          (item) => item.date === selectedDay,
        );
        const index = PROMPTS.indexOf(existing?.prompt ?? PROMPTS[0]!);
        return writeJournalEntry(
          current,
          selectedDay,
          existing?.document ?? EMPTY_DOCUMENT,
          PROMPTS[(index + 1) % PROMPTS.length]!,
          at,
        );
      }),
    );
  }
  function changeHabitName(name: string) {
    const current = readHabitDraft(vault);
    if (!current) return;
    try {
      const input: HabitFormInput = {
        mode: current.mode,
        id: current.id,
        name,
      };
      vault.setHabitDraft(input);
      formDirty.current = vault.status().habitDraftDirty;
      setActionError("");
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? message(cause.message)
          : "Couldn’t keep this habit draft. Try again.",
      );
    }
  }
  async function saveHabitForm() {
    if (busy || status.conflict) return;
    setBusy(true);
    const saved = await operation(() => {
      const pending = vault.saveHabitDraft();
      formDirty.current = vault.status().habitDraftDirty;
      return pending;
    });
    if (mounted.current) {
      setBusy(false);
      if (saved) {
        formDirty.current = false;
        setForm(null);
      }
    }
  }
  async function lock() {
    if (lockRequested.current || vault.status().phase !== "unlocked") return;
    lockRequested.current = true;
    setBusy(true);
    try {
      await operation(() => vault.lock());
    } finally {
      lockRequested.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function selectDay(day: string) {
    if (formDirty.current || busy) return;
    setSelectedDay(day);
    setHistory(false);
  }
  function moveMonth(delta: number) {
    const date = new Date(month.year, month.month - 1 + delta, 1);
    if (date.getFullYear() >= 1000 && date.getFullYear() <= 9999)
      setMonth({ year: date.getFullYear(), month: date.getMonth() + 1 });
  }
  const error = actionError || (status.error ? message(status.error) : "");
  const statusLabel = status.conflict
    ? "Needs you"
    : status.error
      ? "Couldn’t save"
      : status.saving && savingShown
        ? "Saving…"
        : status.dirty ||
            status.habitDraftDirty ||
            status.linkDraftDirty ||
            status.saving
          ? "Unsaved changes"
          : "Saved";
  const calendar = (
    <Calendar
      days={days}
      year={month.year}
      month={month.month}
      selected={selectedDay}
      today={today}
      onSelect={selectDay}
      onMove={moveMonth}
    />
  );
  const recovery = (
    <>
      {error && (
        <div className="journal-banner error" role="alert">
          {error}
          {status.conflict ? (
            <button onClick={() => setDiscardOpen(true)}>
              Use saved Journal
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => void operation(() => vault.retry())}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </>
  );
  return (
    <>
      <header className="journal-heading">
        <div>
          <h1>Journal</h1>
          <span>
            {history
              ? monthTitle(month.year, month.month)
              : dayTitle(selectedDay)}
          </span>
        </div>
        <div className="journal-actions">
          <span className="journal-private">
            Private · passphrase protected
          </span>
          <span role="status">{statusLabel}</span>
          {status.dirty &&
            !status.saving &&
            !status.conflict &&
            !status.error && (
              <button
                disabled={busy}
                onClick={() => void operation(() => vault.retry())}
              >
                Save Journal
              </button>
            )}
          <button
            onClick={() => {
              const day = journalToday();
              selectDay(day);
              setMonth({
                year: dayDate(day).getFullYear(),
                month: dayDate(day).getMonth() + 1,
              });
            }}
          >
            Today
          </button>
          <button aria-pressed={history} onClick={() => setHistory(!history)}>
            Past entries
          </button>
          <Menu
            label="Journal menu"
            actions={[
              {
                label: "Journal settings",
                onSelect: () => openForm({ kind: "settings" }),
              },
              { label: "Lock Journal", onSelect: () => void lock() },
              {
                label: "Export Journal",
                onSelect: () => openForm({ kind: "export" }),
              },
              ...(status.dirty || status.conflict
                ? [
                    {
                      label: "Discard draft and reload",
                      danger: true,
                      onSelect: () => setDiscardOpen(true),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </header>
      {!form && recovery}
      {history ? (
        <div className="journal-history">
          <div>{calendar}</div>
          <div className="journal-past">
            <h2>Past entries</h2>
            <p className="journal-caption">
              {written.length} {written.length === 1 ? "day" : "days"} written ·
              Private
            </p>
            {written.length === 0 ? (
              <p>No entries in this month</p>
            ) : (
              [...written].reverse().map((day) => (
                <button
                  className="journal-history-row"
                  key={day.date}
                  onClick={() => selectDay(day.date)}
                >
                  <b>{dayTitle(day.date)}</b>
                  <span>
                    {plainText(day.entry!.document).trim().slice(0, 160)}
                  </span>
                  <small>
                    {day.habitsCompleted} of {day.habitTotal} habits
                  </small>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="journal-layout">
          <div className="journal-entry">
            <span className="journal-caption">{dayTitle(selectedDay)}</span>
            <h2>
              {selectedDay === today
                ? "Today"
                : dayDate(selectedDay).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                  })}
            </h2>
            {data.preferences.promptEnabled && (
              <div className="journal-prompt">
                <span className="journal-caption">Prompt</span>
                <span>{prompt}</span>
                <button disabled={!canEdit} onClick={newPrompt}>
                  New prompt
                </button>
              </div>
            )}
            <div
              className="journal-writing"
              role="group"
              aria-label="Journal entry"
            >
              <RichEditor
                key={selectedDay}
                document={entry?.document ?? EMPTY_DOCUMENT}
                onChange={write}
                ariaLabel="Journal entry"
                readOnly={!canEdit}
                linkControl={linkControl}
              />
            </div>
            <div className="journal-habits-heading">
              <h3>
                Habits ·{" "}
                {activeHabits.filter((habit) => completed.has(habit.id)).length}{" "}
                of {activeHabits.length} done
              </h3>
              <button
                disabled={!canEdit}
                onClick={() => openForm({ kind: "habit" })}
              >
                Add a habit
              </button>
            </div>
            <div className="journal-habits" role="group" aria-label="Habits">
              {activeHabits.length === 0 ? (
                <p>No habits yet</p>
              ) : (
                activeHabits.map((habit) => (
                  <button
                    key={habit.id}
                    aria-pressed={completed.has(habit.id)}
                    disabled={!canEdit}
                    onClick={() => {
                      const at = new Date();
                      void operation(() =>
                        vault.update((current) =>
                          setHabitCompletion(
                            current,
                            selectedDay,
                            habit.id,
                            !current.completions.some(
                              (item) =>
                                item.date === selectedDay &&
                                item.habitId === habit.id &&
                                item.done,
                            ),
                            at,
                          ),
                        ),
                      );
                    }}
                  >
                    <span className="journal-check" aria-hidden="true">
                      {completed.has(habit.id) ? "✓" : ""}
                    </span>
                    {habit.name}
                  </button>
                ))
              )}
            </div>
          </div>
          <aside className="journal-month-panel" aria-label="Journal month">
            {calendar}
          </aside>
        </div>
      )}
      {form && (
        <Dialog
          title={
            form.kind === "habit"
              ? habitDraft?.mode === "edit"
                ? "Edit habit"
                : "Add a habit"
              : form.kind === "archive"
                ? "Archive habit?"
                : form.kind === "settings"
                  ? "Journal settings"
                  : "Export Journal"
          }
          onClose={closeForm}
          className="journal-dialog"
        >
          {recovery}
          {form.kind === "habit" && habitDraft && (
            <HabitForm
              draft={habitDraft}
              disabled={busy || status.conflict}
              working={busy}
              onChange={changeHabitName}
              onSave={() => void saveHabitForm()}
              onCancel={closeForm}
            />
          )}
          {form.kind === "archive" && (
            <>
              <p>
                This hides the habit from future days. Past completions stay in
                your Journal.
              </p>
              <button disabled={busy} onClick={closeForm}>
                Cancel
              </button>
              <button
                disabled={busy || status.conflict}
                onClick={async () => {
                  setBusy(true);
                  const at = new Date();
                  const saved = await operation(() =>
                    vault.update((current) =>
                      archiveHabit(current, form.habit.id, at),
                    ),
                  );
                  if (mounted.current) {
                    setBusy(false);
                    if (saved) setForm(null);
                  }
                }}
              >
                Archive habit
              </button>
            </>
          )}
          {form.kind === "settings" && (
            <div className="journal-settings">
              <div>
                <b>Lock Journal with</b>
                <span>A separate passphrase</span>
              </div>
              <div>
                <b>Lock after</b>
                <span>1 minute away</span>
              </div>
              <label className="journal-toggle">
                <input
                  type="checkbox"
                  checked={data.preferences.promptEnabled}
                  disabled={!canEdit}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void operation(() =>
                      vault.update((current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          promptEnabled: enabled,
                        },
                      })),
                    );
                  }}
                />
                Show a daily prompt
              </label>
              <h3>Habits</h3>
              {data.habits
                .filter((habit) => !habit.archivedAt)
                .map((habit) => (
                  <div key={habit.id}>
                    <span>{habit.name}</span>
                    <button
                      disabled={!canEdit}
                      onClick={() => openForm({ kind: "habit", habit })}
                    >
                      Edit
                    </button>
                    <button
                      disabled={!canEdit}
                      onClick={() => openForm({ kind: "archive", habit })}
                    >
                      Archive
                    </button>
                  </div>
                ))}
              <button
                disabled={!canEdit}
                onClick={() => openForm({ kind: "habit" })}
              >
                Add a habit
              </button>
              <button onClick={closeForm}>Done</button>
            </div>
          )}
          {form.kind === "export" && (
            <JournalExport vault={vault} onCancel={closeForm} />
          )}
        </Dialog>
      )}
      {cancelHabitOpen && (
        <Dialog
          title="Discard habit changes?"
          onClose={() => setCancelHabitOpen(false)}
        >
          <p>Your unsubmitted habit changes will be discarded.</p>
          <button onClick={() => setCancelHabitOpen(false)}>
            Keep editing
          </button>
          <button
            className="danger"
            onClick={() => {
              vault.discardHabitDraft();
              formDirty.current = false;
              setCancelHabitOpen(false);
              setForm(null);
            }}
          >
            Discard changes
          </button>
        </Dialog>
      )}
      {discardOpen && (
        <Dialog
          title="Discard your Journal draft?"
          onClose={() => {
            if (!busy) setDiscardOpen(false);
          }}
        >
          <p>
            This discards your unsaved Journal, habit and link changes in this
            window and returns to the saved Journal. Copy any text you need
            before continuing.
          </p>
          <button disabled={busy} onClick={() => setDiscardOpen(false)}>
            Cancel
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await operation(() => vault.discardAndReload());
              if (mounted.current) setBusy(false);
            }}
          >
            Discard draft and reload
          </button>
        </Dialog>
      )}
    </>
  );
}

function Calendar({
  days,
  year,
  month,
  selected,
  today,
  onSelect,
  onMove,
}: {
  days: ReturnType<typeof journalMonth>;
  year: number;
  month: number;
  selected: string;
  today: string;
  onSelect: (day: string) => void;
  onMove: (delta: number) => void;
}) {
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return (
    <div className="journal-calendar">
      <header>
        <h2>{monthTitle(year, month)}</h2>
        <button
          aria-label="Previous month"
          disabled={year === 1000 && month === 1}
          onClick={() => onMove(-1)}
        >
          ‹
        </button>
        <button
          aria-label="Next month"
          disabled={year === 9999 && month === 12}
          onClick={() => onMove(1)}
        >
          ›
        </button>
      </header>
      <div className="journal-weekdays" aria-hidden="true">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <span key={index}>{day}</span>
        ))}
      </div>
      <div
        className="journal-calendar-days"
        role="group"
        aria-label={monthTitle(year, month)}
      >
        {Array.from({ length: offset }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {days.map((day) => (
          <button
            key={day.date}
            disabled={day.date > today}
            data-level={
              day.habitsCompleted === 0
                ? 0
                : day.habitTotal && day.habitsCompleted >= day.habitTotal
                  ? 3
                  : day.habitsCompleted / Math.max(1, day.habitTotal) >= 0.5
                    ? 2
                    : 1
            }
            aria-label={`${dayTitle(day.date)} · ${day.habitsCompleted} of ${day.habitTotal} habits${day.written ? " · written" : ""}`}
            aria-pressed={day.date === selected}
            aria-current={day.date === today ? "date" : undefined}
            onClick={() => onSelect(day.date)}
          >
            {Number(day.date.slice(-2))}
          </button>
        ))}
      </div>
      <p className="journal-caption">Habits done · 0, some, most, all</p>
      <p className="journal-caption">
        Days written · {days.filter((day) => day.written).length}
      </p>
    </div>
  );
}
function HabitForm({
  draft,
  disabled,
  working,
  onChange,
  onSave,
  onCancel,
}: {
  draft: HabitFormDraft;
  disabled: boolean;
  working: boolean;
  onChange: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="journal-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.name.trim()) onSave();
      }}
    >
      <label>
        Name
        <input
          autoFocus
          required
          maxLength={200}
          disabled={disabled}
          value={draft.name}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </label>
      <div className="journal-actions">
        <button type="button" disabled={working} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={disabled || !draft.name.trim()}>
          Save habit
        </button>
      </div>
    </form>
  );
}
function JournalExport({
  vault,
  onCancel,
}: {
  vault: JournalVault;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const download = useRef<string | null>(null);
  const [error, setError] = useState("");
  useLayoutEffect(
    () => () => {
      if (download.current) URL.revokeObjectURL(download.current);
      download.current = null;
    },
    [],
  );
  function prepare() {
    if (download.current) return;
    try {
      const output = exportJournalFiles(vault.read());
      if (!output.length) {
        setError(
          "There are no Journal entries or habit records to export yet.",
        );
        return;
      }
      const files: Record<string, Uint8Array> = {};
      for (const file of output) files[file.filename] = strToU8(file.content);
      if (vault.status().phase !== "unlocked") return;
      const generated = URL.createObjectURL(
        new Blob([zipSync(files) as BlobPart], { type: "application/zip" }),
      );
      download.current = generated;
      setUrl(generated);
    } catch {
      setError("Couldn’t export Journal. Your entries were not changed.");
    }
  }
  return (
    <div className="journal-form">
      <p>
        Exported entries and habits are readable copies. Anyone with the files
        can read them.
      </p>
      <p>The file is not encrypted. Keep it somewhere safe.</p>
      <p>
        Includes a complete JSON backup and readable Markdown. Journal import
        and automatic restore are not available yet.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="journal-actions">
        <button onClick={onCancel}>{url ? "Done" : "Cancel"}</button>
        {url ? (
          <a href={url} download="orbyn-journal.zip">
            Download Journal
          </a>
        ) : (
          <button className="primary" onClick={prepare}>
            Export Journal
          </button>
        )}
      </div>
    </div>
  );
}
