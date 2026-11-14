import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/ui/SettingsView";
import { RichEditor } from "../../src/ui/RichEditor";
import { usePreferences } from "../../src/ui/primitives";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import type { NoteDocument } from "../../src/domain/contracts";
const live = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (
      options: import("@tiptap/react").UseEditorOptions,
      dependencies?: import("react").DependencyList,
    ) => {
      const editor = actual.useEditor(options, dependencies);
      live.editor = editor;
      return editor;
    },
  };
});
function Fixture({
  readOnly = false,
  document = { type: "doc", content: [{ type: "paragraph", content: [] }] },
  onChange = () => {},
}: {
  readOnly?: boolean;
  document?: NoteDocument;
  onChange?: (value: NoteDocument) => void;
}) {
  const preferences = usePreferences();
  return (
    <>
      <SettingsView
        email="synthetic@example.test"
        preferences={preferences}
        onSignOut={() => {}}
        onExport={() => {}}
        onErase={() => {}}
        onDone={() => {}}
      />
      <RichEditor
        document={document}
        onChange={onChange}
        ariaLabel="Journal entry"
        readOnly={readOnly}
      />
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
it.each(["markdown", "readonly"])(
  "rejects queued IME formatting after %s changes",
  async (mode) => {
    const document: NoteDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "## " }] },
      ],
    };
    const change = vi.fn();
    const mounted = render(<Fixture document={document} onChange={change} />);
    const box = await screen.findByRole("textbox", { name: "Journal entry" });
    const view = live.editor!.view;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() =>
        view.dispatch(
          view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
        ),
      );
      fireEvent.compositionEnd(box);
      if (mode === "markdown") {
        fireEvent.click(screen.getByRole("button", { name: /^Editor$/ }));
        fireEvent.click(
          screen.getByRole("checkbox", { name: /Turn Markdown/ }),
        );
      } else
        mounted.rerender(
          <Fixture document={document} onChange={change} readOnly />,
        );
      act(() => vi.runOnlyPendingTimers());
      expect(box.querySelector("h2")).toBeNull();
      expect(box.textContent).toBe("## ");
      expect(change).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
      vi.useRealTimers();
    }
  },
);
it("applies spelling/size/width across an already mounted editor and persists across remount", async () => {
  const mounted = render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: /^Editor$/ }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "Text size" })).getByRole(
      "button",
      { name: "Large" },
    ),
  );
  fireEvent.click(
    within(screen.getByRole("group", { name: "Line width" })).getByRole(
      "button",
      { name: "Wide" },
    ),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Check spelling" }));
  expect(
    await screen.findByRole("textbox", { name: "Journal entry" }),
  ).toHaveAttribute("spellcheck", "false");
  expect(
    document.documentElement.style.getPropertyValue("--notes-editor-size"),
  ).toBe("16px");
  expect(
    document.documentElement.style.getPropertyValue("--notes-editor-width"),
  ).toBe("800px");
  mounted.unmount();
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: /^Editor$/ }));
  expect(
    within(screen.getByRole("group", { name: "Text size" })).getByRole(
      "button",
      { name: "Large" },
    ),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("checkbox", { name: "Check spelling" }),
  ).not.toBeChecked();
});
it("uses safe defaults for corrupt persisted preferences and updates on cross-tab storage changes", async () => {
  localStorage.setItem("notes.editor.v1", '{"textSize":"999px"}');
  render(<Fixture />);
  expect(
    await screen.findByRole("textbox", { name: "Journal entry" }),
  ).toHaveAttribute("spellcheck", "true");
  await act(async () => {
    localStorage.setItem(
      "notes.editor.v1",
      JSON.stringify({
        textSize: "small",
        lineWidth: "wide",
        markdown: false,
        spellcheck: false,
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "notes.editor.v1" }),
    );
  });
  expect(
    screen.getByRole("textbox", { name: "Journal entry" }),
  ).toHaveAttribute("spellcheck", "false");
  expect(
    document.documentElement.style.getPropertyValue("--notes-editor-size"),
  ).toBe("12px");
});
it("keeps a conflicted Journal readable/selectable while disabling editing and its formatting surface", async () => {
  const mounted = render(<Fixture />);
  expect(
    await screen.findByRole("textbox", { name: "Journal entry" }),
  ).toHaveAttribute("contenteditable", "true");
  mounted.rerender(<Fixture readOnly />);
  expect(
    screen.getByRole("textbox", { name: "Journal entry" }),
  ).toHaveAttribute("contenteditable", "false");
  expect(
    screen.getByRole("textbox", { name: "Journal entry" }),
  ).toHaveAttribute("aria-readonly", "true");
  expect(
    screen.getByRole("toolbar", { name: "Formatting", hidden: true }),
  ).toHaveAttribute("inert");
});
it("allows controlled saved-document replacement in read-only mode without calling autosave", async () => {
  const change = vi.fn();
  const mounted = render(<Fixture readOnly onChange={change} />);
  await screen.findByRole("textbox", { name: "Journal entry" });
  mounted.rerender(
    <Fixture
      readOnly
      onChange={change}
      document={{
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Reloaded synthetic saved entry" }],
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByRole("textbox", { name: "Journal entry" }),
  ).toHaveTextContent("Reloaded synthetic saved entry");
  expect(change).not.toHaveBeenCalled();
});
