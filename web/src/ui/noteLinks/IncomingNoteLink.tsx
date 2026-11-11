import "../../styles/incoming-note-link.css";

export type IncomingNoteLinkState =
  "opening" | "blocked" | "unavailable" | "invalid" | "service-error";
export type IncomingNoteLinkProps = {
  state: IncomingNoteLinkState;
  onRetry: () => void;
  onDismiss: () => void;
};

/** Presentation only. The parent owns the bounded identity intent and guarded
 * navigator. Retrying must synchronously admit an opening state in that owner;
 * this component never resolves a target or retries after a state change.
 * Opening has no Dismiss action: hiding a notice cannot cancel an already
 * admitted Workspace navigation through the current navigator contract. */
export function IncomingNoteLink({
  state,
  onRetry,
  onDismiss,
}: IncomingNoteLinkProps) {
  const message = {
    opening: "Opening note…",
    blocked: "Finish your current work before opening this note.",
    unavailable: "This note isn’t available in this workspace.",
    invalid: "This note link isn’t valid.",
    "service-error":
      "Note links couldn’t connect. Reconnect, then open the link again.",
  }[state];
  return (
    <section
      className="incoming-note-link"
      aria-label="Incoming note link"
      role={
        state === "invalid" || state === "service-error" ? "alert" : "status"
      }
      aria-atomic="true"
    >
      <p>{message}</p>
      {state !== "opening" && (
        <div className="incoming-note-link-actions">
          {(state === "blocked" ||
            state === "unavailable" ||
            state === "service-error") && (
            <button type="button" className="primary" onClick={onRetry}>
              {state === "service-error" ? "Reconnect" : "Try again"}
            </button>
          )}
          <button type="button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
