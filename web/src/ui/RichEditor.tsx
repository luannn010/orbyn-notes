import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type { NoteDocument } from "../domain/contracts";
import { safeLink } from "./model";
import { useEffect, useState } from "react";
export function RichEditor({
  document,
  onChange,
}: {
  document: NoteDocument;
  onChange: (value: NoteDocument) => void;
}) {
  const [slash, setSlash] = useState<{ from: number; to: number } | null>(null);
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
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as NoteDocument);
      const { $from, from } = editor.state.selection;
      setSlash(
        $from.parent.textContent === "/" ? { from: from - 1, to: from } : null,
      );
    },
  });
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(document))
      editor.commands.setContent(document, { emitUpdate: false });
  }, [document, editor]);
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
      {slash && (
        <div className="slash-menu" aria-label="Insert block">
          <p>Insert block</p>
          {[
            "Paragraph",
            "Heading",
            "Bulleted list",
            "Numbered list",
            "To-do list",
            "Web link",
          ].map((label, index) => (
            <button
              key={label}
              onClick={() => {
                const chain = editor.chain().focus().deleteRange(slash);
                if (index === 0) chain.setParagraph().run();
                if (index === 1) chain.toggleHeading({ level: 2 }).run();
                if (index === 2) chain.toggleBulletList().run();
                if (index === 3) chain.toggleOrderedList().run();
                if (index === 4) chain.toggleTaskList().run();
                if (index === 5) {
                  const url = window.prompt(
                    "Link URL (https://, http:// or mailto:)",
                  );
                  if (url && safeLink(url)) {
                    chain
                      .insertContent({
                        type: "text",
                        text: url,
                        marks: [{ type: "link", attrs: { href: url } }],
                      })
                      .run();
                  }
                }
                setSlash(null);
              }}
            >
              {label}
            </button>
          ))}
          <button onClick={() => setSlash(null)}>Close</button>
        </div>
      )}
    </>
  );
}
