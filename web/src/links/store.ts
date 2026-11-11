import { renderNoteExport } from "../transfer/noteLinks";
import type { NotesLibraryStore } from "../library/contracts";
import type { Note, NoteDocument } from "../domain/contracts";
import { lockVersion, onLock } from "../account/session";
import { noteLinkOwner } from "../library/store";
import { NoteLinkError, NoteLinkConflictError } from "./contracts";
import type {
  NoteLinkService,
  NoteTarget,
  LinkToken,
  LinkProgress,
  LinkNotReady,
  LinkRepairIntent,
  LinkSearchCursor,
  NoteExportIntent,
  NoteExportResult,
  NoteLinksRow,
  NoteLinkResolution,
} from "./contracts";
import { linkToken, sameLinkToken, sameOwnerState } from "./model";
import type {
  LinkCertificate,
  LinkOwnerSnapshot,
  LinkRepairCommand,
} from "./model";
import {
  NOTE_LINK_LIMITS,
  inspectLinkDocument,
  scanLinkDocumentAsync,
  sameTargets,
  charge,
  targetKey,
} from "./scanner";
import { validateNoteTarget } from "./reference";

type Cache = {
  units: number;
  digest: string;
  snippet: string;
  targets: NoteLinksRow["targets"];
};
export function createNoteLinkService(
  notes: NotesLibraryStore,
): NoteLinkService {
  const owner = noteLinkOwner(notes),
    openedLock = lockVersion();
  let closed = false,
    epoch: string | undefined,
    generation = 0,
    job = 0;
  let cache = new Map<string, Cache>(),
    verified: LinkCertificate | null = null;
  let mismatch: LinkOwnerSnapshot | null = null;
  let inFlightRead: {
    generation: number;
    promise: Promise<LinkOwnerSnapshot>;
  } | null = null;
  let progress: LinkProgress = {
    verifiedNotes: 0,
    totalNotes: 0,
    verifiedHistory: 0,
    totalHistory: 0,
    utf8Units: 0,
    nodeVisits: 0,
  };
  let paused = false,
    cacheUnits = 0;
  type DocumentJob = {
    key: string;
    noteId: string;
    revision: number;
    document: NoteDocument;
    history: boolean;
  };
  let round: {
    state: LinkOwnerSnapshot;
    documents: DocumentJob[];
    cursor: number;
    rows: NoteLinksRow[];
    documentDigests: [string, number, string][];
    snippets: [string, string][];
    rowUnits: number;
    seen: Set<string>;
  } | null = null;
  const listeners = new Set<() => void>(),
    invalidations = new Set<(reason: "epoch" | "closed") => void>();
  let repairs = new WeakMap<
    LinkRepairIntent,
    { command: LinkRepairCommand; generation: number }
  >();
  let cursors = new WeakMap<
    LinkSearchCursor,
    {
      query: string;
      sourceId: string | undefined;
      token: LinkToken;
      offset: number;
    }
  >();
  let exports = new WeakMap<
    NoteExportIntent,
    { state: LinkOwnerSnapshot; ids: string[]; generation: number }
  >();
  let exportResults = new WeakMap<
    NoteExportResult,
    { state: LinkOwnerSnapshot; generation: number }
  >();
  const stopLock = onLock(close);
  let stopNotes: () => void;
  try {
    stopNotes = notes.subscribe(refresh);
  } catch (error) {
    stopLock();
    throw error;
  }
  function emit() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Observer isolation. */
      }
    }
  }
  function invalidate(reason: "epoch" | "closed") {
    generation++;
    inFlightRead = null;
    job++;
    round = null;
    verified = null;
    mismatch = null;
    cache.clear();
    cacheUnits = 0;
    repairs = new WeakMap();
    cursors = new WeakMap();
    exports = new WeakMap();
    exportResults = new WeakMap();
    for (const listener of invalidations) {
      try {
        listener(reason);
      } catch {
        /* Revoke all consumers. */
      }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    invalidate("closed");
    stopLock();
    stopNotes?.();
    listeners.clear();
    invalidations.clear();
  }
  function guard(captured = generation) {
    if (closed || openedLock !== lockVersion() || captured !== generation)
      throw new NoteLinkError("note_link_revoked");
  }
  function observe(state: LinkOwnerSnapshot) {
    if (epoch !== undefined && state.library.epoch !== epoch)
      invalidate("epoch");
    epoch = state.library.epoch;
    if (verified && !sameOwnerState(verified.snapshot, state)) verified = null;
    if (mismatch && !sameOwnerState(mismatch, state)) mismatch = null;
  }
  async function read(captured = generation) {
    guard(captured);
    let pending = inFlightRead;
    if (!pending || pending.generation !== captured) {
      pending = { generation: captured, promise: owner.read() };
      inFlightRead = pending;
      const clear = () => {
        if (inFlightRead === pending) inFlightRead = null;
      };
      // Share only the current synchronous burst. A later microtask/event
      // must read afresh even if this older snapshot is still unresolved.
      queueMicrotask(clear);
      // Successful and failed authorization is never cached after settlement.
      void pending.promise.then(clear, clear);
    }
    const state = await pending.promise;
    guard(captured);
    observe(state);
    guard(captured);
    return state;
  }
  function refresh() {
    if (!closed) {
      // A genuine owner-change notification must read after that change,
      // rather than joining an older snapshot still held by a consumer.
      inFlightRead = null;
      void read()
        .then(emit)
        .catch(() => {});
    }
  }
  function nonready(state: LinkOwnerSnapshot): LinkNotReady {
    if (state.index.status === "invalid")
      return { status: "invalid", code: "index-invalid" };
    if (state.knownMismatch || (mismatch && sameOwnerState(mismatch, state)))
      return { status: "invalid", code: "index-mismatch" };
    return {
      status: paused ? "paused-limit" : "pending",
      progress: { ...progress },
    };
  }
  function target(state: LinkOwnerSnapshot, noteId: string): NoteTarget {
    return {
      kind: "note",
      accountId: state.accountId,
      libraryEpoch: state.library.epoch,
      noteId,
    };
  }
  function resolveIn(
    state: LinkOwnerSnapshot,
    input: NoteTarget,
    byId?: Map<string, Note>,
  ): NoteLinkResolution {
    if (
      input.accountId !== state.accountId ||
      input.libraryEpoch !== state.library.epoch
    )
      return { status: "unavailable", reason: "scope" };
    const note = byId
      ? byId.get(input.noteId)
      : state.notes.find((note) => note.id === input.noteId);
    if (!note) return { status: "unavailable", reason: "missing" };
    if (note.trashedAt !== null)
      return { status: "unavailable", reason: "trashed" };
    return {
      status: "available",
      token: linkToken(state),
      target: { ...input },
      noteRevision: note.revision,
      title: note.title,
    };
  }
  async function hashDocument(json: string, captured: number) {
    guard(captured);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(json),
    );
    guard(captured);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  async function verify(): Promise<
    { status: "ready"; token: LinkToken } | LinkNotReady
  > {
    const captured = generation,
      currentJob = ++job,
      state = await read(captured);
    if (verified && sameOwnerState(verified.snapshot, state))
      return state.index.status === "invalid" || state.knownMismatch || mismatch
        ? nonready(state)
        : { status: "ready", token: linkToken(state) };
    const work = { utf8Units: 0, nodeVisits: 0 };
    if (!round || !sameOwnerState(round.state, state)) {
      round = {
        state,
        documents: [
          ...state.notes.map((note) => ({
            key: "note:" + note.id,
            noteId: note.id,
            revision: note.revision,
            document: note.document,
            history: false,
          })),
          ...(state.rawVersion === 3
            ? []
            : state.library.versions.map((version) => ({
                key: "history:" + version.id,
                noteId: version.noteId,
                revision: version.noteRevision,
                document: version.document,
                history: true,
              }))),
        ],
        cursor: 0,
        rows: [],
        documentDigests: [],
        snippets: [],
        rowUnits: 0,
        seen: new Set(),
      };
      progress = {
        verifiedNotes: 0,
        totalNotes: state.notes.length,
        verifiedHistory: 0,
        totalHistory:
          state.rawVersion === 3 ? 0 : state.library.versions.length,
        utf8Units: 0,
        nodeVisits: 0,
      };
    }
    const active = round,
      rows = active.rows,
      seen = active.seen;
    paused = false;
    let lastYieldNodes = 0,
      lastYieldAt = performance.now();
    try {
      for (; active.cursor < active.documents.length;) {
        const item = active.documents[active.cursor]!;
        guard(captured);
        if (job !== currentJob) throw new NoteLinkError("note_link_revoked");
        // Serialization is charged even on a cache hit: revision-only cache
        // reuse would allow a forged same-revision document to certify edges.
        const json = JSON.stringify(item.document);
        charge(work, json.length * 6, 0);
        seen.add(item.key);
        const digest = await hashDocument(json, captured);
        guard(captured);
        if (job !== currentJob) throw new NoteLinkError("note_link_revoked");
        let entry = cache.get(item.key);
        if (!entry || entry.digest !== digest) {
          const inspected = inspectLinkDocument(
            item.document,
            state.rawVersion === 3 ? "notes" : "plain",
            work,
          );
          const snippet = { text: "" };
          const targets = await scanLinkDocumentAsync(
            inspected,
            work,
            () => {
              guard(captured);
              if (job !== currentJob)
                throw new NoteLinkError("note_link_revoked");
            },
            snippet,
          );
          const targetJSON = JSON.stringify(targets);
          charge(work, targetJSON.length * 3, 0);
          entry = {
            digest,
            targets,
            snippet: snippet.text,
            units:
              (item.key.length + targetJSON.length + snippet.text.length) * 3 +
              128,
          };
          const old = cache.get(item.key);
          if (old) {
            cacheUnits -= old.units;
            cache.delete(item.key);
          }
          while (
            cache.size &&
            cacheUnits + entry.units > NOTE_LINK_LIMITS.workBytes
          ) {
            const oldest = cache.keys().next().value!;
            cacheUnits -= cache.get(oldest)!.units;
            cache.delete(oldest);
          }
          if (entry.units <= NOTE_LINK_LIMITS.workBytes) {
            cache.set(item.key, entry);
            cacheUnits += entry.units;
          }
        }
        if (item.history) progress.verifiedHistory++;
        else {
          if (entry.targets.length) {
            const row = {
                noteId: item.noteId,
                noteRevision: item.revision,
                targets: structuredClone(entry.targets),
              },
              units = JSON.stringify(row).length * 3;
            if (active.rowUnits + units > NOTE_LINK_LIMITS.workBytes)
              throw new NoteLinkError("note_link_limit");
            charge(work, units, 0);
            active.rowUnits += units;
            rows.push(row);
          }
          progress.verifiedNotes++;
          active.documentDigests.push([
            item.noteId,
            item.revision,
            entry.digest,
          ]);
          active.snippets.push([item.noteId, entry.snippet]);
        }
        active.cursor++;
        progress.utf8Units = work.utf8Units;
        progress.nodeVisits = work.nodeVisits;
        if (
          work.nodeVisits - lastYieldNodes >= NOTE_LINK_LIMITS.yieldNodes ||
          performance.now() - lastYieldAt >= 8
        ) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          lastYieldNodes = work.nodeVisits;
          lastYieldAt = performance.now();
        }
        guard(captured);
        if (job !== currentJob) throw new NoteLinkError("note_link_revoked");
      }
      for (const key of cache.keys())
        if (!seen.has(key)) {
          cacheUnits -= cache.get(key)!.units;
          cache.delete(key);
        }
      const latest = await read(captured);
      if (job !== currentJob) throw new NoteLinkError("note_link_revoked");
      if (!sameOwnerState(state, latest))
        throw new NoteLinkConflictError(linkToken(latest));
      const total = rows.reduce(
        (n, row) =>
          n + row.targets.reduce((n, entry) => n + entry.occurrences, 0),
        0,
      );
      if (total > NOTE_LINK_LIMITS.totalReferences)
        throw new NoteLinkError("note_link_limit");
      const certificate = {
        snapshot: state,
        rows: structuredClone(rows),
        documentDigests: active.documentDigests,
        snippets: active.snippets,
      };
      round = null;
      if (state.rawVersion !== 3) {
        await owner.authorizeLegacy(certificate, () => {
          guard(captured);
          if (job !== currentJob) throw new NoteLinkError("note_link_revoked");
        });
        guard(captured);
        if (job !== currentJob) throw new NoteLinkError("note_link_revoked");
        verified = certificate;
      } else {
        // Keep complete document proof for repair even if the stored cache is
        // malformed; it is never published as a ready graph before repair.
        verified = certificate;
        if (state.index.status === "invalid")
          return { status: "invalid", code: "index-invalid" };
        const indexed = new Map(
          state.index.rows.map((row) => [row.noteId, row]),
        );
        if (
          indexed.size !== rows.length ||
          rows.some(
            (row) =>
              !sameTargets(row.targets, indexed.get(row.noteId)?.targets ?? []),
          )
        ) {
          mismatch = state;
          owner.mismatch(state);
          return { status: "invalid", code: "index-mismatch" };
        }
      }
      emit();
      return { status: "ready", token: linkToken(state) };
    } catch (error) {
      if (
        error instanceof NoteLinkError &&
        error.code === "note_link_verification_limit"
      ) {
        paused = true;
        progress.utf8Units = work.utf8Units;
        progress.nodeVisits = work.nodeVisits;
        emit();
        return nonready(state);
      }
      throw error;
    }
  }
  async function graph() {
    const state = await read();
    if (
      verified &&
      sameOwnerState(verified.snapshot, state) &&
      state.index.status !== "invalid" &&
      !state.knownMismatch &&
      !mismatch
    )
      return { state, certificate: verified };
    return { state, certificate: null };
  }
  const service: NoteLinkService = {
    async admission() {
      const state = await read();
      if (state.rawVersion !== 3)
        return {
          mode: "legacy",
          rawVersion: state.rawVersion,
          token: linkToken(state),
          premise:
            verified && sameOwnerState(verified.snapshot, state)
              ? "verified"
              : paused
                ? "paused-limit"
                : "pending",
        };
      const status = nonready(state);
      if (status.status === "invalid")
        return {
          mode: "index-recovery",
          token: linkToken(state),
          reason:
            status.code === "index-mismatch"
              ? "index-mismatch"
              : "index-invalid",
        };
      return {
        mode: "current",
        token: linkToken(state),
        graph:
          verified && sameOwnerState(verified.snapshot, state)
            ? "ready"
            : paused
              ? "paused-limit"
              : "pending",
      };
    },
    async currentToken() {
      return linkToken(await read());
    },
    async search(query, sourceId, cursor) {
      if (
        typeof query !== "string" ||
        query.length > 200 ||
        (sourceId !== undefined && typeof sourceId !== "string")
      )
        throw new NoteLinkError("note_link_invalid");
      const captured = generation,
        state = await read(captured),
        token = linkToken(state),
        prior = cursor ? cursors.get(cursor) : null;
      if (
        cursor &&
        (!prior ||
          prior.query !== query ||
          prior.sourceId !== sourceId ||
          !sameLinkToken(prior.token, token))
      )
        throw new NoteLinkConflictError(token);
      if (
        state.notes.reduce((n, note) => n + note.title.length, 0) >
        NOTE_LINK_LIMITS.searchUnits
      )
        throw new NoteLinkError("note_link_limit");
      const matches = state.notes.filter(
          (note) =>
            note.trashedAt === null &&
            note.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        ),
        offset = prior?.offset ?? 0;
      const items = matches.slice(offset, offset + 50).map((note) => ({
        target: target(state, note.id),
        title: note.title,
        noteRevision: note.revision,
        updatedAt: note.updatedAt,
        thisNote: note.id === sourceId,
      }));
      let next: LinkSearchCursor | null = null;
      if (offset + items.length < matches.length) {
        next = Object.freeze({}) as LinkSearchCursor;
        cursors.set(next, {
          query,
          sourceId,
          token,
          offset: offset + items.length,
        });
      }
      return { token, items, next };
    },
    async reference(noteId) {
      if (typeof noteId !== "string")
        throw new NoteLinkError("note_link_invalid");
      const state = await read();
      if (
        state.rawVersion !== 3 &&
        !(verified && sameOwnerState(verified.snapshot, state))
      )
        throw new NoteLinkError("note_link_migration_pending");
      if (state.index.status === "invalid" || state.knownMismatch || mismatch)
        throw new NoteLinkError("note_link_index_invalid");
      const ref = target(state, noteId);
      if (resolveIn(state, ref).status !== "available")
        throw new NoteLinkError("note_link_unavailable");
      return { token: linkToken(state), target: ref };
    },
    async resolve(input) {
      const ref = validateNoteTarget(input);
      if (closed || openedLock !== lockVersion())
        return { status: "unavailable", reason: "locked" };
      return resolveIn(await read(), ref);
    },
    async outgoing(noteId) {
      if (typeof noteId !== "string")
        throw new NoteLinkError("note_link_invalid");
      const captured = generation,
        state = await read(captured);
      if (state.rawVersion !== 3) {
        const result = await graph();
        if (!result.certificate) return nonready(state);
        return { status: "ready", token: linkToken(state), items: [] };
      }
      if (state.index.status === "invalid" || state.knownMismatch || mismatch)
        return nonready(state);
      const note = state.notes.find((note) => note.id === noteId);
      if (!note || note.trashedAt !== null)
        return { status: "ready", token: linkToken(state), items: [] };
      const work = { utf8Units: 0, nodeVisits: 0 };
      const doc = inspectLinkDocument(note.document, "notes", work),
        targets = await scanLinkDocumentAsync(doc, work, () => guard(captured));
      const latest = await read(captured);
      if (!sameOwnerState(state, latest))
        throw new NoteLinkConflictError(linkToken(latest));
      const indexed = state.index.rows.find((row) => row.noteId === noteId);
      if (!sameTargets(targets, indexed?.targets ?? [])) {
        mismatch = state;
        owner.mismatch(state);
        return { status: "invalid", code: "index-mismatch" };
      }
      const byId = new Map(state.notes.map((note) => [note.id, note]));
      return {
        status: "ready",
        token: linkToken(state),
        items: targets.map((entry) => ({
          ...entry,
          resolution: resolveIn(state, entry.target, byId),
        })),
      };
    },
    async backlinks(noteId) {
      if (typeof noteId !== "string")
        throw new NoteLinkError("note_link_invalid");
      const { state, certificate } = await graph();
      if (!certificate) return nonready(state);
      const notesById = new Map(state.notes.map((note) => [note.id, note])),
        snippets = new Map(certificate.snippets);
      return {
        status: "ready",
        token: linkToken(state),
        items: certificate.rows.flatMap((row) => {
          const source = notesById.get(row.noteId);
          if (!source || source.trashedAt !== null) return [];
          const entry = row.targets.find(
            (entry) =>
              entry.target.accountId === state.accountId &&
              entry.target.libraryEpoch === state.library.epoch &&
              entry.target.noteId === noteId,
          );
          return entry
            ? [
                {
                  sourceId: source.id,
                  sourceRevision: source.revision,
                  title: source.title,
                  occurrences: entry.occurrences,
                  snippet: snippets.get(source.id) ?? "",
                },
              ]
            : [];
        }),
      };
    },
    async linkedNoteIds() {
      const { state, certificate } = await graph();
      if (!certificate) return nonready(state);
      const active = new Set(
          state.notes
            .filter((note) => note.trashedAt === null)
            .map((note) => note.id),
        ),
        linked = new Set<string>();
      for (const row of certificate.rows) {
        if (!active.has(row.noteId)) continue;
        linked.add(row.noteId);
        for (const entry of row.targets)
          if (
            entry.target.accountId === state.accountId &&
            entry.target.libraryEpoch === state.library.epoch &&
            active.has(entry.target.noteId)
          )
            linked.add(entry.target.noteId);
      }
      return { status: "ready", token: linkToken(state), items: [...linked] };
    },
    verifyGraph: verify,
    cancelVerification() {
      job++;
      paused = true;
      emit();
    },
    async prepareRepair(expected) {
      if (
        !expected ||
        typeof expected !== "object" ||
        Object.keys(expected).length !== 2 ||
        !Object.hasOwn(expected, "epoch") ||
        !Object.hasOwn(expected, "revision") ||
        typeof expected.epoch !== "string" ||
        !Number.isSafeInteger(expected.revision) ||
        expected.revision < 0
      )
        throw new NoteLinkError("note_link_invalid");
      const stable = { epoch: expected.epoch, revision: expected.revision },
        captured = generation,
        state = await read(captured);
      if (!sameLinkToken(stable, linkToken(state)))
        throw new NoteLinkConflictError(linkToken(state));
      if (state.rawVersion !== 3)
        throw new NoteLinkError("note_link_migration_pending");
      if (!verified || !sameOwnerState(verified.snapshot, state))
        throw new NoteLinkError("note_link_verification_limit");
      const certificate = structuredClone(verified),
        operationId = crypto.randomUUID();
      const rowJSON = JSON.stringify(certificate.rows),
        digestsJSON = JSON.stringify(certificate.documentDigests);
      if (
        (rowJSON.length + state.rawIndex.length + digestsJSON.length) * 3 >
        NOTE_LINK_LIMITS.workBytes
      )
        throw new NoteLinkError("note_link_verification_limit");
      const indexDigest = await hashDocument(rowJSON, captured),
        rawIndexDigest = await hashDocument(state.rawIndex, captured),
        documentsDigest = await hashDocument(digestsJSON, captured);
      const latest = await read(captured);
      if (!sameOwnerState(state, latest))
        throw new NoteLinkConflictError(linkToken(latest));
      const args = JSON.stringify({
        revision: state.library.revision,
        rawIndexDigest,
        documentsDigest,
        indexDigest,
      });
      const intent = Object.freeze({ operationId }) as LinkRepairIntent;
      repairs.set(intent, {
        command: { operationId, arguments: args, indexDigest, certificate },
        generation: captured,
      });
      return intent;
    },
    async commitRepair(intent) {
      guard();
      const prepared = repairs.get(intent);
      if (!prepared) throw new NoteLinkError("note_link_revoked");
      const fresh = () => guard(prepared.generation);
      const result = await owner.repair(prepared.command, fresh);
      fresh();
      verified = null;
      mismatch = null;
      emit();
      return {
        operationId: prepared.command.operationId,
        indexDigest: prepared.command.indexDigest,
        ...result,
      };
    },
    async prepareExport(noteIds) {
      guard();
      if (
        !Array.isArray(noteIds) ||
        noteIds.length > 10000 ||
        noteIds.some((id) => typeof id !== "string")
      )
        throw new NoteLinkError("note_link_invalid");
      const captured = generation,
        ids = [...new Set(noteIds)],
        state = await read(captured),
        intent = Object.freeze({}) as NoteExportIntent;
      exports.set(intent, { state, ids, generation: captured });
      return intent;
    },
    async exportFiles(intent) {
      guard();
      const held = exports.get(intent);
      if (!held) throw new NoteLinkError("note_link_revoked");
      const captured = held.generation,
        state = await read(captured);
      if (!sameOwnerState(held.state, state))
        throw new NoteLinkConflictError(linkToken(state));
      const byId = new Map(state.notes.map((note) => [note.id, note])),
        selected: Note[] = [],
        references = new Map<
          string,
          { target: NoteTarget; resolution: NoteLinkResolution }
        >(),
        work = { utf8Units: 0, nodeVisits: 0 };
      for (const id of held.ids) {
        const note = byId.get(id);
        if (!note) throw new NoteLinkError("note_link_unavailable");
        const doc = inspectLinkDocument(
          note.document,
          state.rawVersion === 3 ? "notes" : "plain",
          work,
        );
        const targets = await scanLinkDocumentAsync(doc, work, () =>
          guard(captured),
        );
        selected.push(note);
        for (const row of targets)
          references.set(targetKey(row.target), {
            target: row.target,
            resolution: resolveIn(state, row.target, byId),
          });
        if (references.size > NOTE_LINK_LIMITS.totalReferences)
          throw new NoteLinkError("note_link_limit");
      }
      const projection = {
        accountId: state.accountId,
        token: linkToken(state),
        references: [...references.values()],
        consumedWork: { ...work },
      };
      const rendered = renderNoteExport(selected, projection);
      guard(captured);
      const latest = await read(captured);
      if (!sameOwnerState(state, latest))
        throw new NoteLinkConflictError(linkToken(latest));
      const result = Object.freeze({
        token: Object.freeze(linkToken(state)),
        files: Object.freeze(rendered.files.map((file) => Object.freeze(file))),
        warnings: Object.freeze(rendered.warnings.slice()),
      });
      exportResults.set(result, { state, generation: captured });
      return result;
    },
    async assertFreshExport(result) {
      guard();
      const held = exportResults.get(result);
      if (!held) throw new NoteLinkError("note_link_revoked");
      const state = await read(held.generation);
      if (!sameOwnerState(held.state, state))
        throw new NoteLinkConflictError(linkToken(state));
    },
    subscribe(listener) {
      guard();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onInvalidate(listener) {
      guard();
      invalidations.add(listener);
      return () => invalidations.delete(listener);
    },
    close,
  };
  return service;
}
