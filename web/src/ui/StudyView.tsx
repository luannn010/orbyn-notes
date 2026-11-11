import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouteHeading, type HeadingPresentation } from "./routeHeadingMotion";
import { flushSync } from "react-dom";
import { onLock, lockVersion } from "../account/session";
import {
  assertCollectionsAccess,
  onCollectionsClose,
  onCollectionsEpochChange,
} from "../collections/store";
import type {
  StudySourceOpenRequest,
  StudyEntryOpenRequest,
} from "./studySourceNavigation";
import type {
  CollectionsState,
  CollectionsStore,
  Grade,
  StudyEntry,
  StudyState,
} from "../collections/contracts";
import { CollectionsRevisionConflictError } from "../collections/contracts";
import {
  createDeck,
  saveEntry,
  deleteEntry,
  gradeCard,
  undoReview,
  reviewQueue,
  cardText,
  progress,
} from "../study/model";
import { nextSchedule, studyDay } from "../study/scheduler";
import { parseStudyCsv, importStudyCsv, exportStudyCsv } from "../study/csv";
import { registerCloseGuard, trackOperation } from "../desktop/closeGuard";
import { Dialog } from "./primitives";
import { Menu } from "./Menu";
import "../styles/study.css";
import { CardSearchPreview } from "./CardSearchPreview";
import { useStudyToastLifetime } from "./useStudyToastLifetime";
import {
  useStudyMotion,
  useStudyToastExit,
  useStudyColdLoading,
} from "./useStudyMotion";
import type { StudyMotionLocator } from "./useStudyMotion";
import type { CardContentInput } from "../study/cardContent";
import type {
  CardSearchOpenRequest,
  SearchReaderResult,
} from "./searchNavigation";

type Session = {
  id: string;
  deckId?: string;
  cards: string[];
  position: number;
  history: { eventId: string; position: number }[];
};
type ReviewIntent = {
  epoch: string;
  operationId: string;
  grade: Grade;
  at: Date;
  cardId: string;
  sessionId: string;
  position: number;
  checked: boolean;
};
type Form =
  | { kind: "deck" }
  | { kind: "card"; entry?: StudyEntry }
  | { kind: "delete"; entry: StudyEntry }
  | { kind: "import" }
  | { kind: "export" };
const grades: { grade: Grade; label: string }[] = [
  { grade: "again", label: "Again" },
  { grade: "hard", label: "Hard" },
  { grade: "good", label: "Good" },
  { grade: "easy", label: "Easy" },
];
const typeName = (entry: StudyEntry) =>
  entry.type === "cloze"
    ? "Fill in the blank"
    : entry.type === "reversed"
      ? "Reversed"
      : "Basic";
