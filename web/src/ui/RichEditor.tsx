import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type { NoteDocument } from "../domain/contracts";
import { safeLink } from "./model";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";

const commands = [
  "Paragraph",
  "Heading",
  "Bulleted list",
  "Numbered list",
  "To-do list",
  "Web link",
] as const;
type Slash = { from: number; to: number; query: string };

function currentSlash(editor: Editor): Slash | null {
  const { selection } = editor.state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return null;
  const { $from, from } = selection;
  const before = $from.parent.textBetween(
    0,
    $from.parentOffset,
    "\n",
    "\ufffc",
  );
  if (!/^\/[^\s/]*$/.test(before)) return null;
  return { from: from - before.length, to: from, query: before.slice(1) };
}

export function RichEditor({
  document,
  onChange,
}: {
  document: NoteDocument;
  onChange: (value: NoteDocument) => void;
}) {
  const [slash, setSlash] = useState<Slash | null>(null);
  const [active, setActive] = useState(0);
  const [closing, setClosing] = useState<Slash | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 300 });
  const slashRef = useRef<Slash | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dismissed = useRef<Slash | null>(null);
  const composing = useRef(false);
  const replacing = useRef(false);
  const close = () => {
    if (slashRef.current) setClosing(slashRef.current);
    slashRef.current = null;
    setSlash(null);
  };
  const action = useRef<(label: string) => void>(() => {});
  const sync = useRef<(editor: Editor) => void>(() => {});
  const id = useRef(`slash-${Math.random().toString(36).slice(2)}`);
  const shown = slash ?? closing;
  const matches = shown
    ? commands.filter((label) =>
        label.toLowerCase().includes(shown.query.toLowerCase()),
      )
    : [];
  const matchesRef = useRef<readonly string[]>([]);
  matchesRef.current = matches;
  const activeRef = useRef(active);
  activeRef.current = active;
  sync.current = (instance) => {
    if (composing.current || replacing.current || !instance.isFocused) return;
    const next = currentSlash(instance);
    const visible = dismissed.current ? null : next;
    if (visible?.query !== slashRef.current?.query) setActive(0);
    if (visible) {
      setClosing(null);
      slashRef.current = visible;
      setSlash(visible);
    } else close();
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Focusing a stored document must not append content or trigger a write.
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: false,
          isAllowedUri: (url) => safeLink(url),
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: document,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Note content",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => {
        if (composing.current || event.isComposing || !slashRef.current)
          return false;
        const options = matchesRef.current;
        if (event.key === "Escape" || event.key === "Tab") {
          const current = slashRef.current;
          dismissed.current = current;
          close();
          return event.key === "Escape";
        }
        if (
          options.length &&
          (event.key === "ArrowDown" || event.key === "ArrowUp")
        ) {
          setActive(
            (old) =>
              (old + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length,
          );
          return true;
        }
        if (event.key === "Enter" && options[activeRef.current]) {
          action.current(options[activeRef.current]!);
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        compositionstart: () => {
          composing.current = true;
          close();
          return false;
        },
        compositionend: () => {
          composing.current = false;
          queueMicrotask(() => {
            if (editor) sync.current(editor);
          });
          return false;
        },
        blur: () => {
          close();
          return false;
        },
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text !== undefined && text !== "") {
          event.preventDefault();
          view.dispatch(view.state.tr.insertText(text));
          return true;
        }
        // HTML-only clipboard payloads must never enter the document.
        if (event.clipboardData?.types.includes("text/html")) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onSelectionUpdate: ({ editor }) => sync.current(editor),
    onFocus: ({ editor }) => sync.current(editor),
    onUpdate: ({ editor, transaction }) => {
      const previous = dismissed.current;
      if (previous) {
        const from = transaction.mapping.map(previous.from, -1);
        const to = transaction.mapping.map(previous.to, 1);
        dismissed.current =
          editor.state.doc.textBetween(from, to, "\n", "\ufffc") ===
          `/${previous.query}`
            ? { ...previous, from, to }
            : null;
      }
      onChange(editor.getJSON() as NoteDocument);
      sync.current(editor);
    },
  });
  useEffect(() => {
    if (
      editor &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(document)
    ) {
      close();
      dismissed.current = null;
      replacing.current = true;
      editor.commands.setContent(document, { emitUpdate: false });
      replacing.current = false;
    }
  }, [document, editor]);
  useLayoutEffect(() => {
    if (!editor || !slash) return;
    const update = () => {
      const live = currentSlash(editor);
      if (!live) return;
      const rect = editor.view.coordsAtPos(live.to);
      const width = Math.min(260, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const flip = below < 240 && above > below;
      const maxHeight = Math.max(0, flip ? above : below);
      const height = Math.min(menuRef.current?.scrollHeight ?? 0, maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(
          8,
          Math.min(
            flip ? rect.top - height : rect.bottom,
            window.innerHeight - height - 8,
          ),
        ),
        maxHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editor, slash]);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    if (slash) {
      dom.setAttribute("aria-autocomplete", "list");
      dom.setAttribute("aria-haspopup", "listbox");
      dom.setAttribute("aria-controls", id.current);
      const label = matches[active];
      if (label)
        dom.setAttribute(
          "aria-activedescendant",
          `${id.current}-${commands.indexOf(label)}`,
        );
      else dom.removeAttribute("aria-activedescendant");
    } else
      for (const attr of [
        "aria-autocomplete",
        "aria-haspopup",
        "aria-controls",
        "aria-activedescendant",
      ])
        dom.removeAttribute(attr);
  }, [editor, slash, active, matches.join("|")]);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const label = slash && matches[active];
    const row = label
      ? menu?.querySelector<HTMLElement>(
          `[id="${id.current}-${commands.indexOf(label)}"]`,
        )
      : null;
    if (menu && row) {
      if (row.offsetTop < menu.scrollTop) menu.scrollTop = row.offsetTop;
      else if (
        row.offsetTop + row.offsetHeight >
        menu.scrollTop + menu.clientHeight
      )
        menu.scrollTop = row.offsetTop + row.offsetHeight - menu.clientHeight;
    }
  }, [slash, active, matches.join("|")]);
  action.current = (label) => {
    if (!editor) return;
    const range = currentSlash(editor);
    if (
      !range ||
      !slashRef.current ||
      range.from !== slashRef.current.from ||
      range.to !== slashRef.current.to ||
      range.query !== slashRef.current.query
    )
      return;
    let url: string | null = null;
    if (label === "Web link") {
      url = window.prompt("Link URL (https://, http:// or mailto:)");
      if (!url || !safeLink(url)) {
        if (url) window.alert("Use an https://, http:// or mailto: link.");
        dismissed.current = range;
        close();
        editor.commands.focus();
        return;
      }
    }
    const chain = editor
      .chain()
      .focus()
      .command(({ tr }) => {
        closeHistory(tr);
        return true;
      })
      .deleteRange(range);
    if (label === "Paragraph") chain.setParagraph();
    else if (label === "Heading") chain.toggleHeading({ level: 2 });
    else if (label === "Bulleted list") chain.toggleBulletList();
    else if (label === "Numbered list") chain.toggleOrderedList();
    else if (label === "To-do list") chain.toggleTaskList();
    else if (url)
      chain.insertContent({
        type: "text",
        text: url,
        marks: [{ type: "link", attrs: { href: url } }],
      });
    close();
    chain.run();
  };
  if (!editor) return null;
  return (
    <>
      <div className="format" role="toolbar" aria-label="Formatting">
        <button
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          aria-pressed={editor.isActive("heading")}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          Heading
        </button>
        <button
          aria-pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          Bullets
        </button>
        <button
          aria-pressed={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          Numbered
        </button>
        <button
          aria-pressed={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          To-do
        </button>
        <button
          onClick={() => {
            const url = window.prompt(
              "Link URL (https://, http:// or mailto:)",
            );
            if (url === null) return;
            if (!url) editor.chain().focus().unsetLink().run();
            else if (safeLink(url))
              editor.chain().focus().setLink({ href: url }).run();
            else window.alert("Use an https://, http:// or mailto: link.");
          }}
        >
          Link
        </button>
        <button
          aria-label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
        >
          Undo
        </button>
      </div>
      <EditorContent editor={editor} />
      {shown && (
        <div
          ref={menuRef}
          className="slash-menu"
          data-exiting={slash ? undefined : "true"}
          aria-hidden={slash ? undefined : true}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && !slash)
              setClosing(null);
          }}
          role="listbox"
          aria-label="Insert block"
          id={id.current}
          style={{
            position: "fixed",
            left: position.left,
            top: position.top,
            maxHeight: position.maxHeight,
          }}
        >
          <p>Insert block</p>
          {matches.length ? (
            matches.map((label, index) => (
              <button
                type="button"
                tabIndex={-1}
                role="option"
                id={`${id.current}-${commands.indexOf(label)}`}
                aria-selected={index === active}
                key={label}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => action.current(label)}
              >
                {label}
              </button>
            ))
          ) : (
            <p>No matching commands</p>
          )}
        </div>
      )}
    </>
  );
}
