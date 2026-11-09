import { lazy, Suspense, useEffect, useState } from "react";
import { createAccountService, subscribeLock } from "./account";
import type {
  AccountService,
  AccountSession,
  NotesStore,
} from "./domain/contracts";
import { AccountView, PendingDevice } from "./ui/AccountView";
import { usePreferences } from "./ui/primitives";
const Workspace = lazy(() =>
  import("./ui/Workspace").then((module) => ({ default: module.Workspace })),
);
export function App() {
  usePreferences();
  const [service, setService] = useState<AccountService | null>(null);
  const [session, setSession] = useState<AccountSession | null>(null);
  const [store, setStore] = useState<NotesStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(
    () =>
      subscribeLock(() => {
        setSession(null);
        setStore(null);
        setError("");
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    try {
      const account = createAccountService();
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
    let opened: NotesStore | undefined;
    setLoading(true);
    void import("./data")
      .then((module) => module.openNotesStore(session))
      .then((s) => {
        opened = s;
        if (active) setStore(s);
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
      store?.close();
      setStore(null);
      setSession(null);
      setError("");
    } catch (error) {
      setError("Couldn’t sign out. Try again.");
      if (propagateFailure) throw error;
    }
  }
  if (loading) return <Loading />;
  if (error)
    return (
      <main className="account-page">
        <section className="account-card">
          <h1>Notes can’t open yet</h1>
          <p role="alert">{error}</p>
          <button className="primary" onClick={() => setAttempt((v) => v + 1)}>
            Try again
          </button>
          {session && <button onClick={() => void signOut()}>Sign out</button>}
        </section>
      </main>
    );
  if (!service) return null;
  if (!session) return <AccountView service={service} onSession={setSession} />;
  if (session.deviceState === "pending")
    return (
      <PendingDevice
        service={service}
        onSession={setSession}
        onSignOut={() => void signOut()}
      />
    );
  if (!store) return null;
  return (
    <Suspense fallback={<Loading />}>
      <Workspace
        key={session.accountId}
        store={store}
        session={session}
        onSignOut={() => signOut(true)}
      />
    </Suspense>
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
