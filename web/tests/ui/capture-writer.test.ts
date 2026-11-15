import { describe, expect, it, vi } from "vitest";
import type { Note, NotesStore } from "../../src/domain/contracts";
import { CaptureWriter, emptyDocument } from "../../src/ui/captureWriter";
const content = (title = "") => ({
  title,
  document: emptyDocument(),
  tags: [],
});
function note(id: string, title: string, revision = 1): Note {
  return {
    id,
    ...content(title),
    revision,
    createdAt: "2026-11-15",
    updatedAt: "2026-11-15",
    trashedAt: null,
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("capture draft durability", () => {
  it("does not write or block departure for an untouched or tag-only draft", async () => {
    const create = vi.fn(),
      store = { create } as unknown as NotesStore;
    const writer = new CaptureWriter(
      store,
      ["trip"],
      () => {},
      () => {},
    );
    expect(writer.canLeave()).toBe(true);
    writer.change({ ...content(), tags: ["trip", "home"] });
    await flush();
    expect(create).not.toHaveBeenCalled();
    expect(writer.state.status).toBe("empty");
    expect(writer.canLeave()).toBe(true);
  });
  it("serializes typing during creation and retains the current draft until both commits", async () => {
    let finish!: (note: Note) => void;
    const create = vi.fn(
      (_input, _id) =>
        new Promise<Note>((resolve) => {
          finish = resolve;
        }),
    );
    const update = vi.fn(async (id, input, revision) => ({
      ...note(id, input.title, revision + 1),
      ...input,
    }));
    const saved = vi.fn(),
      writer = new CaptureWriter(
        { create, update } as unknown as NotesStore,
        [],
        () => {},
        saved,
      );
    writer.change(content("A"));
    writer.change(content("AB"));
    expect(writer.canLeave()).toBe(false);
    finish(note(writer.id, "A"));
    await flush();
    expect(update).toHaveBeenCalledWith(writer.id, content("AB"), 1);
    expect(writer.state.value.title).toBe("AB");
    expect(writer.state.status).toBe("saved");
    expect(saved).toHaveBeenCalledTimes(2);
  });
  it("retries creation with the same UUID after failure and never claims Saved prematurely", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockImplementation(async (input, id) => ({
        ...note(id, input.title),
        ...input,
      }));
    const writer = new CaptureWriter(
      { create } as unknown as NotesStore,
      [],
      () => {},
      () => {},
    );
    writer.change(content("Keep"));
    await flush();
    expect(writer.state.status).toBe("error");
    expect(writer.canLeave()).toBe(false);
    writer.retry();
    await flush();
    expect(create.mock.calls[0]?.[1]).toBe(create.mock.calls[1]?.[1]);
    expect(writer.state.status).toBe("saved");
  });
  it("blocks revision conflicts without replacing the draft and allows a current copied recovery", async () => {
    const create = vi.fn(async (input, id) => ({
      ...note(id, input.title),
      ...input,
    }));
    const update = vi.fn().mockRejectedValue(new Error("revision conflict"));
    const writer = new CaptureWriter(
      { create, update } as unknown as NotesStore,
      [],
      () => {},
      () => {},
    );
    writer.change(content("First"));
    await flush();
    writer.change(content("Mine"));
    await flush();
    expect(writer.canLeave()).toBe(false);
    expect(writer.state.value.title).toBe("Mine");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
    await writer.copy();
    expect(writer.canLeave()).toBe(true);
    writer.change(content("Newer"));
    expect(writer.canLeave()).toBe(false);
  });
});
