import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Link,
  FileText,
  Undo2,
  Redo2,
  ChevronDown,
  MoreHorizontal,
  Eye,
  FileCode,
} from "./icons";
import { registerCloseGuard } from "../desktop/closeGuard";
import {
  createMarkdownSource,
  parseMarkdownSource,
  type MarkdownSource,
} from "../editor/markdownSource";
import type { NoteDocument } from "../domain/contracts";
import "../styles/editor-formatting.css";

function overlayHost(anchor: Element | null): HTMLElement {
  // Native modal dialogs make body siblings inert and paint above body portals.
  return anchor?.closest<HTMLDialogElement>("dialog[open]") ?? document.body;
}

export function EditorTooltip({
  label,
  shortcut,
  syntax,
  children,
}: {
  label: string;
  shortcut?: string;
  syntax?: string;
  children: ReactElement;
}) {
  const id = useId(),
    anchor = useRef<HTMLSpanElement>(null),
    tip = useRef<HTMLSpanElement>(null);
  const [shown, show] = useState(false),
    [position, place] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!shown || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect(),
      own = tip.current?.getBoundingClientRect();
    place({
      left: Math.max(
        8,
        Math.min(rect.left, innerWidth - (own?.width ?? 0) - 8),
      ),
      top: Math.max(
        8,
        Math.min(rect.bottom + 7, innerHeight - (own?.height ?? 0) - 8),
      ),
    });
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const hide = () => show(false);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [shown]);
  const child = children as ReactElement<{ "aria-describedby"?: string }>;
  return (
    <span
      className="editor-tooltip-anchor"
      ref={anchor}
      onPointerEnter={() => show(true)}
      onPointerLeave={() => show(false)}
      onFocus={() => show(true)}
      onBlur={() => show(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") show(false);
      }}
    >
      {cloneElement(child, {
        "aria-describedby":
          [child.props["aria-describedby"], shown ? id : null]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      {shown &&
        createPortal(
          <span
            ref={tip}
            id={id}
            role="tooltip"
            className="editor-format-tooltip"
            style={position}
          >
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
            {syntax && <code>{syntax}</code>}
          </span>,
          overlayHost(anchor.current),
        )}
    </span>
  );
}

type Format =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote";
const formats: {
  command: Format;
  label: string;
  shortcut: string;
  syntax: string;
  icon: typeof Bold;
  secondary?: boolean;
}[] = [
  {
    command: "bold",
    label: "Bold",
    shortcut: "Ctrl+B",
    syntax: "**text**",
    icon: Bold,
  },
  {
    command: "italic",
    label: "Italic",
    shortcut: "Ctrl+I",
    syntax: "*text*",
    icon: Italic,
  },
  {
    command: "strike",
    label: "Strikethrough",
    shortcut: "Ctrl+Shift+S",
    syntax: "~~text~~",
    icon: Strikethrough,
    secondary: true,
  },
  {
    command: "code",
    label: "Inline code",
    shortcut: "Ctrl+E",
    syntax: "`text`",
    icon: Code,
    secondary: true,
  },
  {
    command: "bulletList",
    label: "Bulleted list",
    shortcut: "Ctrl+Shift+8",
    syntax: "- ",
    icon: List,
  },
  {
    command: "orderedList",
    label: "Numbered list",
    shortcut: "Ctrl+Shift+7",
    syntax: "1. ",
    icon: ListOrdered,
  },
  {
    command: "taskList",
    label: "To-do",
    shortcut: "Ctrl+Shift+9",
    syntax: "- [ ] ",
    icon: ListTodo,
  },
  {
    command: "blockquote",
    label: "Quote",
    shortcut: "Ctrl+Shift+B",
    syntax: "> ",
    icon: Quote,
    secondary: true,
  },
];
const blocks = [
  { label: "Text", syntax: "", command: "paragraph" },
  { label: "Heading", syntax: "#", command: "heading" },
  { label: "Subheading", syntax: "##", command: "subheading" },
  { label: "Bulleted list", syntax: "-", command: "bulletList" },
  { label: "Numbered list", syntax: "1.", command: "orderedList" },
  { label: "To-do", syntax: "[ ]", command: "taskList" },
  { label: "Quote", syntax: ">", command: "blockquote" },
] as const;
type Block = (typeof blocks)[number]["command"];
type SourceEditingOwner =
  | { sourceEditing: true; onUnsavedChange: (dirty: boolean) => void }
  | { sourceEditing?: false; onUnsavedChange?: never };
type Props = {
  editor: Editor;
  disabled: boolean;
  active: boolean;
  toolbarTarget?: HTMLElement | null;
  openLink: () => void;
  openNote: () => void;
  noteLinks: boolean;
  onViewChange: (markdown: boolean) => void;
  markdownInput?: boolean;
} & SourceEditingOwner;
export function EditorFormatting({
  editor,
  disabled,
  active,
  toolbarTarget,
  openLink,
  openNote,
  noteLinks,
  onViewChange,
  onUnsavedChange,
  sourceEditing = false,
  markdownInput = true,
}: Props) {
  const [markdown, setMarkdown] = useState(false),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [copyBusy, setCopyBusy] = useState(false);
  const [menu, setMenu] = useState<{
    kind: "context" | "style" | "more";
    left: number;
    top: number;
  } | null>(null);
  const [, refresh] = useState(0),
    textarea = useRef<HTMLTextAreaElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const source = useRef<MarkdownSource | null>(null),
    sourceDoc = useRef<Editor["state"]["doc"] | null>(null);
  const invalid = useRef(false),
    copied = useRef(false),
    pending = useRef(false),
    alive = useRef(true),
    current = useRef({ disabled, active, sourceEditing });
  const callbacks = useRef({ onViewChange, onUnsavedChange });
  callbacks.current = { onViewChange, onUnsavedChange };
  current.current = { disabled, active, sourceEditing };
  const menuSelection = useRef<Editor["state"]["selection"] | null>(null),
    menuDocument = useRef<Editor["state"]["doc"] | null>(null);
  const touch = useRef<ReturnType<typeof setTimeout> | null>(null),
    touchStart = useRef<{ x: number; y: number } | null>(null);
  const composing = useRef(false);
  const sourceGeneration = useRef(0);
  const sourceText = useRef(""),
    sourcePast = useRef<string[]>([]),
    sourceFuture = useRef<string[]>([]);
  useEffect(() => {
    alive.current = true;
    const update = () => refresh((value) => value + 1);
    editor.on("transaction", update);
    return () => {
      alive.current = false;
      editor.off("transaction", update);
      if (touch.current) clearTimeout(touch.current);
      callbacks.current.onUnsavedChange?.(false);
    };
  }, [editor]);
  useEffect(
    () =>
      registerCloseGuard(
        () =>
          !current.current.active ||
          (!pending.current && (!invalid.current || copied.current)),
      ),
    [],
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        current.current.active &&
        (pending.current || (invalid.current && !copied.current))
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);
  function canEdit() {
    return (
      alive.current &&
      current.current.active &&
      !current.current.disabled &&
      !editor.isDestroyed &&
      editor.isEditable
    );
  }
  function flag(value: boolean) {
    invalid.current = value;
    copied.current = false;
    callbacks.current.onUnsavedChange?.(value);
  }
  function applySource(value: string, history = true) {
    if (history && value !== sourceText.current) {
      sourcePast.current.push(sourceText.current);
      sourceFuture.current = [];
    }
    while (
      sourcePast.current.length > 32 ||
      sourcePast.current.reduce((total, item) => total + item.length, 0) >
        2_000_000
    )
      sourcePast.current.shift();
    sourceText.current = value;
    sourceGeneration.current++;
    setText(value);
    copied.current = false;
    try {
      if (
        !current.current.sourceEditing ||
        !canEdit() ||
        (sourceDoc.current && !editor.state.doc.eq(sourceDoc.current))
      )
        throw Error(
          "The note changed while this source was open. Copy your Markdown before leaving.",
        );
      const doc = parseMarkdownSource(value, source.current ?? undefined),
        node = editor.schema.nodeFromJSON(doc);
      node.check();
      if (!node.eq(editor.state.doc))
        editor.view.dispatch(
          editor.state.tr.replaceWith(
            0,
            editor.state.doc.content.size,
            node.content,
          ),
        );
      sourceDoc.current = editor.state.doc;
      flag(false);
      setError("");
    } catch (failure) {
      flag(true);
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn’t read this Markdown. Your draft is still here.",
      );
    }
  }
  function changeView(next: boolean) {
    if (next === markdown || !current.current.active) return;
    if (next && !current.current.sourceEditing) return;
    setMenu(null);
    if (invalid.current) {
      setError(
        "Your Markdown draft is still here. Fix it or discard it before returning to Rich view.",
      );
      return;
    }
    if (next) {
      try {
        source.current = createMarkdownSource(editor.getJSON() as NoteDocument);
        sourceDoc.current = editor.state.doc;
        setText(source.current.text);
        setError("");
        sourceText.current = source.current.text;
        sourcePast.current = [];
        sourceFuture.current = [];
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "This note cannot be shown as Markdown.",
        );
        return;
      }
    }
    setMarkdown(next);
    callbacks.current.onViewChange(next);
    if (!next)
      queueMicrotask(() => {
        if (canEdit()) editor.commands.focus();
      });
  }
  function sourceCommand(command: Format | Block | "undo" | "redo") {
    const area = textarea.current;
    if (!area || !current.current.sourceEditing || !canEdit()) return;
    if (command === "undo" || command === "redo") {
      const from =
          command === "undo" ? sourcePast.current : sourceFuture.current,
        to = command === "undo" ? sourceFuture.current : sourcePast.current;
      const previous = from.pop();
      if (previous !== undefined) {
        to.push(sourceText.current);
        applySource(previous, false);
      }
      area.focus();
      return;
    }
    const from = area.selectionStart,
      to = area.selectionEnd,
      selection = text.slice(from, to);
    let next: string,
      start = from,
      end: number;
    const wraps: Partial<Record<Format, string>> = {
      bold: "**",
      italic: "*",
      strike: "~~",
      code: "`",
    };
    const wrap = wraps[command as Format];
    if (wrap) {
      if (
        text.slice(from - wrap.length, from) === wrap &&
        text.slice(to, to + wrap.length) === wrap
      ) {
        next =
          text.slice(0, from - wrap.length) +
          selection +
          text.slice(to + wrap.length);
        start -= wrap.length;
      } else {
        next = text.slice(0, from) + wrap + selection + wrap + text.slice(to);
        start += wrap.length;
      }
      end = start + selection.length;
    } else {
      const lineStart = text.lastIndexOf("\n", from - 1) + 1,
        lineEnd = text.indexOf("\n", to),
        stop = lineEnd < 0 ? text.length : lineEnd;
      const prefix =
        command === "heading"
          ? "# "
          : command === "subheading"
            ? "## "
            : command === "bulletList"
              ? "- "
              : command === "orderedList"
                ? "1. "
                : command === "taskList"
                  ? "- [ ] "
                  : command === "blockquote"
                    ? "> "
                    : "";
      const lines = text
        .slice(lineStart, stop)
        .split("\n")
        .map(
          (line) =>
            prefix +
            line.replace(/^(?:#{1,6} |[-*] \[[ xX]\] |[-*] |\d+\. |> )/, ""),
        )
        .join("\n");
      next = text.slice(0, lineStart) + lines + text.slice(stop);
      start = lineStart;
      end = lineStart + lines.length;
    }
    applySource(next);
    queueMicrotask(() => {
      if (alive.current) {
        area.focus();
        area.setSelectionRange(start, end);
      }
    });
  }
  function run(command: Format | Block | "undo" | "redo") {
    if (!canEdit()) return;
    if (markdown) {
      sourceCommand(command);
      return;
    }
    if (menu && !menuDocument.current?.eq(editor.state.doc)) {
      setError("The note changed. Open the formatting menu again.");
      setMenu(null);
      return;
    }
    if (menu && menuSelection.current)
      editor.commands.setTextSelection({
        from: menuSelection.current.from,
        to: menuSelection.current.to,
      });
    const chain = editor.chain().focus();
    if (command === "bold") chain.toggleBold().run();
    else if (command === "italic") chain.toggleItalic().run();
    else if (command === "strike") chain.toggleStrike().run();
    else if (command === "code") chain.toggleCode().run();
    else if (command === "bulletList") chain.toggleBulletList().run();
    else if (command === "orderedList") chain.toggleOrderedList().run();
    else if (command === "taskList") chain.toggleTaskList().run();
    else if (command === "blockquote") chain.toggleBlockquote().run();
    else if (command === "paragraph") chain.setParagraph().run();
    else if (command === "heading") chain.setHeading({ level: 1 }).run();
    else if (command === "subheading") chain.setHeading({ level: 2 }).run();
    else if (command === "undo") chain.undo().run();
    else chain.redo().run();
  }
  function openMenu(
    kind: "context" | "style" | "more",
    left: number,
    top: number,
  ) {
    if (!current.current.active || composing.current) return;
    menuSelection.current = editor.state.selection;
    menuDocument.current = editor.state.doc;
    setMenu({ kind, left, top });
  }
  useLayoutEffect(() => {
    if (!menu || !popup.current) return;
    const node = popup.current,
      rect = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(menu.left, innerWidth - rect.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(menu.top, innerHeight - rect.height - 8))}px`;
    if (menu.kind === "context") node.focus();
    else node.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node)) setMenu(null);
    };
    const resize = () => setMenu(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", resize, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", resize, true);
    };
  }, [menu]);
  useEffect(() => {
    const dom = editor.view.dom;
    const context = (event: MouseEvent) => {
      if (!current.current.active) return;
      event.preventDefault();
      openMenu("context", event.clientX, event.clientY);
    };
    const key = (event: KeyboardEvent) => {
      if (composing.current || event.isComposing) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        menuSelection.current = editor.state.selection;
        menuDocument.current = editor.state.doc;
        void clipboard("markdown");
      } else if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        const rect = dom.getBoundingClientRect();
        openMenu("context", rect.left + 16, rect.top + 24);
      }
    };
    const cancel = () => {
      if (touch.current) clearTimeout(touch.current);
      touch.current = null;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      cancel();
      touchStart.current = { x: event.clientX, y: event.clientY };
      touch.current = setTimeout(
        () => openMenu("context", event.clientX, event.clientY),
        550,
      );
    };
    const move = (event: PointerEvent) => {
      if (
        touchStart.current &&
        Math.hypot(
          event.clientX - touchStart.current.x,
          event.clientY - touchStart.current.y,
        ) > 8
      )
        cancel();
    };
    const compositionStart = () => {
        composing.current = true;
        setMenu(null);
      },
      compositionEnd = () => {
        composing.current = false;
      };
    dom.addEventListener("contextmenu", context);
    dom.addEventListener("keydown", key);
    dom.addEventListener("pointerdown", down);
    dom.addEventListener("pointermove", move);
    dom.addEventListener("pointerup", cancel);
    dom.addEventListener("pointercancel", cancel);
    dom.addEventListener("compositionstart", compositionStart);
    dom.addEventListener("compositionend", compositionEnd);
    return () => {
      cancel();
      dom.removeEventListener("contextmenu", context);
      dom.removeEventListener("keydown", key);
      dom.removeEventListener("pointerdown", down);
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("pointerup", cancel);
      dom.removeEventListener("pointercancel", cancel);
      dom.removeEventListener("compositionstart", compositionStart);
      dom.removeEventListener("compositionend", compositionEnd);
    };
  }, [editor]);
  async function clipboard(action: "cut" | "copy" | "markdown" | "paste") {
    setMenu(null);
    if (!alive.current || !current.current.active || pending.current) return;
    const doc = editor.state.doc,
      selection = menuSelection.current ?? editor.state.selection;
    if (menuDocument.current && !menuDocument.current.eq(doc)) {
      setError("The note changed. Open the formatting menu again.");
      return;
    }
    if (action === "paste" || action === "cut") {
      if (!canEdit()) return;
    }
    pending.current = true;
    try {
      if (action === "paste") {
        const value = await navigator.clipboard.readText();
        if (!canEdit() || !doc.eq(editor.state.doc))
          throw Error(
            "The note changed. Paste again at the current selection.",
          );
        if (
          markdownInput &&
          /(^|\n)(?:#{1,6} |[-*] |\d+\. |> )|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`/.test(
            value,
          )
        ) {
          try {
            const parsed = editor.schema.nodeFromJSON(
              parseMarkdownSource(value),
            );
            parsed.check();
            editor.commands.setTextSelection({
              from: selection.from,
              to: selection.to,
            });
            editor.commands.insertContent(parsed.toJSON().content);
          } catch {
            editor.view.dispatch(
              editor.state.tr.insertText(value, selection.from, selection.to),
            );
            setError(
              "Pasted as plain text because some Markdown is not supported.",
            );
          }
        } else
          editor.view.dispatch(
            editor.state.tr.insertText(value, selection.from, selection.to),
          );
      } else {
        const fragment =
          doc.slice(selection.from, selection.to).content.toJSON() ?? [];
        let value = doc.textBetween(
          selection.from,
          selection.to,
          "\n",
          "\ufffc",
        );
        if (action === "markdown") {
          const content = doc.slice(selection.from, selection.to).content;
          const slice = editor.schema.topNodeType.createAndFill(
            undefined,
            content.firstChild?.isInline
              ? editor.schema.nodes.paragraph!.create(undefined, content)
              : content,
          );
          if (!slice)
            throw Error("Select complete text blocks to copy as Markdown.");
          value = createMarkdownSource(slice.toJSON() as NoteDocument).text;
        }
        // Never cut a note-reference atom through a plain clipboard projection.
        if (
          JSON.stringify(fragment).includes('"type":"noteLink"') &&
          action !== "markdown"
        )
          throw Error(
            "Use the keyboard Copy command to preserve note references.",
          );
        await navigator.clipboard.writeText(value);
        if (!alive.current || !current.current.active) return;
        if (action === "cut") {
          if (!canEdit() || !doc.eq(editor.state.doc))
            throw Error("The note changed. Nothing was cut.");
          editor.view.dispatch(
            editor.state.tr.delete(selection.from, selection.to),
          );
        }
      }
      if (alive.current) setError("");
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Clipboard access failed. Your note was not changed.",
        );
    } finally {
      pending.current = false;
    }
  }
  async function copyMarkdownDraft() {
    if (pending.current || !alive.current || !current.current.active) return;
    const generation = sourceGeneration.current;
    pending.current = true;
    setCopyBusy(true);
    try {
      await navigator.clipboard.writeText(text);
      if (
        alive.current &&
        current.current.active &&
        generation === sourceGeneration.current
      ) {
        copied.current = true;
        callbacks.current.onUnsavedChange?.(false);
        setError("Markdown copied. Your saved note was not changed.");
      }
    } catch {
      if (alive.current)
        setError("Couldn’t copy. Select and copy your Markdown text.");
    } finally {
      pending.current = false;
      if (alive.current) setCopyBusy(false);
    }
  }
  const shortcut = (text: string) =>
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? text.replaceAll("Ctrl+", "⌘").replaceAll("Shift+", "⇧")
      : text;
  function icon(
    label: string,
    node: ReactNode,
    action: () => void,
    options: {
      pressed?: boolean;
      unavailable?: boolean;
      shortcut?: string;
      syntax?: string;
      secondary?: boolean;
    } = {},
  ) {
    return (
      <EditorTooltip
        key={label}
        label={label}
        shortcut={shortcut(options.shortcut ?? "")}
        syntax={options.syntax}
      >
        <button
          type="button"
          aria-label={label}
          aria-pressed={options.pressed}
          disabled={disabled || options.unavailable}
          className={`editor-format-icon ${options.secondary ? "editor-format-secondary" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            action();
          }}
        >
          {node}
        </button>
      </EditorTooltip>
    );
  }
  const formatButtons = (context = false) =>
    formats
      .filter(
        (item) =>
          !context ||
          ["bold", "italic", "strike", "code"].includes(item.command),
      )
      .map((item) =>
        icon(
          item.label,
          <item.icon size={14} aria-hidden="true" />,
          () => {
            run(item.command);
            setMenu(null);
          },
          {
            pressed: !markdown && editor.isActive(item.command),
            shortcut: item.shortcut,
            syntax: item.syntax,
            secondary: !context && item.secondary,
          },
        ),
      );
  const styleLabel = markdown
    ? "Text"
    : editor.isActive("heading", { level: 1 })
      ? "Heading"
      : editor.isActive("heading", { level: 2 })
        ? "Subheading"
        : (formats.find(
            (item) =>
              ["bulletList", "orderedList", "taskList", "blockquote"].includes(
                item.command,
              ) && editor.isActive(item.command),
          )?.label ?? "Text");
  const toolbar = (
    <div
      className="format editor-format-toolbar"
      role="toolbar"
      aria-label="Formatting"
      inert={disabled}
      aria-disabled={disabled || undefined}
    >
      {icon("Undo", <Undo2 size={14} />, () => run("undo"), {
        shortcut: "Ctrl+Z",
        unavailable: !markdown && !editor.can().undo(),
      })}
      {icon("Redo", <Redo2 size={14} />, () => run("redo"), {
        shortcut: "Ctrl+Shift+Z",
        unavailable: !markdown && !editor.can().redo(),
      })}
      <span className="editor-format-separator" />
      <button
        type="button"
        className="editor-format-style"
        aria-label="Text style"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === "style"}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu("style", rect.left, rect.bottom + 4);
        }}
      >
        {styleLabel}
        <ChevronDown size={12} />
      </button>
      <span className="editor-format-separator" />
      {formatButtons()}
      <span className="editor-format-separator" />
      {icon(
        "Link",
        <Link size={14} />,
        () => {
          if (markdown) {
            const area = textarea.current;
            if (!area) return;
            const start = area.selectionStart,
              end = area.selectionEnd;
            applySource(
              text.slice(0, start) +
                `[${text.slice(start, end)}](https://)` +
                text.slice(end),
            );
          } else openLink();
        },
        { shortcut: "Ctrl+K", syntax: "[text](url)" },
      )}
      {icon("Link a note", <FileText size={14} />, openNote, {
        unavailable: !noteLinks || markdown,
        syntax: "[[note]]",
      })}
      <button
        type="button"
        className="editor-format-more"
        aria-label="More formatting"
        aria-haspopup="menu"
        disabled={disabled}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu("more", rect.left, rect.bottom);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      <div className="editor-format-view" role="group" aria-label="View">
        <button
          type="button"
          aria-pressed={!markdown}
          onClick={() => changeView(false)}
        >
          <Eye size={13} />
          Rich
        </button>
        <button
          type="button"
          aria-pressed={markdown}
          disabled={!sourceEditing}
          onClick={() => changeView(true)}
        >
          <FileCode size={13} />
          Markdown
        </button>
      </div>
    </div>
  );
  return (
    <>
      {active &&
        (toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar)}
      {markdown && (
        <div className="editor-markdown-surface">
          <textarea
            ref={textarea}
            aria-label="Markdown source"
            spellCheck={false}
            readOnly={disabled || !sourceEditing}
            value={text}
            onChange={(event) => applySource(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const key = event.key.toLowerCase();
              if (
                (event.ctrlKey || event.metaKey) &&
                ["b", "i", "e", "z", "y"].includes(key)
              ) {
                event.preventDefault();
                sourceCommand(
                  key === "z"
                    ? event.shiftKey
                      ? "redo"
                      : "undo"
                    : key === "y"
                      ? "redo"
                      : key === "b"
                        ? "bold"
                        : key === "i"
                          ? "italic"
                          : "code",
                );
              }
            }}
          />
          {source.current?.references.size ? (
            <p className="editor-source-note">
              Note reference tokens keep their original destinations. Choose new
              links in Rich view.
            </p>
          ) : null}
        </div>
      )}
      {error && active && (
        <div className="editor-format-notice" role="alert">
          {error}
          {invalid.current && (
            <>
              <button
                type="button"
                disabled={copyBusy}
                onClick={() => void copyMarkdownDraft()}
              >
                Copy Markdown draft
              </button>
              <button
                type="button"
                onClick={() => {
                  sourceGeneration.current++;
                  flag(false);
                  setError("");
                  setMarkdown(false);
                  callbacks.current.onViewChange(false);
                }}
              >
                Discard Markdown draft
              </button>
            </>
          )}
        </div>
      )}
      {menu &&
        active &&
        createPortal(
          <div
            ref={popup}
            tabIndex={-1}
            className="editor-format-menu"
            role="menu"
            aria-label={
              menu.kind === "context"
                ? "Formatting menu"
                : menu.kind === "style"
                  ? "Text style"
                  : "More formatting"
            }
            style={{ left: menu.left, top: menu.top }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setMenu(null);
                if (canEdit()) editor.commands.focus();
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const options = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const index = options.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                options[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? options.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          options.length) %
                        options.length
                ]?.focus();
              } else if (event.key === "Tab") setMenu(null);
            }}
          >
            {menu.kind === "context" && (
              <>
                <div className="editor-format-quick">{formatButtons(true)}</div>
                {(
                  [
                    ["Cut", "cut", "Ctrl+X"],
                    ["Copy", "copy", "Ctrl+C"],
                    ["Copy as Markdown", "markdown", "Ctrl+Shift+C"],
                    ["Paste", "paste", "Ctrl+V"],
                  ] as const
                ).map(([label, action, key]) => (
                  <button
                    key={action}
                    role="menuitem"
                    disabled={
                      ((action === "cut" || action === "paste") && disabled) ||
                      (action !== "paste" && editor.state.selection.empty)
                    }
                    onClick={() => void clipboard(action)}
                  >
                    {label}
                    <kbd>{shortcut(key)}</kbd>
                  </button>
                ))}
                <div className="editor-format-menu-label">Turn into</div>
              </>
            )}
            {menu.kind === "more"
              ? formats
                  .filter((item) => item.secondary)
                  .map((item) => (
                    <button
                      key={item.command}
                      role="menuitem"
                      disabled={disabled}
                      onClick={() => {
                        run(item.command);
                        setMenu(null);
                      }}
                    >
                      <item.icon size={14} />
                      {item.label}
                      <code>{item.syntax}</code>
                    </button>
                  ))
              : blocks.map((item) => (
                  <button
                    key={item.command}
                    role="menuitem"
                    disabled={disabled}
                    onClick={() => {
                      run(item.command);
                      setMenu(null);
                    }}
                  >
                    {item.label}
                    <code>{item.syntax}</code>
                  </button>
                ))}
            {menu.kind === "context" && (
              <>
                <button
                  role="menuitem"
                  disabled={disabled || !noteLinks}
                  onClick={() => {
                    setMenu(null);
                    openNote();
                  }}
                >
                  Link to a note<code>[[</code>
                </button>
                <button role="menuitem" disabled>
                  Make a card<span>Planned</span>
                </button>
              </>
            )}
          </div>,
          overlayHost(editor.view.dom),
        )}
    </>
  );
}
