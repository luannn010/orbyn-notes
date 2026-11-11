import { describe, expect, it, vi } from "vitest";
import { encodeNoteReference } from "../../src/links/reference";
import {
  IncomingNoteLinkController,
  formatWebNoteLink,
  parseNoteLinkHash,
} from "../../src/links/entry";
import type { NoteTarget } from "../../src/links/contracts";

const target: NoteTarget = {
  kind: "note",
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "opaque /?#🪴",
};
const hash = () => "#note/v1/" + encodeNoteReference(target).split("/v1/")[1];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("web note-link ingress", () => {
  it("exposes a pending-only intent before a workspace is available", () => {
    const controller = new IncomingNoteLinkController();
    controller.receive(hash());
    expect(controller.state()).toBe(null);
    expect(controller.hasPending()).toBe(true);
    controller.revoke();
    expect(controller.hasPending()).toBe(false);
  });
  it("accepts a bounded native target as a new deliberate intent while retaining the shared navigator", async () => {
    const controller = new IncomingNoteLinkController();
    const owner = {};
    const navigate = vi.fn().mockResolvedValue({ status: "blocked" });
    controller.bind(owner);
    controller.register(owner, navigate);
    controller.receiveTarget(target);
    await tick();
    expect(controller.state()).toBe("blocked");
    controller.receiveTarget(target);
    await tick();
    expect(navigate).toHaveBeenCalledTimes(2);
    controller.receiveInvalid();
    expect(controller.state()).toBe("invalid");
  });
  it("never installs an untransportable or malformed native target", async () => {
    const controller = new IncomingNoteLinkController();
    const owner = {};
    const navigate = vi.fn();
    controller.bind(owner);
    controller.register(owner, navigate);
    controller.receiveTarget({ ...target, noteId: "x".repeat(5000) });
    await tick();
    expect(navigate).not.toHaveBeenCalled();
    expect(controller.state()).toBe("invalid");
  });
  it("re-arms only an invocation canceled before it began, including mount cleanup", async () => {
    const controller = new IncomingNoteLinkController();
    const owner = {};
    const navigate = vi.fn().mockResolvedValue({ status: "opened" });
    controller.bind(owner);
    controller.receive(hash());
    controller.register(owner, navigate);
    controller.register(owner, null);
    controller.register(owner, navigate);
    await tick();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(controller.state()).toBe(null);
  });
  it("aborts a started invocation on revocation and does not replay it on re-registration", async () => {
    const controller = new IncomingNoteLinkController();
    const owner = {};
    let signal: AbortSignal | undefined;
    const navigate = vi.fn((_target, incoming: AbortSignal | undefined) => {
      signal = incoming;
      return new Promise<{ status: "opened" }>(() => {});
    });
    controller.bind(owner);
    controller.receive(hash());
    controller.register(owner, navigate);
    await tick();
    controller.register(owner, null);
    expect(signal?.aborted).toBe(true);
    expect(controller.state()).toBe("unavailable");
    controller.register(owner, navigate);
    await tick();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it("round trips the exact target without copying authentication or invite parameters", () => {
    const copy = formatWebNoteLink(
      target,
      "https://user:secret@example.test/notes/?invite=private&token=secret#old",
    );
    expect(copy.kind).toBe("web-link");
    expect(copy.text).toBe("https://example.test/notes/" + hash());
    expect(parseNoteLinkHash(new URL(copy.text).hash)).toEqual({
      kind: "target",
      target,
    });
    expect(() => formatWebNoteLink(target, "file:///notes.html")).toThrow();
    expect(() => formatWebNoteLink(target, "javascript:alert(1)")).toThrow();
  });
  it("does not normalize malformed, encoded, oversized or unknown-version hashes", () => {
    expect(parseNoteLinkHash("#tags")).toEqual({ kind: "unrelated" });
    for (const value of [
      "#note",
      "#note/v2/a",
      hash() + "?x=1",
      hash() + "/..",
      hash().replace("v1", "%761"),
      "#note/v1/" + "a".repeat(9000),
    ]) {
      expect(parseNoteLinkHash(value)).toEqual({ kind: "invalid" });
    }
  });
  it("holds one initial intent until an actual workspace navigator is registered", async () => {
    const controller = new IncomingNoteLinkController();
    const navigate = vi.fn().mockResolvedValue({ status: "opened" });
    controller.receive(hash());
    expect(controller.state()).toBe(null);
    controller.bind(null);
    const owner = {};
    controller.bind(owner);
    controller.register(owner, navigate);
    await tick();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      target,
      expect.any(AbortSignal),
    );
    expect(controller.state()).toBe(null);
    controller.register(owner, navigate);
    await tick();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it("does not retry a blocked navigation as editors or navigators rerender", async () => {
    const controller = new IncomingNoteLinkController();
    const owner = {};
    const navigate = vi
      .fn()
      .mockResolvedValueOnce({ status: "blocked" })
      .mockResolvedValue({ status: "opened" });
    controller.bind(owner);
    controller.register(owner, navigate);
    controller.receive(hash());
    await tick();
    expect(controller.state()).toBe("blocked");
    controller.register(owner, navigate);
    await tick();
    expect(navigate).toHaveBeenCalledTimes(1);
    controller.retry();
    await tick();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(controller.state()).toBe(null);
  });
  it("revokes pending results and old intents across A to B to A and lock", async () => {
    const controller = new IncomingNoteLinkController();
    const a = {},
      b = {};
    let finish!: (value: { status: "blocked" }) => void;
    const navigate = vi.fn(
      () =>
        new Promise<{ status: "blocked" }>((resolve) => {
          finish = resolve;
        }),
    );
    controller.bind(a);
    controller.register(a, navigate);
    controller.receive(hash());
    await tick();
    controller.bind(b);
    controller.bind(a);
    controller.register(a, navigate);
    finish({ status: "blocked" });
    await tick();
    expect(controller.state()).toBe(null);
    expect(navigate).toHaveBeenCalledTimes(1);
    controller.receive(hash());
    await tick();
    controller.revoke();
    finish({ status: "blocked" });
    await tick();
    controller.register(a, navigate);
    controller.retry();
    expect(controller.state()).toBe(null);
    expect(navigate).toHaveBeenCalledTimes(2);
  });
  it("ignores stale registration cleanup and only the latest incoming request may publish", async () => {
    const controller = new IncomingNoteLinkController();
    const old = {},
      owner = {};
    let finish!: (value: { status: "unavailable" }) => void;
    controller.bind(old);
    controller.bind(owner);
    const navigate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ status: "opened" });
    controller.register(owner, navigate);
    controller.register(old, null);
    controller.receive(hash());
    await tick();
    controller.receive("#note/v2/invalid");
    finish({ status: "unavailable" });
    await tick();
    expect(controller.state()).toBe("invalid");
    controller.dismiss();
    expect(controller.state()).toBe(null);
    controller.receive(hash());
    await tick();
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
