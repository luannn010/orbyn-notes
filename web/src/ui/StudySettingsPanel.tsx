import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  CollectionsRevision,
  CollectionsState,
  StudyPreferences,
} from "../collections/contracts";
import { CollectionsRevisionConflictError } from "../collections/contracts";
import {
  assertCollectionsAccess,
  onCollectionsClose,
  onCollectionsEpochChange,
} from "../collections/store";
import { lockVersion, onLock, requireSession } from "../account/session";
import {
  checkClose,
  registerCloseGuard,
  trackOperation,
} from "../desktop/closeGuard";
import { Dialog } from "./primitives";
import type {
  SettingsLeaveGuard,
  StudySettingsOwner,
} from "./studySettingsTypes";
import "../styles/study-settings.css";
type Values = Pick<
  StudyPreferences,
  | "newPerDay"
  | "reviewsPerDay"
  | "dayStartHour"
  | "showNextReview"
  | "showStreak"
>;
type Draft = Omit<Values, "newPerDay" | "reviewsPerDay"> & {
  newPerDay: string;
  reviewsPerDay: string;
};
type Key = keyof Values;
type Baseline = {
  token: CollectionsRevision;
  values: Values;
  timezone: string;
};
type Attempt = {
  token: CollectionsRevision;
  values: Values;
  keys: readonly Key[];
  draftVersion: number;
};
type Phase =
  | "loading"
  | "load-error"
  | "ready"
  | "saving"
  | "checking"
  | "failed"
  | "conflict"
  | "closed";
