import type { AccountIdentity, Note, RichNode } from "../domain/contracts";
import type { CollectionsState } from "../collections/contracts";
import type { NotesLibraryStore } from "../library/contracts";
import type { CollectionsStore } from "../collections/contracts";
import { lockVersion, onLock } from "../account/session";
import {
  readRecord,
  wrappingSecret,
  type DeviceRecord,
} from "../data/database";
import { validateNoteTarget } from "../links/reference";
import { SearchSourceError } from "./contracts";
import type {
  SearchLease,
  SearchInvalidation,
  SearchSourceReader,
  SearchNodeCursor,
  SearchEntryCursor,
  SearchVersions,
  SearchClipView,
  SearchDeckView,
  SearchCardView,
} from "./contracts";

type Token = { epoch: string; revision: number };
type NoteData = {
  id: string;
  revision: number;
  title: string;
  tags: string[];
  updatedAt: string;
  document: Note["document"];
};
type EntryData = {
  id: string;
  revision: number;
  deckId: string;
  tags: string[];
} & (
  | { type: "basic" | "reversed"; front: string; back: string }
  | { type: "cloze"; text: string; blanks: { id: string; answer: string }[] }
);
export type NotesSearchData = {
  kind: "notes";
  token: Token;
  notes: NoteData[];
};
export type CollectionsSearchData = {
  kind: "collections";
  token: Token;
  clips: SearchClipView[];
  decks: SearchDeckView[];
  entries: EntryData[];
  cards: SearchCardView[];
};
type Data = NotesSearchData | CollectionsSearchData;
type Proof = {
  record: Pick<
    DeviceRecord,
    | "email"
    | "accountId"
    | "deviceId"
    | "generation"
    | "sealedKeys"
    | "snapshot"
    | "verifiedTrust"
    | "approvalCheckpointId"
  >;
};
type OwnerNotice = Readonly<{ reason: SearchInvalidation; before?: Proof }>;
declare const partBrand: unique symbol;
type Part = Readonly<{ [partBrand]: true }>;
type PartState = {
  owner: SearchOwnerAccess;
  data: Data | null;
  proof: Proof;
  identity: AccountIdentity;
  reason: SearchInvalidation | null;
  nodes: WeakMap<SearchNodeCursor, RichNode>;
  entries: WeakMap<SearchEntryCursor, Extract<EntryData, { type: "cloze" }>>;
  listeners: Set<(notice: OwnerNotice) => void>;
};
const parts = new WeakMap<Part, PartState>();
export interface SearchOwnerAccess {
  capture(signal?: AbortSignal): Promise<Part>;
  fresh(part: Part, signal?: AbortSignal): Promise<void>;
  release(part: Part): void;
}
class UnverifiedImage extends SearchSourceError {
  constructor() {
    super("search_source_revoked");
  }
}
function fail(
  code:
    | "search_source_invalid"
    | "search_source_unavailable"
    | "search_source_corrupt"
    | "search_source_changed"
    | "search_source_revoked",
): never {
  throw new SearchSourceError(code);
}
function bytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function sameProof(a: Proof, b: Proof): boolean {
  const x = a.record,
    y = b.record;
  return (
    x.email === y.email &&
    x.accountId === y.accountId &&
    x.deviceId === y.deviceId &&
    x.generation === y.generation &&
    x.verifiedTrust === y.verifiedTrust &&
    x.approvalCheckpointId === y.approvalCheckpointId &&
    bytes(x.snapshot, y.snapshot) &&
    bytes(x.sealedKeys, y.sealedKeys)
  );
}
function sameAuthority(a: Proof, b: Proof): boolean {
  const x = a.record,
    y = b.record;
  return (
    x.email === y.email &&
    x.accountId === y.accountId &&
    x.deviceId === y.deviceId &&
    x.verifiedTrust === y.verifiedTrust &&
    x.approvalCheckpointId === y.approvalCheckpointId &&
    bytes(x.sealedKeys, y.sealedKeys)
  );
}
function proof(record: DeviceRecord): Proof {
  return {
    record: {
      email: record.email,
      accountId: record.accountId,
      deviceId: record.deviceId,
      generation: record.generation,
      sealedKeys: record.sealedKeys,
      snapshot: record.snapshot,
      verifiedTrust: record.verifiedTrust,
      approvalCheckpointId: record.approvalCheckpointId,
    },
  };
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) fail("search_source_revoked");
}
function partState(part: Part): PartState & { data: Data } {
  const state = parts.get(part);
  if (!state || !state.data || state.reason)
    fail(
      state?.reason === "changed"
        ? "search_source_changed"
        : "search_source_revoked",
    );
  return state as PartState & { data: Data };
}
function revokePart(part: Part, notice: OwnerNotice) {
  const state = parts.get(part);
  if (!state || state.reason) return;
  state.reason = notice.reason;
  state.data = null;
  state.nodes = new WeakMap();
  state.entries = new WeakMap();
  for (const callback of state.listeners) {
    try {
      callback(notice);
    } catch {
      /* Revoke all borrowers. */
    }
  }
  state.listeners.clear();
}

