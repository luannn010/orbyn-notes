import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createAccountService, subscribeLock } from "./account";
import type { AccountService, AccountSession } from "./domain/contracts";
import { AccountError } from "./domain/contracts";
import type { NotesLibraryStore } from "./library/contracts";
import { AccountView, PendingDevice } from "./ui/AccountView";
import { usePreferences } from "./ui/primitives";
import { DesktopShell } from "./desktop/DesktopShell";
import { isDesktop } from "./desktop/window";
import { storageCopy } from "./ui/storageCopy";
import { protectOperations } from "./desktop/closeGuard";
import { useIncomingNoteLink } from "./links/useIncomingNoteLink";
import { IncomingNoteLink } from "./ui/noteLinks/IncomingNoteLink";
import { localModeSelected, openLocalSession, selectLocalMode } from "./data/local";
import { lock } from "./account/session";
import { isQuickWindow, requireQuickClosed, setCaptureScope } from "./desktop/capture";
const QuickNoteWindow = lazy(() => import("./ui/QuickNoteWindow").then(module => ({ default: module.QuickNoteWindow })));
const QuickNoteLocked = lazy(() => import("./ui/QuickNoteWindow").then(module => ({ default: module.QuickNoteLocked })));
const Workspace = lazy(() =>
  import("./ui/Workspace").then((module) => ({ default: module.Workspace })),
);
const SampleWorkspace = lazy(() => import("./demo/SampleWorkspace"));
export function App() {
  const [sample, setSample] = useState(false);
  if (isQuickWindow()) return <Suspense fallback={<Loading />}><AppContent quick /></Suspense>;
  return (
    <DesktopShell>
      {sample ? (
        <Suspense fallback={<Loading />}><SampleWorkspace onExit={() => setSample(false)} /></Suspense>
      ) : <AppContent onUseWithoutAccount={() => setSample(true)} />}
    </DesktopShell>
  );
}
function AppContent({ quick = false, onUseWithoutAccount }: { quick?: boolean; onUseWithoutAccount?: () => void }) {
  usePreferences();
  const [service, setService] = useState<AccountService | null>(null);
  const [session, setSession] = useState<AccountSession | null>(null);
  const [store, setStore] = useState<NotesLibraryStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [local, setLocal] = useState(localModeSelected);
  const incoming = useIncomingNoteLink(quick ? null : store, isDesktop() && !quick);
  const activeSession = useRef(session);
  activeSession.current = session;
  useEffect(
    () =>
      subscribeLock(() => {
        // Initial account establishment also announces a lock. Preserve an
        // initial URL intent until the first session; revoke an active one.
        if (activeSession.current) incoming.revoke();
        setSession(null);
        setStore(null);
        setError("");
      }),
    [incoming.revoke],
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    try {
      const original = local ? null : createAccountService();
      const account = original && isDesktop()
        ? protectOperations(original, Object.keys(original))
        : original;
      setService(account);
      void (local ? openLocalSession(() => active) : account!.current())
        .then((s) => {
          if (active) {
            setSession(s);
          }
        })
        .catch((failure) => {
          if (!active) return;
          if (
            !local &&
            failure instanceof AccountError &&
            failure.code === "local_access_invalid"
          ) {
            setSession(null);
            return;
          }
          setError(
            "The account or encryption service isn’t available. Your saved notes were not changed.",
          );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } catch {
      setError(
        "The account or encryption service isn’t available. Your saved notes were not changed.",
      );
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [attempt, local]);
  useEffect(() => {
    if (!session || session.deviceState === "pending") return;
    let active = true;
    let opened: NotesLibraryStore | undefined;
    setLoading(true);
    void import("./data")
      .then((module) => module.openNotesStore(session))
      .then((s) => {
        opened = s;
        if (active)
          setStore(
            isDesktop()
              ? protectOperations(s, [
                  "create",
                  "update",
                  "trash",
                  "restore",
                  "erase",
                ])
              : s,
          );
        else s.close();
      })
      .catch(() => {
        if (active)
          setError(
            storageCopy(isDesktop()).openingError,
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      opened?.close();
      setStore(null);
    };
  }, [session, attempt]);
  useEffect(() => {
    if (!isDesktop()) return;
    void setCaptureScope(session?.accountId ?? null, session?.deviceId ?? null).catch(() => {});
    return () => { void setCaptureScope(null, null).catch(() => {}); };
  }, [session?.accountId, session?.deviceId]);
  async function signOut(propagateFailure = false) {
    let releaseOwner = async () => {};
    try {
      if (isDesktop() && !quick) releaseOwner = await requireQuickClosed();
      if (local) {
        selectLocalMode(false);
        setLocal(false);
        lock();
      } else await service?.signOut();
      incoming.revoke();
      store?.close();
      setStore(null);
      setSession(null);
      setError("");
    } catch (error) {
      if (propagateFailure) throw error;
      setError("Couldn’t sign out. Try again.");
    } finally {
      await releaseOwner().catch(() => setActionError("Quick note is paused because workspace coordination failed. Reopen Notes before trying it again."));
    }
  }
  async function useLocal() {
    let releaseOwner = async () => {};
    if (isDesktop() && !quick) { try { releaseOwner = await requireQuickClosed(); } catch (error) { setActionError(String(error)); return; } }
    try {
    setActionError("");
    incoming.revoke();
    store?.close();
    setStore(null);
    setSession(null);
    setError("");
    selectLocalMode(true);
    setLocal(true);
    setAttempt((value) => value + 1);
    } catch (error) { setActionError(String(error)); } finally {
      await releaseOwner().catch(() => setActionError("Quick note is paused because workspace coordination failed. Reopen Notes before trying it again."));
    }
  }
  const incomingNotice = incoming.state ? (
    <IncomingNoteLink
      state={incoming.state}
      onRetry={incoming.retry}
      onDismiss={incoming.dismiss}
    />
  ) : null;
  // Generic syntax/transport notices are safe before authentication. Do not
  // project a target, title or navigation outcome into account entry.
  const publicNotice =
    incoming.state === "invalid" || incoming.state === "service-error"
      ? incomingNotice
      : null;
  if (loading)
    return (
      <>
        {publicNotice}
        <Loading />
      </>
    );
  if (quick && (!session || error)) return <QuickNoteLocked />;
  if (error)
    return (
      <>
        {publicNotice}
        <main className="account-page">
          <section className="account-card">
            <h1>Notes can’t open yet</h1>
            <p role="alert">{error}</p>
            <button
              className="primary"
              onClick={() => setAttempt((v) => v + 1)}
            >
              Try again
            </button>

            {session && (
              <button onClick={() => void signOut()}>Sign out</button>
            )}
            {!local && <button onClick={isDesktop() ? useLocal : onUseWithoutAccount}>Use without an account</button>}
          </section>
        </main>
      </>
    );
  if (!session && local) return (
    <main className="account-page"><section className="account-card">
      <h1>Local workspace is closed</h1>
      <p>Your saved local notes are still on this device.</p>
      <button className="primary" onClick={useLocal}>Open local workspace</button>
      <button onClick={() => { selectLocalMode(false); setLocal(false); }}>Back</button>
    </section></main>
  );
  if (!session)
    return (
      <>
        {publicNotice}
        {service && <AccountView service={service} onSession={setSession} onUseLocal={isDesktop() ? useLocal : undefined} onUseWithoutAccount={onUseWithoutAccount} />}
      </>
    );
  if (session.deviceState === "pending" && service)
    return (
      <>
        {publicNotice}
        <PendingDevice
          service={service}
          onSession={setSession}
          onSignOut={() => void signOut()}
        />
      </>
    );
  if (!store) return publicNotice;
  if (quick) return <QuickNoteWindow key={session.accountId} store={store} />;
  return (
    <div className="notes-entry-layout">
      {incomingNotice}
      {actionError && <p role="alert" className="banner">{actionError}</p>}
      <Suspense fallback={<Loading />}>
        <Workspace
          key={session.accountId}
          store={store}
          library={store.library}
          sourceOwner={store}
          onNoteLinkNavigatorReady={incoming.register}
          onNoteLinkScopeRevoked={incoming.revoke}
          incomingNoteIntentActive={incoming.hasPending || incoming.state !== null}
          formatNoteLink={incoming.format}
          session={session}
          onSignOut={() => signOut(true)}
          onUseLocal={useLocal}
        />
      </Suspense>
    </div>
  );
}
function Loading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="loading" aria-label="Opening Notes" aria-busy="true">
      {show && <div className="skeleton" />}
    </main>
  );
}
