import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LinkPopover } from "../../src/ui/LinkPopover";
import { RichEditor, type EditorLinkControl } from "../../src/ui/RichEditor";
import { checkClose } from "../../src/desktop/closeGuard";

beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(10, 10, 1, 16),
  });
});
it("keeps dirty URL input and its guard when a route or caption button is clicked", () => {
  const cancel = vi.fn(),
    close = vi.fn();
  render(
    <>
      <LinkPopover
        initialUrl=""
        anchor={() => ({ left: 10, top: 10, bottom: 26 })}
        onApply={() => null}
        onCancel={cancel}
      />
      <button onClick={close}>Close window</button>
    </>,
  );
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://example.test/unfinished" },
  });
  const outside = screen.getByRole("button", { name: "Close window" });
  fireEvent.pointerDown(outside);
  fireEvent.click(outside);
  expect(close).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(screen.getByLabelText("URL")).toHaveValue(
    "https://example.test/unfinished",
  );
  let state = "";
  act(() => {
    state = checkClose();
  });
  expect(state).toBe("draft");
});
it("rejects URLs that the persistence validator would reject", () => {
  const apply = vi.fn(() => null);
  render(
    <LinkPopover
      initialUrl=""
      anchor={() => ({ left: 10, top: 10, bottom: 26 })}
      onApply={apply}
      onCancel={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://example.test/a b" },
  });
  fireEvent.submit(screen.getByRole("dialog", { name: "Web link" }));
  expect(screen.getByText("Enter a valid web or email link.")).toBeVisible();
  expect(apply).not.toHaveBeenCalled();
});
it("validates inline, applies email URLs and keeps unsubmitted input behind the close guard", async () => {
  const apply = vi.fn(() => null),
    cancel = vi.fn();
  const mounted = render(
    <LinkPopover
      initialUrl=""
      anchor={() => ({ left: 10, top: 10, bottom: 26 })}
      onApply={apply}
      onCancel={cancel}
    />,
  );
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "javascript:bad" },
  });
  let state: string = "";
  act(() => {
    state = checkClose();
  });
  expect(state).toBe("draft");
  fireEvent.submit(screen.getByRole("dialog", { name: "Web link" }));
  expect(screen.getByText("Enter a valid web or email link.")).toBeVisible();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "mailto:synthetic@example.test" },
  });
  fireEvent.submit(screen.getByRole("dialog", { name: "Web link" }));
  expect(apply).toHaveBeenCalledWith("mailto:synthetic@example.test");
  fireEvent.keyDown(screen.getByLabelText("URL"), { key: "Escape" });
  expect(cancel).toHaveBeenCalledWith(true);
  mounted.unmount();
  expect(checkClose()).toBe("allowed");
});
it("removes an existing link while keeping its text", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <RichEditor
      document={{
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Keep this text",
                marks: [
                  { type: "link", attrs: { href: "https://example.test" } },
                ],
              },
            ],
          },
        ],
      }}
      onChange={change}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "Note content" });
  await act(async () => editor.focus());
  await act(async () => {
    const range = document.createRange();
    range.setStart(editor.querySelector("a")!.firstChild!, 3);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await user.click(screen.getByRole("button", { name: /^Link$/ }));
  expect(screen.getByLabelText("URL")).toHaveValue("https://example.test");
  await user.click(screen.getByRole("button", { name: "Remove link" }));
  expect(editor.querySelector("a")).toBeNull();
  expect(editor.textContent).toBe("Keep this text");
  expect(editor).toHaveFocus();
  expect(change).toHaveBeenCalled();
});

it("guards restored dirty input immediately and permits only draft-preserving caption actions", () => {
  const cancel = vi.fn(),
    minimize = vi.fn(),
    maximize = vi.fn(),
    close = vi.fn();
  render(
    <>
      <LinkPopover
        initialUrl="https://example.test/retained"
        originalUrl=""
        anchor={() => ({ left: 0, top: 0, bottom: 20 })}
        onApply={() => null}
        onCancel={cancel}
      />
      <button data-preserves-editor-draft="true" onClick={minimize}>
        Minimize window
      </button>
      <button data-preserves-editor-draft="true" onClick={maximize}>
        Maximize window
      </button>
      <button onClick={close}>Close window</button>
    </>,
  );
  let state = "";
  act(() => {
    state = checkClose();
  });
  expect(state).toBe("draft");
  for (const name of ["Minimize window", "Maximize window", "Close window"]) {
    const button = screen.getByRole("button", { name });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
  }
  expect(minimize).toHaveBeenCalledOnce();
  expect(maximize).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(screen.getByLabelText("URL")).toHaveValue(
    "https://example.test/retained",
  );
});
it("keeps copyable stale input and allows Journal locking without applying it", () => {
  const lock = vi.fn(),
    apply = vi.fn(() => null),
    cancel = vi.fn();
  render(
    <LinkPopover
      initialUrl="invalid private draft"
      originalUrl=""
      unavailable="This text changed. Cancel this link and select the text again."
      anchor={() => ({ left: 0, top: 0, bottom: 20 })}
      onApply={apply}
      onCancel={cancel}
      onLock={lock}
    />,
  );
  expect(screen.getByRole("button", { name: "Apply link" })).toBeDisabled();
  expect(screen.getByLabelText("URL")).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Lock Journal" }));
  expect(lock).toHaveBeenCalledOnce();
  expect(apply).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});
it("rejects an unretainable change before displaying it", () => {
  render(
    <LinkPopover
      initialUrl="retained"
      onChange={() => {
        throw new Error("Synthetic retention limit");
      }}
      anchor={() => ({ left: 0, top: 0, bottom: 20 })}
      onApply={() => null}
      onCancel={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "unretainable" },
  });
  expect(screen.getByLabelText("URL")).toHaveValue("retained");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Synthetic retention limit",
  );
});

it("restores the accepted URL after a protected editor becomes read-only and editable again", async () => {
  const control: EditorLinkControl = {
    draft: {
      from: 1,
      to: 1,
      source: "toolbar",
      selection: { type: "text", anchor: 1, head: 1 },
      initialUrl: "",
      url: "",
    },
    valid: true,
    open: vi.fn(),
    change: vi.fn(),
    cancel: vi.fn(),
    beginApply: vi.fn(() => () => {}),
  };
  const doc = {
    type: "doc" as const,
    content: [{ type: "paragraph" as const, content: [] }],
  };
  const fixture = (readOnly: boolean) => (
    <RichEditor
      document={doc}
      onChange={() => {}}
      readOnly={readOnly}
      linkControl={control}
    />
  );
  const view = render(fixture(false));
  await screen.findByLabelText("URL");
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://example.test/accepted" },
  });
  expect(control.change).toHaveBeenCalledWith("https://example.test/accepted");
  view.rerender(fixture(true));
  expect(
    screen.queryByRole("dialog", { name: "Web link" }),
  ).not.toBeInTheDocument();
  expect(control.cancel).not.toHaveBeenCalled();
  view.rerender(fixture(false));
  expect(await screen.findByLabelText("URL")).toHaveValue(
    "https://example.test/accepted",
  );
});