/** Internal owner helper; never registered by a caller. Genuine registries live
 * inside library/store and collections/store, and expose only frozen access. */
export function createSearchAdmission(
  identity: AccountIdentity,
  initialKey: CryptoKey,
  assertOpen: () => void,
  load: () => Promise<void>,
) {
  const scope = structuredClone(identity),
    openedLock = lockVersion();
  let current: { data: Data; proof: Proof } | null = null,
    closed = false,
    authorityLost = false,
    loading: Promise<void> | null = null;
  const captures = new Set<Part>();
  let failedImage: Proof | null = null;
  const getCurrent = () => current;
  function guard() {
    if (closed || authorityLost || lockVersion() !== openedLock)
      fail("search_source_revoked");
    try {
      assertOpen();
    } catch {
      close();
      fail("search_source_revoked");
    }
  }
  function invalidate(reason: SearchInvalidation, before?: Proof) {
    for (const part of captures)
      revokePart(part, Object.freeze({ reason, before }));
    captures.clear();
    current = null;
  }
  function close() {
    if (closed) return;
    closed = true;
    failedImage = null;
    invalidate("closed");
  }
  async function keysMatch(record: DeviceRecord) {
    let expected: Uint8Array | undefined, actual: Uint8Array | undefined;
    try {
      expected = await wrappingSecret(initialKey);
      guard();
      actual = await wrappingSecret(record.wrapKey);
      guard();
      return bytes(expected, actual);
    } finally {
      expected?.fill(0);
      actual?.fill(0);
    }
  }
  async function verify(expected: Proof, signal?: AbortSignal) {
    guard();
    aborted(signal);
    const record = await readRecord<DeviceRecord>("devices", scope.email);
    guard();
    aborted(signal);
    if (!record || !sameAuthority(expected, proof(record))) {
      authorityLost = true;
      invalidate("unverified");
      fail("search_source_revoked");
    }
    if (!sameProof(expected, proof(record))) {
      invalidate("unverified");
      throw new UnverifiedImage();
    }
    try {
      if (!(await keysMatch(record))) {
        authorityLost = true;
        invalidate("unverified");
        fail("search_source_revoked");
      }
    } catch (error) {
      if (!closed) invalidate("unverified");
      throw error;
    }
    guard();
    aborted(signal);
  }
  const access: SearchOwnerAccess = Object.freeze({
    async capture(signal?: AbortSignal) {
      guard();
      aborted(signal);
      if (current) {
        try {
          await verify(current.proof, signal);
        } catch (error) {
          if (!(error instanceof UnverifiedImage) || closed || signal?.aborted)
            throw error;
        }
      }
      if (!current) {
        if (!loading) {
          loading = (async () => {
            const record = await readRecord<DeviceRecord>(
              "devices",
              scope.email,
            );
            guard();
            if (!record) fail("search_source_unavailable");
            const image = proof(record);
            if (failedImage && sameProof(failedImage, image))
              fail("search_source_unavailable");
            failedImage = image;
            await load();
            guard();
            if (!getCurrent()) fail("search_source_unavailable");
            failedImage = null;
          })().finally(() => {
            loading = null;
          });
        }
        await loading;
        guard();
        aborted(signal);
        const admitted = getCurrent();
        if (!admitted) fail("search_source_unavailable");
        await verify(admitted.proof, signal);
      }
      guard();
      aborted(signal);
      if (!current) fail("search_source_unavailable");
      const part = Object.freeze({}) as Part;
      parts.set(part, {
        owner: access,
        data: current.data,
        proof: current.proof,
        identity: scope,
        reason: null,
        nodes: new WeakMap(),
        entries: new WeakMap(),
        listeners: new Set(),
      });
      captures.add(part);
      return part;
    },
    async fresh(part: Part, signal?: AbortSignal) {
      const state = partState(part);
      if (state.owner !== access) fail("search_source_invalid");
      guard();
      await verify(state.proof, signal);
      partState(part);
    },
    release(part: Part) {
      if (parts.get(part)?.owner !== access) fail("search_source_invalid");
      revokePart(part, { reason: "closed" });
      captures.delete(part);
    },
  });
  return {
    access,
    close,
    unverified() {
      if (!closed) invalidate("unverified");
    },
    sameImage(record: DeviceRecord) {
      return current !== null && sameProof(current.proof, proof(record));
    },
    async publish(
      record: DeviceRecord,
      data: Data | null,
      before?: DeviceRecord,
    ) {
      guard();
      // No lease is granted by publication: capture/fresh always check cloned
      // key material. Only active borrowers require that work before observers.
      try {
        if (captures.size > 0 && !(await keysMatch(record))) {
          authorityLost = true;
          fail("search_source_revoked");
        }
      } catch (error) {
        invalidate("unverified");
        throw error;
      }
      guard();
      const after = proof(record);
      if (current && sameProof(current.proof, after)) return;
      const prior = current,
        reason: SearchInvalidation =
          prior && data && prior.data.token.epoch !== data.token.epoch
            ? "epoch"
            : before && prior && sameProof(prior.proof, proof(before))
              ? "changed"
              : "unverified";
      if (prior) invalidate(reason, before ? proof(before) : undefined);
      if (!data) fail("search_source_unavailable");
      current = { data, proof: after };
    },
  };
}
export function notesSearchData(notes: Note[], token: Token): NotesSearchData {
  return {
    kind: "notes",
    token: { ...token },
    notes: notes
      .filter((note) => note.trashedAt === null)
      .map((note) => ({
        id: note.id,
        revision: note.revision,
        title: note.title,
        tags: note.tags.slice(),
        updatedAt: note.updatedAt,
        document: note.document,
      })),
  };
}
export function collectionsSearchData(
  state: CollectionsState,
): CollectionsSearchData {
  return {
    kind: "collections",
    token: { epoch: state.epoch, revision: state.revision },
    clips: state.clips.items.map((clip) => ({
      id: clip.id,
      revision: clip.revision,
      title: clip.title,
      originalUrl: clip.originalUrl,
      canonicalUrl: clip.canonicalUrl,
      text: clip.text,
      updatedAt: clip.updatedAt,
      archivedAt: clip.archivedAt,
    })),
    decks: state.study.decks.map((deck) => ({
      id: deck.id,
      revision: deck.revision,
      title: deck.title,
    })),
    entries: state.study.entries.map((entry) => {
      const base = {
        id: entry.id,
        revision: entry.revision,
        deckId: entry.deckId,
        tags: entry.tags.slice(),
      };
      return entry.type === "cloze"
        ? {
            ...base,
            type: entry.type,
            text: entry.text,
            blanks: entry.blanks.map((blank) => ({
              id: blank.id,
              answer: blank.answer,
            })),
          }
        : { ...base, type: entry.type, front: entry.front, back: entry.back };
    }),
    cards: state.study.cards.map((card) => ({
      id: card.id,
      revision: card.revision,
      entryId: card.entryId,
      key: card.key,
    })),
  };
}

