import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  useRouteHeading,
  useRouteHeadings,
  type HeadingCue,
  type HeadingRoute,
  type RouteHeadingController,
} from "../../src/ui/routeHeadingMotion";

let controller: RouteHeadingController;
type Availability = "pending" | "target" | "absent";
function Harness({
  cue = null,
  active = true,
  availability = "target",
  covered = false,
  route = "notes",
  title = "All notes",
  version = 0,
}: {
  cue?: HeadingCue | null;
  active?: boolean;
  availability?: Availability;
  covered?: boolean;
  route?: HeadingRoute;
  title?: string;
  version?: number;
}) {
  controller = useRouteHeadings();
  const ref = useRouteHeading(
    { controller, cue, active },
    route,
    availability,
    covered,
  );
  return availability === "target" ? (
    <h1 ref={ref} data-version={version}>
      {title}
    </h1>
  ) : (
    <div>{availability}</div>
  );
}
function request(route: HeadingRoute = "notes") {
  let cue!: HeadingCue;
  act(() => {
    cue = controller.request(route);
  });
  return cue;
}
function heading() {
  return screen.getByRole("heading", { level: 1 });
}
function animated() {
  expect(heading()).toHaveAttribute("data-route-heading-motion", "enter");
}
function staticHeading() {
  expect(heading()).not.toHaveAttribute("data-route-heading-motion");
}
function end(element: HTMLElement) {
  fireEvent.animationEnd(element, { animationName: "route-heading-in" });
}

describe("route heading presentation", () => {
  it("starts static and animates the admitted current h1 once without replacing its text or node", () => {
    const { rerender } = render(<Harness />);
    const node = heading();
    staticHeading();
    act(() => controller.admit("notes"));
    const cue = request();
    rerender(<Harness cue={cue} title="Pinned" />);
    expect(heading()).toBe(node);
    expect(heading()).toHaveTextContent("Pinned");
    animated();
    const marker = node.getAttributeNode("data-route-heading-motion");
    act(() => end(node));
    expect(node.getAttributeNode("data-route-heading-motion")).toBe(marker);
    rerender(<Harness cue={cue} title="Pinned updated" version={1} />);
    expect(heading()).toBe(node);
    expect(heading()).toHaveTextContent("Pinned updated");
    expect(node.getAttributeNode("data-route-heading-motion")).toBe(marker);
  });
  it("holds a cold pending cue for its current target and consumes an intentionally absent target", () => {
    const { rerender } = render(<Harness availability="pending" />);
    const pending = request("study");
    rerender(<Harness cue={pending} route="study" availability="pending" />);
    act(() => controller.admit("study"));
    rerender(<Harness cue={pending} route="study" title="Study" />);
    animated();
    act(() => end(heading()));
    const absent = request("study");
    rerender(<Harness cue={absent} route="study" availability="absent" />);
    rerender(<Harness cue={absent} route="study" title="Study" />);
    staticHeading();
  });
  it("retires hidden cues, prevents uncover replay, and permits a new request", () => {
    const { rerender } = render(<Harness />);
    act(() => controller.admit("notes"));
    const cue = request();
    rerender(<Harness cue={cue} />);
    animated();
    rerender(<Harness cue={cue} active={false} />);
    staticHeading();
    rerender(<Harness cue={cue} active />);
    staticHeading();
    const next = request();
    rerender(<Harness cue={next} />);
    animated();
    act(() => controller.retire());
    staticHeading();
  });
  it.each([undefined, "notes"] as const)(
    "latches %s invalidation until a fresh admitted request",
    (route) => {
      const { rerender } = render(<Harness />);
      act(() => controller.admit("notes"));
      const old = request();
      rerender(<Harness cue={old} />);
      const node = heading();
      animated();
      act(() => controller.invalidate(route));
      staticHeading();
      rerender(<Harness cue={old} version={1} />);
      act(() => end(node));
      staticHeading();
      act(() => controller.admit("notes"));
      rerender(<Harness cue={old} version={2} />);
      staticHeading();
      const fresh = request();
      rerender(<Harness cue={fresh} version={3} />);
      animated();
    },
  );
  it("consumes a cue covered by the actual ancestor entry rather than replaying it", () => {
    const { rerender } = render(<Harness route="study" title="Study" />);
    act(() => controller.admit("study"));
    const cue = request("study");
    rerender(<Harness cue={cue} route="study" title="Study" covered />);
    staticHeading();
    rerender(<Harness cue={cue} route="study" title="Study" covered={false} />);
    staticHeading();
  });
  it("holds a fresh post-invalidation request until the matching current read admits it", () => {
    const { rerender } = render(<Harness />);
    act(() => controller.admit("notes"));
    const old = request();
    rerender(<Harness cue={old} />);
    animated();
    act(() => controller.invalidate("notes"));
    staticHeading();
    const fresh = request();
    rerender(<Harness cue={fresh} availability="pending" />);
    act(() => controller.admit("study"));
    rerender(<Harness cue={fresh} title="Fresh notes" />);
    staticHeading();
    act(() => controller.admit("notes"));
    animated();
    expect(heading()).toHaveTextContent("Fresh notes");
  });
  it("ignores a bubbled animation end and a stale old-node end after new registration", () => {
    const { rerender } = render(<Harness />);
    act(() => controller.admit("notes"));
    const first = request();
    rerender(<Harness cue={first} />);
    const old = heading();
    const child = document.createElement("span");
    old.append(child);
    act(() => end(child));
    animated();
    rerender(<Harness cue={first} availability="pending" />);
    const next = request();
    rerender(<Harness cue={next} title="Fresh" />);
    const current = heading();
    expect(current).not.toBe(old);
    animated();
    act(() => end(old));
    animated();
    const marker = current.getAttributeNode("data-route-heading-motion");
    act(() => end(current));
    expect(current.getAttributeNode("data-route-heading-motion")).toBe(marker);
  });
  it("works through Strict Mode effect replay and does not revive invalidated cues", () => {
    const tree = (cue: HeadingCue | null, version: number) => (
      <StrictMode>
        <Harness cue={cue} version={version} />
      </StrictMode>
    );
    const { rerender } = render(tree(null, 0));
    act(() => controller.admit("notes"));
    rerender(tree(null, 1));
    const cue = request();
    rerender(tree(cue, 2));
    animated();
    act(() => controller.invalidate());
    staticHeading();
    rerender(tree(cue, 3));
    staticHeading();
    act(() => controller.admit("notes"));
    rerender(tree(cue, 4));
    staticHeading();
    const fresh = request();
    rerender(tree(fresh, 5));
    animated();
  });
});
