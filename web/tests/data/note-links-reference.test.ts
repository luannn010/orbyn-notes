// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  decodeNoteReference,
  encodeNoteReference,
  isWellFormedReferenceId,
  validateNoteTarget,
} from "../../src/links/reference";
import { NoteLinkError } from "../../src/links/contracts";
const scope = {
  kind: "note" as const,
  accountId: "12345678-1234-4234-8234-123456789abc",
  libraryEpoch: "abcdef12-3456-4789-abcd-123456789abc",
};
const pack = (text: string) =>
  "orbyn-notes://note/v1/" + Buffer.from(text).toString("base64url");
it("round trips opaque IDs without trim, case or Unicode normalization", () => {
  for (const noteId of [
    "",
    "Note /?## %",
    "e\u0301",
    "é",
    "📝",
    "\ufeff",
    "x".repeat(4096),
  ]) {
    const target = { ...scope, noteId };
    expect(decodeNoteReference(encodeNoteReference(target))).toEqual(target);
  }
  expect(encodeNoteReference({ ...scope, noteId: "é" })).not.toBe(
    encodeNoteReference({ ...scope, noteId: "e\u0301" }),
  );
});
it("storage target validation preserves IDs that cannot honestly be copied", () => {
  for (const noteId of ["\ud800", "\udc00", "x\ud800y"]) {
    expect(validateNoteTarget({ ...scope, noteId }).noteId).toBe(noteId);
    expect(isWellFormedReferenceId(noteId)).toBe(false);
    expect(() => encodeNoteReference({ ...scope, noteId })).toThrow(
      expect.objectContaining({ code: "note_link_reference_unencodable" }),
    );
  }
  const huge = { ...scope, noteId: "x".repeat(4097) };
  expect(validateNoteTarget(huge)).toEqual(huge);
  expect(() => encodeNoteReference(huge)).toThrow(
    expect.objectContaining({ code: "note_link_reference_too_large" }),
  );
  expect(() =>
    encodeNoteReference({ ...scope, noteId: "界".repeat(1366) }),
  ).toThrow(NoteLinkError);
});
it("rejects alternative JSON/base64/URI spelling, duplicates and malformed UTF8", () => {
  const canonical = JSON.stringify({
    v: 1,
    kind: "note",
    accountId: scope.accountId,
    libraryEpoch: scope.libraryEpoch,
    noteId64: "YQ",
  });
  const bad = [
    pack(canonical.replace('"v":1', '"v":1,"v":1')),
    pack(canonical.replace('"v":1', '"v":2')),
    pack(canonical.replace("{", "{ ")),
    pack(canonical.replace('"YQ"', '"YR"')),
    pack(canonical.replace('"YQ"', '"YQ=="')),
    pack(canonical.replace('"YQ"', '"_w"')),
    pack(canonical.replace('"note"', '"no\\u0074e"')),
    pack("\ufeff" + canonical),
    pack(canonical) + "=",
    pack(canonical) + "#fragment",
    pack(canonical).replace("orbyn-notes", "ORBYN-NOTES"),
    pack(canonical).replace("note/v1", "note/v2"),
    "orbyn-notes://note/v1/_w",
    "orbyn-notes://note/v1/A",
  ];
  for (const value of bad)
    expect(() => decodeNoteReference(value), value).toThrow(NoteLinkError);
});
it("rejects size violations before decoding and exact target-shape violations", () => {
  for (const value of [
    null,
    {},
    4,
    "x".repeat(8193),
    "orbyn-notes://note/v1/" + "A".repeat(8001),
  ])
    expect(() => decodeNoteReference(value)).toThrow(NoteLinkError);
  for (const value of [
    { ...scope, noteId: "x", title: "leak" },
    { ...scope, noteId: "x", accountId: "wrong" },
    { ...scope, noteId: 1 },
  ])
    expect(() => validateNoteTarget(value)).toThrow(NoteLinkError);
  const inherited = Object.assign(Object.create({ noteId: "inherited" }), {
    ...scope,
    title: "cached",
  });
  expect(() => validateNoteTarget(inherited)).toThrow(NoteLinkError);
  expect(
    validateNoteTarget(
      Object.assign(Object.create(null), { ...scope, noteId: "own" }),
    ),
  ).toEqual({ ...scope, noteId: "own" });
});
it("matches shared native/web golden vectors including numeric surrogate cases", async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL("../vectors/note-reference.json", import.meta.url),
      "utf8",
    ),
  );
  for (const row of vectors.valid) {
    expect(encodeNoteReference(row.target)).toBe(row.uri);
    expect(decodeNoteReference(row.uri)).toEqual(row.target);
  }
  for (const row of vectors.invalid)
    expect(() => decodeNoteReference(row.uri)).toThrow(NoteLinkError);
  for (const row of vectors.unencodable)
    expect(() =>
      encodeNoteReference({
        ...scope,
        noteId: String.fromCharCode(...row.utf16),
      }),
    ).toThrow(
      expect.objectContaining({ code: "note_link_reference_unencodable" }),
    );
});