type LeaseState = {
  notes: Part;
  collections: Part;
  reason: SearchInvalidation | null;
  listeners: Set<(reason: SearchInvalidation) => void>;
  stops: (() => void)[];
};
const leases = new WeakMap<SearchLease, LeaseState>();
function leaseState(lease: SearchLease) {
  const state = leases.get(lease);
  if (!state) fail("search_source_invalid");
  if (state.reason)
    fail(
      state?.reason === "changed"
        ? "search_source_changed"
        : "search_source_revoked",
    );
  partState(state.notes);
  partState(state.collections);
  return state;
}
function revokeLease(state: LeaseState, reason: SearchInvalidation) {
  if (state.reason) return;
  state.reason = reason;
  for (const stop of state.stops) stop();
  state.stops = [];
  parts.get(state.notes)?.owner.release(state.notes);
  parts.get(state.collections)?.owner.release(state.collections);
  for (const callback of state.listeners) {
    try {
      callback(reason);
    } catch {
      /* Clear every consumer. */
    }
  }
  state.listeners.clear();
}
export async function acquireSearchSource(
  notes: NotesLibraryStore,
  collections: CollectionsStore,
  signal?: AbortSignal,
): Promise<SearchLease> {
  aborted(signal);
  const [{ notesSearchAdmission }, { collectionsSearchAdmission }] =
    await Promise.all([
      import("../library/store"),
      import("../collections/store"),
    ]);
  aborted(signal);
  const left = notesSearchAdmission(notes),
    right = collectionsSearchAdmission(collections);
  let a: Part | undefined, b: Part | undefined;
  try {
    const captured = await Promise.allSettled([
      left.capture(signal),
      right.capture(signal),
    ]);
    const first = captured[0]!,
      second = captured[1]!;
    if (first.status === "fulfilled") a = first.value;
    if (second.status === "fulfilled") b = second.value;
    if (first.status === "rejected") throw first.reason;
    if (second.status === "rejected") throw second.reason;
    aborted(signal);
    if (!a || !b) fail("search_source_unavailable");
    const ns = partState(a),
      cs = partState(b);
    if (
      ns.identity.accountId !== cs.identity.accountId ||
      ns.identity.deviceId !== cs.identity.deviceId ||
      ns.identity.email !== cs.identity.email
    )
      fail("search_source_revoked");
    await Promise.all([left.fresh(a, signal), right.fresh(b, signal)]);
    const lease = Object.freeze({}) as SearchLease,
      state: LeaseState = {
        notes: a,
        collections: b,
        reason: null,
        listeners: new Set(),
        stops: [],
      };
    leases.set(lease, state);
    for (const part of [a, b]) {
      const ps = partState(part),
        callback = (notice: OwnerNotice) => {
          let reason = notice.reason;
          if (
            reason === "changed" &&
            (!notice.before ||
              !sameProof(parts.get(a!)!.proof, notice.before) ||
              !sameProof(parts.get(b!)!.proof, notice.before))
          )
            reason = "unverified";
          revokeLease(state, reason);
        };
      ps.listeners.add(callback);
      state.stops.push(() => ps.listeners.delete(callback));
    }
    return lease;
  } catch (error) {
    if (a) left.release(a);
    if (b) right.release(b);
    throw error;
  }
}
export async function assertSearchSourceFresh(
  lease: SearchLease,
  signal?: AbortSignal,
): Promise<void> {
  const state = leaseState(lease);
  aborted(signal);
  await Promise.all([
    parts.get(state.notes)!.owner.fresh(state.notes, signal),
    parts.get(state.collections)!.owner.fresh(state.collections, signal),
  ]);
  leaseState(lease);
  aborted(signal);
}
export function onSearchSourceInvalidated(
  lease: SearchLease,
  listener: (reason: SearchInvalidation) => void,
): () => void {
  const state = leaseState(lease);
  if (typeof listener !== "function") fail("search_source_invalid");
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
export function releaseSearchSource(lease: SearchLease): void {
  const state = leases.get(lease);
  if (!state) fail("search_source_invalid");
  revokeLease(state, "closed");
}
function item<T>(items: readonly T[], index: number): T {
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length)
    fail("search_source_invalid");
  return items[index]!;
}
export function searchSourceReader(lease: SearchLease): SearchSourceReader {
  const state = leaseState(lease),
    left = partState(state.notes),
    right = partState(state.collections);
  if (left.data!.kind !== "notes" || right.data!.kind !== "collections")
    fail("search_source_invalid");
  const versions: SearchVersions = Object.freeze({
    accountId: left.identity.accountId,
    library: Object.freeze({ ...left.data!.token }),
    collections: Object.freeze({ ...right.data!.token }),
  });
  function data() {
    leaseState(lease);
    const n = partState(state.notes),
      c = partState(state.collections);
    if (n.data!.kind !== "notes" || c.data!.kind !== "collections")
      fail("search_source_invalid");
    return { n: n.data!, c: c.data!, part: n, entryPart: c };
  }
  function cursor(node: RichNode) {
    const value = Object.freeze({}) as SearchNodeCursor;
    partState(state.notes).nodes.set(value, node);
    return value;
  }
  return Object.freeze({
    versions,
    counts: Object.freeze({
      notes: left.data.notes.length,
      clips: right.data.clips.length,
      decks: right.data.decks.length,
      entries: right.data.entries.length,
      cards: right.data.cards.length,
    }),
    note(index) {
      const value = item(data().n.notes, index);
      return Object.freeze({
        id: value.id,
        revision: value.revision,
        title: value.title,
        tags: Object.freeze(value.tags.slice()),
        updatedAt: value.updatedAt,
        root: cursor(value.document),
      });
    },
    node(handle) {
      const value = data().part.nodes.get(handle);
      if (!value) fail("search_source_invalid");
      return Object.freeze({
        type: value.type,
        text: value.text ?? null,
        target:
          value.type === "noteLink"
            ? validateNoteTarget(value.attrs?.target)
            : null,
        children: value.content?.length ?? 0,
      });
    },
    child(handle, index) {
      const value = data().part.nodes.get(handle);
      if (!value) fail("search_source_invalid");
      return cursor(item(value.content ?? [], index));
    },
    clip(index) {
      return Object.freeze({ ...item(data().c.clips, index) });
    },
    deck(index) {
      return Object.freeze({ ...item(data().c.decks, index) });
    },
    card(index) {
      return Object.freeze({ ...item(data().c.cards, index) });
    },
    entry(index) {
      const { c, entryPart } = data(),
        value = item(c.entries, index),
        base = {
          id: value.id,
          revision: value.revision,
          deckId: value.deckId,
          tags: Object.freeze(value.tags.slice()),
        };
      if (value.type !== "cloze")
        return Object.freeze({
          ...base,
          type: value.type,
          front: value.front,
          back: value.back,
        });
      const handle = Object.freeze({}) as SearchEntryCursor;
      entryPart.entries.set(handle, value);
      return Object.freeze({
        ...base,
        type: value.type,
        text: value.text,
        blankCount: value.blanks.length,
        cursor: handle,
      });
    },
    blank(handle, index) {
      const value = data().entryPart.entries.get(handle);
      if (!value) fail("search_source_invalid");
      return Object.freeze({ ...item(value.blanks, index) });
    },
  });
}
