import type { Note } from "../domain/contracts";
import type { LibraryCommonState } from "../library/contracts";
import type { LinkToken, NoteLinksRow } from "./contracts";

export type LinkOwnerSnapshot = {
  accountId: string;
  generation: number;
  rawVersion: 1 | 2 | 3;
  notes: Note[];
  library: LibraryCommonState;
  index: { status: "valid"; rows: NoteLinksRow[] } | { status: "invalid" };
  rawIndex: string;
  recordIdentity: Readonly<{ core: string; library: string }>;
  knownMismatch: boolean;
};
export type LinkCertificate = {
  snapshot: LinkOwnerSnapshot;
  rows: NoteLinksRow[];
  documentDigests: [string, number, string][];
  snippets: [string, string][];
};
export type LinkRepairCommand = {
  operationId: string;
  arguments: string;
  indexDigest: string;
  certificate: LinkCertificate;
};
export interface LinkOwnerAccess {
  read(): Promise<LinkOwnerSnapshot>;
  authorizeLegacy(
    certificate: LinkCertificate,
    fresh: () => void,
  ): Promise<void>;
  mismatch(snapshot: LinkOwnerSnapshot): void;
  repair(
    command: LinkRepairCommand,
    fresh: () => void,
  ): Promise<{ committedToken: LinkToken; replayed: boolean }>;
}
export const linkToken = (state: LinkOwnerSnapshot): LinkToken => ({
  epoch: state.library.epoch,
  revision: state.library.revision,
});
export function sameLinkToken(a: LinkToken, b: LinkToken): boolean {
  return a.epoch === b.epoch && a.revision === b.revision;
}
export function sameOwnerState(
  a: LinkOwnerSnapshot,
  b: LinkOwnerSnapshot,
): boolean {
  return (
    a.accountId === b.accountId &&
    a.generation === b.generation &&
    a.rawVersion === b.rawVersion &&
    sameLinkToken(linkToken(a), linkToken(b)) &&
    a.rawIndex === b.rawIndex &&
    a.recordIdentity.core === b.recordIdentity.core &&
    a.recordIdentity.library === b.recordIdentity.library
  );
}
