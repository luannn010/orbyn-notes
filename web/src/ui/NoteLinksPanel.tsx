import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Backlink,
  LinkQuery,
  NoteLinkService,
  NoteTarget,
  OutgoingLink,
  OwnerAdmission,
  LinkRepairIntent,
} from "../links/contracts";
import { trackOperation, registerCloseGuard } from "../desktop/closeGuard";
import { Dialog } from "./primitives";
import { NoteLinkConflictError, NoteLinkError } from "../links/contracts";
import "../styles/note-links.css";
export function NoteLinksPanel({
  service,
  noteId,
  dirty,
  onOpen,
  onClose,
  canClose,
  requestClose,
  embedded = false,
}: {
  service: NoteLinkService;
  noteId?: string;
  dirty: boolean;
  onOpen: (target: NoteTarget) => void;
  onClose: () => void;
  canClose?: React.MutableRefObject<() => boolean>;
  requestClose?: React.MutableRefObject<() => void>;
  embedded?: boolean;
}) {
  const [incoming, setIncoming] = useState<LinkQuery<Backlink> | null>(null),
    [outgoing, setOutgoing] = useState<LinkQuery<OutgoingLink> | null>(null),
    [admission, setAdmission] = useState<OwnerAdmission | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [retry, setRetry] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [narrow, setNarrow] = useState(false),
    [closing, setClosing] = useState(false);
  const closingRef = useRef(false),
    panel = useRef<HTMLElement>(null);
  const rowAction = useRef(0);
  const finish = () => {
    if (pending.current || intent.current || closingRef.current) return;
    rowAction.current++;
    closingRef.current = true;
    setClosing(true);
  };
  useLayoutEffect(() => {
    const pane = document.querySelector(".editor-pane");
    const measure = () =>
      setNarrow((pane?.getBoundingClientRect().width || innerWidth) < 720);
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (pane) observer?.observe(pane);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (requestClose) requestClose.current = finish;
    return () => {
      if (requestClose) requestClose.current = () => {};
    };
  }, [requestClose]);
  useEffect(() => {
    if (!closing) return;
    let done = false;
    const node = panel.current;
    const end = () => {
      if (done) return;
      done = true;
      if (alive.current) onClose();
    };
    const listener = (event: AnimationEvent) => {
      if (event.target === node) end();
    };
    node?.addEventListener("animationend", listener);
    const duration = Math.max(
      ...(node ? getComputedStyle(node).animationDuration : "0s")
        .split(",")
        .map((value) => parseFloat(value) * 1000),
      0,
    );
    const timer = setTimeout(end, duration + 34);
    return () => {
      clearTimeout(timer);
      node?.removeEventListener("animationend", listener);
    };
  }, [closing]);
  const generation = useRef(0);
  const alive = useRef(true),
    sequence = useRef(0),
    pending = useRef(false),
    intent = useRef<LinkRepairIntent | null>(null);
  useLayoutEffect(() => {
    if (canClose) canClose.current = () => !pending.current && !intent.current;
    return () => {
      if (canClose) canClose.current = () => true;
    };
  }, [canClose]);
  async function read() {
    const ticket = ++sequence.current;
    try {
      const [a, b, c] = await Promise.all([
        noteId === undefined
          ? Promise.resolve(null)
          : service.backlinks(noteId),
        noteId === undefined ? Promise.resolve(null) : service.outgoing(noteId),
        service.admission(),
      ]);
      if (alive.current && ticket === sequence.current) {
        setIncoming(a);
        setOutgoing(b);
        setAdmission(c);
      }
    } catch {
      if (alive.current && ticket === sequence.current)
        setError("Couldn’t load note links. Try again.");
    }
  }
  useEffect(() => {
    generation.current++;
    alive.current = true;
    setIncoming(null);
    setOutgoing(null);
    void read();
    const stop = service.subscribe(() => {
        rowAction.current++;
        void read();
      }),
      invalidate = service.onInvalidate(() => {
        generation.current++;
        rowAction.current++;
        sequence.current++;
        intent.current = null;
        pending.current = false;
        setIncoming(null);
        setOutgoing(null);
        setAdmission(null);
        onClose();
      });
    return () => {
      generation.current++;
      rowAction.current++;
      alive.current = false;
      sequence.current++;
      stop();
      invalidate();
      service.cancelVerification();
    };
  }, [service, noteId]);
  useEffect(
    () => registerCloseGuard(() => !pending.current && !intent.current),
    [],
  );
  async function verify() {
    if (pending.current || intent.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await trackOperation(() => service.verifyGraph());
      if (alive.current)
        setNeedsVerification(
          result.status === "pending" || result.status === "paused-limit",
        );
      await read();
    } catch {
      if (alive.current) setError("Couldn’t check note links. Try again.");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function repair() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const ticket = generation.current;
    try {
      await trackOperation(async () => {
        if (!intent.current) {
          const token = await service.currentToken();
          intent.current = await service.prepareRepair(token);
        }
        await service.commitRepair(intent.current);
        intent.current = null;
      });
      if (alive.current && ticket === generation.current) {
        setConfirm(false);
        setRetry(false);
        await read();
      }
    } catch (failure) {
      if (alive.current && ticket === generation.current) {
        setConfirm(false);
        const stale = failure instanceof NoteLinkConflictError,
          incomplete =
            failure instanceof NoteLinkError &&
            failure.code === "note_link_verification_limit";
        if (stale || incomplete) {
          intent.current = null;
          setNeedsVerification(true);
        }
        setRetry(Boolean(intent.current));
        setError(
          stale
            ? "Notes changed while links were checked. Check again before rebuilding."
            : incomplete
              ? "Note-link checking is incomplete. Continue before rebuilding."
              : failure instanceof Error
                ? failure.message
                : "Couldn’t rebuild note links. Try again.",
        );
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const state = incoming?.status === "ready" ? outgoing : incoming;
  function status(value: LinkQuery<unknown> | null) {
    if (!value || value.status === "pending")
      return <p role="status">Checking note links…</p>;
    if (value.status === "paused-limit")
      return (
        <p role="status">
          Note-link checking is paused. Continue to check the remaining notes.
        </p>
      );
    if (value.status === "invalid")
      return (
        <p role="status">
          {value.code === "legacy-premise"
            ? "Preparing note links…"
            : "Note links need repair. Your notes are still available."}
        </p>
      );
    return null;
  }
  const content = (
    <aside
      ref={panel}
      data-exiting={closing || undefined}
      inert={closing}
      className="note-links-panel"
      aria-label="Links and backlinks"
    >
      <header>
        <b>{noteId === undefined ? "Note links" : "Linked from"}</b>
        <button
          type="button"
          aria-label="Close links and backlinks"
          disabled={busy || retry}
          onClick={finish}
        >
          ×
        </button>
      </header>
      {dirty && <p role="status">Links update after this note is saved.</p>}
      {error && <p role="alert">{error}</p>}
      {noteId !== undefined && (
        <section>
          <h3>
            Linked from{" "}
            {incoming?.status === "ready" && (
              <small>
                {incoming.items.length}{" "}
                {incoming.items.length === 1 ? "note" : "notes"}
              </small>
            )}
          </h3>
          {status(incoming)}
          {incoming?.status === "ready" &&
            (incoming.items.length ? (
              incoming.items.map((item) => (
                <button
                  type="button"
                  className="note-backlink"
                  key={item.sourceId}
                  onClick={() => {
                    const ticket = generation.current,
                      action = ++rowAction.current;
                    void service
                      .reference(item.sourceId)
                      .then((value) => {
                        if (
                          alive.current &&
                          !closingRef.current &&
                          ticket === generation.current &&
                          action === rowAction.current
                        )
                          onOpen(value.target);
                      })
                      .catch(() => {
                        if (
                          alive.current &&
                          !closingRef.current &&
                          ticket === generation.current &&
                          action === rowAction.current
                        )
                          setError(
                            "This note isn’t available in this workspace.",
                          );
                      });
                  }}
                >
                  <b>
                    {item.title || "Untitled note"}
                    {item.sourceId === noteId ? " · This note" : ""}
                  </b>
                  <span>{item.snippet}</span>
                  {item.occurrences > 1 && (
                    <small>{item.occurrences} references</small>
                  )}
                </button>
              ))
            ) : (
              <p>No notes link here yet.</p>
            ))}
        </section>
      )}
      {noteId !== undefined && (
        <section>
          <h3>
            Links in this note{" "}
            {outgoing?.status === "ready" && (
              <small>{outgoing.items.length}</small>
            )}
          </h3>
          {status(outgoing)}
          {outgoing?.status === "ready" &&
            (outgoing.items.length ? (
              outgoing.items.map((item) => (
                <button
                  type="button"
                  className="note-reference-chip"
                  key={JSON.stringify(item.target)}
                  onClick={() => {
                    rowAction.current++;
                    onOpen(item.target);
                  }}
                >
                  {item.resolution.status === "available"
                    ? item.resolution.title || "Untitled note"
                    : item.resolution.reason === "trashed"
                      ? "Note in Trash"
                      : "Unavailable note"}
                </button>
              ))
            ) : (
              <p>No links in this note.</p>
            ))}
        </section>
      )}
      {noteId === undefined &&
        admission?.mode === "current" &&
        admission.graph !== "ready" && (
          <p role="status">
            Note-link checking is{" "}
            {admission.graph === "paused-limit" ? "paused" : "pending"}.
          </p>
        )}
      {noteId === undefined &&
        admission?.mode === "current" &&
        admission.graph !== "ready" && (
          <button disabled={busy} onClick={() => void verify()}>
            Continue verification
          </button>
        )}
      {noteId === undefined && admission?.mode === "index-recovery" && (
        <p role="status">
          Note links need repair. Your notes are still available.
        </p>
      )}
      {state?.status === "pending" && (
        <button type="button" disabled={busy} onClick={() => void verify()}>
          Check note links
        </button>
      )}
      {state?.status === "paused-limit" && (
        <button type="button" disabled={busy} onClick={() => void verify()}>
          Continue verification
        </button>
      )}
      {admission?.mode === "legacy" && admission.premise !== "verified" && (
        <button type="button" disabled={busy} onClick={() => void verify()}>
          Continue preparation
        </button>
      )}
      {needsVerification && (
        <button disabled={busy || retry} onClick={() => void verify()}>
          Check again
        </button>
      )}
      {admission?.mode === "index-recovery" && !retry && !needsVerification && (
        <button type="button" disabled={busy} onClick={() => setConfirm(true)}>
          Rebuild index
        </button>
      )}
      {retry && (
        <p>
          The result is not confirmed. Retry the same repair.
          <button type="button" disabled={busy} onClick={() => void repair()}>
            Retry same repair
          </button>
        </p>
      )}
      {confirm && (
        <Dialog
          title="Rebuild note links?"
          onClose={() => {
            if (!pending.current) setConfirm(false);
          }}
        >
          <p>
            Rebuilds the link index from your saved notes. Note text and
            reference targets stay the same.
          </p>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button disabled={busy} onClick={() => void repair()}>
              Rebuild index
            </button>
          </div>
        </Dialog>
      )}
    </aside>
  );
  return narrow && !embedded ? (
    <Dialog title="Links and backlinks" onClose={finish}>
      {content}
    </Dialog>
  ) : (
    content
  );
}
