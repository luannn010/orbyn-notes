import type { NodeViewRenderer, NodeViewRendererProps } from "@tiptap/core";
import type { NoteLinkService, NoteTarget } from "../links/contracts";
export type EditorNoteLinks = {
  service: NoteLinkService;
  noteId: string;
  onOpen: (target: NoteTarget) => void;
  interactive?: boolean;
};
export function createNoteLinkViews(
  control: () => EditorNoteLinks | undefined,
) {
  const readers = new Set<() => void>();
  const renderer: NodeViewRenderer = ({ node }: NodeViewRendererProps) => {
    let current = node,
      active = true,
      sequence = 0,
      stop: (() => void) | undefined,
      revoke: (() => void) | undefined;
    let subscribed: NoteLinkService | undefined;
    const dom = document.createElement("span");
    dom.className = "note-reference";
    dom.contentEditable = "false";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-reference-chip";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.5");
    for (const d of ["M6 4h9l3 3v13H6z", "M9 11h6M9 14.5h4"]) {
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", d);
      icon.append(path);
    }
    const labelNode = document.createElement("span");
    button.append(icon, labelNode);
    dom.append(button);
    function redact(label = "Note reference", actionable = false) {
      labelNode.textContent = label;
      button.setAttribute("aria-label", label);
      button.disabled = !actionable;
      button.removeAttribute("title");
    }
    const refresh = () => {
      const owner = control(),
        ticket = ++sequence;
      redact();
      if (subscribed !== owner?.service) {
        stop?.();
        revoke?.();
        subscribed = owner?.service;
        stop = subscribed?.subscribe(refresh);
        revoke = subscribed?.onInvalidate(() => {
          sequence++;
          redact("Unavailable note");
        });
      }
      if (!owner) return;
      const target = current.attrs.target as NoteTarget;
      void owner.service
        .resolve(target)
        .then((result) => {
          if (
            !active ||
            ticket !== sequence ||
            control()?.service !== owner.service
          )
            return;
          if (result.status === "available") {
            const title = result.title || "Untitled note";
            labelNode.textContent = title;
            button.setAttribute(
              "aria-label",
              owner.interactive === false
                ? `Note reference: ${title}`
                : `Open note: ${title}`,
            );
            button.disabled = owner.interactive === false;
          } else
            redact(
              result.reason === "trashed"
                ? "Note in Trash"
                : "Unavailable note",
              owner.interactive !== false,
            );
        })
        .catch(() => {
          if (active && ticket === sequence) redact("Unavailable note");
        });
    };
    button.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
        return;
      event.preventDefault();
      event.stopPropagation();
      const owner = control();
      if (!button.disabled && owner)
        owner.onOpen(current.attrs.target as NoteTarget);
    });
    readers.add(refresh);
    refresh();
    return {
      dom,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        refresh();
        return true;
      },
      stopEvent: (event) => {
        if (!button.contains(event.target as Node)) return false;
        if (event instanceof KeyboardEvent)
          return (
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey &&
            ["Enter", " "].includes(event.key)
          );
        return (
          event instanceof MouseEvent &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          /^(click|mousedown|mouseup)$/.test(event.type)
        );
      },
      ignoreMutation: () => true,
      destroy() {
        active = false;
        sequence++;
        stop?.();
        revoke?.();
        readers.delete(refresh);
      },
    };
  };
  return { renderer, refresh: () => readers.forEach((read) => read()) };
}
