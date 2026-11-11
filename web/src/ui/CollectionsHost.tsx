import { useEffect, useRef, useState } from "react";
import type {
  StudySourceOpenRequest,
  StudyEntryOpenRequest,
} from "./studySourceNavigation";
import type { AccountSession } from "../domain/contracts";
import type { CollectionsStore } from "../collections/contracts";
import { trackOperation } from "../desktop/closeGuard";
import type { HeadingPresentation } from "./routeHeadingMotion";
import { StudyView } from "./StudyView";
import { JournalView } from "./JournalView";
import { ClipsView } from "./ClipsView";
import type { ClipsStore } from "../clips/contracts";
import { isDesktop } from "../desktop/window";
import { openExternalUrl } from "../desktop/external";
import type { JournalVault } from "../collections/journalVault";
import type {
  ClipSearchOpenRequest,
  CardSearchOpenRequest,
  SearchReaderResult,
} from "./searchNavigation";

/** Opens real account-scoped collections only when their route is selected. */
export function CollectionsHost({
  session,
  heading,
  onOpenNote,
  onEpochChange,
  view = "study",
  collections: borrowed,
  onOpenSource,
  openEntry,
  openClip,
  openCard,
  onReturnToSearch,
  holdClipSearchOrigin,
  restoreClipSearchOrigin,
  onSearchReaderResult,
  covered = false,
  onReopen,
}: {
  heading?: HeadingPresentation;
  onReopen?: () => void;
  covered?: boolean;
  openClip?: ClipSearchOpenRequest | null;
  openCard?: CardSearchOpenRequest | null;
  onReturnToSearch?: () => void;
  holdClipSearchOrigin?: boolean;
  restoreClipSearchOrigin?: number;
  onSearchReaderResult?: SearchReaderResult;
  onOpenSource?: (request: StudySourceOpenRequest) => void;
  openEntry?: StudyEntryOpenRequest | null;
  collections?: CollectionsStore | null;
  session: AccountSession;
  onOpenNote: (noteId: string) => void;
  onEpochChange?: () => void;
  view?: "study" | "journal" | "clips";
}) {
  const headingLive = useRef(heading);
  headingLive.current = heading;
  const [clips, setClips] = useState<ClipsStore | null>(null);
  const [clipsError, setClipsError] = useState(false);
  const [clipsAttempt, setClipsAttempt] = useState(0);
  const epochChanged = useRef(onEpochChange);
  epochChanged.current = onEpochChange;
  const [store, setStore] = useState<CollectionsStore | null>(null);
  const [error, setError] = useState("");
  const [showLoading, setShowLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [vault, setVault] = useState<JournalVault | null>(null);
  const [vaultError, setVaultError] = useState(false);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultAttempt, setVaultAttempt] = useState(0);
  useEffect(() => {
    if (borrowed !== undefined) {
      setStore(borrowed);
      setError("");
      if (!borrowed) return;
      let active = true,
        stop: (() => void) | undefined;
      void import("../collections/store").then((module) => {
        if (active)
          stop = module.onCollectionsEpochChange(borrowed, () =>
            epochChanged.current?.(),
          );
      });
      return () => {
        active = false;
        stop?.();
      };
    }
    let active = true;
    let opened: CollectionsStore | undefined;
    let stopEpoch: (() => void) | undefined;
    setStore(null);
    setError("");
    setShowLoading(false);
    const timer = setTimeout(() => setShowLoading(true), 400);
    void trackOperation(async () => {
      const module = await import("../collections/store");
      const opened = await module.openCollectionsStore(session);
      return { opened, module };
    })
      .then(({ opened: value, module }) => {
        opened = value;
        if (active) {
          stopEpoch = module.onCollectionsEpochChange(value, () =>
            epochChanged.current?.(),
          );
          setStore(value);
        } else value.close();
      })
      .catch(() => {
        opened?.close();
        if (active) setError("Your saved data was not changed. Try again.");
      });
    return () => {
      active = false;
      clearTimeout(timer);
      stopEpoch?.();
      opened?.close();
    };
  }, [session.accountId, session.deviceId, session.email, attempt, borrowed]);
  useEffect(() => {
    if (!store || view !== "journal") return;
    let active = true;
    let opened: JournalVault | undefined;
    setVault(null);
    setVaultError(false);
    setVaultLoading(false);
    const timer = setTimeout(() => setVaultLoading(true), 400);
    void trackOperation(async () => {
      const { openJournalVault } = await import("../collections/journalVault");
      return openJournalVault(session, store);
    })
      .then((value) => {
        opened = value;
        if (active) {
          if (value.status().phase === "locked") headingLive.current?.controller.admit("journal");
          setVault(value);
        } else value.close();
      })
      .catch(() => {
        if (active) setVaultError(true);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      opened?.close();
      setVault(null);
    };
  }, [
    store,
    view,
    session.accountId,
    session.deviceId,
    session.email,
    vaultAttempt,
  ]);
  useEffect(() => {
    if (!store || view !== "clips") return;
    let active = true,
      opened: ClipsStore | undefined;
    setClips(null);
    setClipsError(false);
    void import("../clips/store")
      .then(({ createClipsStore }) => {
        if (!active) return;
        opened = createClipsStore(store);
        setClips(opened);
      })
      .catch(() => {
        if (active) setClipsError(true);
      });
    return () => {
      active = false;
      opened?.close();
      setClips(null);
    };
  }, [store, view, clipsAttempt]);
  const title =
    view === "journal" ? "Journal" : view === "clips" ? "Clips" : "Study";
  if (error)
    return (
      <section className="empty" aria-label={title}>
        <h1>{title} couldn’t open</h1>
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </section>
    );
  if (!store)
    return (
      <section
        className="loading"
        aria-label={`Opening ${title}`}
        aria-busy="true"
      >
        {showLoading && <div className="skeleton" />}
      </section>
    );
  if (view === "clips") {
    if (clipsError)
      return (
        <section className="empty" aria-label="Clips">
          <h1>Clips couldn’t open</h1>
          <p role="alert">Your saved clips were not changed.</p>
          <button onClick={() => setClipsAttempt((value) => value + 1)}>
            Try again
          </button>
        </section>
      );
    if (!clips)
      return (
        <section
          className="loading"
          aria-label="Opening Clips"
          aria-busy="true"
        />
      );
    return (
      <ClipsView
        heading={heading}
        store={clips}
        accountId={session.accountId}
        openClip={openClip}
        holdSearchOrigin={holdClipSearchOrigin}
        restoreSearchOrigin={restoreClipSearchOrigin}
        onSearchReaderResult={onSearchReaderResult}
        onOpenExternal={isDesktop() ? openExternalUrl : undefined}
      />
    );
  }
  if (view === "journal") {
    if (vaultError)
      return (
        <section className="empty" aria-label="Journal">
          <h1>Journal couldn’t open</h1>
          <p role="alert">Your saved Journal was not changed. Try again.</p>
          <button onClick={() => setVaultAttempt((value) => value + 1)}>
            Try again
          </button>
        </section>
      );
    if (!vault)
      return (
        <section
          className="loading"
          aria-label="Opening Journal"
          aria-busy="true"
        >
          {vaultLoading && <div className="skeleton" />}
        </section>
      );
    return (
      <JournalView
        heading={heading}
        vault={vault}
        onReopen={() => setVaultAttempt((value) => value + 1)}
      />
    );
  }
  return (
    <StudyView
      heading={heading}
      store={store}
      covered={covered}
      onReopen={
        borrowed === undefined
          ? () => setAttempt((value) => value + 1)
          : onReopen
      }
      accountId={session.accountId}
      openCard={openCard}
      onSearchReaderResult={onSearchReaderResult}
      onReturnToSearch={onReturnToSearch}
      onOpenNote={onOpenNote}
      onOpenSource={onOpenSource}
      openEntry={openEntry}
    />
  );
}
