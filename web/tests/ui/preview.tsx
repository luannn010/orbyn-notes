// Test-only visual fixture; this entry is excluded from the production build.
import { createRoot } from "react-dom/client";
import { Workspace } from "../../src/ui/Workspace";
import { applyInitialPreferences } from "../../src/ui/primitives";
import type { Note, NotesStore } from "../../src/domain/contracts";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
applyInitialPreferences();
let notes: Note[] = [
  {
    id: "test-one",
    title: "A quiet place to think",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "A synthetic note for checking the editor. Ideas, details and a little room to write.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Next steps" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Write down the important parts." },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    tags: ["Ideas", "Work"],
    revision: 1,
    createdAt: "2026-11-08T10:00:00Z",
    updatedAt: "2026-11-08T10:00:00Z",
    trashedAt: null,
  },
  {
    id: "test-two",
    title: "Reading notes",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Questions to return to after the next chapter.",
            },
          ],
        },
      ],
    },
    tags: ["Reading"],
    revision: 1,
    createdAt: "2026-11-07T10:00:00Z",
    updatedAt: "2026-11-07T10:00:00Z",
    trashedAt: null,
  },
];
if (new URLSearchParams(location.search).get("count") === "1000") {
  const template = notes[0]!;
  notes = Array.from({ length: 1000 }, (_, index) => ({
    ...structuredClone(template),
    id: `fixture-${index}`,
    title: `Synthetic note ${String(index).padStart(4, "0")}`,
  }));
}
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
const store: NotesStore = {
  list: async () => structuredClone(notes),
  get: async (id) => notes.find((n) => n.id === id) ?? null,
  create: async (input) => {
    const n: Note = {
      ...input,
      id: crypto.randomUUID(),
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      trashedAt: null,
    };
    notes = [n, ...notes];
    notify();
    return n;
  },
  update: async (id, patch) => {
    const n = notes.find((n) => n.id === id)!;
    const next = {
      ...n,
      ...patch,
      revision: n.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    notes = notes.map((n) => (n.id === id ? next : n));
    notify();
    return next;
  },
  trash: async (id) => {
    const n = notes.find((n) => n.id === id)!;
    n.trashedAt = new Date().toISOString();
    n.revision++;
    notify();
    return n;
  },
  restore: async (id) => {
    const n = notes.find((n) => n.id === id)!;
    n.trashedAt = null;
    n.revision++;
    notify();
    return n;
  },
  erase: async () => {
    notes = [];
    notify();
  },
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  persistence: () => ({ status: "ready" }),
  close: () => {},
};
createRoot(document.getElementById("root")!).render(
  <>
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        zIndex: 50,
        fontSize: 10,
        background: "#fbbf24",
        color: "#000",
        padding: "2px 6px",
      }}
    >
      TEST FIXTURE · In-memory data · No encryption claim
    </div>
    <Workspace
      store={store}
      session={{
        accountId: "test",
        deviceId: "test",
        email: "fixture@example.invalid",
        deviceState: "trusted",
      }}
      onSignOut={async () => {
        document.getElementById("root")!.textContent = "Fixture signed out";
      }}
    />
  </>,
);
