import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CompactNoteTags } from "../../src/ui/CompactNoteTags";
import { checkClose } from "../../src/desktop/closeGuard";
function setup(initial: string[] = []) {
  const writes = vi.fn();
  function Host() {
    const [tags, setTags] = useState(initial);
    return (
      <>
        <CompactNoteTags
          tags={tags}
          onChange={(next) => {
            writes(next);
            setTags(next);
          }}
          onApply={() =>
            document
              .querySelector<HTMLTextAreaElement>(
                '[aria-label="Writing space"]',
              )
              ?.focus()
          }
        />
        <textarea aria-label="Writing space" />
      </>
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  return { input: screen.getByLabelText("Tags, separated by commas"), writes };
}
it("confirms comma-space, keeps the field focused, then Tab commits the last tag and focuses writing", () => {
  const { input, writes } = setup();
  fireEvent.change(input, { target: { value: "trip," } });
  expect(writes).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "trip, " } });
  expect(writes).toHaveBeenLastCalledWith(["trip"]);
  expect(input).toHaveFocus();
  expect(input).toHaveValue("");
  expect(screen.getByLabelText("Confirmed tags")).toHaveTextContent("#trip");
  fireEvent.change(input, { target: { value: "planning, " } });
  expect(writes).toHaveBeenLastCalledWith(["trip", "planning"]);
  fireEvent.change(input, { target: { value: "ideas" } });
  expect(checkClose()).toBe("draft");
  fireEvent.keyDown(input, { key: "Tab" });
  expect(writes).toHaveBeenLastCalledWith(["trip", "planning", "ideas"]);
  expect(screen.getByLabelText("Writing space")).toHaveFocus();
  expect(checkClose()).toBe("allowed");
});
it("does not split a quoted legacy comma tag, or confirm existing separators while editing a name", () => {
  const { input, writes } = setup(["trip", "planning"]);
  fireEvent.change(input, { target: { value: "trips, planning" } });
  expect(writes).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  const next = screen.getByLabelText("Tags, separated by commas");
  fireEvent.change(next, { target: { value: '"work, play", ' } });
  expect(writes).toHaveBeenLastCalledWith(["work, play"]);
});
it("does not confirm during composition and does not create duplicates or empty tags", () => {
  const { input, writes } = setup();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "trip, " } });
  expect(writes).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Tab", isComposing: true });
  expect(screen.getByLabelText("Writing space")).not.toHaveFocus();
  fireEvent.compositionEnd(input);
  fireEvent.change(input, { target: { value: "trip, trip, , " } });
  expect(writes).toHaveBeenLastCalledWith(["trip"]);
  fireEvent.keyDown(input, { key: "Tab" });
  expect(screen.getByLabelText("Writing space")).toHaveFocus();
});
it("Escape discards the unfinished token while retaining confirmed tags", () => {
  const { input, writes } = setup();
  fireEvent.change(input, { target: { value: "trip, " } });
  fireEvent.change(input, { target: { value: "unfinished" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(writes).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("group", { name: "Current note tags" }),
  ).toHaveTextContent("trip");
});
it("rejects an invalid confirmation without losing the visible draft", () => {
  const { input, writes } = setup();
  fireEvent.change(input, { target: { value: "x".repeat(101) + ", " } });
  expect(screen.getByRole("alert")).toHaveTextContent("100 characters");
  expect(input).toHaveValue("x".repeat(101) + ", ");
  expect(writes).not.toHaveBeenCalled();
  expect(checkClose()).toBe("draft");
});

it("keeps existing suffix tags when inserting at the beginning or middle then cancelling", () => {
  const { input, writes } = setup(["planning", "ideas"]);
  fireEvent.change(input, { target: { value: "trip, planning, ideas" } });
  expect(writes).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(
    screen.getByRole("group", { name: "Current note tags" }),
  ).toHaveTextContent("#planning#ideas");
  fireEvent.click(screen.getByRole("button", { name: "Manage note tags" }));
  fireEvent.change(screen.getByLabelText("Tags, separated by commas"), {
    target: { value: "planning, trip, ideas" },
  });
  expect(writes).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Tags, separated by commas"), {
    key: "Escape",
  });
  expect(
    screen.getByRole("group", { name: "Current note tags" }),
  ).toHaveTextContent("#planning#ideas");
});
