import { StrictMode, useLayoutEffect, type ComponentProps } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NoteEditor } from "../../src/ui/NoteEditor";
import type { RichEditor, EditorSourceCapture } from "../../src/ui/RichEditor";
import type { SourceCardComposer } from "../../src/ui/SourceCardComposer";
import { captureSourceSelection } from "../../src/study/sourceCodec";

type Props = ComponentProps<typeof NoteEditor>;
const boundary = vi.hoisted(() => ({
  editable: false,
  composerPresent: false,
  capture: null as null | ((capture: EditorSourceCapture) => void),
  close: null as null | ((restore: boolean) => void),
}));
// Deliberate lifecycle adapters: genuine browser tests separately prove Tiptap
// selection/focus. These adapters exercise same-commit scope changes precisely.
vi.mock("../../src/ui/RichEditor", () => ({
  RichEditor: (props: ComponentProps<typeof RichEditor>) => {
    boundary.capture = props.sourceControl?.onCapture ?? null;
    useLayoutEffect(() => {
      boundary.editable = !props.readOnly;
    });
    return <div />;
  },
}));
vi.mock("../../src/ui/SourceCardComposer", () => ({
  SourceCardComposer: (props: ComponentProps<typeof SourceCardComposer>) => {
    boundary.close = props.onClose;
    useLayoutEffect(() => {
      boundary.composerPresent = true;
      return () => {
        boundary.composerPresent = false;
      };
    }, []);
    return <div />;
  },
  SourceCardNotice: () => null,
}));
const document: Props["note"]["document"] = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "NADH after" }] },
  ],
};
function setup() {
  const invalidations = new Set<() => void>();
  const source: NonNullable<Props["source"]> = {
    library: {
      read: vi.fn(),
      updateWithSourceSteps: vi.fn(),
      replaceDocument: vi.fn(),
      setPinned: vi.fn(),
      setSort: vi.fn(),
      createTag: vi.fn(),
      renameTag: vi.fn(),
      recolorTag: vi.fn(),
      mergeTag: vi.fn(),
      deleteTag: vi.fn(),
      history: vi.fn(),
      version: vi.fn(),
      restoreVersion: vi.fn(),
      changeTrash: vi.fn(),
      undoTrash: vi.fn(),
      emptyTrash: vi.fn(),
      eraseLegacy: vi.fn(),
    },
    collections: {
      read: vi.fn(),
      update: vi.fn(),
      subscribe: () => () => {},
      persistence: () => ({ status: "ready" }),
      close: vi.fn(),
    },
    service: {
      prepareCreate: vi.fn(),
      prepareUndo: vi.fn(),
      commit: vi.fn(),
      resolve: vi.fn(),
      annotations: vi.fn(async () => []),
      subscribe: () => () => {},
      persistence: () => ({ status: "ready" }),
      close: vi.fn(),
      onInvalidate: (listener) => {
        const notify = () => listener("epoch");
        invalidations.add(notify);
        return () => {
          invalidations.delete(notify);
        };
      },
    },
    onOpenCard: vi.fn(),
  };
  const props: Props = {
    note: {
      id: "focus-note",
      title: "Focus",
      document,
      tags: [],
      revision: 1,
      createdAt: "2026-11-11T00:00:00.000Z",
      updatedAt: "2026-11-11T00:00:00.000Z",
      trashedAt: null,
    },
    store: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      trash: vi.fn(),
      restore: vi.fn(),
      erase: vi.fn(),
      subscribe: () => () => {},
      persistence: () => ({ status: "ready" }),
      close: vi.fn(),
    },
    source,
    onSaved: vi.fn(),
    onBack: vi.fn(),
    onTrash: vi.fn(),
    onExport: vi.fn(),
  };
  const observations: { editable: boolean; composerPresent: boolean }[] = [];
  const capture: EditorSourceCapture = {
    document,
    selection: captureSourceSelection(document, 1, 5),
    anchor: () => ({ left: 10, top: 10, bottom: 20 }),
    isCurrent: vi.fn(() => true),
    restore: vi.fn(() => {
      observations.push({
        editable: boundary.editable,
        composerPresent: boundary.composerPresent,
      });
    }),
  };
  const view = render(
    <StrictMode>
      <NoteEditor {...props} />
    </StrictMode>,
  );
  act(() => boundary.capture!(capture));
  return {
    props,
    capture,
    view,
    observations,
    invalidate: () => invalidations.forEach((notify) => notify()),
  };
}
beforeEach(() => {
  boundary.editable = false;
  boundary.composerPresent = false;
  boundary.capture = null;
  boundary.close = null;
});
it("SRC-FOCUS-1 restores once after editable child commit and composer removal in StrictMode", () => {
  const t = setup();
  expect(boundary.editable).toBe(false);
  act(() => boundary.close!(true));
  expect(t.capture.restore).toHaveBeenCalledTimes(1);
  expect(t.observations).toEqual([{ editable: true, composerPresent: false }]);
  t.view.rerender(
    <StrictMode>
      <NoteEditor {...t.props} />
    </StrictMode>,
  );
  expect(t.capture.restore).toHaveBeenCalledTimes(1);
});
it("outside no-restore intent does not steal focus", () => {
  const t = setup();
  act(() => boundary.close!(false));
  expect(t.capture.restore).not.toHaveBeenCalled();
});
it.each(["active", "readOnly", "note", "service"] as const)(
  "rejects pending restore after same-commit %s scope change",
  (mode) => {
    const t = setup();
    const props = { ...t.props };
    if (mode === "active") props.active = false;
    if (mode === "readOnly") props.readOnly = true;
    if (mode === "note") props.note = { ...props.note, id: "different-note" };
    if (mode === "service")
      props.source = {
        ...props.source!,
        service: { ...props.source!.service },
      };
    act(() => {
      boundary.close!(true);
      t.view.rerender(
        <StrictMode>
          <NoteEditor {...props} />
        </StrictMode>,
      );
    });
    expect(t.capture.restore).not.toHaveBeenCalled();
  },
);
it("rejects a stale document/selection capture without weakening its freshness check", () => {
  const t = setup();
  vi.mocked(t.capture.isCurrent).mockReturnValue(false);
  act(() => boundary.close!(true));
  expect(t.capture.restore).not.toHaveBeenCalled();
});
it("a newer capture supersedes the queued restoration", () => {
  const t = setup();
  const next = { ...t.capture, restore: vi.fn() };
  act(() => {
    boundary.close!(true);
    boundary.capture!(next);
  });
  expect(t.capture.restore).not.toHaveBeenCalled();
  expect(next.restore).not.toHaveBeenCalled();
  expect(boundary.composerPresent).toBe(true);
});
it("observed invalidation clears queued restore synchronously", () => {
  const t = setup();
  act(() => {
    boundary.close!(true);
    t.invalidate();
  });
  expect(t.capture.restore).not.toHaveBeenCalled();
  expect(boundary.composerPresent).toBe(false);
});
it("unmount leaves no deferred restore callback", () => {
  const t = setup();
  act(() => {
    boundary.close!(true);
    t.view.unmount();
  });
  expect(t.capture.restore).not.toHaveBeenCalled();
});
