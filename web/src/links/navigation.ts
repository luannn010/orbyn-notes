import type { NoteTarget } from "./contracts";

/** Outcome of one guarded Workspace admission, never an authorization grant. */
export type NoteLinkNavigationResult =
  { status: "opened" } | { status: "blocked" } | { status: "unavailable" };

export type NoteLinkNavigator = (
  target: NoteTarget,
  signal?: AbortSignal,
) => Promise<NoteLinkNavigationResult>;

/** Register the current account's one navigation path; null revokes it. */
export type NoteLinkNavigatorRegistration = (
  navigator: NoteLinkNavigator | null,
) => void;

export type NoteLinkCopyValue = Readonly<{
  text: string;
  kind: "web-link" | "native-link" | "local-reference";
}>;
/** Formatting only; the UI obtains an authorized reference before calling it. */
export type NoteLinkCopyFormatter = (target: NoteTarget) => NoteLinkCopyValue;
