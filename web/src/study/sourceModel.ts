import type { StudyEntry } from "../collections/contracts";
import { saveEntry, deleteEntry } from "./model";
import { initialSchedule } from "./scheduler";
import { canonicalSourceDocument, captureSourceSelection } from "./sourceCodec";
import { SourceError } from "./sourceContracts";
import type {
  AnchoredStudySource,
  SourceAnchor,
  SourceCommand,
  SourceExpected,
  SourceOwnerSnapshot,
  SourceReceipt,
  SourceResolution,
} from "./sourceContracts";
import { SOURCE_LIMITS } from "./sourceValidation";

export function sourceTokens(state: SourceOwnerSnapshot): SourceExpected {
  return {
    library: { epoch: state.library.epoch, revision: state.library.revision },
    collections: {
      epoch: state.collections.epoch,
      revision: state.collections.revision,
    },
  };
}
export function resolveSource(
  state: SourceOwnerSnapshot,
  entryId: string,
  documentDigest: string,
): SourceResolution {
  const entry = state.collections.study.entries.find(
      (entry) => entry.id === entryId,
    ),
    source = entry?.source;
  if (!entry || !source) return { status: "unavailable", reason: "missing" };
  if (!("version" in source))
    return { status: "unavailable", reason: "legacy" };
  const anchor = state.library.anchors.find(
    (anchor) => anchor.id === source.anchorId,
  );
  const note = state.notes.find((note) => note.id === source.noteId);
  if (!note || !anchor) return { status: "unavailable", reason: "missing" };
  if (note.trashedAt !== null)
    return { status: "unavailable", reason: "trashed" };
  if (
    source.libraryEpoch !== state.library.epoch ||
    anchor.entryId !== entryId ||
    anchor.noteId !== source.noteId ||
    anchor.birth.noteRevision !== source.noteRevision ||
    anchor.quote !== source.quote ||
    anchor.status !== "attached" ||
    anchor.noteRevision !== note.revision ||
    anchor.documentDigest !== documentDigest
  )
    return { status: "unavailable", reason: "stale" };
  try {
    if (
      captureSourceSelection(note.document, anchor.from, anchor.to).passage
        .quote !== anchor.quote
    )
      return { status: "unavailable", reason: "stale" };
  } catch {
    return { status: "unavailable", reason: "stale" };
  }
  return {
    status: "attached",
    entryId,
    anchorId: anchor.id,
    anchorRevision: anchor.revision,
    noteId: note.id,
    noteRevision: note.revision,
    documentDigest,
    from: anchor.from,
    to: anchor.to,
    quote: anchor.quote,
  };
}
export function applySourceCommand(
  state: SourceOwnerSnapshot,
  command: SourceCommand,
): SourceReceipt {
  let receipt: SourceReceipt;
  if (command.kind === "create") {
    const selection = command.selection,
      note = state.notes.find((note) => note.id === selection.noteId);
    if (
      !note ||
      note.trashedAt !== null ||
      note.revision !== selection.noteRevision ||
      state.library.epoch !== selection.libraryEpoch ||
      canonicalSourceDocument(note.document).canonicalJSON !==
        selection.fingerprint.canonicalJSON ||
      captureSourceSelection(
        note.document,
        selection.passage.from,
        selection.passage.to,
      ).passage.quote !== selection.passage.quote
    )
      throw new SourceError(
        "source_stale",
        "The selected passage changed. Select it again.",
      );
    if (state.library.anchors.length >= SOURCE_LIMITS.anchors)
      throw new SourceError("source_limit", "Source annotations are full.");
    if (
      state.library.anchors.some(
        (anchor) =>
          anchor.id === command.anchorId || anchor.entryId === command.entryId,
      ) ||
      state.collections.study.entries.some(
        (entry) => entry.id === command.entryId,
      )
    )
      throw new SourceError(
        "source_operation_reused",
        "This card identity is already in use.",
      );
    const source: AnchoredStudySource = {
      version: 2,
      noteId: note.id,
      noteRevision: note.revision,
      quote: selection.passage.quote,
      libraryEpoch: state.library.epoch,
      anchorId: command.anchorId,
    };
    const entry: StudyEntry = {
      ...structuredClone(command.draft),
      id: command.entryId,
      revision: 1,
      source,
    };
    const at = new Date();
    const nextStudy = saveEntry(state.collections.study, entry, at);
    const cards = nextStudy.cards.filter((card) => card.entryId === entry.id);
    if (cards.length !== command.cardIds.length)
      throw new SourceError(
        "source_invalid",
        "Derived card identities do not match the selected type.",
      );
    cards.forEach((card, i) => {
      card.id = command.cardIds[i]!;
    });
    state.collections.study = nextStudy;
    const anchor: SourceAnchor = {
      id: command.anchorId,
      revision: 1,
      noteId: note.id,
      entryId: entry.id,
      birth: {
        noteRevision: note.revision,
        documentDigest: selection.fingerprint.digest,
        from: selection.passage.from,
        to: selection.passage.to,
      },
      noteRevision: note.revision,
      from: selection.passage.from,
      to: selection.passage.to,
      quote: selection.passage.quote,
      documentDigest: selection.fingerprint.digest,
      status: "attached",
      staleReason: null,
    };
    state.library.anchors.push(anchor);
    receipt = {
      operationId: command.operationId,
      digest: command.digest,
      kind: "create",
      at: at.toISOString(),
      entryId: entry.id,
      cardIds: command.cardIds.slice(),
      anchorId: anchor.id,
      createOperationId: command.operationId,
      entryRevision: 1,
      cardRevisions: cards.map(() => 1),
      anchorRevision: 1,
    };
  } else {
    const original = state.library.sourceReceipts.find(
      (row) => row.operationId === command.original.operationId,
    );
    const entry = state.collections.study.entries.find(
        (entry) => entry.id === command.entryId,
      ),
      anchor = state.library.anchors.find(
        (anchor) => anchor.id === command.original.anchorId,
      );
    const cards = state.collections.study.cards.filter(
        (card) => card.entryId === command.entryId,
      ),
      now = Date.now();
    const schedule = original ? initialSchedule(new Date(original.at)) : null;
    const matchingCards =
      original &&
      schedule &&
      cards.length === original.cardIds.length &&
      original.cardIds.every((id) =>
        cards.some(
          (card) =>
            card.id === id &&
            card.revision === 1 &&
            (Object.keys(schedule) as (keyof typeof schedule)[]).every(
              (key) => card.schedule[key] === schedule[key],
            ),
        ),
      );
    if (
      !original ||
      original.kind !== "create" ||
      JSON.stringify(original) !== JSON.stringify(command.original) ||
      !entry ||
      entry.revision !== 1 ||
      !anchor ||
      anchor.revision !== 1 ||
      anchor.entryId !== entry.id ||
      !matchingCards ||
      resolveSource(state, entry.id, anchor.documentDigest).status !==
        "attached" ||
      state.collections.study.events.some((event) =>
        original.cardIds.includes(event.cardId),
      ) ||
      now < Date.parse(original.at) ||
      now > Date.parse(original.at) + 5000
    )
      throw new SourceError(
        "source_undo_unavailable",
        "This card or source changed, or Undo expired.",
      );
    state.collections.study = deleteEntry(state.collections.study, entry.id);
    state.library.anchors = state.library.anchors.filter(
      (row) => row.id !== anchor.id,
    );
    receipt = {
      ...structuredClone(original),
      operationId: command.operationId,
      digest: command.digest,
      kind: "undo",
      at: new Date(now).toISOString(),
    };
  }
  state.library.sourceReceipts.push(receipt);
  state.library.sourceReceipts = state.library.sourceReceipts.slice(
    -SOURCE_LIMITS.receipts,
  );
  return receipt;
}
