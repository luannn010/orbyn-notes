// @vitest-environment node
import { expect, it } from "vitest";
import type { Note } from "../../src/domain/contracts";
import { emptyLibrary } from "../../src/library/model";
import {
  validateLegacyLibrary,
  validateLibrary,
  normalizeLibrary,
  jsonBytes,
  LEGACY_LIBRARY_BYTES,
  SOURCE_LIBRARY_BYTES,
  SOURCE_LIBRARY_OVERHEAD,
  LINK_LIBRARY_OVERHEAD,
  LIBRARY_LIMITS,
} from "../../src/library/validation";
import { scanLinkDocument, validateLinkRows } from "../../src/links/scanner";
const note: Note = {
  id: "id",
  title: "",
  document: { type: "doc", content: [] },
  tags: [],
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  trashedAt: null,
  revision: 1,
};
const target = {
  kind: "note" as const,
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "opaque",
};
it("keeps exact cumulative raw1/raw2/raw3 overhead and rejects nonempty/digit-growth overflow", () => {
  const state = emptyLibrary();
  state.noteMetadata = [{ noteId: "", revision: 1, pinned: false, tagIds: [] }];
  const { anchors, sourceReceipts, ...common } = state;
  const raw1 = { ...common, version: 1 };
  const length = LEGACY_LIBRARY_BYTES - jsonBytes(raw1),
    id = "x".repeat(length),
    notes = [{ ...note, id }];
  raw1.noteMetadata[0]!.noteId = id;
  expect(jsonBytes(raw1)).toBe(LEGACY_LIBRARY_BYTES);
  expect(validateLegacyLibrary(raw1, notes).version).toBe(1);
  const raw2 = normalizeLibrary(raw1, notes);
  expect(raw2.version).toBe(2);
  expect(jsonBytes(raw2)).toBe(SOURCE_LIBRARY_BYTES);
  expect(SOURCE_LIBRARY_BYTES - LEGACY_LIBRARY_BYTES).toBe(
    SOURCE_LIBRARY_OVERHEAD,
  );
  const raw3 = { ...raw2, version: 3 as const, noteLinks: [] };
  expect(jsonBytes(raw3)).toBe(LIBRARY_LIMITS.bytes);
  expect(LIBRARY_LIMITS.bytes - SOURCE_LIBRARY_BYTES).toBe(
    LINK_LIBRARY_OVERHEAD,
  );
  expect(validateLibrary(raw3, notes).version).toBe(3);
  expect(() => validateLegacyLibrary(raw3, notes)).toThrow();
  expect(() => validateLibrary({ ...raw2, revision: 10 }, notes)).toThrow(
    expect.objectContaining({ code: "library_capacity" }),
  );
  expect(() =>
    validateLibrary(
      {
        ...raw3,
        noteLinks: [
          {
            noteId: id,
            noteRevision: 1,
            targets: [{ target, occurrences: 1 }],
          },
        ],
      },
      notes,
    ),
  ).toThrow(expect.objectContaining({ code: "library_capacity" }));
}, 15000);
it("enforces occurrence and total-graph limits with no silently dropped references", () => {
  const document = {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: Array.from({ length: 1001 }, () => ({
          type: "noteLink",
          attrs: { version: 1, target },
        })),
      },
    ],
  };
  expect(() =>
    scanLinkDocument(document, { utf8Units: 0, nodeVisits: 0 }),
  ).toThrow(expect.objectContaining({ code: "note_link_limit" }));
  const notes = Array.from({ length: 101 }, (_, i) => ({
    id: String(i),
    revision: 1,
  }));
  expect(() =>
    validateLinkRows(
      notes.map((note) => ({
        noteId: note.id,
        noteRevision: 1,
        targets: [{ target, occurrences: 1000 }],
      })),
      notes,
    ),
  ).toThrow(expect.objectContaining({ code: "note_link_limit" }));
  expect(() =>
    validateLinkRows(
      [
        {
          noteId: "0",
          noteRevision: 1,
          targets: [
            { target, occurrences: 1 },
            { target, occurrences: 1 },
          ],
        },
      ],
      notes,
    ),
  ).toThrow(expect.objectContaining({ code: "note_link_index_invalid" }));
});
