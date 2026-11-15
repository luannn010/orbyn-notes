import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Note, NotesStore } from "../domain/contracts";
import { checkClose, lockClosing } from "../desktop/closeGuard";
import { connectWindow, type DesktopWindow } from "../desktop/window";
import { freezeWindow } from "../desktop/freeze";
import { installQuitGuard, showNotes } from "../desktop/capture";
import { NewNote } from "./NewNote";
import { NotesMark } from "./NotesMark";
import { Pin, X } from "lucide-react";

export function QuickNoteWindow({ store }: { store: NotesStore }) {
  const root = useRef<HTMLDivElement>(null),
    bridge = useRef<DesktopWindow | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [pinned, setPinned] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const handoff = useRef<{
    token: string;
    resolve: () => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(() => {
    let active = true,
      connection: DesktopWindow | undefined,
      quit: (() => void) | undefined,
      result: (() => void) | undefined;
    setReady(false);
    void (async () => {
      connection = await connectWindow(
        (requestId) => {
          const current = bridge.current;
          if (!active || !current) return;
          if (checkClose() !== "allowed") {
            setError("Save or copy your text before closing.");
            return;
          }
          const unlock = lockClosing(),
            unfreeze = root.current ? freezeWindow(root.current) : () => {};
          void current.finishClose(requestId).catch(() => {
            unfreeze();
            unlock();
            setError("Couldn’t close. Your text is still here.");
          });
        },
        () => {},
      );
      if (!active) {
        connection.dispose();
        return;
      }
      bridge.current = connection;
      quit = await installQuitGuard(root.current!, () => {
        if (active)
          setError(
            "Notes stayed open. Save or copy all unfinished work before quitting.",
          );
      });
      result = await listen<{ token: string; accepted: boolean }>(
        "notes-capture-result",
        (event) => {
          const pending = handoff.current;
          if (!pending || pending.token !== event.payload.token) return;
          clearTimeout(pending.timer);
          handoff.current = null;
          if (event.payload.accepted) {
            pending.resolve();
            void bridge.current?.close();
          } else
            pending.reject(
              new Error(
                "Notes has unfinished work. Finish it before opening this note there.",
              ),
            );
        },
      );
      if (!active) {
        connection.dispose();
        quit();
        result();
        return;
      }
      setReady(true);
      setError("");
      const warning = await invoke<string | null>("capture_shortcut_status");
      if (warning && active) setError(warning);
    })().catch((error) => {
      if (active) setError(String(error));
    });
    return () => {
      active = false;
      bridge.current = null;
      connection?.dispose();
      quit?.();
      result?.();
      if (handoff.current) {
        clearTimeout(handoff.current.timer);
        handoff.current.reject(new Error("Quick note closed."));
        handoff.current = null;
      }
    };
  }, [attempt]);
  function open(note: Note) {
    if (handoff.current)
      return Promise.reject(
        new Error("Notes is opening this note. Wait for it to finish."),
      );
    return new Promise<void>((resolve, reject) => {
      const token = crypto.randomUUID();
      const timer = setTimeout(() => {
        if (handoff.current?.token !== token) return;
        handoff.current = null;
        reject(
          new Error(
            "Notes did not open the note. Your text is still here; try again.",
          ),
        );
      }, 5000);
      handoff.current = { token, resolve, reject, timer };
      void invoke("capture_handoff", { noteId: note.id, token }).catch(
        (error) => {
          if (handoff.current?.token !== token) return;
          clearTimeout(timer);
          handoff.current = null;
          reject(error);
        },
      );
    });
  }
  return (
    <div className="quick-note-window" ref={root}>
      <header
        className="quick-note-titlebar"
        onMouseDown={(event) => {
          if (
            event.button === 0 &&
            !(event.target as HTMLElement).closest("button")
          )
            void bridge.current?.startDragging();
        }}
      >
        <NotesMark size={16} />
        <strong>Quick note</strong>
        <button
          aria-label="Keep on top"
          aria-pressed={pinned}
          disabled={!ready}
          onClick={() => {
            void invoke("capture_pin", { pinned: !pinned })
              .then(() => setPinned(!pinned))
              .catch((error) => setError(String(error)));
          }}
        >
          <Pin size={14} />
        </button>
        <button
          aria-label="Close Quick note"
          disabled={!ready}
          onClick={() => void bridge.current?.close()}
        >
          <X size={14} />
        </button>
      </header>
      {error && (
        <div className="banner" role="alert">
          {error}
          {!ready && (
            <button onClick={() => setAttempt((value) => value + 1)}>
              Retry window controls
            </button>
          )}
        </div>
      )}
      {ready && (
        <NewNote
          quick
          store={store}
          onSaved={() => {}}
          onBack={() => {}}
          onOpen={open}
          onClose={() => void bridge.current?.close()}
        />
      )}
    </div>
  );
}
export function QuickNoteLocked() {
  useEffect(() => {
    let active = true,
      connection: DesktopWindow | undefined,
      stop: (() => void) | undefined;
    void connectWindow(
      (id) => {
        if (active && checkClose() === "allowed")
          void connection?.finishClose(id);
      },
      () => {},
    )
      .then((value) => {
        connection = value;
        if (!active) value.dispose();
      })
      .catch(() => {});
    void installQuitGuard(document.body, () => {})
      .then((value) => {
        if (active) stop = value;
        else value();
      })
      .catch(() => {});
    return () => {
      active = false;
      connection?.dispose();
      stop?.();
    };
  }, []);
  return (
    <main className="quick-note-locked">
      <NotesMark size={48} />
      <h1>Open Notes to unlock your workspace</h1>
      <p>Quick note uses the same account or local workspace as Notes.</p>
      <button onClick={() => void showNotes()}>Open Notes</button>
      <button
        onClick={() =>
          void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
            getCurrentWindow().close(),
          )
        }
      >
        Close Quick note
      </button>
    </main>
  );
}
