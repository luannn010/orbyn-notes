import { expect, it } from "vitest";
import {
  archiveHabit,
  emptyJournal,
  saveHabit,
  setHabitCompletion,
  writeJournalEntry,
} from "../../src/collections/journal";
import {
  exportJournalFiles,
  exportJournalMarkdown,
} from "../../src/collections/journalTransfer";
import { parseMarkdown } from "../../src/transfer";

it("includes a complete readable backup when habits have never been checked", () => {
  const at = new Date(2026, 10, 11, 12);
  let data = saveHabit(emptyJournal(), "Never checked", at);
  data = saveHabit(data, "Archived without completion", at);
  data = archiveHabit(data, data.habits[1]!.id, at);
  const files = exportJournalFiles(data);
  const backup = files.find((file) => file.filename === "journal.json");
  expect(backup).toBeDefined();
  expect(JSON.parse(backup!.content)).toEqual(data);
  expect(
    files.find((file) => file.filename === "README.txt")!.content,
  ).toContain("no built-in Journal import");
});
it("does not present an empty Journal as having exported content", () => {
  expect(exportJournalFiles(emptyJournal())).toEqual([]);
});

it("deliberately exports Journal writing and habit-only days without leaking key metadata", () => {
  const at = new Date(2026, 10, 11, 12);
  let data = saveHabit(emptyJournal(), "A synthetic habit", at);
  data = setHabitCompletion(data, "2026-11-11", data.habits[0]!.id, true, at);
  data = writeJournalEntry(
    data,
    "2026-11-10",
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "My synthetic private entry" }],
        },
      ],
    },
    null,
    at,
  );
  const files = exportJournalMarkdown(data);
  expect(files.map((file) => file.filename)).toEqual([
    "2026-11-10.md",
    "2026-11-11.md",
  ]);
  expect(files[0]!.content).toContain("My synthetic private entry");
  expect(files[1]!.content).toContain("[x] A synthetic habit");
  expect(files[0]!.content).not.toContain("PBKDF2");
  expect(
    parseMarkdown(
      files.map((file) => ({ name: file.filename, content: file.content })),
    ),
  ).toHaveLength(2);
  expect(data.entries).toHaveLength(1);
});
