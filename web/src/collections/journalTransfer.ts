import type { Note, NoteDocument, RichNode } from "../domain/contracts";
import { exportMarkdown } from "../transfer";
import { validateJournalData } from "./journal";
import type { JournalData } from "./journal";

/** Complete readable backup plus Markdown views; not an automatic restore API. */
export function exportJournalFiles(
  input: JournalData,
): ReturnType<typeof exportMarkdown> {
  const data = validateJournalData(input);
  if (!data.entries.length && !data.habits.length && !data.completions.length)
    return [];
  const files = [
    { filename: "journal.json", content: `${JSON.stringify(data, null, 2)}\n` },
  ];
  let markdownWarning = "";
  try {
    files.push(...exportJournalMarkdown(data));
  } catch {
    // The complete structured backup remains available when added Markdown
    // presentation (prompt/habit sections) exceeds an individual note limit.
    markdownWarning =
      "\nMarkdown views could not be generated. journal.json still contains every entry, habit definition and completion.\n";
  }
  files.push({
    filename: "README.txt",
    content: `Orbyn Notes Journal export\n\njournal.json is the complete structured backup: entries, prompts, habit definitions (including archived and never-completed habits), completions and Journal preferences. Dated Markdown files are readable views when available.\n\nThese files are NOT encrypted. Anyone with the files can read them. There is currently no built-in Journal import or automatic restore. Keep journal.json together with this export for manual recovery.${markdownWarning}\n`,
  });
  return files;
}

/** Call only after explicit plaintext-export confirmation on an unlocked vault. */
export function exportJournalMarkdown(
  input: JournalData,
): ReturnType<typeof exportMarkdown> {
  const data = validateJournalData(input);
  const dates = [
    ...new Set([
      ...data.entries.map((entry) => entry.date),
      ...data.completions.map((completion) => completion.date),
    ]),
  ].sort();
  const entries = new Map(data.entries.map((entry) => [entry.date, entry]));
  return dates.flatMap((day) => {
    const entry = entries.get(day);
    const content: RichNode[] = [];
    if (entry?.prompt)
      content.push({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: entry.prompt }],
          },
        ],
      });
    content.push(...structuredClone(entry?.document.content ?? []));
    const completions = data.completions.filter(
      (completion) => completion.date === day,
    );
    if (completions.length) {
      content.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Habits" }],
      });
      content.push({
        type: "taskList",
        content: completions.map((completion) => ({
          type: "taskItem",
          attrs: { checked: completion.done },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: data.habits.find(
                    (habit) => habit.id === completion.habitId,
                  )!.name,
                },
              ],
            },
          ],
        })),
      });
    }
    const document: NoteDocument = {
      type: "doc",
      content: content.length ? content : [{ type: "paragraph", content: [] }],
    };
    const fallbackTimestamp = `${day}T12:00:00.000Z`;
    const note: Note = {
      id: entry?.id ?? `journal-${day}`,
      title: `Journal — ${day}`,
      document,
      tags: [],
      revision: entry?.revision ?? 1,
      createdAt: entry?.createdAt ?? fallbackTimestamp,
      updatedAt: entry?.updatedAt ?? fallbackTimestamp,
      trashedAt: null,
    };
    return exportMarkdown([note]).map((file) => ({
      ...file,
      filename: `${day}.md`,
    }));
  });
}
