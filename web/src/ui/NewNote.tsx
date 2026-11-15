import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckSquare, Globe, Hash, Users } from "./icons";
import type { Note, NoteDocument, NotesStore } from "../domain/contracts";
import { registerCloseGuard } from "../desktop/closeGuard";
import { RichEditor } from "./RichEditor";
import {
  CaptureWriter,
  emptyDocument,
  meaningful,
  type CaptureState,
} from "./captureWriter";
import { plainText, safeLink } from "./model";
import { isDesktop } from "../desktop/window";
import { openExternalUrl } from "../desktop/external";
import { useDesktop } from "../desktop/DesktopShell";
import { createPortal } from "react-dom";
import "../styles/new-note.css";

const starters = [
  {
    name: "Checklist",
    hint: "To-dos you tick off",
    icon: CheckSquare,
    headings: ["Checklist"],
  },
  {
    name: "Meeting",
    hint: "Who, notes and actions",
    icon: Users,
    headings: ["Who", "Notes", "Actions"],
  },
  {
    name: "Trip plan",
    hint: "Before you go, days, bookings",
    icon: Globe,
    headings: ["Before you go", "Days", "Bookings"],
  },
  {
    name: "Study notes",
    hint: "Terms, summary, cards",
    icon: BookOpen,
    headings: ["Terms", "Summary", "Cards"],
  },
];
function starterDocument(name: string): NoteDocument {
  const starter = starters.find((item) => item.name === name)!;
  if (name === "Meeting")
    return {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Who" }],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Notes" }],
        },
        { type: "paragraph" },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Actions" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    };
  return {
    type: "doc",
    content: starter.headings.flatMap((text) => [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text }],
      },
      ...(text === "Actions" || name === "Checklist"
        ? [
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ]
        : [{ type: "paragraph" }]),
    ]),
  };
}
export function NewNote({
  store,
  initialTags = [],
  onSaved,
  onBack,
  quick = false,
  onOpen,
  onClose,
}: {
  store: NotesStore;
  initialTags?: string[];
  onSaved: (note: Note) => void;
  onBack: () => void;
  quick?: boolean;
  onOpen?: (note: Note) => Promise<void>;
  onClose?: () => void;
}) {
  const desktop = useDesktop();
  const callbacks = useRef({ onSaved, onBack, onOpen, onClose });
  callbacks.current = { onSaved, onBack, onOpen, onClose };
  const [state, setState] = useState<CaptureState>({
    value: { title: "", document: emptyDocument(), tags: initialTags },
    note: null,
    status: "empty",
    error: "",
    copied: false,
  });
  const writer = useRef<CaptureWriter | null>(null);
  if (!writer.current)
    writer.current = new CaptureWriter(store, initialTags, setState, (note) =>
      callbacks.current.onSaved(note),
    );
  const title = useRef<HTMLTextAreaElement>(null),
    body = useRef<HTMLDivElement>(null);
  const [tagOpen, setTagOpen] = useState(false),
    [tag, setTag] = useState(""),
    [starter, setStarter] = useState("");
  const pendingTag = useRef("");
  pendingTag.current = tag;
  const [notice, setNotice] = useState("");
  function leave(action: () => void) {
    if (!writer.current!.canLeave() || pendingTag.current.trim()) {
      setNotice(
        "Your text is still here. Save or copy it before leaving; add or clear any unfinished tag.",
      );
      return;
    }
    action();
  }
  useEffect(() => {
    writer.current!.activate();
    title.current?.focus();
    const stop = registerCloseGuard(() => {
      const allowed = writer.current!.canLeave() && !pendingTag.current.trim();
      if (!allowed)
        setNotice(
          "Your text is still here. Save or copy it before leaving; add or clear any unfinished tag.",
        );
      return allowed;
    });
    return () => {
      stop();
      writer.current!.dispose();
    };
  }, []);
  function change(patch: Partial<CaptureState["value"]>) {
    writer.current!.change({ ...writer.current!.state.value, ...patch });
  }
  const empty = !meaningful(state.value);
  const status =
    state.status === "empty"
      ? quick
        ? "Esc closes, nothing kept"
        : "Not saved yet"
      : state.status === "error"
        ? "Couldn’t save"
        : state.status !== "saved"
          ? "Saving…"
          : quick
            ? "Saved to All notes"
            : "Saved on this device";
  const pills = (
    <div className="new-note-pills">
      {state.value.tags.map((name) => (
        <span className="new-note-pill" key={name}>
          {name}
          <button
            aria-label={`Remove tag ${name}`}
            onClick={() =>
              change({
                tags: state.value.tags.filter((value) => value !== name),
              })
            }
          >
            ×
          </button>
        </span>
      ))}
      <button
        className="new-note-pill"
        onClick={() => setTagOpen((value) => !value)}
        aria-expanded={tagOpen}
      >
        <Hash size={13} />
        {quick ? "Tag" : "Add tag"}
      </button>
      {!quick && (
        <span
          className="new-note-pill"
          title="Planner links are not available in this beta"
        >
          Link a task · Planned
        </span>
      )}
    </div>
  );
  const toolbar = (
    <header className="new-note-header">
      {!quick && (
        <button onClick={() => leave(() => callbacks.current.onBack())}>
          ← Back to notes
        </button>
      )}
      <span role="status">{status}</span>
    </header>
  );
  return (
    <section
      className={`new-note ${quick ? "quick-note-content" : ""}`}
      aria-label={quick ? "Quick note" : "New note"}
      data-starter={starter}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (quick && event.key === "Escape") {
          event.preventDefault();
          leave(() => callbacks.current.onClose?.());
        }
        if (
          quick &&
          (event.ctrlKey || event.metaKey) &&
          event.key === "Enter"
        ) {
          event.preventDefault();
          if (state.note && state.status === "saved")
            leave(
              () =>
                void callbacks.current
                  .onOpen?.(state.note!)
                  .catch((error) => setNotice(String(error))),
            );
        }
      }}
    >
      {desktop?.toolbar && !quick
        ? createPortal(toolbar, desktop.toolbar)
        : toolbar}
      {notice && (
        <p role="alert" className="banner">
          {notice}
        </p>
      )}
      {state.error && (
        <div className="banner error" role="alert">
          {state.error}{" "}
          <button onClick={() => writer.current!.retry()}>Try again</button>
          <button
            onClick={() =>
              void writer
                .current!.copy()
                .catch(() =>
                  setNotice("Couldn’t copy. Select and copy your text."),
                )
            }
          >
            Copy text
          </button>
          {state.copied && (
            <span>Copied. Your saved note was not changed.</span>
          )}
        </div>
      )}
      <div
        className="new-note-page"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget)
            body.current
              ?.querySelector<HTMLElement>(
                quick ? "textarea" : '[contenteditable="true"]',
              )
              ?.focus();
        }}
      >
        <textarea
          ref={title}
          id="note-title"
          aria-label="Note title"
          className="new-note-title"
          rows={1}
          placeholder="Title"
          value={state.value.title}
          onChange={(event) => change({ title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              body.current
                ?.querySelector<HTMLElement>(
                  quick ? "textarea" : '[contenteditable="true"]',
                )
                ?.focus();
            }
          }}
        />
        {!quick && pills}
        {tagOpen && (
          <form
            className="capture-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (tag.trim()) {
                change({
                  tags: [...new Set([...state.value.tags, tag.trim()])],
                });
                setTag("");
                setTagOpen(false);
              }
            }}
          >
            <label>
              Tag
              <input
                aria-label="New tag"
                value={tag}
                maxLength={100}
                onChange={(event) => setTag(event.target.value)}
              />
            </label>
            <button disabled={!tag.trim()}>Add tag</button>
            <button
              type="button"
              onClick={() => {
                setTag("");
                setTagOpen(false);
              }}
            >
              Cancel
            </button>
          </form>
        )}
        <div ref={body} className={`new-note-body ${empty ? "is-empty" : ""}`}>
          {quick ? (
            <textarea
              aria-label="Note content"
              placeholder="Write something"
              value={state.value.document.content
                .map(
                  (node) =>
                    node.content?.map((child) => child.text ?? "").join("") ??
                    "",
                )
                .join("\n")}
              onChange={(event) =>
                change({
                  document: {
                    type: "doc",
                    content: event.target.value
                      .split("\n")
                      .map((text) => ({
                        type: "paragraph",
                        ...(text ? { content: [{ type: "text", text }] } : {}),
                      })),
                  },
                })
              }
            />
          ) : (
            <RichEditor
              documentPolicy="notes"
              document={state.value.document}
              onChange={(document) => change({ document })}
            />
          )}
          {quick && (
            <div className="quick-note-links">
              {[
                ...new Set(
                  plainText(state.value.document).match(
                    /https?:\/\/[^\s<>]+/g,
                  ) ?? [],
                ),
              ]
                .filter((url) => safeLink(url))
                .map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      if (isDesktop()) {
                        event.preventDefault();
                        void openExternalUrl(url).catch(() =>
                          setNotice(
                            "Couldn’t open the link. Copy it and open it in your browser.",
                          ),
                        );
                      }
                    }}
                  >
                    {url}
                  </a>
                ))}
            </div>
          )}
          {empty && !quick && (
            <div className="new-note-starts">
              <p
                className="new-note-hint"
                onClick={() =>
                  body.current
                    ?.querySelector<HTMLElement>('[contenteditable="true"]')
                    ?.focus()
                }
              >
                Write, or type / to insert. Or start from
              </p>
              <div
                className="new-note-tiles"
                role="group"
                aria-label="Start from"
              >
                {starters.map((item) => (
                  <button
                    className="new-note-tile"
                    key={item.name}
                    onClick={() => {
                      setStarter(item.name);
                      change({
                        title:
                          item.name === "Meeting"
                            ? `Meeting, ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                            : item.name,
                        document: starterDocument(item.name),
                      });
                      requestAnimationFrame(() => {
                        title.current?.focus();
                        title.current?.select();
                      });
                    }}
                  >
                    <b>
                      <item.icon size={13} />
                      {item.name}
                    </b>
                    <span>{item.hint}</span>
                  </button>
                ))}
              </div>
              <p className="new-note-foot">
                Starters show only while the note is empty. Choosing one fills
                the page; Undo brings the blank page back.
              </p>
            </div>
          )}
        </div>
        {starter && (
          <div className="capture-starter-notice" role="status">
            Started from {starter}
            <button
              onClick={() => {
                change({ title: "", document: emptyDocument() });
                setStarter("");
                title.current?.focus();
              }}
            >
              Undo starter
            </button>
          </div>
        )}
      </div>
      {quick && (
        <footer className="quick-note-footer">
          {pills}
          <span>{status}</span>
          <button
            disabled={
              !state.note ||
              state.status !== "saved" ||
              !writer.current!.canLeave()
            }
            onClick={() =>
              state.note &&
              leave(
                () =>
                  void callbacks.current
                    .onOpen?.(state.note!)
                    .catch((error) => setNotice(String(error))),
              )
            }
          >
            Open in Notes
          </button>
        </footer>
      )}
    </section>
  );
}
