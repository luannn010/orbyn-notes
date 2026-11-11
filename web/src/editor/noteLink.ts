import { Node, type NodeViewRenderer } from "@tiptap/core";
import { validateNoteTarget } from "../links/reference";

export type NoteLinkOptions = { nodeView?: NodeViewRenderer };

/** Shared identity-only schema. The optional view changes presentation, not data. */
const NoteLink = Node.create<NoteLinkOptions>({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",
  addOptions() {
    return {};
  },
  addAttributes() {
    return {
      version: {
        default: 1,
        rendered: false,
        validate(value: unknown) {
          if (value !== 1) throw new Error("Invalid note reference version.");
        },
      },
      target: {
        isRequired: true,
        rendered: false,
        validate(value: unknown) {
          validateNoteTarget(value);
        },
      },
    };
  },
  // Untrusted HTML/attributes never confer a typed reference. Notes-only paste
  // uses the separate bounded reference codec and actual editor admission.
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ["span", { "data-type": "note-link" }, "Note reference"];
  },
  renderText() {
    return "Note reference";
  },
  addNodeView() {
    return this.options.nodeView ?? null;
  },
});

export function createNoteLinkExtension(
  options: NoteLinkOptions = {},
): Node<NoteLinkOptions> {
  return NoteLink.configure(options);
}