const countText = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;
function dateText(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
function intervalText(due: string, at: Date) {
  const minutes = Math.max(
    1,
    Math.round((Date.parse(due) - at.getTime()) / 60000),
  );
  return minutes < 60
    ? `${minutes} min`
    : minutes < 1440
      ? `${Math.round(minutes / 60)} h`
      : `${Math.round(minutes / 1440)} d`;
}

export function StudyView({
  store,
  heading,
  onOpenNote,
  onOpenSource,
  openEntry,
  openCard,
  onSearchReaderResult,
  onReturnToSearch,
  accountId,
  covered = false,
  onReopen,
}: {
  heading?: HeadingPresentation;
  onReopen?: () => void;
  covered?: boolean;
  store: CollectionsStore;
  onOpenNote?: (noteId: string) => void;
  onOpenSource?: (request: StudySourceOpenRequest) => void;
  openEntry?: StudyEntryOpenRequest | null;
  openCard?: CardSearchOpenRequest | null;
  onSearchReaderResult?: SearchReaderResult;
  onReturnToSearch?: () => void;
  accountId?: string;
}) {
  const headingLive = useRef(heading);
  headingLive.current = heading;
  const headingOwner = useRef({ store, accountId });
  const [cardPreview, setCardPreview] = useState<{
    request: CardSearchOpenRequest;
    input: CardContentInput;
    deckTitle: string;
    entryRevision: number;
    cardRevision: number;
    collectionsRevision: number;
    hasSource: boolean;
  } | null>(null);
  const cardAdmission = useRef(0),
    cardReaderResult = useRef(onSearchReaderResult);
  cardReaderResult.current = onSearchReaderResult;
  const [snapshot, setSnapshot] = useState<CollectionsState | null>(null);
  const current = useRef<CollectionsState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const revoked = useRef(false),
    ownerGeneration = useRef(0),
    ownerLockVersion = useRef(lockVersion()),
    readOwner = useRef(-1);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const dirty = useRef(false);
  const [guardNotice, setGuardNotice] = useState("");
  const [notice, setNotice] = useState("");
  const [deckId, setDeckId] = useState<string | null>(null);
  const [page, setPage] = useState<"decks" | "progress">("decks");
  const [filter, setFilter] = useState<"all" | "due" | "new" | "learned">(
    "all",
  );
  const [form, setForm] = useState<Form | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [answer, setAnswer] = useState(false);
  const [answerAt, setAnswerAt] = useState(() => new Date());
  const pendingReview = useRef<ReviewIntent | null>(null);
  const [toast, setToast] = useState<{ text: string; eventId: string } | null>(
    null,
  );
  const effectiveCovered = covered || cardPreview !== null || form !== null;
  const motion = useStudyMotion(effectiveCovered, validLocator);
  const coldLoading = useStudyColdLoading(
    snapshot !== null,
    !!readError,
    ownerGeneration.current,
  );
  const eligibleToastId =
    snapshot &&
    session &&
    toast &&
    toast.eventId === session.history.at(-1)?.eventId
      ? toast.eventId
      : null;
  const toastExit = useStudyToastExit(eligibleToastId, (eventId) =>
    setToast((current) => (current?.eventId === eventId ? null : current)),
  );
  const toastInteractions = useStudyToastLifetime(
    snapshot &&
      session &&
      toast &&
      toast.eventId === session.history.at(-1)?.eventId
      ? toast.eventId
      : null,
    toastExit.expire,
    effectiveCovered,
  );
  const [now, setNow] = useState(() => new Date());
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const surface = useRef<HTMLElement>(null);
  const motionFocus = useRef<Element | null>(null);
  function locator(
    value: CollectionsState,
    cardId: string,
    sessionId: string,
    side: StudyMotionLocator["side"],
  ): StudyMotionLocator | null {
    const card = value.study.cards.find((item) => item.id === cardId),
      entry =
        card && value.study.entries.find((item) => item.id === card.entryId);
    return card && entry
      ? {
          epoch: value.epoch,
          sessionId,
          cardId,
          entryId: entry.id,
          cardRevision: card.revision,
          entryRevision: entry.revision,
          side,
        }
      : null;
  }
  function validLocator(item: StudyMotionLocator) {
    const value = current.current,
      card = value?.study.cards.find((card) => card.id === item.cardId),
      entry = value?.study.entries.find((entry) => entry.id === item.entryId);
    return (
      value?.epoch === item.epoch &&
      session?.id === item.sessionId &&
      card?.entryId === item.entryId &&
      card.revision === item.cardRevision &&
      entry?.revision === item.entryRevision
    );
  }
  function clearPrivate(closed: boolean, synchronous = true, retireHeading = true) {
    if (retireHeading) headingLive.current?.controller.invalidate("study");
    ownerGeneration.current++;
    sequence.current++;
    cardAdmission.current++;
    revoked.current = closed;
    current.current = null;
    pendingReview.current = null;
    dirty.current = false;
    working.current = false;
    motionFocus.current = null;
    const clear = () => {
      motion.invalidate();
      setSnapshot(null);
      setSession(null);
      setAnswer(false);
      setToast(null);
      setForm(null);
      setCardPreview(null);
      setDeckId(null);
      setPage("decks");
      setFilter("all");
      setError("");
      setReadError("");
      setNotice("");
      setGuardNotice("");
      setConflict(false);
      setBusy(false);
      setUnavailable(closed);
    };
    if (synchronous) flushSync(clear);
    else clear();
  }
  function ownerCurrent(ticket: number) {
    if (
      revoked.current ||
      ticket !== ownerGeneration.current ||
      lockVersion() !== ownerLockVersion.current ||
      !mounted.current
    )
      return false;
    try {
      assertCollectionsAccess(store);
      return true;
    } catch {
      return false;
    }
  }
  useLayoutEffect(() => {
    if (motion.locator && !validLocator(motion.locator)) motion.invalidate();
  }, [snapshot, session?.id, motion.nonce]);
  useLayoutEffect(() => {
    if (effectiveCovered || motion.exiting || !session) return;
    const focused = document.activeElement;
    if (
      motionFocus.current &&
      (focused === motionFocus.current ||
        focused === document.body ||
        focused === surface.current)
    ) {
      surface.current
        ?.querySelector<HTMLElement>(
          answer
            ? ".study-flash:not([inert])"
            : ".study-flash:not([inert]) .primary",
        )
        ?.focus({ preventScroll: true });
    }
    motionFocus.current = null;
  }, [motion.phase, session?.position, answer, effectiveCovered]);
  useEffect(() => {
    if (!snapshot) return;
    const time = Date.now();
    const next = snapshot.study.cards.reduce((due, card) => {
      const candidate = Date.parse(card.schedule.due);
      return candidate > time ? Math.min(due, candidate) : due;
    }, time + 60_000);
    const timer = setTimeout(
      () => setNow(new Date()),
      Math.max(25, next - time + 5),
    );
    return () => clearTimeout(timer);
  }, [snapshot?.study, now]);

  function accept(value: CollectionsState) {
    if (revoked.current) return;
    if (current.current && current.current.epoch !== value.epoch) {
      headingLive.current?.controller.invalidate("study");
      motion.invalidate();
      setCardPreview(null);
      cardAdmission.current++;
      dirty.current = false;
      pendingReview.current = null;
      setForm(null);
      setSession(null);
      setAnswer(false);
      setToast(null);
      setDeckId(null);
      setPage("decks");
      setFilter("all");
      setGuardNotice("");
      setNotice("");
      setError("");
      setConflict(false);
    } else if (current.current && value.revision < current.current.revision)
      return;
    current.current = value;
    setSnapshot(value);
    setNow(new Date());
    confirmReview(value);
  }
  function confirmReview(value: CollectionsState) {
    const intent = pendingReview.current;
    if (!intent || intent.epoch !== value.epoch) return false;
    const event = value.study.events.find(
      (item) => item.id === intent.operationId,
    );
    if (
      !event ||
      event.undoneAt ||
      !value.study.cards.some((card) => card.id === intent.cardId)
    )
      return false;
    if (
      event.cardId !== intent.cardId ||
      event.sessionId !== intent.sessionId ||
      event.grade !== intent.grade ||
      event.at !== intent.at.toISOString()
    )
      return false;
    pendingReview.current = null;
    const outgoing = locator(value, intent.cardId, intent.sessionId, "answer");
    if (outgoing) {
      motionFocus.current = document.activeElement;
      motion.begin("confirmed-exit", outgoing, event.id);
    }
    setSession((previous) =>
      previous?.id === intent.sessionId
        ? {
            ...previous,
            position: intent.position + 1,
            history: [
              ...previous.history,
              { eventId: intent.operationId, position: intent.position },
            ],
          }
        : previous,
    );
    setAnswer(false);
    setError("");
    setConflict(false);
    setGuardNotice("");
    setToast({
      eventId: intent.operationId,
      text: `Graded ${grades.find((item) => item.grade === intent.grade)!.label} · next review in ${intervalText(event.after.schedule.due, intent.at)}`,
    });
    return true;
  }
  async function load(resetConflict = false) {
    const request = ++sequence.current;
    const ownerTicket = ownerGeneration.current;
    if (!ownerCurrent(ownerTicket)) return;
    readOwner.current = ownerTicket;
    if (!current.current) setReadError("");
    try {
      const value = await store.read();
      if (!ownerCurrent(ownerTicket) || request !== sequence.current) return;
      accept(value);
      if (current.current === value) headingLive.current?.controller.admit("study");
      setReadError("");
      if (resetConflict) {
        if (pendingReview.current?.epoch === value.epoch)
          pendingReview.current.checked = true;
        setConflict(false);
        setError("");
      }
    } catch {
      if (ownerCurrent(ownerTicket) && request === sequence.current)
        setReadError("Couldn’t load your decks. Try again.");
    }
  }
  useLayoutEffect(() => {
    mounted.current = true;
    ownerLockVersion.current = lockVersion();
    if (headingOwner.current.store !== store || headingOwner.current.accountId !== accountId) {
      headingLive.current?.controller.invalidate("study");
      headingOwner.current = { store, accountId };
    }
    clearPrivate(false, false, false);
    let stopClose: (() => void) | undefined,
      stopEpoch: (() => void) | undefined,
      stopLock: (() => void) | undefined,
      unsubscribe: (() => void) | undefined;
    try {
      assertCollectionsAccess(store);
      stopClose = onCollectionsClose(store, () => clearPrivate(true));
      stopEpoch = onCollectionsEpochChange(store, () => {
        clearPrivate(false);
        const ticket = ownerGeneration.current;
        queueMicrotask(() => {
          if (ownerCurrent(ticket) && readOwner.current !== ticket) void load();
        });
      });
      stopLock = onLock(() => clearPrivate(true));
      unsubscribe = store.subscribe(() => void load());
      void load();
    } catch {
      clearPrivate(true, false);
    }
    return () => {
      mounted.current = false;
      sequence.current++;
      motion.invalidate();
      unsubscribe?.();
      stopClose?.();
      stopEpoch?.();
      stopLock?.();
      ownerGeneration.current++;
      revoked.current = true;
      current.current = null;
      pendingReview.current = null;
      dirty.current = false;
      working.current = false;
    };
  }, [store, accountId]);
  useEffect(() => {
    if (!openEntry) return;
    let active = true;
    const request = ++sequence.current;
    const ownerTicket = ownerGeneration.current;
    void trackOperation(() => store.read())
      .then((value) => {
        if (
          !active ||
          !ownerCurrent(ownerTicket) ||
          request !== sequence.current
        )
          return;
        accept(value);
        const entry = value.study.entries.find(
          (entry) => entry.id === openEntry.entryId,
        );
        if (!entry) {
          setError("This card is no longer available.");
          return;
        }
        setDeckId(entry.deckId);
        setPage("decks");
        setForm({ kind: "card", entry });
      })
      .catch(() => {
        if (active && ownerCurrent(ownerTicket) && request === sequence.current)
          setError(
            "Couldn’t open this card. Your saved cards were not changed.",
          );
      });
    return () => {
      active = false;
    };
  }, [store, openEntry?.key]);
  useLayoutEffect(() => {
    if (!openCard) setCardPreview(null);
  }, [openCard?.requestId]);
  useEffect(() => {
    const ticket = ++cardAdmission.current;
    if (!openCard) return;
    const request = openCard;
    if (dirty.current || working.current || pendingReview.current) {
      cardReaderResult.current?.(request.requestId, "blocked");
      return;
    }
    void trackOperation(() => store.read())
      .then((value) => {
        if (!mounted.current || ticket !== cardAdmission.current) return;
        if (dirty.current || working.current || pendingReview.current) {
          cardReaderResult.current?.(request.requestId, "blocked");
          return;
        }
        const target = request.target,
          card = value.study.cards.find(
            (card) =>
              card.id === target.cardId &&
              card.entryId === target.entryId &&
              card.key === target.key,
          ),
          entry = value.study.entries.find(
            (entry) => entry.id === target.entryId,
          );
        if (
          !accountId ||
          accountId !== target.accountId ||
          value.epoch !== target.collectionsEpoch ||
          !card ||
          !entry
        ) {
          cardReaderResult.current?.(request.requestId, "unavailable");
          return;
        }
        let input: CardContentInput;
        if (entry.type === "basic" && card.key === "basic:forward")
          input = {
            type: "basic",
            key: card.key,
            front: entry.front,
            back: entry.back,
          };
        else if (
          entry.type === "reversed" &&
          (card.key === "reversed:forward" || card.key === "reversed:reverse")
        )
          input = {
            type: "reversed",
            key: card.key,
            front: entry.front,
            back: entry.back,
          };
        else if (
          entry.type === "cloze" &&
          card.key.startsWith("cloze:") &&
          entry.blanks.some((blank) => `cloze:${blank.id}` === card.key)
        )
          input = {
            type: "cloze",
            key: card.key as `cloze:${string}`,
            text: entry.text,
            blanks: entry.blanks,
          };
        else {
          cardReaderResult.current?.(request.requestId, "unavailable");
          return;
        }
        accept(value);
        setForm(null);
        setCardPreview({
          request,
          input,
          deckTitle:
            value.study.decks.find((deck) => deck.id === entry.deckId)?.title ??
            "Untitled deck",
          entryRevision: entry.revision,
          cardRevision: card.revision,
          collectionsRevision: value.revision,
          hasSource: !!entry.source,
        });
        cardReaderResult.current?.(request.requestId, "opened");
      })
      .catch(() => {
        if (mounted.current && ticket === cardAdmission.current)
          cardReaderResult.current?.(request.requestId, "unavailable");
      });
    return () => {
      cardAdmission.current++;
    };
  }, [store, accountId, openCard?.requestId]);
  useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
      setNow(new Date());
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  useLayoutEffect(
    () =>
      registerCloseGuard(() => {
        if (!dirty.current && !working.current && !pendingReview.current)
          return true;
        setGuardNotice(
          pendingReview.current
            ? "This review hasn’t been confirmed. Reload to check it before leaving."
            : "Your Study changes are only in this window. Save or cancel before leaving.",
        );
        return false;
      }),
    [],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty.current || working.current || pendingReview.current)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    if (session && !form && !effectiveCovered)
      surface.current?.focus({ preventScroll: true });
  }, [session?.id]);

  async function commit(
    change: (state: StudyState) => StudyState,
    failure: string,
  ): Promise<CollectionsState | null> {
    const expected = current.current;
    const ownerTicket = ownerGeneration.current;
    if (!expected || working.current || conflict || !ownerCurrent(ownerTicket))
      return null;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await trackOperation(() =>
        store.update(expected, (state) => ({
          ...state,
          study: change(state.study),
        })),
      );
      if (
        !ownerCurrent(ownerTicket) ||
        current.current?.epoch !== expected.epoch
      )
        return null;
      sequence.current++;
      accept(value);
      setGuardNotice("");
      return value;
    } catch (cause) {
      if (
        !ownerCurrent(ownerTicket) ||
        current.current?.epoch !== expected.epoch
      )
        return null;
      const changed =
        cause instanceof CollectionsRevisionConflictError ||
        (typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "collections_revision_conflict");
      setConflict(changed);
      const entryChanged =
        cause instanceof Error && cause.message.startsWith("entry_conflict:");
      setError(
        changed
          ? "Study changed in another window. Your draft is still here. Reload before trying again."
          : entryChanged
            ? "This card changed in another window. Your draft is still here. Copy your changes, then reopen the card."
            : failure,
      );
      return null;
    } finally {
      if (ownerCurrent(ownerTicket)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  function openForm(next: Form) {
    setError("");
    setGuardNotice("");
    dirty.current = false;
    setForm(next);
  }
  function closeForm() {
    if (working.current) return;
    dirty.current = false;
    setGuardNotice("");
    setError("");
    setForm(null);
  }
  function markDirty() {
    dirty.current = true;
  }
  async function addDeck(title: string) {
    const ownerTicket = ownerGeneration.current;
    const at = new Date();
    const value = await commit(
      (state) => createDeck(state, title, at),
      "Couldn’t create this deck. Your name is still here. Try again.",
    );
    if (value && ownerCurrent(ownerTicket)) {
      const created = value.study.decks.find(
        (deck) =>
          !snapshot?.study.decks.some((previous) => previous.id === deck.id),
      );
      closeForm();
      if (created) setDeckId(created.id);
    }
  }
  async function persistEntry(entry: StudyEntry) {
    const ownerTicket = ownerGeneration.current;
    const at = new Date();
    const value = await commit(
      (state) => saveEntry(state, entry, at),
      "Couldn’t save this card. Your draft is still here. Try again.",
    );
    if (value && ownerCurrent(ownerTicket)) closeForm();
  }
  function startReview(more = false) {
    const state = current.current?.study;
    if (!state || working.current) return;
    const at = new Date();
    const selected = deckId
      ? state.cards.filter((card) =>
          state.entries.some(
            (entry) => entry.id === card.entryId && entry.deckId === deckId,
          ),
        )
      : state.cards;
    const queue = more
      ? [...selected].sort(
          (a, b) =>
            a.schedule.due.localeCompare(b.schedule.due) ||
            a.id.localeCompare(b.id),
        )
      : reviewQueue(state, at, deckId ?? undefined);
    setSession({
      id: crypto.randomUUID(),
      deckId: deckId ?? undefined,
      cards: queue.map((card) => card.id),
      position: 0,
      history: [],
    });
    motion.enter();
    setAnswer(false);
    setAnswerAt(at);
    setError("");
    setToast(null);
    setNow(at);
  }
  async function grade(grade: Grade) {
    if (!session || !answer || working.current || motion.phase !== "stable")
      return;
    const cardId = session.cards[session.position];
    if (!cardId) return;
    const existing = pendingReview.current;
    if (existing && (existing.grade !== grade || !existing.checked)) return;
    const intent = existing ?? {
      epoch: current.current!.epoch,
      operationId: crypto.randomUUID(),
      grade,
      at: answerAt,
      cardId,
      sessionId: session.id,
      position: session.position,
      checked: true,
    };
    pendingReview.current = intent;
    const value = await commit(
      (state) =>
        gradeCard(
          state,
          intent.cardId,
          intent.grade,
          intent.sessionId,
          intent.operationId,
          intent.at,
        ),
      "Couldn’t save this review. Your answer is still here. Try again.",
    );
    if (value) confirmReview(value);
    if (pendingReview.current === intent) {
      intent.checked = false;
      setError(
        "Couldn’t confirm this review. Reload to check whether it was saved.",
      );
    } else if (mounted.current) setError("");
  }
  async function undo() {
    const last = session?.history.at(-1);
    if (!last || !session || working.current || pendingReview.current) return;
    motion.invalidate();
    const at = new Date();
    const ownerTicket = ownerGeneration.current;
    const value = await commit(
      (state) => undoReview(state, last.eventId, at),
      "Couldn’t undo this review. Your saved grade was not changed. Try again.",
    );
    if (!value || !ownerCurrent(ownerTicket)) return;
    setSession({
      ...session,
      position: last.position,
      history: session.history.slice(0, -1),
    });
    setAnswer(true);
    setAnswerAt(new Date());
    setToast(null);
    motion.enter();
  }
  function keyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (
      !session ||
      form ||
      busy ||
      event.defaultPrevented ||
      event.repeat ||
      event.nativeEvent.isComposing
    )
      return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input,textarea,select,button,a,[role="button"],dialog,[contenteditable="true"],[role="menu"],[role="listbox"]',
      )
    )
      return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      void undo();
    } else if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key === " " &&
      !motion.exiting &&
      !answer &&
      session.position < session.cards.length
    ) {
      event.preventDefault();
      reveal();
    } else if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      answer &&
      motion.phase === "stable" &&
      /^[1-4]$/.test(event.key)
    ) {
      event.preventDefault();
      void grade(grades[Number(event.key) - 1]!.grade);
    }
  }
  function reveal() {
    if (answer || motion.exiting || !session || !current.current) return;
    const outgoing = locator(
      current.current,
      session.cards[session.position]!,
      session.id,
      "question",
    );
    if (!outgoing) return;
    motionFocus.current = document.activeElement;
    motion.begin("reveal-exit", outgoing);
    setAnswerAt(new Date());
    setAnswer(true);
  }
  function toggleStreak() {
    const next = !current.current?.study.preferences.showStreak;
    void commit(
      (state) => ({
        ...state,
        preferences: { ...state.preferences, showStreak: next },
      }),
      "Couldn’t save this preference. Try again.",
    );
  }

  const cachedProgress = useMemo(
    () => (snapshot ? progress(snapshot.study, now) : null),
    [snapshot?.study, now],
  );
  const cachedDue = useMemo(
    () =>
      snapshot ? reviewQueue(snapshot.study, now, deckId ?? undefined) : [],
    [snapshot?.study, now, deckId],
  );
  const headingRef = useRouteHeading(
    heading && { ...heading, active: heading.active && !covered && !form },
    "study",
    unavailable || readError ? "absent" : !snapshot ? "pending" : session || cardPreview ? "absent" : "target",
    coldLoading.entering,
  );
  if (unavailable)
    return (
      <section className="study-view" aria-label="Study">
        <p role="status">Study is no longer available.</p>
        {onReopen && <button onClick={onReopen}>Try again</button>}
      </section>
    );
  if (!snapshot)
    return (
      <section className="study-view" aria-label="Study" aria-busy={!readError}>
        <header className="study-heading">
          <h1>Study</h1>
        </header>
        {readError ? (
          <div className="study-empty">
            <h2>Couldn’t load your decks.</h2>
            <p>Your saved cards have not been changed.</p>
            <button onClick={() => void load()}>Try again</button>
          </div>
        ) : coldLoading.loader ? (
          <div className="study-skeleton" aria-label="Loading decks">
            <span className="study-loading-ring" aria-hidden="true" />
            <div />
            <div />
            <div />
          </div>
        ) : null}
      </section>
    );
  const state = snapshot.study;
  const showStreak = state.preferences.showStreak;
  const metrics = cachedProgress!;
  const deck = state.decks.find((item) => item.id === deckId);
  const entries = deckId
    ? state.entries.filter((entry) => entry.deckId === deckId)
    : state.entries;
  const cards = state.cards.filter((card) =>
    entries.some((entry) => entry.id === card.entryId),
  );
  const due = cachedDue;
  const activeCard = session
    ? state.cards.find((card) => card.id === session.cards[session.position])
    : undefined;
  const activeEntry = activeCard
    ? state.entries.find((entry) => entry.id === activeCard.entryId)
    : undefined;
  const reviewText =
    activeCard && activeEntry ? cardText(activeEntry, activeCard.key) : null;
  const outgoing =
    motion.exiting && motion.locator && validLocator(motion.locator)
      ? motion.locator
      : null;
  const shownCard = outgoing
    ? state.cards.find((item) => item.id === outgoing.cardId)
    : activeCard;
  const shownEntry = outgoing
    ? state.entries.find((item) => item.id === outgoing.entryId)
    : activeEntry;
  const shownAnswer = outgoing ? outgoing.side === "answer" : answer;
  const shownText =
    outgoing && shownCard && shownEntry
      ? cardText(shownEntry, shownCard.key)
      : reviewText;
  const complete = session !== null && session.position >= session.cards.length;
  const lastEvent = session?.history.at(-1);
  const remainingDue = state.cards.filter(
    (card) =>
      Date.parse(card.schedule.due) <= now.getTime() &&
      (!session?.deckId ||
        state.entries.some(
          (entry) =>
            entry.id === card.entryId && entry.deckId === session.deckId,
        )),
  ).length;
  const nextDue = cards
    .filter((card) => Date.parse(card.schedule.due) > now.getTime())
    .sort((a, b) => a.schedule.due.localeCompare(b.schedule.due))[0];
  const doneForToday =
    remainingDue === 0 &&
    (!nextDue ||
      studyDay(
        new Date(nextDue.schedule.due),
        state.preferences.timezone,
        state.preferences.dayStartHour,
      ) >
        studyDay(
          now,
          state.preferences.timezone,
          state.preferences.dayStartHour,
        ));

  return (
    <section
      className={`study-view${coldLoading.entering ? " study-content-enter" : ""}`}
      aria-label="Study"
      ref={surface}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (!cardPreview) keyboard(event);
      }}
    >
      {coldLoading.entering && (
        <div className="study-skeleton study-loader-exit" aria-hidden="true">
          <span className="study-loading-ring" />
          <div />
          <div />
          <div />
        </div>
      )}
      {cardPreview && (
        <CardSearchPreview
          key={cardPreview.request.requestId}
          input={cardPreview.input}
          deckTitle={cardPreview.deckTitle}
          scopeVersion={snapshot!.revision}
          isCurrent={() => {
            const value = current.current,
              target = cardPreview.request.target;
            return (
              !!value &&
              accountId === target.accountId &&
              value.epoch === target.collectionsEpoch &&
              value.revision === cardPreview.collectionsRevision
            );
          }}
          onClose={() => setCardPreview(null)}
          onBack={() => {
            setCardPreview(null);
            onReturnToSearch?.();
          }}
          onOpenSource={
            cardPreview.hasSource && onOpenSource
              ? () => {
                  const target = cardPreview.request.target;
                  setCardPreview(null);
                  onOpenSource({
                    entryId: target.entryId,
                    cardId: target.cardId,
                  });
                }
              : undefined
          }
        />
      )}
      {offline && (
        <p className="study-banner" role="status">
          You’re offline. Reviews are saved on this device.
        </p>
      )}
      {readError && (
        <div className="study-banner" role="alert">
          {readError} <button onClick={() => void load()}>Try again</button>
        </div>
      )}
      {guardNotice && (
        <p className="study-banner" role="status">
          {guardNotice}
        </p>
      )}
      {notice && (
        <p className="study-banner" role="status">
          {notice}
          <button
            aria-label="Dismiss Study notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </p>
      )}
      {error && !form && (
        <div className="study-banner error" role="alert">
          {error}
          {(conflict || pendingReview.current) && (
            <button disabled={busy} onClick={() => void load(true)}>
              Reload
            </button>
          )}
        </div>
      )}
      {session ? (
        <>
          <header className="study-review-heading">
            <span
              className="study-review-track"
              role="progressbar"
              aria-label="Review progress"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, session.cards.length)}
              aria-valuenow={session.position}
            >
              <i
                style={{
                  width: `${session.cards.length ? (100 * session.position) / session.cards.length : 0}%`,
                }}
              />
            </span>
            <span>
              {complete
                ? "Done"
                : `${session.position + 1} of ${session.cards.length}`}
            </span>
            <button
              aria-label="End session"
              disabled={busy || !!pendingReview.current}
              onClick={() => {
                setSession(null);
                setToast(null);
                setError("");
              }}
            >
              ×
            </button>
          </header>
          <div className="study-review-body">
            {complete && !outgoing ? (
              <div className="study-done">
                <h1 className={doneForToday ? "study-done-label" : undefined}>
                  {doneForToday ? "Done for today" : "Session complete"}
                </h1>
                <p>{countText(session.history.length, "card")} reviewed</p>
                <p>
                  {doneForToday
                    ? "That is everything due. Nothing is waiting for you."
                    : "Your reviews are saved on this device."}
                </p>
                {nextDue && (
                  <p>
                    Next review ·{" "}
                    {new Date(nextDue.schedule.due).toLocaleString()}
                  </p>
                )}
                <div className="study-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSession(null);
                      setToast(null);
                    }}
                  >
                    Done
                  </button>
                  {cards.length > 0 && (
                    <button disabled={busy} onClick={() => startReview(true)}>
                      Study more
                    </button>
                  )}
                </div>
                <small>
                  Study more shows cards that are not due yet. It never changes
                  your schedule beyond normal grading.
                </small>
              </div>
            ) : shownCard && shownEntry && shownText ? (
              <div className="study-review-stack">
                <article
                  key={`${shownCard.id}-${shownAnswer}-${motion.nonce}`}
                  className="study-flash"
                  data-study-motion={motion.phase}
                  onAnimationEnd={(event) => {
                    if (!motion.locator || validLocator(motion.locator))
                      motion.onAnimationEnd(event);
                    else motion.invalidate();
                  }}
                  inert={!!outgoing}
                  aria-hidden={outgoing ? true : undefined}
                  tabIndex={-1}
                  aria-label={shownAnswer ? "Card answer" : "Card question"}
                >
                  <span className="study-caption">
                    {
                      state.decks.find((item) => item.id === shownEntry.deckId)
                        ?.title
                    }
                  </span>
                  <div className="study-question">{shownText.front}</div>
                  {shownAnswer ? (
                    <>
                      <div className="study-answer">{shownText.back}</div>
                      {!outgoing &&
                        shownEntry.source &&
                        (onOpenSource || onOpenNote) && (
                          <button
                            className="study-source"
                            onClick={() =>
                              onOpenSource
                                ? onOpenSource({
                                    entryId: shownEntry.id,
                                    cardId: shownCard.id,
                                  })
                                : onOpenNote?.(shownEntry.source!.noteId)
                            }
                          >
                            Open in note
                          </button>
                        )}
                    </>
                  ) : (
                    <>
                      <button className="primary" onClick={reveal}>
                        Show answer
                      </button>
                      <small>Space</small>
                    </>
                  )}
                </article>
                {answer && !outgoing && (
                  <>
                    <div className="study-grades">
                      {grades.map(({ grade: value, label }, index) => (
                        <button
                          key={value}
                          disabled={
                            busy ||
                            motion.phase !== "stable" ||
                            conflict ||
                            (!!pendingReview.current &&
                              (!pendingReview.current.checked ||
                                pendingReview.current.grade !== value))
                          }
                          onClick={() => void grade(value)}
                        >
                          <span>{label}</span>
                          {state.preferences.showNextReview && (
                            <small>
                              <time
                                dateTime={
                                  nextSchedule(
                                    shownCard.schedule,
                                    value,
                                    answerAt,
                                  ).due
                                }
                              >
                                {intervalText(
                                  nextSchedule(
                                    shownCard.schedule,
                                    value,
                                    answerAt,
                                  ).due,
                                  answerAt,
                                )}
                              </time>
                            </small>
                          )}
                          <kbd>{index + 1}</kbd>
                        </button>
                      ))}
                    </div>
                    <p className="study-caption">
                      {state.preferences.showNextReview
                        ? "Press 1, 2, 3 or 4. The interval under each button is until the next review."
                        : "Press 1, 2, 3 or 4."}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="study-empty">
                <h2>This card is no longer available</h2>
                <button onClick={() => setSession(null)}>Back to Study</button>
              </div>
            )}
          </div>
          {toast && lastEvent?.eventId === toast.eventId && (
            <div
              className="study-toast"
              data-exiting={toastExit.exiting || undefined}
              inert={toastExit.exiting}
              aria-hidden={toastExit.exiting || undefined}
              role="status"
              {...toastInteractions}
              onAnimationEnd={toastExit.onAnimationEnd}
            >
              <span>{toast.text}</span>
              <button
                disabled={busy || !!pendingReview.current}
                onClick={() => void undo()}
              >
                Undo
              </button>
              <kbd>Ctrl+Z</kbd>
            </div>
          )}
        </>
      ) : (
        <>
          <header className="study-heading">
            <div>
              <h1 ref={headingRef}>
                {page === "progress" ? "Progress" : (deck?.title ?? "Study")}
              </h1>
              <span>
                {page === "progress"
                  ? "Study · Last 30 days"
                  : deck
                    ? `${countText(cards.length, "card")} · ${due.length} due`
                    : state.decks.length
                      ? `${countText(due.length, "card")} due today`
                      : "No decks yet"}
              </span>
            </div>
            <div className="study-actions">
              {(deckId || page === "progress") && (
                <button
                  onClick={() => {
                    setDeckId(null);
                    setPage("decks");
                  }}
                >
                  Back to Study
                </button>
              )}
              {page !== "progress" && (
                <>
                  <button
                    onClick={() =>
                      openForm(deck ? { kind: "card" } : { kind: "deck" })
                    }
                  >
                    {deck ? "Add card" : "New deck"}
                  </button>
                  {deck && (
                    <>
                      <button onClick={() => openForm({ kind: "import" })}>
                        Import CSV
                      </button>
                      <button onClick={() => openForm({ kind: "export" })}>
                        Export CSV
                      </button>
                    </>
                  )}
                  {due.length > 0 && (
                    <button className="primary" onClick={() => startReview()}>
                      Study {countText(due.length, "card")}
                    </button>
                  )}
                  <button onClick={() => setPage("progress")}>Progress</button>
                </>
              )}
            </div>
          </header>
          <div className="study-content">
            {page === "progress" ? (
              <>
                <div className="study-stats">
                  <Stat
                    label="Remembered, last 30 days"
                    value={
                      metrics.remembered === null
                        ? "No reviews yet"
                        : `${Math.round(metrics.remembered * 100)}%`
                    }
                  />
                  <Stat
                    label="Reviews, last 30 days"
                    value={metrics.reviewedLast30Days}
                  />
                  <Stat label="Cards" value={metrics.cardCount} />
                </div>
                <Forecast
                  days={metrics.dueNext14Days}
                  title="Due in the next 14 days"
                />
                <div className="study-card">
                  <b>Remembered</b>
                  <span>Good and Easy answers</span>
                  {metrics.remembered === null ? (
                    <p>No reviews yet</p>
                  ) : (
                    <>
                      <meter
                        min={0}
                        max={1}
                        value={metrics.remembered}
                        aria-label="Remembered, last 30 days"
                      />
                      <span>
                        {Math.round(metrics.remembered * 100)}% over the last 30
                        days
                      </span>
                    </>
                  )}
                </div>
                <div className="study-streak">
                  {showStreak && (
                    <span>Streak {countText(metrics.streak, "day")}</span>
                  )}
                  <button disabled={busy} onClick={toggleStreak}>
                    {showStreak ? "Hide streak" : "Show streak"}
                  </button>
                </div>
              </>
            ) : deckId ? (
              deck ? (
                <>
                  <div
                    className="study-filters"
                    role="group"
                    aria-label="Filter cards"
                  >
                    {(["all", "due", "new", "learned"] as const).map(
                      (value) => (
                        <button
                          key={value}
                          aria-pressed={filter === value}
                          onClick={() => setFilter(value)}
                        >
                          {value === "all"
                            ? "All"
                            : value === "due"
                              ? "Due"
                              : value === "new"
                                ? "New"
                                : "Learned"}{" "}
                          {value === "all"
                            ? cards.length
                            : value === "due"
                              ? due.length
                              : cards.filter((card) =>
                                  value === "new"
                                    ? card.schedule.state === "new"
                                    : card.schedule.state === "review",
                                ).length}
                        </button>
                      ),
                    )}
                  </div>
                  {cards.length === 0 ? (
                    <div className="study-empty">
                      <h2>No cards in this deck yet</h2>
                      <p>
                        Select words in a note and choose Make a card, or add
                        one by hand.
                      </p>
                      <button
                        className="primary"
                        onClick={() => openForm({ kind: "card" })}
                      >
                        Add card
                      </button>
                    </div>
                  ) : (
                    <div className="study-table-wrap">
                      <table className="study-table">
                        <thead>
                          <tr>
                            <th>Card</th>
                            <th>Type</th>
                            <th>Due</th>
                            <th>From</th>
                            <th>
                              <span className="study-sr">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {cards
                            .filter(
                              (card) =>
                                filter === "all" ||
                                (filter === "due"
                                  ? due.some((item) => item.id === card.id)
                                  : filter === "new"
                                    ? card.schedule.state === "new"
                                    : card.schedule.state === "review"),
                            )
                            .map((card) => {
                              const entry = entries.find(
                                (item) => item.id === card.entryId,
                              )!;
                              return (
                                <tr key={card.id}>
                                  <td>
                                    <button
                                      className="study-text-button"
                                      onClick={() =>
                                        openForm({ kind: "card", entry })
                                      }
                                    >
                                      {cardText(entry, card.key).front}
                                    </button>
                                  </td>
                                  <td>{typeName(entry)}</td>
                                  <td>
                                    {Date.parse(card.schedule.due) <=
                                    now.getTime()
                                      ? "Today"
                                      : dateText(card.schedule.due)}
                                  </td>
                                  <td>
                                    {entry.source &&
                                    (onOpenSource || onOpenNote) ? (
                                      <button
                                        className="study-source"
                                        onClick={() =>
                                          onOpenSource
                                            ? onOpenSource({
                                                entryId: entry.id,
                                                cardId: card.id,
                                              })
                                            : onOpenNote?.(entry.source!.noteId)
                                        }
                                      >
                                        Open in note
                                      </button>
                                    ) : entry.source ? (
                                      "Linked note"
                                    ) : (
                                      "Added by hand"
                                    )}
                                  </td>
                                  <td>
                                    <Menu
                                      label="Card menu"
                                      actions={[
                                        {
                                          label: "Edit card",
                                          onSelect: () =>
                                            openForm({ kind: "card", entry }),
                                        },
                                        {
                                          label: "Delete card",
                                          danger: true,
                                          onSelect: () =>
                                            openForm({ kind: "delete", entry }),
                                        },
                                      ]}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="study-empty">
                  <h2>This deck is no longer available</h2>
                  <button onClick={() => setDeckId(null)}>Back to Study</button>
                </div>
              )
            ) : state.decks.length === 0 ? (
              <div className="study-empty">
                <h2>Make your first card from a note</h2>
                <p>Select words in any note and choose Make a card.</p>
                <button
                  className="primary"
                  onClick={() => openForm({ kind: "deck" })}
                >
                  New deck
                </button>
              </div>
            ) : (
              <>
                <div className="study-stats">
                  <Stat label="Due today" value={due.length} />
                  <Stat
                    label="Reviewed this week"
                    value={metrics.reviewedThisWeek}
                  />
                  <Stat
                    label="Remembered"
                    value={
                      metrics.remembered === null
                        ? "No reviews yet"
                        : `${Math.round(metrics.remembered * 100)}%`
                    }
                  />
                </div>
                <div className="study-table-wrap">
                  <table className="study-table">
                    <thead>
                      <tr>
                        <th>Deck</th>
                        <th>Made from</th>
                        <th>Cards</th>
                        <th>Due</th>
                        <th>Last studied</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.decks.map((item) => {
                        const ownEntries = state.entries.filter(
                          (entry) => entry.deckId === item.id,
                        );
                        const ownCards = state.cards.filter((card) =>
                          ownEntries.some((entry) => entry.id === card.entryId),
                        );
                        const ownDue = due.filter((card) =>
                          ownCards.some((own) => own.id === card.id),
                        ).length;
                        const last = state.events
                          .filter(
                            (event) =>
                              !event.undoneAt &&
                              ownCards.some((card) => card.id === event.cardId),
                          )
                          .map((event) => event.at)
                          .sort()
                          .at(-1);
                        return (
                          <tr key={item.id}>
                            <td>
                              <button
                                className="study-text-button"
                                onClick={() => {
                                  setDeckId(item.id);
                                  setFilter("all");
                                }}
                              >
                                {item.title}
                              </button>
                            </td>
                            <td>
                              {ownEntries.some((entry) => entry.source)
                                ? "Linked notes"
                                : "Added by hand"}
                            </td>
                            <td>{ownCards.length}</td>
                            <td>{ownDue ? `${ownDue} due` : "Nothing due"}</td>
                            <td>{last ? dateText(last) : "Not studied yet"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Forecast
                  days={metrics.dueNext14Days.slice(0, 7)}
                  title="Next 7 days"
                />
                {showStreak && (
                  <p className="study-caption">
                    Streak {countText(metrics.streak, "day")}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
      {form && (
        <Dialog
          title={
            form.kind === "deck"
              ? "New deck"
              : form.kind === "delete"
                ? "Delete card?"
                : form.kind === "import"
                  ? "Import cards"
                  : form.kind === "export"
                    ? "Export CSV"
                    : form.entry
                      ? "Edit card"
                      : "Add card"
          }
          onClose={closeForm}
          className={form.kind === "card" ? "study-card-dialog" : undefined}
        >
          {guardNotice && <p role="status">{guardNotice}</p>}
          {error && (
            <div className="error" role="alert">
              {error}
              {conflict && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void load(true)}
                >
                  Reload
                </button>
              )}
            </div>
          )}
          {form.kind === "deck" && (
            <DeckForm
              busy={busy || conflict}
              onDirty={markDirty}
              onCancel={closeForm}
              onSave={(title) => void addDeck(title)}
            />
          )}
          {form.kind === "card" && (
            <CardForm
              entry={form.entry}
              deckId={deckId ?? ""}
              decks={state.decks}
              busy={busy || conflict}
              onDirty={markDirty}
              onCancel={closeForm}
              onSave={(entry) => void persistEntry(entry)}
            />
          )}
          {form.kind === "delete" && (
            <>
              <p>This removes this entry and its review cards from the deck.</p>
              <button disabled={busy} onClick={closeForm}>
                Cancel
              </button>
              <button
                disabled={busy || conflict}
                className="danger"
                onClick={async () => {
                  const ownerTicket = ownerGeneration.current;
                  const value = await commit(
                    (state) => deleteEntry(state, form.entry.id),
                    "Couldn’t delete this card. Try again.",
                  );
                  if (value && ownerCurrent(ownerTicket)) closeForm();
                }}
              >
                Delete card
              </button>
            </>
          )}
          {form.kind === "import" && deck && (
            <CsvImport
              busy={busy || conflict}
              onDirty={markDirty}
              onCancel={closeForm}
              onSave={async (source, count) => {
                const ownerTicket = ownerGeneration.current;
                const at = new Date();
                const value = await commit(
                  (state) => importStudyCsv(state, deck.id, source, at),
                  "Couldn’t import these cards. Nothing was imported. Try again.",
                );
                if (value && ownerCurrent(ownerTicket)) {
                  closeForm();
                  setNotice(`Imported ${countText(count, "card")}`);
                }
              }}
            />
          )}
          {form.kind === "export" && deck && (
            <CsvExport
              state={state}
              deckId={deck.id}
              title={deck.title}
              onCancel={closeForm}
            />
          )}
        </Dialog>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="study-stat">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}
function Forecast({
  days,
  title,
}: {
  days: { day: string; count: number }[];
  title: string;
}) {
  const max = Math.max(1, ...days.map((day) => day.count));
  return (
    <div className="study-card">
      <b>{title}</b>
      <div className="study-forecast" role="list" aria-label={title}>
        {days.map((day, index) => (
          <div
            key={day.day}
            role="listitem"
            aria-label={`${day.day}: ${countText(day.count, "review")}`}
          >
            <span>{day.count}</span>
            <i style={{ height: `${(day.count / max) * 64}px` }} />
            <small>{index === 0 ? "Today" : Number(day.day.slice(-2))}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
function DeckForm({
  busy,
  onDirty,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onDirty: () => void;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <form
      className="study-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) onSave(title.trim());
      }}
    >
      <label>
        Name
        <input
          autoFocus
          required
          maxLength={500}
          disabled={busy}
          value={title}
          onChange={(event) => {
            onDirty();
            setTitle(event.target.value);
          }}
        />
      </label>
      <div className="study-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create deck"}
        </button>
      </div>
    </form>
  );
}
function CardForm({
  entry,
  deckId,
  decks,
  busy,
  onDirty,
  onSave,
  onCancel,
}: {
  entry?: StudyEntry;
  deckId: string;
  decks: StudyState["decks"];
  busy: boolean;
  onDirty: () => void;
  onSave: (entry: StudyEntry) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<StudyEntry["type"]>(entry?.type ?? "basic");
  const [front, setFront] = useState(
    entry && entry.type !== "cloze" ? entry.front : "",
  );
  const [back, setBack] = useState(
    entry && entry.type !== "cloze" ? entry.back : "",
  );
  const [text, setText] = useState(entry?.type === "cloze" ? entry.text : "");
  const [blanks, setBlanks] = useState(
    entry?.type === "cloze" ? entry.blanks : [{ id: "blank1", answer: "" }],
  );
  const [selectedDeck, setSelectedDeck] = useState(entry?.deckId ?? deckId);
  const [tags, setTags] = useState(entry?.tags.join(", ") ?? "");
  const [validation, setValidation] = useState("");
  const newId = useRef(crypto.randomUUID());
  function submit() {
    if (type === "cloze") {
      if (
        !text.trim() ||
        !blanks.length ||
        blanks.some(
          (blank) =>
            !/^[A-Za-z0-9_-]+$/.test(blank.id) ||
            !blank.answer.trim() ||
            text.split(`{{${blank.id}}}`).length !== 2,
        ) ||
        new Set(blanks.map((blank) => blank.id)).size !== blanks.length ||
        [...text.matchAll(/\{\{([^{}]+)\}\}/g)].some(
          (match) => !blanks.some((blank) => blank.id === match[1]),
        )
      ) {
        setValidation(
          "Give each blank a unique ID and answer, and use its {{ID}} once in the text.",
        );
        return;
      }
    } else if (!front.trim() || !back.trim()) {
      setValidation("Enter a front and a back for this card.");
      return;
    }
    if (!decks.some((deck) => deck.id === selectedDeck)) {
      setValidation("Choose an available deck.");
      return;
    }
    setValidation("");
    const base = {
      id: entry?.id ?? newId.current,
      deckId: selectedDeck,
      tags: [
        ...new Set(
          tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ],
      source: entry?.source ?? null,
      revision: entry ? entry.revision + 1 : 1,
    };
    onSave(
      type === "cloze"
        ? { ...base, type, text, blanks }
        : { ...base, type, front, back },
    );
  }
  return (
    <form
      className="study-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="study-types" role="group" aria-label="Card type">
        {(["basic", "reversed", "cloze"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={type === value}
            disabled={busy}
            onClick={() => {
              onDirty();
              setType(value);
            }}
          >
            {value === "cloze"
              ? "Fill in the blank"
              : value === "reversed"
                ? "Reversed"
                : "Basic"}
          </button>
        ))}
      </div>
      {type === "cloze" ? (
        <>
          <label>
            Text
            <textarea
              autoFocus
              required
              disabled={busy}
              value={text}
              onChange={(event) => {
                onDirty();
                setText(event.target.value);
              }}
            />
          </label>
          <p className="study-caption">
            Use a blank ID in double braces, such as {"{{capital}}"}. Each blank
            becomes its own card.
          </p>
          {blanks.map((blank, index) => (
            <div className="study-blank-fields" key={index}>
              <label>
                Blank ID {index + 1}
                <input
                  required
                  disabled={busy}
                  value={blank.id}
                  onChange={(event) => {
                    onDirty();
                    setBlanks((items) =>
                      items.map((item, position) =>
                        position === index
                          ? { ...item, id: event.target.value }
                          : item,
                      ),
                    );
                  }}
                />
              </label>
              <label>
                Answer {index + 1}
                <input
                  required
                  disabled={busy}
                  value={blank.answer}
                  onChange={(event) => {
                    onDirty();
                    setBlanks((items) =>
                      items.map((item, position) =>
                        position === index
                          ? { ...item, answer: event.target.value }
                          : item,
                      ),
                    );
                  }}
                />
              </label>
              {blanks.length > 1 && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove blank ${index + 1}`}
                  onClick={() => {
                    onDirty();
                    setBlanks((items) =>
                      items.filter((_, position) => position !== index),
                    );
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onDirty();
              setBlanks((items) => [
                ...items,
                { id: `blank${items.length + 1}`, answer: "" },
              ]);
            }}
          >
            Add blank
          </button>
        </>
      ) : (
        <>
          <label>
            Front
            <textarea
              autoFocus
              required
              disabled={busy}
              value={front}
              onChange={(event) => {
                onDirty();
                setFront(event.target.value);
              }}
            />
          </label>
          <label>
            Back
            <textarea
              required
              disabled={busy}
              value={back}
              onChange={(event) => {
                onDirty();
                setBack(event.target.value);
              }}
            />
          </label>
          {type === "reversed" && (
            <p className="study-caption">
              Reviewed in both directions, as two cards with their own
              schedules.
            </p>
          )}
        </>
      )}
      <label>
        Deck
        <select
          disabled={busy}
          value={selectedDeck}
          onChange={(event) => {
            onDirty();
            setSelectedDeck(event.target.value);
          }}
        >
          {decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tags
        <input
          disabled={busy}
          value={tags}
          placeholder="Tags, separated by commas"
          onChange={(event) => {
            onDirty();
            setTags(event.target.value);
          }}
        />
      </label>
      {entry?.source && (
        <div className="study-card">
          <span>Linked to a note</span>
          <small>Cancel editing to open the saved card’s source.</small>
        </div>
      )}
      {validation && (
        <p role="alert" className="error">
          {validation}
        </p>
      )}
      <div className="study-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : entry ? "Save card" : "Add card"}
        </button>
      </div>
    </form>
  );
}

function CsvImport({
  busy,
  onDirty,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onDirty: () => void;
  onCancel: () => void;
  onSave: (source: string, count: number) => Promise<void>;
}) {
  const [preview, setPreview] = useState<{
    source: string;
    name: string;
    rows: ReturnType<typeof parseStudyCsv>;
  } | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  async function read(file: File | undefined) {
    if (!file) return;
    setError("");
    setPreview(null);
    setReading(true);
    try {
      if (!/\.csv$/i.test(file.name) || file.size > 10_000_000)
        throw new Error("Choose a CSV file up to 10 MB.");
      const source = await trackOperation(() => file.text());
      const rows = parseStudyCsv(source);
      onDirty();
      setPreview({ source, name: file.name, rows });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace(/^[a-z_]+: /, "")
          : "Couldn’t read this file. Nothing was imported.",
      );
    } finally {
      setReading(false);
    }
  }
  return (
    <div className="study-form">
      <p>
        CSV uses Front, Back and optional Tags columns. Tags use a JSON list,
        such as ["biology"]. Imported rows become new Basic cards with fresh
        schedules; card types and source links are not restored.
      </p>
      <label>
        Choose CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy || reading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void read(file);
          }}
        />
      </label>
      {reading && <p role="status">Reading file…</p>}
      {error && (
        <p role="alert" className="error">
          {error} Nothing was imported.
        </p>
      )}
      {preview && (
        <div className="study-card">
          <b>
            {preview.name} · {countText(preview.rows.length, "card")}
          </b>
          <span>Preview · row 1</span>
          <p>{preview.rows[0]!.front}</p>
          <p>{preview.rows[0]!.back}</p>
        </div>
      )}
      <div className="study-actions">
        <button disabled={busy || reading} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || reading || !preview}
          onClick={() => {
            if (preview) void onSave(preview.source, preview.rows.length);
          }}
        >
          {busy
            ? "Importing…"
            : preview
              ? `Import ${countText(preview.rows.length, "card")}`
              : "Import cards"}
        </button>
      </div>
    </div>
  );
}
function CsvExport({
  state,
  deckId,
  title,
  onCancel,
}: {
  state: StudyState;
  deckId: string;
  title: string;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <div className="study-form">
      <p>
        Card text and tags only. Scheduling, card types and source links are not
        retained. Imported rows become new Basic cards with fresh schedules.
      </p>
      <p>The file is not encrypted. Keep it somewhere safe.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="study-actions">
        <button onClick={onCancel}>{url ? "Done" : "Cancel"}</button>
        {url ? (
          <a
            href={url}
            download={`${
              title
                .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
                .replace(/[. ]+$/g, "")
                .slice(0, 100) || "Study deck"
            }.csv`}
          >
            Download CSV
          </a>
        ) : (
          <button
            className="primary"
            onClick={() => {
              try {
                setUrl(
                  URL.createObjectURL(
                    new Blob([exportStudyCsv(state, deckId)], {
                      type: "text/csv;charset=utf-8",
                    }),
                  ),
                );
              } catch {
                setError(
                  "Couldn’t export this deck. Your cards were not changed.",
                );
              }
            }}
          >
            Export
          </button>
        )}
      </div>
    </div>
  );
}
