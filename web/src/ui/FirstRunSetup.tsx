import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Dialog } from "./primitives";
import "../styles/setup.css";
export type SetupImportState =
  | "idle"
  | "picking"
  | "reading"
  | "review"
  | "running"
  | "failed"
  | "completed";
export function FirstRunSetup({
  email,
  environment,
  readOnly = false,
  importState,
  importedCount = 0,
  remainingCount = 0,
  importMessage = "",
  onChooseMarkdown,
  onComplete,
  onClose,
}: {
  email: string;
  environment: "desktop" | "browser";
  readOnly?: boolean;
  importState: SetupImportState;
  importedCount?: number;
  remainingCount?: number;
  importMessage?: string;
  onChooseMarkdown: () => void;
  onComplete: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"import" | "sync">("import");
  const busy =
    ["picking", "reading", "review", "running"].includes(importState) ||
    remainingCount > 0;
  useEffect(() => {
    if (importState === "completed") setStep("sync");
  }, [importState]);
  return (
    <Dialog
      title="Set up Orbyn Notes"
      className="first-run-setup"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <span className="setup-step">Step {step === "import" ? 2 : 3} of 3</span>
      <p className="setup-intro">
        Every step is optional. You can come back to each one in Settings.
      </p>
      <div className="setup-progress" aria-hidden="true">
        <i style={{ width: step === "import" ? "55%" : "100%" }} />
      </div>
      <div className="setup-choice">
        <Check size={18} aria-hidden="true" />
        <div>
          <b>Signed in as {email}</b>
          <small>Your Orbyn account</small>
        </div>
        <span className="setup-status">Done</span>
      </div>
      <div className={`setup-choice ${step === "import" ? "current" : ""}`}>
        <span className="setup-number">2</span>
        <div>
          <b>Bring in your notes</b>
          <small>
            Import Markdown files. Your originals stay where they are.
          </small>
          <small>Apple Notes import isn’t available in this beta.</small>
          {readOnly && (
            <small>Import is unavailable while Notes is read-only.</small>
          )}
          {importedCount > 0 && (
            <small>
              {importedCount}{" "}
              {importedCount === 1 ? "note imported" : "notes imported"}.
            </small>
          )}
          {importState === "picking" && (
            <small role="status">Choose Markdown files.</small>
          )}
          {importState === "reading" && (
            <small role="status">Reading Markdown files…</small>
          )}
          {importState === "running" && (
            <small role="status">Importing notes…</small>
          )}
          {importState === "failed" && (
            <small role="alert">
              {importMessage ||
                "Import didn’t finish. Review the remaining files."}
            </small>
          )}
        </div>
        {step === "import" ? (
          <div className="setup-actions">
            <button disabled={busy} onClick={() => setStep("sync")}>
              Skip
            </button>
            <button
              className="primary"
              autoFocus
              disabled={busy || readOnly}
              onClick={onChooseMarkdown}
            >
              Import notes
            </button>
          </div>
        ) : (
          <span className="setup-status">
            {importState === "completed" ? "Done" : "Skipped"}
          </span>
        )}
      </div>
      <div className={`setup-choice ${step === "sync" ? "current" : ""}`}>
        <span className="setup-number">3</span>
        <div>
          <b>Sync your devices</b>
          <small>
            Sync isn’t available in this beta. Your notes stay{" "}
            {environment === "desktop"
              ? "in this app on this device"
              : "in this browser profile"}
            .
          </small>
        </div>
        <span className="setup-status">Planned</span>
        {step === "sync" && (
          <button disabled={busy} onClick={onComplete}>
            Skip
          </button>
        )}
      </div>
      <div className="setup-footer">
        <button disabled={busy} onClick={onClose}>
          Close setup
        </button>
      </div>
    </Dialog>
  );
}
