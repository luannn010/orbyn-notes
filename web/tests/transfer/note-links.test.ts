import { expect, it, vi } from "vitest";
import type { Note } from "../../src/domain/contracts";
import type { NoteLinkResolution, NoteTarget } from "../../src/links/contracts";
import { encodeNoteReference } from "../../src/links/reference";
import { exportMarkdown, parseMarkdown } from "../../src/transfer";
import {
  NOTE_EXPORT_LIMITS,
  renderNoteExport,
} from "../../src/transfer/noteLinks";

vi.mock("../../src/links/reference", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/links/reference")>();
  return { ...actual, encodeNoteReference: vi.fn(actual.encodeNoteReference) };
});

const target: NoteTarget = {
  kind: "note",
  accountId: "11111111-1111-4111-8111-111111111111",
  libraryEpoch: "22222222-2222-4222-8222-222222222222",
  noteId: "opaque target",
};
const token = { epoch: target.libraryEpoch, revision: 4 };
function note(to: NoteTarget = target): Note {
  return {
    id: "source",
    title: "Readable note",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "noteLink", attrs: { version: 1, target: to } },
          ],
        },
      ],
    },
    tags: ["exact,tag"],
    revision: 2,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    trashedAt: null,
  };
}
const available = (to = target): NoteLinkResolution => ({
  status: "available",
  token,
  target: to,
  noteRevision: 3,
  title: "Current [title] <safe>",
});
const projection = (
  to = target,
  resolution: NoteLinkResolution = available(to),
) => ({
  accountId: target.accountId,
  token,
  references: [{ target: to, resolution }],
});

it("exports current authorized labels and exact tokens plus actual structured Notes, without unrelated fields", () => {
  const value = { ...note(), unrelatedSecret: "must not export" };
  const result = renderNoteExport([value], projection());
  const markdown = result.files.find((file) =>
    file.filename.endsWith(".md"),
  )!.content;
  expect(markdown).toContain("Current \\[title\\] \\<safe\\>");
  expect(markdown).toContain(encodeNoteReference(target));
  expect(markdown).not.toContain("<safe>");
  const exact = JSON.parse(
    result.files.find((file) => file.filename === "notes.json")!.content,
  );
  expect(exact).toEqual({
    format: "orbyn-notes-notes",
    version: 1,
    notes: [note()],
  });
  expect(result.files.map((file) => file.content).join("\n")).not.toContain(
    "must not export",
  );
  expect(
    result.files.find((file) => file.filename === "README.txt")!.content,
  ).toContain("not a complete workspace backup");
});

it("keeps generic/Journal export strict and Markdown imports truthful plain token text", () => {
  expect(() => exportMarkdown([note()])).toThrow();
  const exported = renderNoteExport([note()], projection()).files.find((file) =>
    file.filename.endsWith(".md"),
  )!;
  const imported = parseMarkdown([
    { name: exported.filename, content: exported.content },
  ])[0]!;
  expect(JSON.stringify(imported.document)).toContain(
    encodeNoteReference(target),
  );
  expect(JSON.stringify(imported.document)).not.toContain('"type":"noteLink"');
});

it("never projects a foreign/unavailable title and refuses a mixed-scope or stale authorized projection", () => {
  const foreign = {
    ...target,
    accountId: "33333333-3333-4333-8333-333333333333",
  };
  const unavailable = {
    status: "unavailable",
    reason: "scope",
    title: "SECRET FOREIGN TITLE",
  } as unknown as NoteLinkResolution;
  const result = renderNoteExport(
    [note(foreign)],
    projection(foreign, unavailable),
  );
  expect(result.files.map((file) => file.content).join("\n")).not.toContain(
    "SECRET FOREIGN TITLE",
  );
  expect(result.files[0]!.content).toContain("Note reference");
  expect(() =>
    renderNoteExport([note(foreign)], projection(foreign, available(foreign))),
  ).toThrow();
  expect(() =>
    renderNoteExport(
      [note()],
      projection(target, {
        ...available(),
        token: { ...token, revision: 5 },
      } as NoteLinkResolution),
    ),
  ).toThrow();
});

it.each(["\ud800", "x".repeat(5000)])(
  "preserves an unencodable/oversize identity exactly without a fake portable token",
  (noteId) => {
    const to = { ...target, noteId };
    const result = renderNoteExport([note(to)], projection(to));
    expect(result.files[0]!.content).toContain(JSON.stringify(to));
    expect(
      JSON.parse(
        result.files.find((file) => file.filename === "notes.json")!.content,
      ).notes[0].document,
    ).toEqual(note(to).document);
    expect(
      result.warnings.some((warning) => warning.includes("not shortened")),
    ).toBe(true);
  },
);

it("charges work already spent by the owner instead of granting a new renderer allowance", () => {
  expect(() =>
    renderNoteExport([note()], {
      ...projection(),
      consumedWork: { utf8Units: NOTE_EXPORT_LIMITS.utf8Units, nodeVisits: 0 },
    }),
  ).toThrow();
  expect(() =>
    renderNoteExport([note()], {
      ...projection(),
      consumedWork: { utf8Units: 0, nodeVisits: NOTE_EXPORT_LIMITS.nodeVisits },
    }),
  ).toThrow();
  expect(() =>
    renderNoteExport([], {
      ...projection(),
      consumedWork: { utf8Units: -1, nodeVisits: 0 },
    }),
  ).toThrow();
});

it("handles many literal backtick runs without argument spreading or repeated code rescans", () => {
  const value = note();
  value.document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "`x".repeat(250000),
            marks: [{ type: "code" }],
          },
        ],
      },
    ],
  };
  const result = exportMarkdown([value]);
  expect(result[0]!.content).toContain("`` `x`x");
});

it("admits escape expansion before encoding a reference in a low-budget file", () => {
  const value = note();
  value.document.content[0]!.content!.unshift({
    type: "text",
    text: " ".repeat(20000),
  });
  vi.mocked(encodeNoteReference).mockClear();
  expect(() =>
    renderNoteExport([value], {
      ...projection(),
      consumedWork: {
        utf8Units: NOTE_EXPORT_LIMITS.utf8Units - 200000,
        nodeVisits: 0,
      },
    }),
  ).toThrow(expect.objectContaining({ code: "note_link_limit" }));
  expect(encodeNoteReference).not.toHaveBeenCalled();
});

it("stops a batch before formatting later file references after exhaustion", () => {
  const value = note();
  value.document.content[0]!.content!.unshift({
    type: "text",
    text: " ".repeat(20000),
  });
  vi.mocked(encodeNoteReference).mockClear();
  expect(() =>
    renderNoteExport([value, { ...value, id: "second" }], {
      ...projection(),
      consumedWork: {
        utf8Units: NOTE_EXPORT_LIMITS.utf8Units - 400000,
        nodeVisits: 0,
      },
    }),
  ).toThrow(expect.objectContaining({ code: "note_link_limit" }));
  expect(encodeNoteReference).toHaveBeenCalledOnce();
});
