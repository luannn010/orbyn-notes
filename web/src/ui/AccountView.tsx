import { useState } from "react";
import type { AccountService, AccountSession } from "../domain/contracts";
import { message } from "./model";
import { isDesktop } from "../desktop/window";
import { storageCopy } from "./storageCopy";
export function AccountView({
  service,
  onSession,
  onUseWithoutAccount,
}: {
  service: AccountService;
  onSession: (session: AccountSession) => void;
  onUseWithoutAccount?: () => void;
}) {
  const [step, setStep] = useState<
    "entry" | "invite" | "register" | "verify" | "signin" | "second"
  >("entry");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [code, setCode] = useState("");
  const [signupId, setSignupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState(false);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (step === "invite") {
        await service.checkInvite(invite);
        setStep("register");
      } else if (step === "register") {
        const result = await service.register({ invite, email, password });
        setSignupId(result.signupId);
        setPassword("");
        setStep("verify");
      } else if (step === "verify") {
        onSession(await service.verifyEmail({ signupId, code }));
      } else if (step === "second") {
        onSession(
          await service.completeSecondFactor(
            recovery ? { recoveryCode: code } : { code },
          ),
        );
      } else {
        onSession(await service.signIn({ email, password }));
        setPassword("");
      }
    } catch (e) {
      if (
        typeof e === "object" &&
        e &&
        "code" in e &&
        e.code === "second_factor_required"
      ) {
        setStep("second");
        setCode("");
      } else {
        const errorCode =
          typeof e === "object" && e && "code" in e ? String(e.code) : "";
        setError(
          errorCode.startsWith("invite_")
            ? "This invite code didn’t work. Check it and try again."
            : errorCode === "too_many_attempts"
              ? "Too many tries. Try again later."
              : step === "invite" && errorCode === "network_error"
                ? "Couldn’t check the code. Nothing was changed."
                : message(e),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <section className="account-card">
        <div className="wordmark">
          Orbyn{" "}
          <span>
            Notes <small>Beta</small>
          </span>
        </div>
        <h1>
          {step === "verify"
            ? "Check your email"
            : step === "second"
              ? "Verify your sign-in"
              : step === "invite"
                ? "Enter your invite code"
                : step === "register"
                  ? "Create an account"
                  : step === "signin"
                    ? "Welcome back"
                    : "Orbyn Notes"}
        </h1>
        <p>
          {step === "entry"
            ? storageCopy(isDesktop()).entry
            : step === "verify"
              ? `Enter the 8-character code sent to ${email}.`
              : step === "invite"
                ? "New accounts need an invite code."
                : step === "second"
                  ? "Enter your authenticator code."
                  : storageCopy(isDesktop()).account}
        </p>
        {step === "entry" ? (
          <div className="stack">
            <button className="primary" onClick={() => setStep("signin")}>
              Sign in
            </button>
            <button onClick={() => setStep("invite")}>Create an account</button>
            <small>New accounts need an invite code.</small>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="stack">
              {step === "invite" ? (
                <label>
                  Invite code
                  <input
                    autoFocus
                    autoComplete="off"
                    value={invite}
                    onChange={(e) =>
                      setInvite(
                        e.target.value
                          .replace(/[^a-z0-9]/gi, "")
                          .slice(0, 16)
                          .toUpperCase()
                          .match(/.{1,4}/g)
                          ?.join("-") ?? "",
                      )
                    }
                  />
                </label>
              ) : null}
              {(step === "signin" || step === "register") && (
                <>
                  <label>
                    Email
                    <input
                      autoFocus
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete={
                        step === "register"
                          ? "new-password"
                          : "current-password"
                      }
                      required
                      minLength={step === "register" ? 12 : 1}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                </>
              )}
              {(step === "verify" || step === "second") && (
                <label>
                  {step === "second" && recovery
                    ? "Recovery code"
                    : "Verification code"}
                  <input
                    autoFocus
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              )}
              {step === "second" && (
                <button
                  type="button"
                  onClick={() => {
                    setRecovery(!recovery);
                    setCode("");
                  }}
                >
                  {recovery ? "Use authenticator code" : "Use recovery code"}
                </button>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              {notice && <p role="status">{notice}</p>}
              <button
                className="primary"
                disabled={
                  busy ||
                  (step === "invite" &&
                    invite.replaceAll("-", "").length !== 16)
                }
              >
                {busy
                  ? "Please wait…"
                  : step === "signin"
                    ? "Sign in"
                    : step === "register"
                      ? "Create account"
                      : "Continue"}
              </button>
              {step === "verify" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await service.resendEmail(signupId);
                      setNotice("A new code was sent.");
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Resend code
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setStep("entry");
                  setError("");
                }}
              >
                Back
              </button>
            </div>
          </form>
        )}
        {onUseWithoutAccount && (step === "entry" || step === "signin") && (
          <button type="button" disabled={busy} onClick={onUseWithoutAccount}>Use without an account</button>
        )}
        <p className="local-copy">
          {storageCopy(isDesktop()).warning}
        </p>
      </section>
    </main>
  );
}
export function PendingDevice({
  service,
  onSession,
  onSignOut,
}: {
  service: AccountService;
  onSession: (s: AccountSession) => void;
  onSignOut: () => void;
}) {
  const [sas, setSas] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="account-page">
      <section className="account-card">
        <h1>{storageCopy(isDesktop()).approvalHeading}</h1>
        <p>{storageCopy(isDesktop()).approvalHelp}</p>
        {sas && <p className="sas">{sas}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="stack">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const p = await service.pendingDevice();
                if (p.status === "compare") setSas(p.sas ?? "");
                if (p.status === "trusted")
                  onSession(await service.confirmDevice());
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Check approval
          </button>
          {sas && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  onSession(await service.confirmDevice(sas));
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              The digits match
            </button>
          )}
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </section>
    </main>
  );
}
