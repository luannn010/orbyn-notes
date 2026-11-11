import {
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefCallback,
} from "react";
import "../styles/route-heading.css";

export type HeadingRoute = "notes" | "study" | "journal" | "clips" | "tags";
export type HeadingCue = Readonly<{
  route: HeadingRoute;
  serial: number;
  generation: number;
}>;
export type HeadingPresentation = Readonly<{
  controller: RouteHeadingController;
  cue: HeadingCue | null;
  active: boolean;
}>;
export interface RouteHeadingController {
  request(route: HeadingRoute): HeadingCue;
  retire(): void;
  invalidate(route?: HeadingRoute): void;
  admit(route: HeadingRoute): void;
}
type RouteState = {
  generation: number;
  registration: number;
  admitted: boolean;
  nodes: Map<object, HTMLHeadingElement>;
};
type Availability = "pending" | "target" | "absent";
const routes: HeadingRoute[] = ["notes", "study", "journal", "clips", "tags"];
const owners = new WeakMap<RouteHeadingController, HeadingOwner>();
const noopSubscribe = () => () => {};
const zero = () => 0;

class HeadingOwner {
  version = 0;
  serial = 0;
  cue: HeadingCue | null = null;
  consumed = false;
  states = new Map<HeadingRoute, RouteState>(
    routes.map((route) => [
      route,
      { generation: 0, registration: 0, admitted: false, nodes: new Map() },
    ]),
  );
  listeners = new Set<() => void>();
  snapshot = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
  cancel(state: RouteState) {
    for (const node of state.nodes.values())
      node.removeAttribute("data-route-heading-motion");
  }
  controller: RouteHeadingController;
  constructor() {
    this.controller = {
      request: (route) => {
        for (const state of this.states.values()) this.cancel(state);
        const state = this.states.get(route)!;
        this.cue = Object.freeze({
          route,
          serial: ++this.serial,
          generation: state.generation,
        });
        this.consumed = false;
        this.notify();
        return this.cue;
      },
      retire: () => {
        if (!this.cue) return;
        for (const state of this.states.values()) this.cancel(state);
        this.cue = null;
        this.consumed = true;
        this.notify();
      },
      invalidate: (route) => {
        for (const name of route ? [route] : routes) {
          const state = this.states.get(name)!;
          this.cancel(state);
          state.nodes.clear();
          state.admitted = false;
          state.generation++;
          state.registration++;
        }
        if (!route || this.cue?.route === route) {
          this.cue = null;
          this.consumed = true;
        }
        this.notify();
      },
      admit: (route) => {
        const state = this.states.get(route)!;
        if (state.admitted) return;
        state.admitted = true;
        state.registration++;
        this.notify();
      },
    };
    owners.set(this.controller, this);
  }
  present(
    presentation: HeadingPresentation | undefined,
    route: HeadingRoute,
    availability: Availability,
    covered: boolean,
  ) {
    const cue = presentation?.cue,
      state = this.states.get(route)!;
    if (
      !cue ||
      cue !== this.cue ||
      cue.route !== route ||
      cue.generation !== state.generation
    )
      return;
    if (!presentation.active) {
      this.controller.retire();
      return;
    }
    if (this.consumed) return;
    if (availability === "absent") {
      this.consumed = true;
      this.cancel(state);
      return;
    }
    if (availability === "pending" || !state.admitted) return;
    if (state.nodes.size !== 1) return;
    const node = state.nodes.values().next().value;
    if (!node?.isConnected) return;
    this.consumed = true;
    if (covered) return;
    node.removeAttribute("data-route-heading-motion");
    void node.offsetWidth;
    node.setAttribute("data-route-heading-motion", "enter");
  }
}

export function useRouteHeadings(): RouteHeadingController {
  const owner = useRef<HeadingOwner | null>(null);
  if (!owner.current) owner.current = new HeadingOwner();
  useLayoutEffect(() => () => owner.current?.controller.invalidate(), []);
  return owner.current.controller;
}

export function useRouteHeading(
  presentation: HeadingPresentation | undefined,
  route: HeadingRoute,
  availability: Availability,
  entryCovered = false,
): RefCallback<HTMLHeadingElement> {
  const owner = presentation && owners.get(presentation.controller);
  const token = useRef({});
  useSyncExternalStore(
    owner?.subscribe ?? noopSubscribe,
    owner?.snapshot ?? zero,
    zero,
  );
  const state = owner?.states.get(route);
  const registration = state?.registration;
  const ref = useMemo<RefCallback<HTMLHeadingElement>>(
    () => (node) => {
      if (!state || state.registration !== registration) return;
      if (!node) {
        state.nodes.delete(token.current);
        return;
      }
      const key = token.current;
      state.nodes.set(key, node);
      // Ref replay may unregister a still-current DOM node. Leave its CSS effect
      // running; genuine retirement/owner invalidation cancels synchronously.
      return () => {
        if (state.nodes.get(key) === node) state.nodes.delete(key);
      };
    },
    [state, registration],
  );
  useLayoutEffect(() => {
    owner?.present(presentation, route, availability, entryCovered);
  });
  return ref;
}
