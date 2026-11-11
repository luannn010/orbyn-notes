import { useLayoutEffect, useRef, type RefCallback } from "react";

export type SidebarSelectionKey = string | symbol;
export type SidebarSelectionController = {
  readonly rootRef: RefCallback<HTMLElement>;
  rowRef: (key: SidebarSelectionKey) => RefCallback<HTMLButtonElement>;
  invalidate: () => void;
  admit: () => void;
};
type Input = {
  controller: SidebarSelectionController;
  activeKey: SidebarSelectionKey | null;
  layoutVersion: number | string;
  visible: boolean;
  privacyRevision: number;
};
type Box = { x: number; y: number; width: number; height: number };
type Position = Box & {
  key: SidebarSelectionKey;
  node: HTMLElement;
  layout: Input["layoutVersion"];
  privacy: number;
  registration: number;
  rootWidth: number;
  rootHeight: number;
};
const sameBox = (a: Box, b: Box) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const owners = new WeakMap<SidebarSelectionController, SelectionOwner>();

class SelectionOwner {
  generation = 0;
  registration = 0;
  latched = false;
  root: HTMLElement | null = null;
  layer: HTMLElement | null = null;
  rows = new Map<SidebarSelectionKey, Set<HTMLButtonElement>>();
  callbacks = new Map<SidebarSelectionKey, RefCallback<HTMLButtonElement>>();
  previous: Position | null = null;
  input: Input | null = null;
  observer: ResizeObserver | null = null;
  observedRow: HTMLElement | null = null;
  observedRoot: HTMLElement | null = null;
  rootRef: RefCallback<HTMLElement> = () => {};
  layerRef: RefCallback<HTMLElement> = () => {};
  controller: SidebarSelectionController;

