import type { Note, NotesStore } from "../domain/contracts";
import { inspectNoteDocument, validateNoteInput } from "../domain/validation";
import { NOTE_LINK_LIMITS } from "../links/scanner";

type Input = Parameters<NotesStore["create"]>[0];
type Entry = { creationId: string; input: Input };
export type MarkdownImportPlan = { entries: Entry[]; expectedEpoch?: string };

export function prepareMarkdownImport(
  inputs: readonly Input[],
  expectedEpoch?: string,
): MarkdownImportPlan {
  // Finish all validation before allocating a writer or admitting a partial plan.
  const entries = inputs.map((input) => {
    const checked = validateNoteInput(structuredClone(input));
    const inspected = inspectNoteDocument(checked.document, "notes");
    if (inspected.jsonUnits * 3 > NOTE_LINK_LIMITS.documentBytes)
      throw new Error("This note is too large to import.");
    return { creationId: crypto.randomUUID(), input: checked };
  });
  return { entries, expectedEpoch };
}

export function markdownImportChunks(entries: readonly Entry[]): Entry[][] {
  const chunks: Entry[][] = [];
  let chunk: Entry[] = [],
    units = 0,
    nodes = 0;
  for (const entry of entries) {
    const size = JSON.stringify(entry.input).length;
    const visits =
      inspectNoteDocument(entry.input.document, "notes").nodeVisits * 2;
    if (
      chunk.length &&
      (chunk.length === 10 ||
        units + size > 1_000_000 ||
        nodes + visits > NOTE_LINK_LIMITS.workNodes)
    ) {
      chunks.push(chunk);
      chunk = [];
      units = 0;
      nodes = 0;
    }
    chunk.push(entry);
    units += size;
    nodes += visits;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export class MarkdownImportFailure extends Error {
  constructor(
    public readonly saved: number,
    public readonly failure: unknown,
  ) {
    super(
      "The final batch may already be saved. Retry uses the same note IDs.",
    );
  }
}

export async function runMarkdownImport(
  store: NotesStore,
  plan: MarkdownImportPlan,
  signal: AbortSignal,
  progress: (saved: number) => void,
): Promise<{ saved: number; stopped: boolean }> {
  let saved = 0;
  try {
    if (store.createBatch && !plan.expectedEpoch)
      throw new Error(
        "Wait for the library to open, then try importing again.",
      );
    const chunks = store.createBatch
      ? markdownImportChunks(plan.entries)
      : plan.entries.map((entry) => [entry]);
    for (const entries of chunks) {
      if (signal.aborted) break;
      let result: Note[];
      if (store.createBatch) {
        result = await store.createBatch(entries, {
          expectedEpoch: plan.expectedEpoch!,
          signal,
        });
      } else {
        result = [
          await store.create(entries[0]!.input, entries[0]!.creationId),
        ];
      }
      if (result.length !== entries.length)
        throw new Error("Import returned an incomplete result.");
      saved += entries.length;
      progress(saved);
      // A browser task boundary makes the existing Cancel control actionable.
      if (!signal.aborted && saved < plan.entries.length)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return { saved, stopped: signal.aborted };
  } catch (failure) {
    // Only the exact pre-commit abort receipt is a known unsaved chunk.
    if (signal.aborted && failure === signal.reason)
      return { saved, stopped: true };
    throw new MarkdownImportFailure(saved, failure);
  }
}
