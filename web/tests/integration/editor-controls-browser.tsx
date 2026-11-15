import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import { createNoteExtensions } from "../../src/editor/schema";
import { EditorFormatting } from "../../src/ui/editorFormatting";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";

function Fixture() {
  const [width, setWidth] = useState("980"),
    [theme, setTheme] = useState("light"),
    [markdown, setMarkdown] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editor = useEditor({
    extensions: createNoteExtensions(),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A synthetic editor note" }],
        },
      ],
    },
    editorProps: {
      attributes: { role: "textbox", "aria-label": "Note content" },
    },
  });
  return (
    <main
      data-theme={theme}
      style={{
        padding: 16,
        minHeight: "100dvh",
        background: "var(--main)",
        color: "var(--t1)",
      }}
    >
      <label>
        Editor pane width
        <select
          aria-label="Editor pane width"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
        >
          {["980", "620", "380"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Theme
        <select
          aria-label="Theme"
          value={theme}
          onChange={(event) => {
            setTheme(event.target.value);
            document.documentElement.dataset.theme = event.target.value;
          }}
        >
          {["light", "dark", "dim"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <p role="status">
        {dirty ? "Unsaved source draft" : "No unsaved source draft"}
      </p>
      <section
        aria-label="Editor component"
        className="note-format-target"
        style={{ width: Number(width), maxWidth: "100%", marginTop: 16 }}
      >
        {editor && (
          <>
            <EditorFormatting
              editor={editor}
              disabled={false}
              active
              noteLinks={false}
              openLink={() => {}}
              openNote={() => {}}
              onViewChange={setMarkdown}
              sourceEditing
              onUnsavedChange={setDirty}
            />
            <div hidden={markdown}>
              <EditorContent editor={editor} />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
