import { createRoot } from "react-dom/client";
import { RichEditor } from "../../src/ui/RichEditor";
import "../../src/styles/app.css";

createRoot(document.getElementById("root")!).render(
  <RichEditor
    document={{ type: "doc", content: [{ type: "paragraph" }] }}
    onChange={() => {}}
  />,
);
