import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import type { NoteDocument } from "../../src/domain/contracts";
import { RichEditor } from "../../src/ui/RichEditor";

const live = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (options: import("@tiptap/react").UseEditorOptions) => {
      const editor = actual.useEditor(options);
      live.editor = editor;
      return editor;
    },
  };
});

it("does not offer writing when the document is unsupported", async () => {
  const onChange = vi.fn();
  const malformed = {
    type: "doc",
    content: [{ type: "unsupported" }],
  } as unknown as NoteDocument;
  render(
    <div className="editor-page">
      <RichEditor
        document={malformed}
        onChange={onChange}
        documentPolicy="notes"
      />
    </div>,
  );
  const textbox = await screen.findByRole("textbox", { name: "Note content" });
  expect(await screen.findByRole("alert")).toHaveTextContent("isn’t supported");
  expect(textbox.closest(".notes-editor-body")).not.toHaveAttribute(
    "data-empty",
  );
  expect(textbox).toHaveAttribute("contenteditable", "false");
  expect(onChange).not.toHaveBeenCalled();
});

const empty = { type: "doc" as const, content: [{ type: "paragraph" }] };

it("shows an unsaved writing hint only for an editable empty note", async () => {
  const onChange = vi.fn();
  const view = render(
    <div className="editor-page">
      <RichEditor document={empty} onChange={onChange} documentPolicy="notes" />
    </div>,
  );
  const textbox = await screen.findByRole("textbox", { name: "Note content" });
  const body = textbox.closest(".notes-editor-body")!;
  await waitFor(() => expect(body).toHaveAttribute("data-empty", "true"));
  fireEvent.focus(textbox);
  fireEvent.blur(textbox);
  expect(onChange).not.toHaveBeenCalled();
  expect(live.editor!.getJSON()).toEqual(empty);

  act(() => {
    live.editor!.commands.insertContent("Hello");
  });
  expect(body).not.toHaveAttribute("data-empty");
  expect(onChange).toHaveBeenCalled();
  expect(live.editor!.getText()).toBe("Hello");
  act(() => {
    live.editor!.commands.clearContent();
  });
  expect(body).toHaveAttribute("data-empty", "true");

  view.rerender(
    <div className="editor-page">
      <RichEditor
        document={empty}
        onChange={onChange}
        documentPolicy="notes"
        readOnly
      />
    </div>,
  );
  expect(body).not.toHaveAttribute("data-empty");
  view.rerender(
    <div className="editor-page">
      <RichEditor
        document={empty}
        onChange={onChange}
        documentPolicy="journal"
      />
    </div>,
  );
  expect(body).not.toHaveAttribute("data-empty");
});
