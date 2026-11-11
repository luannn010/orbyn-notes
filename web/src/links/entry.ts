import type { NoteTarget } from "./contracts";
import type { NoteLinkCopyValue, NoteLinkNavigator } from "./navigation";
import {
  decodeNoteReference,
  encodeNoteReference,
  NOTE_REFERENCE_LIMITS,
} from "./reference";

const HASH_PREFIX = "#note/v1/";
const URI_PREFIX = "orbyn-notes://note/v1/";
export type IncomingNoteLinkState =
  "opening" | "blocked" | "unavailable" | "invalid" | null;
export type ParsedNoteLinkHash =
  | { kind: "target"; target: NoteTarget }
  | { kind: "invalid" }
  | { kind: "unrelated" };

/** Parse the raw fragment. URI normalization/percent decoding is deliberately absent. */
export function parseNoteLinkHash(hash: string): ParsedNoteLinkHash {
  if (hash !== "#note" && !hash.startsWith("#note/"))
    return { kind: "unrelated" };
  if (!hash.startsWith(HASH_PREFIX) || hash.length > NOTE_REFERENCE_LIMITS.uri)
    return { kind: "invalid" };
  try {
    return {
      kind: "target",
      target: decodeNoteReference(URI_PREFIX + hash.slice(HASH_PREFIX.length)),
    };
  } catch {
    return { kind: "invalid" };
  }
}

/** Formatting only. Callers must obtain the current authorized reference first. */
export function formatWebNoteLink(
  target: NoteTarget,
  pageUrl: string,
): NoteLinkCopyValue {
  if (pageUrl.length > 16384) throw new Error("The app address is too long.");
  const base = new URL(pageUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:")
    throw new Error("Web links require an HTTP app address.");
  base.username = "";
  base.password = "";
  base.search = "";
  base.hash = "";
  const reference = encodeNoteReference(target);
  base.hash = HASH_PREFIX.slice(1) + reference.slice(URI_PREFIX.length);
  return { text: base.href, kind: "web-link" };
}

/** One bounded pending intent; the registered Workspace remains the only authority. */
export class IncomingNoteLinkController {
  private owner: object | null = null;
  private navigator: NoteLinkNavigator | null = null;
  private pending: NoteTarget | null = null;
  private status: IncomingNoteLinkState = null;
  private ticket = 0;
  private attempted = false;
  private lastHash: string | null = null;
  private opening: AbortController | null = null;
  private openingStarted = false;
  private listeners = new Set<() => void>();
  constructor(private readonly onRevoke: () => void = () => {}) {}
  state = (): IncomingNoteLinkState => this.status;
  hasPending = (): boolean => this.pending !== null;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(status: IncomingNoteLinkState) {
    this.status = status;
    for (const listener of this.listeners) listener();
  }
  receive(hash: string) {
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    this.offer(parseNoteLinkHash(hash));
  }
  /** Native transport deduplicates broker sequence; a new activation may have
   * the same target. It still enters the identical guarded navigation path. */
  receiveTarget(target: NoteTarget) {
    this.lastHash = null;
    try {
      const bounded = decodeNoteReference(encodeNoteReference(target));
      this.offer({ kind: "target", target: bounded });
    } catch {
      this.offer({ kind: "invalid" });
    }
  }
  receiveInvalid() {
    this.lastHash = null;
    this.offer({ kind: "invalid" });
  }
  private offer(parsed: ParsedNoteLinkHash) {
    this.opening?.abort();
    this.ticket++;
    this.attempted = false;
    this.pending = parsed.kind === "target" ? parsed.target : null;
    this.publish(parsed.kind === "invalid" ? "invalid" : null);
    this.run();
  }
  bind(owner: object | null) {
    if (owner === this.owner) return;
    if (this.owner) this.revoke();
    this.owner = owner;
    this.navigator = null;
  }
  register(owner: object, navigator: NoteLinkNavigator | null) {
    if (owner !== this.owner) return;
    if (!navigator && this.navigator && this.status === "opening") {
      this.opening?.abort();
      this.ticket++;
      // A React mount cleanup may occur before the queued invocation starts.
      // Re-arm only an invocation that never began.
      if (!this.openingStarted) this.attempted = false;
      this.publish(this.openingStarted ? "unavailable" : null);
    }
    this.navigator = navigator;
    // A re-registration never retries a failed/blocked attempt.
    this.run();
  }
  revoke() {
    this.opening?.abort();
    this.ticket++;
    this.pending = null;
    this.navigator = null;
    this.lastHash = null;
    this.attempted = false;
    this.publish(null);
    this.onRevoke();
  }
  dismiss() {
    this.opening?.abort();
    this.ticket++;
    this.pending = null;
    this.lastHash = null;
    this.attempted = false;
    this.publish(null);
  }
  retry() {
    if (this.status !== "blocked" && this.status !== "unavailable") return;
    this.attempted = false;
    this.run();
  }
  private run() {
    if (!this.owner || !this.navigator || !this.pending || this.attempted)
      return;
    const ticket = ++this.ticket;
    const target = this.pending;
    const navigate = this.navigator;
    const opening = new AbortController();
    this.opening = opening;
    this.openingStarted = false;
    this.attempted = true;
    this.publish("opening");
    void Promise.resolve()
      .then(() => {
        // Revocation before this microtask must prevent even starting navigation.
        if (ticket !== this.ticket) return null;
        this.openingStarted = true;
        return navigate(target, opening.signal);
      })
      .then((result) => {
        if (ticket !== this.ticket || !result) return;
        if (result.status === "opened") {
          this.pending = null;
          this.publish(null);
        } else this.publish(result.status);
      })
      .catch(() => {
        if (ticket === this.ticket) this.publish("unavailable");
      });
  }
}
