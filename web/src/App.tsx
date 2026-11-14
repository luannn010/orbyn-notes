import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createAccountService, subscribeLock } from "./account";
import type { AccountService, AccountSession } from "./domain/contracts";
import type { NotesLibraryStore } from "./library/contracts";
import { AccountView, PendingDevice } from "./ui/AccountView";
import { usePreferences } from "./ui/primitives";
import { DesktopShell } from "./desktop/DesktopShell";
import { isDesktop } from "./desktop/window";
import { protectOperations } from "./desktop/closeGuard";
import { useIncomingNoteLink } from "./links/useIncomingNoteLink";
import { IncomingNoteLink } from "./ui/noteLinks/IncomingNoteLink";
const Workspace = lazy(() =>
  import("./ui/Workspace").then((module) => ({ default: module.Workspace })),
);
export function App() {
  return (
    <DesktopShell>
      <AppContent />
    </DesktopShell>
  );
}
function AppContent() {
  usePreferences();
  const [service, setService] = useState<AccountService | null>(null);
  const [session, setSession] = useState<AccountSession | null>(null);
  const [store, setStore] = useState<NotesLibraryStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const incoming = useIncomingNoteLink(store, isDesktop());
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
      const original = createAccountService();
      const account = isDesktop()
        ? protectOperations(original, Object.keys(original))
        : original;
      setService(account);
      void account
        .current()
        .then((s) => {
          if (active) {
            if (!s && !import.meta.env.VITE_ENGINE_URL)
              setError(
                "The account or encryption service isn’t available. Your saved notes were not changed.",
              );
            else setSession(s);
          }
        })
        .catch(() => {
          if (active)
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
  }, [attempt]);
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
            "Notes needs working browser storage and encryption. Nothing was opened or changed. Try another browser or allow this site to store data.",
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
  async function signOut(propagateFailure = false) {
    try {
      await service?.signOut();
      incoming.revoke();
      store?.close();
      setStore(null);
      setSession(null);
      setError("");
    } catch (error) {
      if (propagateFailure) throw error;
      setError("Couldn’t sign out. Try again.");
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
          </section>
        </main>
      </>
    );
  if (!service) return publicNotice;
  if (!session)
    return (
      <>
        {publicNotice}
        <AccountView service={service} onSession={setSession} />
      </>
    );
  if (session.deviceState === "pending")
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
  return (
    <div className="notes-entry-layout">
      {incomingNotice}
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
