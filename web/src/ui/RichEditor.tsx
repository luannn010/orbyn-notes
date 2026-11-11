import { useEditor, EditorContent } from "@tiptap/react";
import { createNoteExtensions } from "../editor/schema";
import {
  captureSourceSelection,
  fingerprintSourceDocument,
} from "../study/sourceCodec";
import type { SourceSelection } from "../study/sourceCodec";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { NoteDocument } from "../domain/contracts";
import { safeLink } from "./model";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { Selection, TextSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { useEditorPreferences } from "./editorPreferences";
import { LinkPopover } from "./LinkPopover";
import { validateDocument, validateNoteDocument } from "../domain/validation";
import { useMemo } from "react";
import { createNoteLinkViews } from "./noteLinkViews";
import type { EditorNoteLinks } from "./noteLinkViews";
import { NoteLinkPicker } from "./NoteLinkPicker";
import { Slice } from "@tiptap/pm/model";
import {
  NOTE_FRAGMENT_MIME,
  encodeNoteFragment,
  decodeNoteFragment,
  referencePlainText,
} from "./noteLinkClipboard";

const commands = [
  "Paragraph",
  "Heading",
  "Bulleted list",
  "Numbered list",
  "To-do list",
  "Web link",
  "Another note",
] as const;
export type EditorChangeTrace = {
  before: NoteDocument;
  steps: readonly unknown[];
};
export type EditorSourceCapture = {
  document: NoteDocument;
  selection: SourceSelection;
  anchor: () => { left: number; top: number; bottom: number };
  isCurrent: () => boolean;
  restore: () => void;
};
export type EditorSourceTarget = {
  key: string;
  noteId: string;
  noteRevision: number;
  documentDigest: string;
  from: number;
  to: number;
  quote: string;
};
export type EditorSourceControl = {
  noteId: string;
  noteRevision: number;
  annotations: readonly EditorSourceTarget[];
  target?: EditorSourceTarget | null;
  onCapture: (capture: EditorSourceCapture) => void;
  onInvalidated?: () => void;
  onTargetUnavailable?: () => void;
};
function noteDocument(value: NoteDocument): NoteDocument {
  return Array.isArray(value.content) ? value : { ...value, content: [] };
}
type Slash = { from: number; to: number; query: string };
export type EditorLinkDraft = {
  from: number;
  to: number;
  source: "toolbar" | "slash";
  selection:
    | { type: "all" }
    | { type: "node"; anchor: number }
    | { type: "text"; anchor: number; head: number };
  initialUrl: string;
  url: string;
};
export interface EditorLinkControl {
  draft: EditorLinkDraft | null;
  valid: boolean;
  open(draft: EditorLinkDraft): void;
  change(url: string): void;
  cancel(): void;
  beginApply(): (document: NoteDocument, changed: boolean) => void;
  lock?(): void;
}
type LinkRequest = {
  from: number;
  to: number;
  href: string;
  slash: boolean;
  value: string;
  selection: EditorLinkDraft["selection"];
  document: Editor["state"]["doc"];
};

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
  ariaLabel = "Note content",
  readOnly = false,
  linkControl,
  traceTransactions = false,
  sourceControl,
  documentPolicy = "plain",
  noteLinks,
}: {
  noteLinks?: EditorNoteLinks;
  documentPolicy?: "notes" | "journal" | "plain";
  document: NoteDocument;
  onChange: (value: NoteDocument, trace?: EditorChangeTrace) => void;
  traceTransactions?: boolean;
  sourceControl?: EditorSourceControl;
  ariaLabel?: string;
  readOnly?: boolean;
  linkControl?: EditorLinkControl;
}) {
  const policy = useRef(documentPolicy);
  const pasteReferences = useRef(false);
  const noteLinksRef = useRef(noteLinks);
  noteLinksRef.current = documentPolicy === "notes" ? noteLinks : undefined;
  useEffect(() => {
    pasteReferences.current = false;
    if (documentPolicy !== "notes" || !noteLinks || readOnly) return;
    let active = true,
      sequence = 0;
    const read = () => {
      const ticket = ++sequence;
      void noteLinks.service
        .admission()
        .then((value) => {
          if (active && ticket === sequence)
            pasteReferences.current =
              value.mode === "current" ||
              (value.mode === "legacy" && value.premise === "verified");
        })
        .catch(() => {
          if (active && ticket === sequence) pasteReferences.current = false;
        });
    };
    const stop = noteLinks.service.subscribe(read),
      invalid = noteLinks.service.onInvalidate(() => {
        sequence++;
        pasteReferences.current = false;
      });
    read();
    return () => {
      active = false;
      sequence++;
      pasteReferences.current = false;
      stop();
      invalid();
    };
  }, [noteLinks?.service, documentPolicy, readOnly]);
  const noteViews = useMemo(
    () => createNoteLinkViews(() => noteLinksRef.current),
    [],
  );
  useEffect(() => noteViews.refresh(), [noteViews, noteLinks]);
  policy.current = documentPolicy;
  const checkedDocument = useMemo(() => {
    try {
      return {
        value: (documentPolicy === "notes"
          ? validateNoteDocument
          : validateDocument)(document),
        error: "",
      };
    } catch {
      return {
        value: { type: "doc" as const, content: [] },
        error:
          "This content isn’t supported in this editor. Your saved document was not changed.",
      };
    }
  }, [document, documentPolicy]);
  const policyBlocked = useRef(false);
  policyBlocked.current = Boolean(checkedDocument.error);
  const sourceRef = useRef(sourceControl);
  sourceRef.current = sourceControl;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const traceRef = useRef(traceTransactions);
  traceRef.current = traceTransactions;
  const editorVersion = useRef(0),
    sourceDecorations = useRef(DecorationSet.empty),
    sourceKey = useRef(new PluginKey("note-source-passages"));
  const [sourceSelection, setSourceSelection] =
    useState<EditorSourceCapture | null>(null);
  const sourceToolbar = useRef<HTMLDivElement>(null);
  const [toolbarPosition, setToolbarPosition] = useState<
    import("react").CSSProperties
  >({ visibility: "hidden" });
  function selectionFor(instance: Editor) {
    if (
      !sourceRef.current ||
      !instance.isEditable ||
      composing.current ||
      readOnlyRef.current ||
      instance.state.selection.empty
    ) {
      setSourceSelection(null);
      return;
    }
    try {
      const { from, to } = instance.state.selection,
        document = noteDocument(instance.getJSON() as NoteDocument),
        selection = captureSourceSelection(document, from, to),
        node = instance.state.doc,
        version = editorVersion.current;
      const isCurrent = () =>
        !instance.isDestroyed &&
        admission.current?.alive === true &&
        admission.current.editor === instance &&
        editorVersion.current === version &&
        instance.state.doc.eq(node);
      const capture: EditorSourceCapture = {
        document,
        selection,
        isCurrent,
        anchor: () => {
          if (!isCurrent()) throw new Error("This passage changed.");
          const start = instance.view.coordsAtPos(from),
            end = instance.view.coordsAtPos(to);
          return { left: start.left, top: start.top, bottom: end.bottom };
        },
        restore: () => {
          if (isCurrent()) {
            instance.view.dispatch(
              instance.state.tr.setSelection(
                TextSelection.create(instance.state.doc, from, to),
              ),
            );
            instance.view.focus();
          }
        },
      };
      setSourceSelection(capture);
    } catch {
      setSourceSelection(null);
    }
  }
  const { preferences } = useEditorPreferences();
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
  const [linkError, setLinkError] = useState("");
  const [contentNotice, setContentNotice] = useState("");
  const [noteRequest, setNoteRequest] = useState<{
    from: number;
    to: number;
    query?: string;
    node: Editor["state"]["doc"];
    version: number;
  } | null>(null);
  const noteRequestRef = useRef(noteRequest);
  noteRequestRef.current = noteRequest;
  const dismissedNote = useRef<string | null>(null);
  function openNotePicker(
    instance: Editor,
    range?: { from: number; to: number; query?: string },
  ) {
    if (
      !noteLinksRef.current ||
      readOnlyRef.current ||
      linkRequest ||
      composing.current ||
      !instance.isEditable
    )
      return;
    const selection = instance.state.selection;
    if (
      !selection.$from.parent.isTextblock ||
      instance.isActive("codeBlock") ||
      instance.isActive("code") ||
      instance.isActive("link")
    )
      return;
    setNoteRequest({
      from: range?.from ?? selection.from,
      to: range?.to ?? selection.to,
      query: range?.query,
      node: instance.state.doc,
      version: editorVersion.current,
    });
  }
  const linkControlRef = useRef(linkControl);
  linkControlRef.current = linkControl;
  const preferencesRef = useRef(preferences);
  const readOnlyRef = useRef(readOnly);
  preferencesRef.current = preferences;
  readOnlyRef.current = readOnly;
  const admission = useRef<{ editor: Editor; alive: boolean } | null>(null);
  const suspendedRules = useRef<{
    editor: Editor;
    slots: { plugin: Plugin; next?: Plugin }[];
  } | null>(null);
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
    ? commands.filter(
        (label) =>
          (label !== "Another note" || Boolean(noteLinksRef.current)) &&
          label.toLowerCase().includes(shown.query.toLowerCase()),
      )
    : [];
  const matchesRef = useRef<readonly string[]>([]);
  matchesRef.current = matches;
  const activeRef = useRef(active);
  activeRef.current = active;
  sync.current = (instance) => {
    if (composing.current || replacing.current || !instance.isFocused) return;
    if (
      noteLinksRef.current &&
      !linkRequest &&
      !noteRequestRef.current &&
      instance.state.selection.empty &&
      !instance.isActive("codeBlock") &&
      !instance.isActive("code") &&
      !instance.isActive("link")
    ) {
      const { $from, from } = instance.state.selection;
      const before = $from.parent.textBetween(
        0,
        $from.parentOffset,
        "\n",
        "\ufffc",
      );
      const match = before.match(/\[\[([^\[\]\n]*)$/);
      if (match) {
        const start = from - match[0].length;
        const key = `${start}:${from}:${match[1]}`;
        if (dismissedNote.current !== key) {
          close();
          openNotePicker(instance, { from: start, to: from, query: match[1] });
          return;
        }
      } else dismissedNote.current = null;
    }
    if (noteRequestRef.current) return;
    const next = currentSlash(instance);
    const visible = next && dismissed.current?.from === next.from ? null : next;
    if (visible?.query !== slashRef.current?.query) setActive(0);
    if (visible) {
      setClosing(null);
      slashRef.current = visible;
      setSlash(visible);
    } else close();
  };
  function copySelection(view: Editor["view"], event: ClipboardEvent) {
    if (
      policy.current !== "notes" ||
      !noteLinksRef.current ||
      !event.clipboardData
    )
      return false;
    try {
      const slice = view.state.selection.content(),
        document = validateNoteDocument({
          type: "doc",
          content: slice.content.toJSON() ?? [],
        });
      const payload = encodeNoteFragment(
        document.content,
        slice.openStart,
        slice.openEnd,
      );
      event.clipboardData.setData("text/plain", referencePlainText(document));
      event.clipboardData.setData(NOTE_FRAGMENT_MIME, payload);
      event.preventDefault();
      return true;
    } catch {
      return false;
    }
  }
  const editor = useEditor({
    editable: !readOnly,
    extensions: createNoteExtensions({ noteLinkNodeView: noteViews.renderer }),
    content: checkedDocument.value,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        spellcheck: String(preferences.spellcheck),
        "aria-readonly": String(readOnly),
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
        copy: copySelection,
        cut: (view, event) => {
          const copied = copySelection(view, event);
          if (copied && !readOnlyRef.current && view.editable)
            view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
          return copied;
        },
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
        if (readOnlyRef.current) {
          event.preventDefault();
          return true;
        }
        const fragment = event.clipboardData?.getData(NOTE_FRAGMENT_MIME);
        if (
          fragment &&
          policy.current === "notes" &&
          noteLinksRef.current &&
          pasteReferences.current
        ) {
          try {
            const parsed = decodeNoteFragment(fragment),
              node = view.state.schema.nodeFromJSON(parsed.document);
            node.check();
            const depth = (first: boolean) => {
              let current = first ? node.firstChild : node.lastChild,
                result = 0;
              while (current && !current.isLeaf) {
                result++;
                current = first ? current.firstChild : current.lastChild;
              }
              return result;
            };
            if (parsed.openStart > depth(true) || parsed.openEnd > depth(false))
              throw Error("Invalid open selection.");
            const slice = new Slice(
              node.content,
              parsed.openStart,
              parsed.openEnd,
            );
            event.preventDefault();
            view.dispatch(
              view.state.tr.replaceSelection(slice).scrollIntoView(),
            );
            return true;
          } catch {
            /* Invalid application payload falls back to its literal text, never HTML. */
          }
        }
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
    onSelectionUpdate: ({ editor }) => {
      sync.current(editor);
      selectionFor(editor);
    },
    onFocus: ({ editor }) => {
      sync.current(editor);
      selectionFor(editor);
    },
    onTransaction: ({ editor, transaction, appendedTransactions }) => {
      const batch = [transaction, ...appendedTransactions];
      if (!batch.some((item) => item.docChanged)) return;
      setContentNotice("");
      editorVersion.current++;
      sourceDecorations.current = DecorationSet.empty;
      if (sourceRef.current)
        editor.view.dispatch(editor.state.tr.setMeta(sourceKey.current, true));
      setSourceSelection(null);
      sourceRef.current?.onInvalidated?.();
      if (replacing.current || !traceRef.current) return;
      changeRef.current(noteDocument(editor.getJSON() as NoteDocument), {
        before: noteDocument(transaction.before.toJSON() as NoteDocument),
        steps: batch.flatMap((item) => item.steps.map((step) => step.toJSON())),
      });
    },
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
      if (!traceRef.current)
        changeRef.current(noteDocument(editor.getJSON() as NoteDocument));
      sync.current(editor);
    },
  });
  useLayoutEffect(() => {
    if (!sourceSelection || readOnly || linkRequest || slash) return;
    const place = () => {
      const node = sourceToolbar.current;
      if (!node) return;
      try {
        const rect = sourceSelection.anchor(),
          viewport = window.visualViewport,
          left = viewport?.offsetLeft ?? 0,
          top = viewport?.offsetTop ?? 0,
          width = viewport?.width ?? innerWidth,
          height = viewport?.height ?? innerHeight;
        const ownWidth = node.offsetWidth,
          ownHeight = node.offsetHeight;
        setToolbarPosition({
          position: "fixed",
          left: Math.max(
            left + 8,
            Math.min(rect.left, left + width - ownWidth - 8),
          ),
          top: Math.max(
            top + 8,
            Math.min(
              rect.top - ownHeight - 10 >= top + 8
                ? rect.top - ownHeight - 10
                : rect.bottom + 10,
              top + height - ownHeight - 8,
            ),
          ),
        });
      } catch {
        setToolbarPosition({ display: "none" });
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [sourceSelection, readOnly, !!linkRequest, !!slash]);
  useEffect(() => {
    if (!editor) return;
    const plugin = new Plugin({
      key: sourceKey.current,
      props: { decorations: () => sourceDecorations.current },
    });
    editor.registerPlugin(plugin);
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(sourceKey.current);
      sourceDecorations.current = DecorationSet.empty;
    };
  }, [editor]);
  useEffect(() => {
    if (editor) selectionFor(editor);
  }, [editor, !!sourceControl]);
  useEffect(() => {
    if (!editor || !sourceControl) return;
    let active = true;
    const version = editorVersion.current,
      node = editor.state.doc,
      control = sourceControl;
    const draw = () => {
      if (!editor.isDestroyed)
        editor.view.dispatch(editor.state.tr.setMeta(sourceKey.current, true));
    };
    sourceDecorations.current = DecorationSet.empty;
    draw();
    void fingerprintSourceDocument(
      noteDocument(editor.getJSON() as NoteDocument),
    )
      .then((fingerprint) => {
        if (
          !active ||
          editor.isDestroyed ||
          version !== editorVersion.current ||
          !editor.state.doc.eq(node)
        )
          return;
        const checked = (target: EditorSourceTarget) => {
          if (
            target.noteId !== control.noteId ||
            target.noteRevision !== control.noteRevision ||
            target.documentDigest !== fingerprint.digest
          )
            return false;
          try {
            if (
              !Number.isSafeInteger(target.from) ||
              !Number.isSafeInteger(target.to) ||
              target.from < 0 ||
              target.from >= target.to ||
              target.to > node.content.size
            )
              return false;
            const start = node.resolve(target.from),
              end = node.resolve(target.to);
            if (!start.parent.isTextblock || !end.parent.isTextblock)
              return false;
            const scalar = (position: number) => {
              const resolved = node.resolve(position),
                before = resolved.nodeBefore,
                after = resolved.nodeAfter,
                left = before?.isText
                  ? before.text?.charCodeAt(before.text.length - 1)
                  : undefined,
                right = after?.isText ? after.text?.charCodeAt(0) : undefined;
              return !(
                left !== undefined &&
                right !== undefined &&
                left >= 0xd800 &&
                left <= 0xdbff &&
                right >= 0xdc00 &&
                right <= 0xdfff
              );
            };
            if (!scalar(target.from) || !scalar(target.to)) return false;
            let supported = true;
            node.nodesBetween(target.from, target.to, (child) => {
              if (
                child.isLeaf &&
                !child.isText &&
                child.type.name !== "hardBreak"
              )
                supported = false;
            });
            return (
              supported &&
              node.textBetween(target.from, target.to, "\n", (child) =>
                child.type.name === "hardBreak" ? "\n" : "\ufffc",
              ) === target.quote
            );
          } catch {
            return false;
          }
        };
        const decorations = control.annotations.filter(checked).map((target) =>
          Decoration.inline(target.from, target.to, {
            class: "study-source-annotation",
            "data-source-entry": target.key,
          }),
        );
        if (control.target) {
          if (checked(control.target)) {
            const target = control.target;
            decorations.push(
              Decoration.inline(target.from, target.to, {
                class: "study-source-highlight",
              }),
            );
            editor.view.dispatch(
              editor.state.tr
                .setSelection(
                  TextSelection.create(
                    editor.state.doc,
                    target.from,
                    target.to,
                  ),
                )
                .scrollIntoView(),
            );
            editor.view.focus();
          } else control.onTargetUnavailable?.();
        }
        sourceDecorations.current = DecorationSet.create(
          editor.state.doc,
          decorations,
        );
        draw();
      })
      .catch(() => {
        if (
          active &&
          !editor.isDestroyed &&
          version === editorVersion.current
        ) {
          sourceDecorations.current = DecorationSet.empty;
          draw();
          if (control.target) control.onTargetUnavailable?.();
        }
      });
    return () => {
      active = false;
    };
  }, [
    editor,
    sourceControl?.noteId,
    sourceControl?.noteRevision,
    sourceControl?.annotations,
    sourceControl?.target,
  ]);
  useEffect(() => {
    if (
      editor &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(checkedDocument.value)
    ) {
      close();
      if (!linkControlRef.current) setLinkRequest(null);
      dismissed.current = null;
      replacing.current = true;
      try {
        editor.commands.setContent(checkedDocument.value, {
          emitUpdate: false,
        });
      } finally {
        replacing.current = false;
      }
    }
  }, [checkedDocument.value, editor]);
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
  function requestFromDraft(draft: EditorLinkDraft): LinkRequest {
    return {
      from: draft.from,
      to: draft.to,
      href: draft.initialUrl,
      value: draft.url,
      slash: draft.source === "slash",
      selection: draft.selection,
      document: editor!.state.doc,
    };
  }
  function openLink(draft: EditorLinkDraft) {
    if (!editor || noteRequestRef.current) return;
    try {
      linkControlRef.current?.open(draft);
      setLinkRequest(requestFromDraft(draft));
      setLinkError("");
    } catch (failure) {
      setLinkError(
        failure instanceof Error
          ? failure.message
          : "Could not open this link draft.",
      );
    }
  }
  useEffect(() => {
    if (editor && !linkRequest && linkControl?.draft) {
      setLinkRequest(requestFromDraft(linkControl.draft));
    }
  }, [editor, linkControl?.draft, linkRequest]);
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
    if (label === "Web link") {
      dismissed.current = range;
      openLink({
        from: range.from,
        to: range.to,
        initialUrl: "",
        url: "",
        source: "slash",
        selection:
          editor.state.selection.toJSON() as EditorLinkDraft["selection"],
      });
      close();
      return;
    }
    if (label === "Another note") {
      dismissed.current = range;
      close();
      openNotePicker(editor, { from: range.from, to: range.to });
      return;
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
    close();
    chain.run();
  };
  useLayoutEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly && !checkedDocument.error, false);
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          role: "textbox",
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          "aria-readonly": String(readOnly),
          spellcheck: String(preferences.spellcheck),
        },
      },
    });
    if (readOnly) {
      close();
      if (!linkControlRef.current) setLinkRequest(null);
    }
  }, [
    editor,
    readOnly,
    ariaLabel,
    preferences.spellcheck,
    checkedDocument.error,
  ]);
  useLayoutEffect(() => {
    let record = admission.current;
    if (record?.editor !== editor) {
      if (!editor) return;
      record = { editor, alive: true };
      admission.current = record;
      const owner = record;
      editor.registerPlugin(
        new Plugin({
          key: new PluginKey("notes-editor-admission"),
          filterTransaction(transaction) {
            if (!transaction.docChanged) return true;
            if (!owner.alive) return false;
            if (policyBlocked.current && !replacing.current) return false;
            if (readOnlyRef.current && !replacing.current) return false;
            try {
              (policy.current === "notes"
                ? validateNoteDocument
                : validateDocument)(
                noteDocument(transaction.doc.toJSON() as NoteDocument),
              );
            } catch {
              setContentNotice(
                "This edit isn’t supported or is too large. Your previous writing is unchanged.",
              );
              return false;
            }
            return (
              preferencesRef.current.markdown ||
              !transaction.getMeta("inputRule")
            );
          },
        }),
      );
    }
    record.alive = true;
    // The editor owns plugin disposal. Keep this fence during deferred destroy so
    // already queued IME callbacks cannot mutate a detached/locked editor.
    return () => {
      record.alive = false;
    };
  }, [editor]);
  useLayoutEffect(() => {
    if (!editor) return;
    if (!preferences.markdown) {
      const plugins = editor.state.plugins;
      if (!plugins.some((plugin) => plugin.spec.isInputRules)) return;
      suspendedRules.current = {
        editor,
        slots: plugins.flatMap((plugin, index) =>
          plugin.spec.isInputRules
            ? [
                {
                  plugin,
                  next: plugins
                    .slice(index + 1)
                    .find((next) => !next.spec.isInputRules),
                },
              ]
            : [],
        ),
      };
      editor.view.updateState(
        editor.state.reconfigure({
          plugins: plugins.filter((plugin) => !plugin.spec.isInputRules),
        }),
      );
    } else if (suspendedRules.current?.editor === editor) {
      // Restore the same rule plugins around their original non-rule anchors.
      // History and any subsequently registered plugins keep their existing state.
      const plugins = [...editor.state.plugins];
      for (const { plugin, next } of suspendedRules.current.slots) {
        if (plugins.includes(plugin)) continue;
        const index = next ? plugins.indexOf(next) : -1;
        plugins.splice(index < 0 ? plugins.length : index, 0, plugin);
      }
      editor.view.updateState(editor.state.reconfigure({ plugins }));
      suspendedRules.current = null;
    }
  }, [editor, preferences.markdown]);
  if (!editor) return null;
  return (
    <>
      <div
        className="format"
        role="toolbar"
        aria-label="Formatting"
        inert={readOnly || Boolean(checkedDocument.error)}
        aria-disabled={readOnly || undefined}
      >
        {noteLinks && documentPolicy === "notes" && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openNotePicker(editor)}
          >
            Link a note
          </button>
        )}
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
            close();
            const { from, to } = editor.state.selection;
            const initialUrl = String(editor.getAttributes("link").href ?? "");
            openLink({
              from,
              to,
              initialUrl,
              url: initialUrl,
              source: "toolbar",
              selection:
                editor.state.selection.toJSON() as EditorLinkDraft["selection"],
            });
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
      {sourceControl && (
        <button
          type="button"
          disabled={!sourceSelection || readOnly || !!noteRequest}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (sourceSelection?.isCurrent())
              sourceRef.current?.onCapture(sourceSelection);
          }}
        >
          Make a card
        </button>
      )}
      {sourceControl &&
        sourceSelection &&
        !linkRequest &&
        !noteRequest &&
        !slash &&
        !readOnly && (
          <div
            role="toolbar"
            aria-label="Selection tools"
            className="study-selection-toolbar"
            ref={sourceToolbar}
            style={toolbarPosition}
          >
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (sourceSelection.isCurrent())
                  sourceRef.current?.onCapture(sourceSelection);
              }}
            >
              Make a card
            </button>
          </div>
        )}
      <EditorContent editor={editor} />
      {noteRequest && noteLinks && documentPolicy === "notes" && (
        <NoteLinkPicker
          owner={noteLinks}
          query={noteRequest.query}
          anchor={() => {
            const rect = editor.view.coordsAtPos(
              Math.min(noteRequest.to, editor.state.doc.content.size),
            );
            return new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top);
          }}
          isCurrent={() =>
            !editor.isDestroyed &&
            admission.current?.alive === true &&
            !readOnlyRef.current &&
            editorVersion.current === noteRequest.version &&
            editor.state.doc.eq(noteRequest.node)
          }
          onQuery={
            noteRequest.query !== undefined
              ? (value) => {
                  if (
                    editorVersion.current !== noteRequest.version ||
                    !editor.state.doc.eq(noteRequest.node)
                  )
                    return;
                  editor.view.dispatch(
                    editor.state.tr.insertText(
                      value,
                      noteRequest.from + 2,
                      noteRequest.to,
                    ),
                  );
                  setNoteRequest({
                    ...noteRequest,
                    to: noteRequest.from + 2 + value.length,
                    query: value,
                    node: editor.state.doc,
                    version: editorVersion.current,
                  });
                }
              : undefined
          }
          onChoose={(target) => {
            const chain = editor
              .chain()
              .focus()
              .command(({ tr }) => {
                closeHistory(tr);
                return true;
              })
              .insertContentAt(
                { from: noteRequest.from, to: noteRequest.to },
                { type: "noteLink", attrs: { version: 1, target } },
              );
            chain.run();
          }}
          onClose={(restoreFocus = true) => {
            dismissedNote.current =
              noteRequest.query === undefined
                ? null
                : `${noteRequest.from}:${noteRequest.to}:${noteRequest.query}`;
            setNoteRequest(null);
            if (restoreFocus && !editor.isDestroyed) editor.commands.focus();
          }}
        />
      )}
      {checkedDocument.error && <p role="alert">{checkedDocument.error}</p>}
      {contentNotice && <p role="status">{contentNotice}</p>}
      {linkError && <p role="alert">{linkError}</p>}
      {linkRequest && (!readOnly || !linkControl) && (
        <LinkPopover
          initialUrl={linkRequest.value}
          originalUrl={linkRequest.href}
          onChange={(url) => {
            linkControlRef.current?.change(url);
            setLinkRequest((current) =>
              current ? { ...current, value: url } : current,
            );
          }}
          onLock={linkControl?.lock}
          unavailable={
            readOnly
              ? "This editor is read-only. You can copy or cancel this link."
              : linkControl && !linkControl.valid
                ? "This text changed. Cancel this link and select the text again."
                : undefined
          }
          anchor={() => editor.view.coordsAtPos(linkRequest.from)}
          onCancel={(restore) => {
            try {
              linkControlRef.current?.cancel();
            } catch (failure) {
              setLinkError(String(failure));
              return;
            }
            setLinkRequest(null);
            if (restore && !editor.isDestroyed) {
              if (editor.state.doc.eq(linkRequest.document)) {
                try {
                  editor.view.dispatch(
                    editor.state.tr.setSelection(
                      Selection.fromJSON(
                        editor.state.doc,
                        linkRequest.selection,
                      ),
                    ),
                  );
                } catch {
                  /* Ignore a selection invalidated by a replacement document. */
                }
              }
              editor.view.focus();
            }
          }}
          onApply={(url) => {
            if (!editor.isEditable || readOnlyRef.current)
              return "This editor is read-only.";
            if (!editor.state.doc.eq(linkRequest.document))
              return "This text changed. Cancel and select it again.";
            let accept:
              ((document: NoteDocument, changed: boolean) => void) | undefined;
            try {
              accept = linkControlRef.current?.beginApply();
            } catch (failure) {
              return String(failure);
            }
            const before = editor.state.doc;
            const chain = editor
              .chain()
              .focus()
              .command(({ tr }) => {
                closeHistory(tr);
                return true;
              });
            if (
              linkRequest.slash ||
              (!linkRequest.href && linkRequest.from === linkRequest.to)
            )
              chain.insertContentAt(
                { from: linkRequest.from, to: linkRequest.to },
                {
                  type: "text",
                  text: url,
                  marks: [{ type: "link", attrs: { href: url } }],
                },
              );
            else
              chain
                .setTextSelection({
                  from: linkRequest.from,
                  to: linkRequest.to,
                })
                .extendMarkRange("link")
                .setLink({ href: url });
            if (!chain.run())
              return "Could not apply this link. Your input is still here.";
            try {
              accept?.(
                noteDocument(editor.getJSON() as NoteDocument),
                !before.eq(editor.state.doc),
              );
            } catch (failure) {
              return String(failure);
            }
            editor.view.focus();
            setLinkRequest(null);
            return null;
          }}
          onRemove={
            linkRequest.href
              ? () => {
                  if (!editor.isEditable || readOnlyRef.current)
                    return "This editor is read-only.";
                  if (!editor.state.doc.eq(linkRequest.document))
                    return "This text changed. Cancel and select it again.";
                  let accept:
                    | ((document: NoteDocument, changed: boolean) => void)
                    | undefined;
                  try {
                    accept = linkControlRef.current?.beginApply();
                  } catch (failure) {
                    return String(failure);
                  }
                  const before = editor.state.doc;
                  const applied = editor
                    .chain()
                    .focus()
                    .setTextSelection({
                      from: linkRequest.from,
                      to: linkRequest.to,
                    })
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                  if (!applied)
                    return "Could not remove this link. Your input is still here.";
                  try {
                    accept?.(
                      noteDocument(editor.getJSON() as NoteDocument),
                      !before.eq(editor.state.doc),
                    );
                  } catch (failure) {
                    return String(failure);
                  }
                  editor.view.focus();
                  setLinkRequest(null);
                  return null;
                }
              : undefined
          }
        />
      )}
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
