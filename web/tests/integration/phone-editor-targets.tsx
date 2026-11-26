// Direct production editor: selection capture and source recovery are real component states.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RichEditor } from "../../src/ui/RichEditor";
import type { NoteDocument } from "../../src/domain/contracts";
import "../../src/styles/app.css";
import "../../src/styles/study-source.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";

function Fixture() {
  const [document, setDocument] = useState<NoteDocument>({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "A synthetic selected passage" }] },
  ] });
  const [captured, setCaptured] = useState(false);
  return <main style={{ padding: 16, maxWidth: 800 }}>
    <p role="status">{captured ? "Current selection captured" : "No selection captured"}</p>
    <RichEditor document={document} onChange={setDocument} sourceControl={{
      noteId: "11111111-1111-4111-8111-111111111111", noteRevision: 1,
      annotations: [], onCapture: (capture) => setCaptured(capture.isCurrent()),
    }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