  constructor() {
    const owner = this;
    this.controller = {
      get rootRef() {
        return owner.rootRef;
      },
      rowRef: (key) => owner.rowRef(key),
      invalidate: () => owner.invalidate(),
      admit: () => {
        if (owner.latched) {
          owner.latched = false;
          owner.rotate();
        }
      },
    };
    owners.set(this.controller, this);
    this.rotate();
  }
  rotate() {
    const generation = ++this.generation;
    this.callbacks.clear();
    this.rootRef = (node) => {
      if (generation !== this.generation || this.latched) return;
      this.root = node;
      this.registration++;
      if (!node) this.pause();
      else this.measure();
    };
    this.layerRef = (node) => {
      if (generation !== this.generation || this.latched) return;
      this.layer = node;
      if (node) node.hidden = true;
    };
  }
  rowRef(key: SidebarSelectionKey): RefCallback<HTMLButtonElement> {
    const existing = this.callbacks.get(key);
    if (existing) return existing;
    const generation = this.generation;
    const callback: RefCallback<HTMLButtonElement> = (node) => {
      if (generation !== this.generation || this.latched) return;
      if (!node) {
        this.rows.delete(key);
        this.registration++;
        return;
      }
      let nodes = this.rows.get(key);
      if (!nodes) this.rows.set(key, (nodes = new Set()));
      const registered = nodes;
      registered.add(node);
      this.registration++;
      return () => {
        if (generation !== this.generation) return;
        registered.delete(node);
        if (!registered.size) this.rows.delete(key);
        this.registration++;
        if (this.previous?.node === node) this.hide();
      };
    };
    this.callbacks.set(key, callback);
    return callback;
  }
  hide() {
    this.root?.removeAttribute("data-sidebar-selection-ready");
    if (this.layer) {
      this.layer.hidden = true;
      this.layer.dataset.animate = "false";
      this.layer.style.transition = "none";
      this.layer.style.transform = "none";
    }
    this.previous = null;
  }
  pause() {
    this.hide();
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoot = this.observedRow = null;
  }
  invalidate() {
    this.pause();
    this.latched = true;
    this.root = this.layer = null;
    for (const nodes of this.rows.values()) nodes.clear();
    this.rows.clear();
    this.input = null;
    this.rotate();
  }
  box(node: HTMLElement): Box | null {
    const root = this.root;
    if (
      !root ||
      !root.isConnected ||
      !node.isConnected ||
      !root.contains(node) ||
      node.offsetParent !== root
    )
      return null;
    const box = {
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      !Object.values(box).every(Number.isFinite)
    )
      return null;
    return box;
  }
  measure(layoutChange = false) {
    const input = this.input,
      root = this.root,
      layer = this.layer;
    if (
      this.latched ||
      !input?.visible ||
      !root ||
      !layer ||
      input.activeKey === null
    ) {
      this.hide();
      return;
    }
    const nodes = this.rows.get(input.activeKey);
    const node = nodes?.size === 1 ? nodes.values().next().value : null;
    const box = node ? this.box(node) : null;
    if (!node || !box) {
      this.hide();
      return;
    }
    const old = this.previous;
    const oldBox = old && this.box(old.node);
    const stable =
      old &&
      oldBox &&
      sameBox(old, oldBox) &&
      old.layout === input.layoutVersion &&
      old.privacy === input.privacyRevision &&
      old.registration === this.registration &&
      old.rootWidth === root.clientWidth &&
      old.rootHeight === root.clientHeight;
    const changed = old && old.key !== input.activeKey;
    const animate = !!(stable && changed && !layoutChange);
    // A resize/scroll/DOM reflow settles even an already running transition.
    if (layoutChange || !stable) {
      layer.style.transition = "none";
      layer.style.transform = `translate(${box.x}px, ${box.y}px)`;
      void layer.offsetWidth;
    }
    if (changed || layoutChange || !stable) {
      layer.dataset.animate = String(animate);
      layer.style.transition = "";
      layer.style.width = `${box.width}px`;
      layer.style.height = `${box.height}px`;
      layer.style.transform = `translate(${box.x}px, ${box.y}px)`;
    }
    layer.hidden = false;
    root.dataset.sidebarSelectionReady = "true";
    this.previous = {
      ...box,
      key: input.activeKey,
      node,
      layout: input.layoutVersion,
      privacy: input.privacyRevision,
      registration: this.registration,
      rootWidth: root.clientWidth,
      rootHeight: root.clientHeight,
    };
    this.observe(node);
  }
  observe(node: HTMLElement) {
    const root = this.root;
    if (!root || (this.observedRoot === root && this.observedRow === node))
      return;
    this.observer?.disconnect();
    this.observedRoot = root;
    this.observedRow = node;
    if (typeof ResizeObserver === "undefined") return;
    const generation = this.generation;
    this.observer = new ResizeObserver(() => {
      if (generation !== this.generation || this.latched) return;
      const previous = this.previous;
      const box = previous && this.box(previous.node);
      if (
        !previous ||
        !box ||
        !sameBox(previous, box) ||
        previous.rootWidth !== root.clientWidth ||
        previous.rootHeight !== root.clientHeight
      )
        this.measure(true);
    });
    this.observer.observe(root);
    this.observer.observe(node);
  }
}

export function useSidebarSelection(): SidebarSelectionController {
  const owner = useRef<SelectionOwner | null>(null);
  if (!owner.current) owner.current = new SelectionOwner();
  useLayoutEffect(() => () => owner.current?.invalidate(), []);
  return owner.current.controller;
}

export function SidebarSelection(props: Input) {
  const owner = owners.get(props.controller);
  useLayoutEffect(() => {
    if (!owner) return;
    owner.input = props;
    owner.measure();
  });
  useLayoutEffect(() => {
    if (!owner) return;
    const onScroll = (event: Event) => {
      const root = owner.root,
        target = event.target;
      if (
        root &&
        (target === document ||
          target === window ||
          (target instanceof HTMLElement &&
            (target === root || target.contains(root))))
      )
        owner.measure(true);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      owner.pause();
    };
  }, [owner]);
  return (
    <i
      ref={owner?.layerRef}
      className="sidebar-selection-highlight"
      aria-hidden="true"
      hidden
    />
  );
}
