import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { useWorkspaceHistory } from "../../src/ui/useWorkspaceHistory";

function fixture() {
  let allowed = true;
  const hook = renderHook(() => {
    const [page, setPage] = useState("Notes");
    const history = useWorkspaceHistory(page, page, true, setPage, action => { if (allowed) action(); });
    return { page, setPage, ...history };
  });
  return { ...hook, block: () => { allowed = false; }, allow: () => { allowed = true; } };
}
it("traverses real view changes and retires forward entries after a new destination", () => {
  const f = fixture();
  act(() => f.result.current.setPage("Study"));
  act(() => f.result.current.setPage("Settings"));
  act(() => f.result.current.back());
  expect(f.result.current.page).toBe("Study");
  expect(f.result.current.canForward).toBe(true);
  act(() => f.result.current.forward());
  expect(f.result.current.page).toBe("Settings");
  act(() => f.result.current.back());
  act(() => f.result.current.setPage("Clips"));
  expect(f.result.current.canForward).toBe(false);
  act(() => f.result.current.back());
  expect(f.result.current.page).toBe("Study");
});
it("does not consume history when unsaved changes block leaving", () => {
  const f = fixture();
  act(() => f.result.current.setPage("Settings"));
  f.block();
  act(() => f.result.current.back());
  expect(f.result.current.page).toBe("Settings");
  expect(f.result.current.canBack).toBe(true);
  expect(f.result.current.canForward).toBe(false);
  f.allow();
  act(() => f.result.current.back());
  expect(f.result.current.page).toBe("Notes");
});
it("starts with empty history when a new workspace mounts", () => {
  const previous = fixture();
  act(() => previous.result.current.setPage("Journal"));
  previous.unmount();
  const next = fixture();
  expect(next.result.current.canBack).toBe(false);
  expect(next.result.current.canForward).toBe(false);
});
