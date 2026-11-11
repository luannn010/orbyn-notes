import { ClipDuplicateError, ClipError } from "./contracts";
import type { ClipActionInput, ClipReceipt, ClipState } from "./contracts";
import { CLIP_LIMITS, clipUrl, validateClipState } from "./validation";

export function applyClipAction(
  state: ClipState,
  action: ClipActionInput,
  operationId: string,
  clipId: string,
  digest: string,
  preparedAt: string,
): { clips: ClipState; receipt: ClipReceipt } {
  const next = structuredClone(state);
  let changed = true,
    resultRevision: number | null = null;
  if (action.kind === "create") {
    const url = clipUrl(action.url);
    const duplicate = next.items.find(
      (item) => item.canonicalUrl === url.canonicalUrl,
    );
    if (!action.allowDuplicate && duplicate)
      throw new ClipDuplicateError(duplicate);
    if (next.items.length >= CLIP_LIMITS.items)
      throw new ClipError(
        "clip_limit",
        "The local clip limit has been reached.",
      );
    if (next.items.some((item) => item.id === clipId))
      throw new ClipError(
        "clip_operation_reused",
        "This clip identity is already in use.",
      );
    // Timestamp admission follows all target and duplicate checks.
    const at = new Date().toISOString();
    next.items.push({
      id: clipId,
      revision: 1,
      originalUrl: url.originalUrl,
      canonicalUrl: url.canonicalUrl,
      title: action.title,
      text: action.text || null,
      createdAt: preparedAt,
      updatedAt: at,
      readAt: null,
      readLater: action.readLater,
      archivedAt: null,
    });
    resultRevision = 1;
    return finish(at);
  }
  const item = next.items.find((item) => item.id === clipId);
  if (!item || item.revision !== action.targetRevision)
    throw new ClipError(
      "clip_stale",
      "This clip changed or is no longer available.",
    );
  if (action.kind === "undo-create") {
    const original = next.receipts.find(
      (receipt) => receipt.operationId === action.receiptOperationId,
    );
    const now = Date.now();
    if (
      !original ||
      original.kind !== "create" ||
      original.clipId !== clipId ||
      original.resultRevision !== 1 ||
      item.revision !== 1 ||
      now < Date.parse(original.at) ||
      now > Date.parse(original.at) + 5000
    )
      throw new ClipError(
        "clip_undo_unavailable",
        "Undo is no longer available for this clip.",
      );
    next.items = next.items.filter((item) => item.id !== clipId);
    return finish(new Date(now).toISOString());
  }
  changed =
    action.kind === "set-read"
      ? Boolean(item.readAt) !== action.read
      : action.kind === "set-read-later"
        ? item.readLater !== action.readLater
        : Boolean(item.archivedAt) !== action.archived;
  if (changed && item.revision === Number.MAX_SAFE_INTEGER)
    throw new ClipError("clip_limit", "Clip revisions are exhausted.");
  const at = new Date().toISOString();
  if (changed) {
    if (action.kind === "set-read") item.readAt = action.read ? at : null;
    else if (action.kind === "set-read-later")
      item.readLater = action.readLater;
    else item.archivedAt = action.archived ? at : null;
    item.updatedAt = at;
    item.revision++;
  }
  resultRevision = item.revision;
  return finish(at);
  function finish(at: string) {
    const receipt: ClipReceipt = {
      operationId,
      digest,
      kind: action.kind,
      clipId,
      resultRevision,
      at,
      changed,
    };
    next.receipts.push(receipt);
    next.receipts = next.receipts.slice(-CLIP_LIMITS.receipts);
    return { clips: validateClipState(next), receipt };
  }
}
