import { useState } from "react";
import { createRoot } from "react-dom/client";
import SampleWorkspace from "../../src/demo/SampleWorkspace";
import "../../src/styles/app.css";

document.documentElement.style.setProperty("--notes-editor-size", "19px");
document.documentElement.style.setProperty("--notes-editor-width", "720px");
function Fixture() {
  const [open, setOpen] = useState(true);
  return open ? <SampleWorkspace onExit={() => setOpen(false)} /> : <p>Sample closed</p>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