const keys: readonly Key[] = [
  "newPerDay",
  "reviewsPerDay",
  "dayStartHour",
  "showNextReview",
  "showStreak",
];
const values = (p: StudyPreferences): Values => ({
  newPerDay: p.newPerDay,
  reviewsPerDay: p.reviewsPerDay,
  dayStartHour: p.dayStartHour,
  showNextReview: p.showNextReview,
  showStreak: p.showStreak,
});
const draftOf = (v: Values): Draft => ({
  ...v,
  newPerDay: String(v.newPerDay),
  reviewsPerDay: String(v.reviewsPerDay),
});
function dirtyKeys(draft: Draft, base: Baseline): Key[] {
  const saved = draftOf(base.values);
  return keys.filter((key) => draft[key] !== saved[key]);
}
function validate(draft: Draft) {
  const errors: Partial<Record<Key, string>> = {};
  for (const key of ["newPerDay", "reviewsPerDay"] as const) {
    const raw = draft[key].trim(),
      max = key === "newPerDay" ? 10000 : 20000;
    if (!raw) errors[key] = "Enter a daily limit.";
    else if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) > max
    )
      errors[key] =
        `Use digits only, from 0 to ${max.toLocaleString("en-US")}.`;
  }
  return {
    errors,
    values: {
      ...draft,
      newPerDay: Number(draft.newPerDay.trim()),
      reviewsPerDay: Number(draft.reviewsPerDay.trim()),
    } as Values,
  };
}
function patch(attempt: Attempt): Partial<Values> {
  const out: Partial<Values> = {};
  if (attempt.keys.includes("newPerDay"))
    out.newPerDay = attempt.values.newPerDay;
  if (attempt.keys.includes("reviewsPerDay"))
    out.reviewsPerDay = attempt.values.reviewsPerDay;
  if (attempt.keys.includes("dayStartHour"))
    out.dayStartHour = attempt.values.dayStartHour;
  if (attempt.keys.includes("showNextReview"))
    out.showNextReview = attempt.values.showNextReview;
  if (attempt.keys.includes("showStreak"))
    out.showStreak = attempt.values.showStreak;
  return out;
}
export function StudySettingsPanel({
  owner,
  onGuardReady,
}: {
  owner: StudySettingsOwner;
  onGuardReady?: (guard: SettingsLeaveGuard | null) => void;
}) {
  if (owner.status === "ready")
    return <LoadedStudySettings owner={owner} onGuardReady={onGuardReady} />;
  return (
    <section className="study-settings-status" aria-label="Study settings">
      <p role="status">
        {owner.status === "loading"
          ? "Loading Study settings…"
          : owner.status === "error"
            ? "Study settings couldn’t load. Try again."
            : "Study settings aren’t available."}
      </p>
      {owner.status === "error" && (
        <button onClick={owner.retry}>Try again</button>
      )}
    </section>
  );
}
function LoadedStudySettings({
  owner,
  onGuardReady,
}: {
  owner: Extract<StudySettingsOwner, { status: "ready" }>;
  onGuardReady?: (guard: SettingsLeaveGuard | null) => void;
}) {
  const { store, identity } = owner,
    id = useId();
  const [baseline, setBaseline] = useState<Baseline | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [phase, setPhase] = useState<Phase>("loading"),
    [notice, setNotice] = useState(""),
    [errors, setErrors] = useState<Partial<Record<Key, string>>>({}),
    [busyState, setBusyState] = useState(false),
    [confirm, setConfirm] = useState<"discard" | "leave" | null>(null);
  const baseRef = useRef<Baseline | null>(null),
    draftRef = useRef<Draft | null>(null),
    dirtyRef = useRef(false),
    working = useRef(false),
    attemptRef = useRef<Attempt | null>(null),
    generation = useRef(0),
    readSequence = useRef(0),
    draftVersion = useRef(0),
    alive = useRef(false),
    openedVersion = useRef(0),
    refreshRequested = useRef(false),
    continuation = useRef<(() => void) | null>(null),
    leaveTicket = useRef(0),
    registration = useRef(onGuardReady),
    form = useRef<HTMLFormElement>(null);
  registration.current = onGuardReady;
  function current(ticket: number) {
    if (
      !alive.current ||
      ticket !== generation.current ||
      lockVersion() !== openedVersion.current
    )
      throw Error("Study settings scope changed.");
    requireSession(identity.accountId, identity.deviceId);
    assertCollectionsAccess(store);
  }
  function revoke() {
    generation.current++;
    readSequence.current++;
    draftVersion.current++;
    leaveTicket.current++;
    baseRef.current = null;
    draftRef.current = null;
    dirtyRef.current = false;
    attemptRef.current = null;
    working.current = false;
    setBusyState(false);
    continuation.current = null;
    refreshRequested.current = false;
    if (alive.current)
      flushSync(() => {
        setBaseline(null);
        setDraft(null);
        setErrors({});
        setNotice("");
        setConfirm(null);
        setPhase("closed");
      });
  }
  function apply(value: CollectionsState, keep: boolean) {
    const oldDraft = draftRef.current,
      oldBase = baseRef.current,
      dirty = oldDraft && oldBase ? dirtyKeys(oldDraft, oldBase) : [];
    const base: Baseline = {
      token: { epoch: value.epoch, revision: value.revision },
      values: values(value.study.preferences),
      timezone: value.study.preferences.timezone,
    };
    const next = draftOf(base.values);
    if (keep && oldDraft) {
      for (const key of dirty) {
        if (key === "newPerDay" || key === "reviewsPerDay")
          next[key] = oldDraft[key];
        else if (key === "dayStartHour")
          next.dayStartHour = oldDraft.dayStartHour;
        else if (key === "showNextReview")
          next.showNextReview = oldDraft.showNextReview;
        else next.showStreak = oldDraft.showStreak;
      }
    }
    baseRef.current = base;
    draftRef.current = next;
    dirtyRef.current = dirtyKeys(next, base).length > 0;
    setBaseline(base);
    setDraft(next);
    readSequence.current++;
  }
  function focusError(error: Partial<Record<Key, string>>) {
    const key = keys.find((key) => error[key]);
    const scope = generation.current,
      version = draftVersion.current,
      leave = leaveTicket.current;
    if (key)
      requestAnimationFrame(() => {
        if (
          !alive.current ||
          scope !== generation.current ||
          version !== draftVersion.current ||
          leave !== leaveTicket.current
        )
          return;
        try {
          current(scope);
        } catch {
          return;
        }
        form.current?.querySelector<HTMLElement>(`[name="${key}"]`)?.focus();
      });
  }
  function continueIfAllowed() {
    const next = continuation.current;
    if (!next) return false;
    continuation.current = null;
    const request = leaveTicket.current;
    try {
      current(generation.current);
      if (request !== leaveTicket.current || checkClose() !== "allowed") {
        setNotice("Finish pending work before leaving Settings.");
        return false;
      }
      next();
      return true;
    } catch {
      return false;
    }
  }
  async function read(
    mode: "initial" | "background" | "reload" | "discard" | "check",
  ) {
    if (working.current) {
      if (mode === "background") refreshRequested.current = true;
      return;
    }
    const ticket = generation.current,
      sequence = ++readSequence.current,
      expected = baseRef.current?.token.epoch;
    working.current = true;
    setBusyState(true);
    if (mode !== "background") {
      setPhase(mode === "initial" ? "loading" : "checking");
      if (mode !== "initial")
        setNotice(
          mode === "check"
            ? "Checking saved settings…"
            : "Loading saved settings…",
        );
      if (mode !== "discard") {
        continuation.current = null;
        leaveTicket.current++;
      }
    }
    try {
      current(ticket);
      const value = await trackOperation(() => store.read());
      current(ticket);
      if (sequence !== readSequence.current) return;
      if (expected && value.epoch !== expected) {
        revoke();
        return;
      }
      if (mode === "background" && dirtyRef.current) {
        if (value.revision !== baseRef.current?.token.revision) {
          setPhase("conflict");
          setNotice(
            "Saved data changed. Reload the latest settings to keep your edits.",
          );
        }
        return;
      }
      if (mode === "check") {
        const attempt = attemptRef.current;
        const matched =
          !!attempt &&
          attempt.keys.every(
            (key) => value.study.preferences[key] === attempt.values[key],
          );
        const newer =
          !!attempt && draftVersion.current !== attempt.draftVersion;
        apply(value, !matched || newer);
        attemptRef.current = null;
        setPhase(matched && !newer ? "ready" : "failed");
        setNotice(
          matched && !newer
            ? "Saved on this device."
            : "Your edits are still here. Review them, then try again.",
        );
      } else {
        apply(value, mode === "reload");
        attemptRef.current = null;
        setErrors({});
        setPhase("ready");
        if (mode === "discard") setNotice("Changes discarded.");
        else if (mode === "reload")
          setNotice("Latest settings loaded. Your edits are still here.");
        else if (mode === "initial") setNotice("");
      }
    } catch {
      if (alive.current && ticket === generation.current) {
        try {
          current(ticket);
        } catch {
          revoke();
          return;
        }
        setPhase(
          mode === "initial"
            ? "load-error"
            : mode === "check"
              ? "failed"
              : "conflict",
        );
        setNotice(
          mode === "initial"
            ? "Study settings couldn’t load. Try again."
            : "Couldn’t load saved settings. Your edits are still here.",
        );
      }
    } finally {
      if (alive.current && ticket === generation.current) {
        working.current = false;
        setBusyState(false);
        const left = mode === "discard" && continueIfAllowed();
        if (
          !left &&
          baseRef.current &&
          !attemptRef.current &&
          refreshRequested.current
        ) {
          refreshRequested.current = false;
          void read("background");
        }
      }
    }
  }
  async function save() {
    if (
      working.current ||
      !baseRef.current ||
      !draftRef.current ||
      attemptRef.current
    )
      return;
    const checked = validate(draftRef.current);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length) {
      focusError(checked.errors);
      return;
    }
    const dirty = dirtyKeys(draftRef.current, baseRef.current);
    if (!dirty.length) {
      continueIfAllowed();
      return;
    }
    const attempt: Attempt = {
        token: { ...baseRef.current.token },
        values: Object.freeze({ ...checked.values }),
        keys: Object.freeze([...dirty]),
        draftVersion: draftVersion.current,
      },
      ticket = generation.current;
    attemptRef.current = attempt;
    working.current = true;
    setBusyState(true);
    readSequence.current++;
    setPhase("saving");
    setNotice("");
    let committed = false;
    try {
      current(ticket);
      const change = Object.freeze(patch(attempt));
      const result = await trackOperation(() =>
        store.update(attempt.token, (value) => ({
          ...value,
          study: {
            ...value.study,
            preferences: { ...value.study.preferences, ...change },
          },
        })),
      );
      current(ticket);
      if (result.epoch !== attempt.token.epoch) {
        revoke();
        return;
      }
      if (draftVersion.current !== attempt.draftVersion) return;
      apply(result, false);
      attemptRef.current = null;
      setPhase("ready");
      setNotice("Saved on this device.");
      committed = true;
    } catch (error) {
      if (!alive.current || ticket !== generation.current) return;
      try {
        current(ticket);
      } catch {
        revoke();
        return;
      }
      if (error instanceof CollectionsRevisionConflictError) {
        attemptRef.current = null;
        setPhase("conflict");
        setNotice(
          "Saved data changed. Reload the latest settings to keep your edits.",
        );
      } else {
        setPhase("checking");
        setNotice("Couldn’t confirm the save. Checking saved settings…");
        try {
          const value = await trackOperation(() => store.read());
          current(ticket);
          if (value.epoch !== attempt.token.epoch) {
            revoke();
            return;
          }
          const matched = attempt.keys.every(
            (key) => value.study.preferences[key] === attempt.values[key],
          );
          if (draftVersion.current !== attempt.draftVersion) return;
          apply(value, !matched);
          attemptRef.current = null;
          setPhase(matched ? "ready" : "failed");
          setNotice(
            matched
              ? "Saved on this device."
              : "Couldn’t save your changes. Your edits are still here.",
          );
          committed = matched;
        } catch {
          if (alive.current && ticket === generation.current) {
            setPhase("failed");
            setNotice("Couldn’t confirm the save. Your edits are still here.");
          }
        }
      }
    } finally {
      if (alive.current && ticket === generation.current) {
        working.current = false;
        setBusyState(false);
        if (!committed) {
          continuation.current = null;
          leaveTicket.current++;
        }
        const left = committed && continueIfAllowed();
        if (!left && !attemptRef.current && refreshRequested.current) {
          refreshRequested.current = false;
          void read("background");
        }
      }
    }
  }
  function canClose() {
    if (working.current || dirtyRef.current || attemptRef.current) {
      continuation.current = null;
      leaveTicket.current++;
      setNotice(
        working.current
          ? "Study settings are still working. Wait before closing."
          : "Save or cancel your Study changes before closing.",
      );
      return false;
    }
    return true;
  }
  const guard = useRef<SettingsLeaveGuard>({
    canClose: () => true,
    requestLeave: () => {},
  });
  guard.current.canClose = canClose;
  guard.current.requestLeave = (next) => {
    if (working.current) {
      continuation.current = null;
      leaveTicket.current++;
      setNotice("Study settings are still working. Wait before leaving.");
      return;
    }
    if (!dirtyRef.current && !attemptRef.current) {
      next();
      return;
    }
    leaveTicket.current++;
    continuation.current = next;
    setConfirm("leave");
  };
  useLayoutEffect(() => {
    alive.current = true;
    setBaseline(null);
    setDraft(null);
    setErrors({});
    setNotice("");
    setConfirm(null);
    setPhase("loading");
    openedVersion.current = lockVersion();
    const ticket = ++generation.current;
    let stopEpoch: (() => void) | undefined,
      stopClose: (() => void) | undefined,
      stopLock: (() => void) | undefined,
      stopSubscribe: (() => void) | undefined;
    const stopGuard = registerCloseGuard(() => guard.current.canClose());
    registration.current?.(guard.current);
    try {
      current(ticket);
      stopEpoch = onCollectionsEpochChange(store, revoke);
      stopClose = onCollectionsClose(store, revoke);
      stopLock = onLock(revoke);
      stopSubscribe = store.subscribe(() => {
        if (working.current || attemptRef.current)
          refreshRequested.current = true;
        else void read("background");
      });
      void read("initial");
    } catch {
      revoke();
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (working.current || dirtyRef.current || attemptRef.current)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      alive.current = false;
      generation.current++;
      readSequence.current++;
      draftRef.current = null;
      baseRef.current = null;
      attemptRef.current = null;
      dirtyRef.current = false;
      working.current = false;
      continuation.current = null;
      leaveTicket.current++;
      stopEpoch?.();
      stopClose?.();
      stopLock?.();
      stopSubscribe?.();
      stopGuard();
      registration.current?.(null);
      window.removeEventListener("beforeunload", unload);
    };
  }, [store, identity.accountId, identity.deviceId, identity.email]);
  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (working.current || !draftRef.current || !baseRef.current) return;
    continuation.current = null;
    leaveTicket.current++;
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    draftVersion.current++;
    dirtyRef.current = dirtyKeys(next, baseRef.current).length > 0;
    setDraft(next);
    setNotice("");
  }
  function keepEditing() {
    continuation.current = null;
    leaveTicket.current++;
    setConfirm(null);
  }
  const busy =
      busyState ||
      phase === "saving" ||
      phase === "checking" ||
      phase === "loading",
    dirty = draft && baseline ? dirtyKeys(draft, baseline) : [];
  if (phase === "closed")
    return (
      <section className="study-settings-status">
        <p role="status">
          Study settings are no longer available. Reopen them before making
          changes.
        </p>
        <button onClick={owner.retry}>Try again</button>
      </section>
    );
  if (!draft || !baseline)
    return (
      <section className="study-settings-status">
        <p role="status">
          {phase === "load-error"
            ? "Study settings couldn’t load. Try again."
            : "Loading Study settings…"}
        </p>
        {phase === "load-error" && (
          <button onClick={() => void read("initial")}>Try again</button>
        )}
      </section>
    );
  return (
    <section className="study-settings" aria-label="Study settings">
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          if (phase !== "conflict") void save();
        }}
        noValidate
      >
        <p className="study-settings-help">
          Limits apply when you start a session. Cards already queued stay
          available.
        </p>
        <p className="study-settings-help">
          Repeat reviews of cards studied today and Study more can exceed these
          limits.
        </p>
        {(["newPerDay", "reviewsPerDay"] as const).map((key) => (
          <div className="study-settings-row" key={key}>
            <label htmlFor={`${id}-${key}`}>
              <b>
                {key === "newPerDay" ? "New cards per day" : "Reviews per day"}
              </b>
              {dirty.includes(key) && (
                <small>Saved value: {baseline.values[key]}</small>
              )}
              {errors[key] && (
                <small id={`${id}-${key}-error`} className="error" role="alert">
                  {errors[key]}
                </small>
              )}
            </label>
            <input
              id={`${id}-${key}`}
              name={key}
              aria-label={
                key === "newPerDay" ? "New cards per day" : "Reviews per day"
              }
              aria-invalid={!!errors[key]}
              aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
              type="text"
              inputMode="numeric"
              value={draft[key]}
              disabled={busy}
              onChange={(event) => edit(key, event.target.value)}
              onBlur={() => {
                const current = draftRef.current;
                if (current)
                  setErrors((value) => ({
                    ...value,
                    [key]: validate(current).errors[key],
                  }));
              }}
            />
          </div>
        ))}
        <div className="study-settings-row">
          <label htmlFor={`${id}-day`}>
            <b>Day starts at</b>
            {dirty.includes("dayStartHour") && (
              <small>
                Saved value:{" "}
                {String(baseline.values.dayStartHour).padStart(2, "0")}:00
              </small>
            )}
            <small>
              {draft.dayStartHour === 0
                ? "The study day starts at midnight."
                : "Before this time, reviews count toward the previous study day."}
            </small>
            <small>Study time zone: {baseline.timezone}.</small>
            <small>
              Changing the day start regroups daily totals. Review due dates
              stay the same.
            </small>
          </label>
          <select
            id={`${id}-day`}
            name="dayStartHour"
            aria-label="Day starts at"
            value={draft.dayStartHour}
            disabled={busy}
            onChange={(event) =>
              edit("dayStartHour", Number(event.target.value))
            }
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
        {(["showNextReview", "showStreak"] as const).map((key) => (
          <label className="study-settings-row" key={key}>
            <span>
              <b>
                {key === "showNextReview"
                  ? "Show next review on answer buttons"
                  : "Show streak"}
              </b>
              {dirty.includes(key) && (
                <small>
                  Saved value: {baseline.values[key] ? "On" : "Off"}
                </small>
              )}
              <small>
                {key === "showNextReview"
                  ? "Show the next review interval for Again, Hard, Good and Easy."
                  : "Show your streak on the Progress page."}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={
                key === "showNextReview"
                  ? "Show next review on answer buttons"
                  : "Show streak"
              }
              checked={draft[key]}
              disabled={busy}
              onChange={(event) => edit(key, event.target.checked)}
            />
          </label>
        ))}
        {notice && (
          <p
            role={
              phase === "failed" || phase === "conflict" ? "alert" : "status"
            }
            className="study-settings-notice"
          >
            {notice}
          </p>
        )}
        {phase === "conflict" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void read("reload")}
          >
            Reload latest (keep edits)
          </button>
        )}
        {!!attemptRef.current && phase === "failed" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void read("check")}
          >
            Check saved settings
          </button>
        )}
        <div className="study-settings-footer">
          <span role="status">
            {!busy && dirty.length ? "Unsaved changes" : ""}
          </span>
          <button
            type="button"
            disabled={busy || (!dirty.length && !attemptRef.current)}
            onClick={() => {
              continuation.current = null;
              leaveTicket.current++;
              setConfirm("discard");
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              busy ||
              !dirty.length ||
              phase === "conflict" ||
              !!attemptRef.current
            }
          >
            {phase === "saving"
              ? "Saving…"
              : phase === "failed"
                ? "Try again"
                : "Save changes"}
          </button>
        </div>
      </form>
      <div className="study-settings-planned">
        {[
          ["Daily reminder", "Reminders aren’t available in this beta."],
          [
            "Add a daily Study task to Planner",
            "Planner integration isn’t available.",
          ],
          [
            "Suggest cards when I finish a note",
            "Card suggestions aren’t available.",
          ],
          ["Let my agent make cards", "Agent setup isn’t available."],
        ].map(([label, help]) => (
          <div className="study-settings-row" key={label}>
            <div>
              <b>{label}</b>
              <small>Planned · {help}</small>
            </div>
            <span className="study-planned-label">Planned</span>
          </div>
        ))}
      </div>
      {confirm && (
        <Dialog
          title={
            confirm === "leave"
              ? "Unsaved Study changes"
              : "Discard Study changes?"
          }
          onClose={keepEditing}
        >
          <p>
            {confirm === "leave"
              ? "Save or discard your Study changes before leaving."
              : "We’ll load the settings currently saved on this device."}
          </p>
          <div className="study-settings-confirm-actions">
            <button disabled={busy} onClick={keepEditing}>
              Keep editing
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                void read("discard");
              }}
            >
              {confirm === "leave" ? "Discard and continue" : "Discard changes"}
            </button>
            {confirm === "leave" && (
              <button
                className="primary"
                disabled={
                  busy ||
                  !!attemptRef.current ||
                  phase === "conflict" ||
                  Object.keys(validate(draft).errors).length > 0
                }
                onClick={() => {
                  const checked = validate(draftRef.current!);
                  setErrors(checked.errors);
                  if (Object.keys(checked.errors).length) {
                    setConfirm(null);
                    continuation.current = null;
                    leaveTicket.current++;
                    focusError(checked.errors);
                    return;
                  }
                  setConfirm(null);
                  void save();
                }}
              >
                Save and continue
              </button>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
