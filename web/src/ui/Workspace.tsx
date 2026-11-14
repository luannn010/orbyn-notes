import {
  lazy,
  type CSSProperties,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FileText,
  Search,
  Trash2,
  Settings,
  Plus,
  Menu,
  Pin,
  Paperclip,
  Tags,
} from "lucide-react";
import type { AccountSession, Note, NotesStore } from "../domain/contracts";
import {
  parseMarkdown,
  MAX_MARKDOWN_FILE_BYTES,
  MAX_MARKDOWN_BATCH_BYTES,
  MAX_MARKDOWN_FILES,
} from "../transfer";
import { projectNotes, plainText, message } from "./model";
import { Dialog, usePreferences } from "./primitives";
import { SettingsView } from "./SettingsView";
import { useRouteHeadings, useRouteHeading, type HeadingRoute, type HeadingCue } from "./routeHeadingMotion";
import { SidebarResize, useSidebarWidth } from "./SidebarResize";
import {
  SidebarSelection,
  useSidebarSelection,
  type SidebarSelectionKey,
} from "./SidebarSelection";
import type { SettingsLeaveGuard } from "./studySettingsTypes";
import { NoteEditor } from "./NoteEditor";
import { buildDownload } from "./download";
import { useDesktop } from "../desktop/DesktopShell";
import {
  checkClose,
  trackOperation,
  registerCloseGuard,
} from "../desktop/closeGuard";
import { FirstRunSetup, type SetupImportState } from "./FirstRunSetup";
import {
  profileSetupPreference,
  type SetupPreference,
} from "../setup/preference";
import type {
  LibraryReadResult,
  LibraryMutationResult,
  NotesLibrary,
  NotesLibraryStore,
  TrashUndo,
  NoteSort,
} from "../library/contracts";
import type { EditorSourceTarget } from "./RichEditor";
import type {
  StudySourceOpenRequest,
  StudyEntryOpenRequest,
} from "./studySourceNavigation";
import { useStudySourceOwners } from "./studySourceOwners";
import { useNoteLinkOwner } from "./noteLinkOwner";
import type {
  LinkQuery,
  OwnerAdmission,
  NoteExportResult,
  NoteLinkService,
} from "../links/contracts";
import { noteLinkDownload } from "./noteLinkDownload";
import { NoteLinksPanel } from "./NoteLinksPanel";
import type {
  NoteLinkNavigator,
  NoteLinkNavigatorRegistration,
  NoteLinkCopyFormatter,
} from "../links/navigation";
import { projectLibraryNotes } from "../library/model";
import { TagsView } from "./TagsView";
import { VersionHistory } from "./VersionHistory";
import { LibraryActionFeedback, useLibraryAction } from "./libraryAction";
import "../styles/library.css";
import { SearchView, type SearchTab } from "./SearchView";
import { SearchSurface } from "./SearchSurface";
import { useLocalSearchOwner } from "./localSearchOwner";
import type { SearchLocator, SearchKind } from "../search/results";
import type {
  ClipSearchOpenRequest,
  CardSearchOpenRequest,
} from "./searchNavigation";
type WorkspaceModule = "notes" | "study" | "journal" | "clips" | "tags";
type SearchOrigin = {
  module: WorkspaceModule;
  selected: string | null;
  trash: boolean;
  tag: string;
  pinned: boolean;
  linked: boolean;
};
const CollectionsHost = lazy(() =>
  import("./CollectionsHost").then((module) => ({
    default: module.CollectionsHost,
  })),
);
type Imported = ReturnType<typeof parseMarkdown>;
export function Workspace({
  store,
  session,
  onSignOut,
  library,
  sourceOwner,
  onNoteLinkNavigatorReady,
  formatNoteLink,
  onNoteLinkScopeRevoked,
  incomingNoteIntentActive = false,
  setupPreference = profileSetupPreference,
}: {
  incomingNoteIntentActive?: boolean;
  setupPreference?: SetupPreference;
  onNoteLinkScopeRevoked?: () => void;
  formatNoteLink?: NoteLinkCopyFormatter;
  onNoteLinkNavigatorReady?: NoteLinkNavigatorRegistration;
  store: NotesStore;
  library?: NotesLibrary;
  sourceOwner?: NotesLibraryStore;
  session: AccountSession;
  onSignOut: () => Promise<void>;
}) {
  const routeHeadings = useRouteHeadings();
  const [headingCue, setHeadingCue] = useState<HeadingCue | null>(null);
  const sidebarSelection = useSidebarSelection();
  const [sidebarPrivacy, setSidebarPrivacy] = useState(0);
  const fallbackSidebarTags = useRef<symbol[]>([]);
  const sidebarLayout = useRef<{
    keys: SidebarSelectionKey[];
    shape: string;
    version: number;
  }>({ keys: [], shape: "", version: 0 });
  function invalidateSidebarSelection() {
    routeHeadings.invalidate();
    sidebarSelection.invalidate();
    readSequence.current++;
    fallbackSidebarTags.current = [];
    sidebarLayout.current.keys = [];
    sidebarLayout.current.version++;
    setSidebarPrivacy((value) => value + 1);
  }
  useLayoutEffect(
    () => () => {
      routeHeadings.invalidate();
      sidebarSelection.invalidate();
      fallbackSidebarTags.current = [];
      sidebarLayout.current.keys = [];
      readSequence.current++;
    },
    [sidebarSelection, store, sourceOwner, session.accountId, session.deviceId],
  );
  const [creatingNote, setCreatingNote] = useState(false);
  const createGeneration = useRef(0);
  const createInFlight = useRef<number | null>(null);
  const createFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountInitial = useMemo(() => {
    const first = new Intl.Segmenter(undefined, { granularity: "grapheme" })
      .segment(session.email.trim())
      [Symbol.iterator]()
      .next().value;
    return first?.segment.toLocaleUpperCase() || "?";
  }, [session.email]);
  function retireCreate() {
    createGeneration.current++;
    createInFlight.current = null;
    if (createFocusTimer.current !== null)
      clearTimeout(createFocusTimer.current);
    createFocusTimer.current = null;
    setCreatingNote(false);
  }
  useLayoutEffect(
    () => () => retireCreate(),
    [store, sourceOwner, session.accountId, session.deviceId],
  );
  const [sourceTarget, setSourceTarget] = useState<EditorSourceTarget | null>(
      null,
    ),
    [sourceReturn, setSourceReturn] = useState<StudySourceOpenRequest | null>(
      null,
    ),
    [sourceUnavailable, setSourceUnavailable] = useState<{
      request: StudySourceOpenRequest;
      reason: string;
    } | null>(null),
    [studyEntry, setStudyEntry] = useState<StudyEntryOpenRequest | null>(null);
  const [sourceProjectionError, setSourceProjectionError] = useState<
    string | null
  >(null);
  const activeSourceTarget = useRef<string | null>(null);
  const linkNavigationTicket = useRef(0);
  const [linkNotice, setLinkNotice] = useState("");
  const exportWorking = useRef(false),
    exportGeneration = useRef(0),
    exportReceipt = useRef<{
      service: NoteLinkService;
      result: NoteExportResult;
    } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  useEffect(
    () => () => {
      exportGeneration.current++;
      exportReceipt.current = null;
    },
    [sourceOwner],
  );
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [linkRecoveryOpen, setLinkRecoveryOpen] = useState(false);
  const linkRecoveryCanClose = useRef<() => boolean>(() => true);
  const [linkAdmission, setLinkAdmission] = useState<OwnerAdmission | null>(
    null,
  );
  const [linkAdmissionSettled, setLinkAdmissionSettled] = useState(false);
  const linkVerificationPending = useRef(false);
  const [linkedQuery, setLinkedQuery] = useState<LinkQuery<string> | null>(
    null,
  );
  const links = useNoteLinkOwner(sourceOwner, (reason) => {
    invalidateSidebarSelection();
    retireCreate();
    try {
      onNoteLinkScopeRevoked?.();
    } catch {
      /* A failed observer must not retain private UI projections. */
    }
    revokeSearchScope();

    importGeneration.current++;
    importHeld.current = false;
    importPending.current = false;
    fileReading.current = false;
    setImportError("");
    setupVisible.current = false;
    setSetupOpen(false);
    setImports(null);
    setImporting(false);
    setSetupImportState("idle");
    clearSourceRoute();
    setStudyEntry(null);
    readSequence.current++;
    setLibraryRead(null);
    setNotes([]);
    setHistoryNote(null);
    setEmptyConfirm(null);
    setLinkRecoveryOpen(false);
    exportGeneration.current++;
    exportReceipt.current = null;
    exportWorking.current = false;
    setExportBusy(false);
    setDownload(null);
    setExportNotes(null);
    setLinkAdmission(null);
    linkNavigationTicket.current++;
    setLinkNotice("");
    setLinkedQuery(null);
    selectedSnapshot.current = undefined;
    setSelected(null);
    if (reason === "epoch") void refresh();
  });
  useEffect(() => {
    setLinkAdmission(null);
    setLinkAdmissionSettled(false);
    if (!links.service) return;
    let active = true,
      sequence = 0;
    const read = () => {
      const ticket = ++sequence;
      void Promise.all([
        links.service!.linkedNoteIds(),
        links.service!.admission(),
      ])
        .then(([result, admission]) => {
          if (active && ticket === sequence) {
            setLinkedQuery(result);
            setLinkAdmission(admission);
            setLinkAdmissionSettled(true);
          }
        })
        .catch(() => {
          if (active && ticket === sequence) {
            setLinkAdmissionSettled(true);
            setLinkNotice("Couldn’t load note links. Try again.");
          }
        });
    };
    read();
    const stop = links.service.subscribe(read);
    return () => {
      active = false;
      sequence++;
      stop();
    };
  }, [links.service]);
  const sourceRequest = useRef(0),
    sourceWorking = useRef(false);
  function assignSourceTarget(value: EditorSourceTarget | null) {
    activeSourceTarget.current = value?.key ?? null;
    setSourceTarget(value);
  }
  function clearSourceRoute() {
    linkNavigationTicket.current++;
    setLinkNotice("");
    sourceRequest.current++;
    setSourceProjectionError(null);
    assignSourceTarget(null);
    setSourceReturn(null);
    setSourceUnavailable(null);
  }
  const sourceOwners = useStudySourceOwners(sourceOwner, session, () => {
    invalidateSidebarSelection();
    retireCreate();
    revokeSearchScope();
    sourceRequest.current++;
    sourceWorking.current = false;
    setSourceProjectionError(null);
    selectedSnapshot.current = undefined;
    setSelected(null);
    assignSourceTarget(null);
    setSourceReturn(null);
    setSourceUnavailable(null);
    setStudyEntry(null);
  });
  const [libraryRead, setLibraryRead] = useState<LibraryReadResult | null>(
    null,
  );
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [historyNote, setHistoryNote] = useState<Note | null>(null);
  const [emptyConfirm, setEmptyConfirm] = useState<LibraryReadResult | null>(
    null,
  );
  const libraryAction = useLibraryAction(
    libraryRead?.mode === "ready"
      ? libraryRead.snapshot.token.epoch
      : libraryRead?.mode,
  );
  const adoptedEpoch = useRef<string | null>(null);
  const readSequence = useRef(0);
  const snapshot = libraryRead?.mode === "ready" ? libraryRead.snapshot : null;
  const readOnly =
    (!!library && libraryRead?.mode !== "ready") ||
    linkAdmission?.mode === "index-recovery";
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const libraryFeedbackAction = {
    ...libraryAction,
    reloaded: !readOnly && libraryAction.reloaded,
    retry: () => {
      if (!readOnlyRef.current) libraryAction.retry();
    },
  };
  const legacyReadOnly = libraryRead?.mode === "legacy-read-only";
  function adoptLibrary(result: LibraryReadResult) {
    if (result.mode === "ready") {
      const nextEpoch = result.snapshot.token.epoch;
      if (adoptedEpoch.current && adoptedEpoch.current !== nextEpoch) {
        invalidateSidebarSelection();
        retireCreate();
        selectedSnapshot.current = undefined;
        setSelected(null);
        setHistoryNote(null);
        setEmptyConfirm(null);
        setUndo(null);
        setTag("");
        setPinnedOnly(false);
      }
      adoptedEpoch.current = nextEpoch;
    }
    setLibraryRead(result);
    setNotes(result.mode === "ready" ? result.snapshot.notes : result.notes);
  }
  function acceptLibrary(result: LibraryMutationResult) {
    readSequence.current++;
    adoptLibrary({ mode: "ready", snapshot: result.snapshot });
  }
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedForCreateFocus = useRef(selected);
  selectedForCreateFocus.current = selected;
  const [module, setModuleState] = useState<WorkspaceModule>("notes");
  const [searchActive, setSearchActive] = useState(false),
    [searchQuery, setSearchQuery] = useState(""),
    [searchTab, setSearchTab] = useState<SearchTab>("all");
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null),
    [searchNavigation, setSearchNavigation] = useState<
      "opening" | "blocked" | "unavailable" | null
    >(null);
  const [searchActionError, setSearchActionError] = useState("");
  const [searchPrivacyVersion, setSearchPrivacyVersion] = useState(0);
  const [restoreClipSearchOrigin, setRestoreClipSearchOrigin] = useState(0);
  const [clipSearchRequest, setClipSearchRequest] =
      useState<ClipSearchOpenRequest | null>(null),
    [cardSearchRequest, setCardSearchRequest] =
      useState<CardSearchOpenRequest | null>(null);
  const searchTicket = useRef(0),
    searchScroll = useRef(0),
    restoreSearchScroll = useRef<{ ticket: number; value: number } | null>(
      null,
    ),
    searchAbort = useRef<AbortController | null>(null),
    searchRequest = useRef<string | null>(null);
  const searchOwner = useLocalSearchOwner(
    sourceOwner,
    sourceOwners.collections,
    (reason) => {
      searchTicket.current++;
      searchAbort.current?.abort();
      searchRequest.current = null;
      setSearchNavigation(null);
      setSearchActionError("");
      setClipSearchRequest(null);
      setCardSearchRequest(null);
      if (reason !== "changed") {
        setSearchPrivacyVersion((value) => value + 1);
        setSearchQuery("");
        setSearchTab("all");
        setSearchOrigin(null);
        setSearchActive(false);
        selectedSnapshot.current = undefined;
        setSelected(null);
      }
    },
  );
  function revokeSearchScope() {
    setSearchPrivacyVersion((value) => value + 1);
    searchTicket.current++;
    searchAbort.current?.abort();
    searchRequest.current = null;
    setSearchQuery("");
    setSearchTab("all");
    setSearchOrigin(null);
    setSearchActive(false);
    setSearchNavigation(null);
    setSearchActionError("");
    setClipSearchRequest(null);
    setCardSearchRequest(null);
    selectedSnapshot.current = undefined;
    setSelected(null);
    searchOwner.service?.cancel();
  }
  function setModule(next: WorkspaceModule) {
    searchTicket.current++;
    searchAbort.current?.abort();
    searchRequest.current = null;
    setSearchActive(false);
    setSearchOrigin(null);
    setClipSearchRequest(null);
    setCardSearchRequest(null);
    setSearchNavigation(null);
    setModuleState(next);
  }
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [trash, setTrash] = useState(false);
  const [grid, setGrid] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const desktop = useDesktop();
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [wide, setWide] = useState(
    () => matchMedia("(min-width: 900px)").matches,
  );
  const [settings, setSettings] = useState(false);
  const settingsStudyGuard = useRef<SettingsLeaveGuard | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);
  const [notice, setNotice] = useState("");
  const navigationGuardNotice = useRef<string | null>(null);
  const [undo, setUndo] = useState<Note | TrashUndo | null>(null);
  const [imports, setImports] = useState<Imported | null>(null);
  const [setupOpen, setSetupOpen] = useState(false),
    [setupImportState, setSetupImportState] =
      useState<SetupImportState>("idle"),
    [setupImported, setSetupImported] = useState(0),
    [importError, setImportError] = useState("");
  const setupVisible = useRef(false),
    setupOrigin = useRef<"auto" | "manual">("auto"),
    autoSetupOwner = useRef<NotesLibraryStore | undefined>(undefined);
  const importGeneration = useRef(0),
    importHeld = useRef(false),
    importPending = useRef(false),
    fileReading = useRef(false),
    importOrigin = useRef<"setup" | "library">("library");
  const [importing, setImporting] = useState(false);
  const [exportNotes, setExportNotes] = useState<Note[] | null>(null);
  const [archiveExport, setArchiveExport] = useState(false);
  function requestExport(values: Note[], archive = false) {
    setArchiveExport(archive);
    setExportNotes(values);
  }
  const [download, setDownload] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [erase, setErase] = useState(false);
  const [eraseText, setEraseText] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const fileRef = useRef<HTMLInputElement>(null);
  const prefs = usePreferences();
  const menuRef = useRef<HTMLButtonElement>(null);
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const selectionRootRef = sidebarSelection.rootRef;
  const sidebarRootRef = useMemo(
    () => (node: HTMLElement | null) => {
      drawerRef.current = node;
      selectionRootRef(node);
    },
    [selectionRootRef],
  );
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    const input = fileRef.current;
    input?.addEventListener("cancel", cancelMarkdown);
    return () => input?.removeEventListener("cancel", cancelMarkdown);
  }, [loaded, sourceOwner]);
  useLayoutEffect(
    () =>
      registerCloseGuard(
        () =>
          !importHeld.current || importPending.current || fileReading.current,
      ),
    [],
  );
  useEffect(
    () => () => {
      importGeneration.current++;
      importHeld.current = false;
      setupVisible.current = false;
    },
    [],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (importHeld.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    const query = matchMedia("(min-width: 900px)");
    const update = () => {
      setWide(query.matches);
      if (query.matches) setDrawer(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    if (!desktop || !loaded) return;
    desktop.setLayout({
      sidebarWidth,
      sidebarVisible: wide && !sidebarHidden,
    });
    return () => desktop.setLayout(null);
  }, [desktop?.setLayout, loaded, sidebarWidth, wide, sidebarHidden]);
  useLayoutEffect(() => {
    if (!desktop || !loaded) return;
    desktop.setNavigation({
      expanded: wide ? !sidebarHidden : drawer,
      toggle: () => {
        if (wide) setSidebarHidden((value) => !value);
        else setDrawer((value) => !value);
      },
    });
    return () => desktop.setNavigation(null);
  }, [desktop?.setNavigation, loaded, wide, sidebarHidden, drawer]);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setShowLoadingSkeleton(true), 400);
    return () => clearTimeout(timer);
  }, [loaded]);
  async function reloadLibrary() {
    const sequence = ++readSequence.current;
    if (library) {
      const value = await library.read();
      if (sequence === readSequence.current) {
        adoptLibrary(value);
        sidebarSelection.admit();
        routeHeadings.admit("notes");
        routeHeadings.admit("tags");
      }
    } else {
      const value = await store.list();
      if (sequence === readSequence.current) {
        sidebarSelection.admit();
        routeHeadings.admit("notes");
        routeHeadings.admit("tags");
        setNotes(value);
      }
    }
  }
  async function refresh() {
    const sequence = ++readSequence.current;
    try {
      if (library) {
        const result = await library.read();
        if (sequence !== readSequence.current) return;
        adoptLibrary(result);
        sidebarSelection.admit();
        routeHeadings.admit("notes");
        routeHeadings.admit("tags");
      } else {
        const result = await store.list();
        if (sequence !== readSequence.current) return;
        sidebarSelection.admit();
        routeHeadings.admit("notes");
        routeHeadings.admit("tags");
        setNotes(result);
      }
      setLoaded(true);
    } catch (e) {
      setError(`Couldn’t load notes. ${message(e)}`);
    }
  }
  useEffect(() => {
    let active = true;
    const read = async () => {
      const sequence = ++readSequence.current;
      try {
        const result = library ? await library.read() : null;
        const list = result
          ? result.mode === "ready"
            ? result.snapshot.notes
            : result.notes
          : await store.list();
        if (active && sequence === readSequence.current) {
          if (result) {
            adoptLibrary(result);
            sidebarSelection.admit();
            routeHeadings.admit("notes");
            routeHeadings.admit("tags");
          } else {
            sidebarSelection.admit();
            routeHeadings.admit("notes");
            routeHeadings.admit("tags");
            setNotes(list);
          }
          setLoaded(true);
        }
      } catch (e) {
        if (active) setError(`Couldn’t load notes. ${message(e)}`);
      }
    };
    void read();
    const unsub = store.subscribe(() => void read());
    return () => {
      active = false;
      unsub();
    };
  }, [store, library]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(
      () => setUndo(null),
      "expiresAt" in undo
        ? Math.max(0, Date.parse(undo.expiresAt) - Date.now())
        : 5000,
    );
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (!drawer) {
      if (drawerWasOpen.current) {
        drawerWasOpen.current = false;
        (desktop?.navigationRef.current ?? menuRef.current)?.focus();
      }
      return;
    }
    drawerWasOpen.current = true;
    drawerRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
      }
      if (e.key === "Tab") {
        const controls = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>("input,button") ??
            [],
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  const selectedSnapshot = useRef<Note | undefined>(undefined);
  const current =
    notes.find((n) => n.id === selected) ??
    (selectedSnapshot.current?.id === selected
      ? selectedSnapshot.current
      : undefined);
  if (current) selectedSnapshot.current = current;
  const metadata = new Map(
    snapshot?.metadata.map((value) => [value.noteId, value]),
  );
  const sort = snapshot?.preferences.sort ?? "edited";
  const selectedTag = snapshot?.tags.find(
    (value) => value.state === "active" && value.name === tag,
  );
  const allVisible = snapshot
    ? tag && !selectedTag
      ? []
      : projectLibraryNotes(
          { ...snapshot, notes },
          { query, tagId: selectedTag?.id, trash, pinnedOnly },
        )
    : projectNotes(notes, query, tag, trash);
  const visible =
    linkedOnly && !trash
      ? linkedQuery?.status === "ready"
        ? allVisible.filter((note) => linkedQuery.items.includes(note.id))
        : []
      : allVisible;
  const tags = snapshot
    ? snapshot.tags
        .filter((value) => value.state === "active")
        .map((value) => value.name)
        .sort((a, b) => a.localeCompare(b))
    : [
        ...new Set(notes.filter((n) => !n.trashedAt).flatMap((n) => n.tags)),
      ].sort();
  fallbackSidebarTags.current.length = tags.length;
  const sidebarTagKeys: SidebarSelectionKey[] = tags.map((name, index) => {
    const id = snapshot?.tags.find(
      (value) => value.state === "active" && value.name === name,
    )?.id;
    return id ? `tag:${id}` : (fallbackSidebarTags.current[index] ??= Symbol());
  });
  const sidebarKeys: SidebarSelectionKey[] = [
    "notes", "journal", "study", "clips",
    ...(library ? ["pinned", ...(links.service ? ["linked"] : []), "tags"] : []),
    ...sidebarTagKeys, "trash",
  ];
  const sidebarShape = `${sidebarWidth}:${wide}:${drawer}:${sidebarHidden}`;
  if (
    sidebarLayout.current.shape !== sidebarShape ||
    sidebarLayout.current.keys.length !== sidebarKeys.length ||
    sidebarKeys.some((key, index) => key !== sidebarLayout.current.keys[index])
  ) {
    sidebarLayout.current = {
      keys: sidebarKeys,
      shape: sidebarShape,
      version: sidebarLayout.current.version + 1,
    };
  }
  const sidebarActiveKey: SidebarSelectionKey | null = module !== "notes"
    ? module
    : trash ? "trash"
      : tag ? sidebarTagKeys[tags.indexOf(tag)] ?? null
        : pinnedOnly ? "pinned" : linkedOnly ? "linked" : "notes";
  const editing = selected !== null && current;
  const noteActors = Array.from(
    new Set(
      [searchOrigin?.selected, selected].filter((id): id is string => !!id),
    ),
  )
    .map(
      (id) =>
        notes.find((note) => note.id === id) ??
        (current?.id === id ? current : undefined),
    )
    .filter((note): note is Note => !!note);

  function requestHeading(route: HeadingRoute, key: SidebarSelectionKey | null) {
    if (module === route && !searchActive && !editing && sidebarActiveKey === key) return;
    setHeadingCue(routeHeadings.request(route));
  }
  function canNavigate() {
    const state = checkClose();
    if (state === "working" || state === "draft") {
      const value =
        state === "working"
          ? "Notes is still working. Wait for it to finish before leaving."
          : "Finish or discard your unsaved changes before leaving.";
      navigationGuardNotice.current = value;
      setNotice(value);
    } else clearNavigationGuardNotice();
    return state === "allowed";
  }
  function clearNavigationGuardNotice() {
    const owned = navigationGuardNotice.current;
    if (owned) {
      navigationGuardNotice.current = null;
      setNotice((value) => (value === owned ? "" : value));
    }
  }
  function enterSearch(raw = searchQuery, submit = false) {
    setSearchQuery(raw);
    if (!canNavigate()) {
      setSearchNavigation("blocked");
      return;
    }
    if (!searchOrigin) {
      searchScroll.current = 0;
      setSearchOrigin({
        module,
        selected,
        trash,
        tag,
        pinned: pinnedOnly,
        linked: linkedOnly,
      });
    }
    setSearchNavigation(null);
    // A retained certificate is not current proof. Clear it synchronously before exposure.
    if (submit && searchOwner.service)
      runSearchAction(() => searchOwner.service!.query(raw));
    else if (!searchActive) freshenReadySearch(raw);
    setSearchActive(true);
    setDrawer(false);
    setSettings(false);
    const main = document.getElementById("main");
    if (main) main.scrollTop = 0;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>(".unified-search input")
        ?.focus(),
    );
  }
  function runSearchAction(action: () => Promise<void>) {
    const ticket = ++searchTicket.current;
    searchAbort.current?.abort();
    searchRequest.current = null;
    setSearchActionError("");
    setSearchNavigation(null);
    void action().catch(() => {
      if (ticket === searchTicket.current)
        setSearchActionError("Search couldn’t finish this action. Try again.");
    });
  }
  function freshenReadySearch(raw: string) {
    const service = searchOwner.service,
      retained = service?.getSnapshot();
    if (!service || retained?.status !== "ready") return;
    const pages: Partial<Record<SearchKind, number>> = {};
    for (const group of retained.groups) pages[group.kind] = group.offset;
    runSearchAction(() => service.query(raw, undefined, Object.freeze(pages)));
  }
  function cancelSearchWork() {
    searchTicket.current++;
    searchAbort.current?.abort();
    searchRequest.current = null;
    setSearchNavigation(null);
    setSearchActionError("");
    searchOwner.service?.cancel();
  }
  function editSearchQuery(raw: string) {
    cancelSearchWork();
    setSearchQuery(raw);
  }
  function selectSearchTab(tab: SearchTab) {
    restoreSearchScroll.current = null;
    setSearchTab(tab);
    const view = document.querySelector<HTMLElement>(".unified-search");
    if (view) view.scrollTop = 0;
  }
  function clearSearch() {
    if (!canNavigate()) {
      setSearchNavigation("blocked");
      return;
    }
    searchTicket.current++;
    searchAbort.current?.abort();
    searchRequest.current = null;
    searchOwner.service?.cancel();
    setSearchQuery("");
    setSearchTab("all");
    setSearchActive(false);
    setSearchNavigation(null);
    setClipSearchRequest(null);
    setCardSearchRequest(null);
    const origin = searchOrigin;
    if (origin?.module === "clips")
      setRestoreClipSearchOrigin((value) => value + 1);
    setSearchOrigin(null);
    if (origin) {
      setModuleState(origin.module);
      setSelected(origin.selected);
      setTrash(origin.trash);
      setTag(origin.tag);
      setPinnedOnly(origin.pinned);
      setLinkedOnly(origin.linked);
    } else {
      setModuleState("notes");
      setSelected(null);
    }
  }
  async function openSearchTarget(target: SearchLocator) {
    if (!canNavigate()) {
      setSearchNavigation("blocked");
      return;
    }
    const ticket = ++searchTicket.current;
    searchAbort.current?.abort();
    const abort = new AbortController();
    searchAbort.current = abort;
    setSearchNavigation("opening");
    searchScroll.current =
      document.querySelector<HTMLElement>(".unified-search")?.scrollTop ?? 0;
    if (target.accountId !== session.accountId) {
      setSearchNavigation("unavailable");
      return;
    }
    if (target.kind === "note") {
      const result = await openNoteTarget(target, abort.signal, true);
      if (ticket !== searchTicket.current || abort.signal.aborted) return;
      setSearchNavigation(result.status === "opened" ? null : result.status);
      return;
    }
    const collections = sourceOwners.collections;
    if (!collections) {
      setSearchNavigation("unavailable");
      return;
    }
    try {
      const value = await trackOperation(() => collections.read());
      if (ticket !== searchTicket.current || abort.signal.aborted) return;
      if (!canNavigate()) {
        setSearchNavigation("blocked");
        return;
      }
      const exists =
        value.epoch === target.collectionsEpoch &&
        (target.kind === "clip"
          ? value.clips.items.some((item) => item.id === target.clipId)
          : value.study.cards.some(
              (card) =>
                card.id === target.cardId &&
                card.entryId === target.entryId &&
                card.key === target.key,
            ) &&
            value.study.entries.some((entry) => entry.id === target.entryId));
      if (!exists) {
        setSearchNavigation("unavailable");
        return;
      }
      const requestId = crypto.randomUUID();
      searchRequest.current = requestId;
      if (target.kind === "clip") {
        setClipSearchRequest({ requestId, target });
        setModuleState("clips");
      } else {
        setCardSearchRequest({ requestId, target });
        setModuleState("study");
      }
    } catch {
      if (ticket === searchTicket.current && !abort.signal.aborted)
        setSearchNavigation("unavailable");
    }
  }
  function searchReaderResult(
    requestId: string,
    status: "opened" | "blocked" | "unavailable",
  ) {
    if (searchRequest.current !== requestId) return;
    searchRequest.current = null;
    if (status === "opened" && !canNavigate()) {
      setSearchNavigation("blocked");
      return;
    }
    setSearchNavigation(status === "opened" ? null : status);
    if (status === "opened") {
      setSelected(null);
      setSearchActive(false);
    } else if (searchOrigin) setModuleState(searchOrigin.module);
  }
  function returnToSearch() {
    if (!canNavigate()) return;
    searchTicket.current++;
    searchAbort.current?.abort();
    searchRequest.current = null;
    setCardSearchRequest(null);
    setClipSearchRequest(null);
    freshenReadySearch(searchQuery);
    setSearchActive(true);
    setSearchNavigation(null);
    const ticket = searchTicket.current;
    restoreSearchScroll.current = { ticket, value: searchScroll.current };
    requestAnimationFrame(() => {
      if (ticket !== searchTicket.current) return;
      const view = document.querySelector<HTMLElement>(".unified-search");
      if (view) {
        view
          .querySelector<HTMLInputElement>("input")
          ?.focus({ preventScroll: true });
      }
    });
  }
  useLayoutEffect(() => {
    const pending = restoreSearchScroll.current;
    if (!pending) return;
    if (pending.ticket !== searchTicket.current || !searchActive) {
      restoreSearchScroll.current = null;
      return;
    }
    if (searchOwner.state.status === "ready") {
      const view = document.querySelector<HTMLElement>(".unified-search");
      if (view) view.scrollTop = pending.value;
      restoreSearchScroll.current = null;
    } else if (searchOwner.state.status !== "pending")
      restoreSearchScroll.current = null;
  }, [searchActive, searchOwner.state]);
  const enterSearchRef = useRef(enterSearch);
  enterSearchRef.current = enterSearch;
  useEffect(() => {
    if (!sourceOwner) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.isComposing ||
        document.querySelector('dialog[open], [role="dialog"]')
      )
        return;
      event.preventDefault();
      enterSearchRef.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sourceOwner]);
  function openSetup(origin: "auto" | "manual") {
    if (incomingNoteIntentActive || !canNavigate()) return;
    setupOrigin.current = origin;
    setupVisible.current = true;
    setSetupImported(0);
    setSetupImportState("idle");
    setImportError("");
    setSettings(false);
    setSetupOpen(true);
  }
  function finishSetup() {
    if (importHeld.current || importPending.current || fileReading.current)
      return;
    setupVisible.current = false;
    setSetupOpen(false);
    setImportError("");
    const result = setupPreference.dismiss();
    if (!result.persisted)
      setNotice(
        `Setup closed. This ${desktop ? "device" : "browser"} couldn’t save the preference.`,
      );
  }
  useEffect(() => {
    if (
      !sourceOwner ||
      autoSetupOwner.current === sourceOwner ||
      !loaded ||
      !links.bootSettled ||
      !sourceOwners.bootSettled ||
      (links.service && !linkAdmissionSettled)
    )
      return;
    // Consume before ALL eligibility/guard refusals; later saves or link completion cannot take over.
    autoSetupOwner.current = sourceOwner;
    if (
      setupPreference.isDismissed() ||
      searchActive ||
      !!searchOrigin ||
      incomingNoteIntentActive ||
      readOnly ||
      !linkAdmission ||
      !snapshot ||
      snapshot.notes.length ||
      module !== "notes" ||
      selected !== null ||
      sourceReturn ||
      query.trim() ||
      trash ||
      tag ||
      pinnedOnly ||
      linkedOnly ||
      settings ||
      drawer ||
      historyNote ||
      emptyConfirm ||
      linkRecoveryOpen ||
      exportNotes ||
      erase ||
      signOutOpen ||
      importHeld.current ||
      libraryAction.error ||
      checkClose() !== "allowed"
    )
      return;
    openSetup("auto");
  }, [
    sourceOwner,
    loaded,
    links.bootSettled,
    links.service,
    linkAdmissionSettled,
    linkAdmission,
    sourceOwners.bootSettled,
    setupPreference,
    searchActive,
    searchOrigin,
    incomingNoteIntentActive,
    readOnly,
    snapshot,
    module,
    selected,
    sourceReturn,
    query,
    trash,
    tag,
    pinnedOnly,
    linkedOnly,
    settings,
    drawer,
    historyNote,
    emptyConfirm,
    linkRecoveryOpen,
    exportNotes,
    erase,
    signOutOpen,
    libraryAction.error,
  ]);
  useEffect(() => {
    const maybeClose = () => {
      if (
        setupVisible.current &&
        setupOrigin.current === "auto" &&
        setupPreference.isDismissed() &&
        !importHeld.current &&
        !importPending.current &&
        !fileReading.current
      ) {
        setupVisible.current = false;
        setSetupOpen(false);
      }
    };
    maybeClose();
    return setupPreference.subscribe(maybeClose);
  }, [setupPreference, setupImportState]);
  useEffect(() => {
    if (
      incomingNoteIntentActive &&
      setupVisible.current &&
      !importHeld.current &&
      !importPending.current &&
      !fileReading.current
    ) {
      setupVisible.current = false;
      setSetupOpen(false);
    }
  }, [incomingNoteIntentActive, setupImportState]);
  function chooseMarkdown(origin: "setup" | "library" = "library") {
    if (
      readOnlyRef.current ||
      importHeld.current ||
      importPending.current ||
      fileReading.current ||
      !canNavigate()
    )
      return;
    importOrigin.current = origin;
    importHeld.current = true;
    setImportError("");
    if (origin === "setup") setSetupImportState("picking");
    fileRef.current?.click();
  }
  function cancelMarkdown() {
    if (importPending.current || fileReading.current) return;
    importHeld.current = false;
    setImports(null);
    if (importOrigin.current === "setup") {
      setSetupImportState("idle");
      setImportError("");
    }
  }
  const openNoteTarget = async (
    target: Parameters<NoteLinkNavigator>[0],
    signal?: AbortSignal,
    fromSearch = false,
  ): ReturnType<NoteLinkNavigator> => {
    if (signal?.aborted) return { status: "unavailable" };
    const service = links.service;
    if (!service) return { status: "unavailable" };
    const self =
      target.noteId === selected &&
      target.accountId === session.accountId &&
      target.libraryEpoch === snapshot?.token.epoch;
    if (!self && !canNavigate()) return { status: "blocked" };
    if (setupVisible.current && !importHeld.current) {
      setupVisible.current = false;
      setSetupOpen(false);
    }
    const ticket = ++linkNavigationTicket.current;
    setLinkNotice("");
    try {
      const resolved = await trackOperation(() => service.resolve(target));
      if (signal?.aborted || ticket !== linkNavigationTicket.current)
        return { status: "unavailable" };
      if (resolved.status !== "available") {
        setLinkNotice(
          resolved.reason === "trashed"
            ? "This note is in Trash."
            : "This note isn’t available in this workspace.",
        );
        return { status: "unavailable" };
      }
      if (self) {
        if (signal?.aborted || ticket !== linkNavigationTicket.current)
          return { status: "unavailable" };
        clearNavigationGuardNotice();
        setSearchActive(false);
        if (!fromSearch) setSearchOrigin(null);
        const focusCurrent = () => {
          if (signal?.aborted || ticket !== linkNavigationTicket.current)
            return;
          document
            .querySelector<HTMLElement>(
              '[data-note-actor-active="true"] [aria-label="Note content"]',
            )
            ?.focus();
        };
        if (searchActive) requestAnimationFrame(focusCurrent);
        else focusCurrent();
        return { status: "opened" };
      }
      const saved = await trackOperation(() =>
        store.get(resolved.target.noteId),
      );
      if (signal?.aborted || ticket !== linkNavigationTicket.current)
        return { status: "unavailable" };
      if (!saved || saved.trashedAt) {
        setLinkNotice("This note isn’t available in this workspace.");
        return { status: "unavailable" };
      }
      if (!canNavigate()) return { status: "blocked" };
      if (signal?.aborted || ticket !== linkNavigationTicket.current)
        return { status: "unavailable" };
      selectedSnapshot.current = saved;
      setNotes((values) => [
        saved,
        ...values.filter((note) => note.id !== saved.id),
      ]);
      assignSourceTarget(null);
      setSourceProjectionError(null);
      setSourceUnavailable(null);
      if (signal?.aborted || ticket !== linkNavigationTicket.current)
        return { status: "unavailable" };
      setSelected(saved.id);
      setDrawer(false);
      if (!sourceReturn) {
        if (fromSearch) setModuleState("notes");
        else setModule("notes");
      }
      setSearchActive(false);
      return { status: "opened" };
    } catch {
      if (!signal?.aborted && ticket === linkNavigationTicket.current)
        setLinkNotice("This note isn’t available in this workspace.");
      return { status: "unavailable" };
    }
  };
  const noteNavigator = useRef(openNoteTarget);
  noteNavigator.current = openNoteTarget;
  const admittedNavigatorService = useRef<NoteLinkService | null>(null);
  const navigatorBootReady =
    loaded && links.bootSettled && (!sourceOwner || sourceOwners.bootSettled);
  const canRegisterNavigator = Boolean(
    links.service &&
    (admittedNavigatorService.current === links.service || navigatorBootReady),
  );
  useEffect(() => {
    if (!links.service || !canRegisterNavigator) {
      if (!links.service) admittedNavigatorService.current = null;
      onNoteLinkNavigatorReady?.(null);
      return;
    }
    admittedNavigatorService.current = links.service;
    const invoke: NoteLinkNavigator = (target, signal?: AbortSignal) =>
      noteNavigator.current(target, signal);
    onNoteLinkNavigatorReady?.(invoke);
    return () => {
      linkNavigationTicket.current++;
      onNoteLinkNavigatorReady?.(null);
    };
  }, [links.service, canRegisterNavigator, onNoteLinkNavigatorReady]);
  function openStudyEntry(entryId: string) {
    if (!canNavigate()) return;
    clearSourceRoute();
    setStudyEntry({ key: crypto.randomUUID(), entryId });
    setModule("study");
    setSelected(null);
    setDrawer(false);
  }
  async function openSource(request: StudySourceOpenRequest, ordinary = false) {
    if (
      sourceWorking.current ||
      !sourceOwners.service ||
      !sourceOwners.collections ||
      !canNavigate()
    )
      return;
    const ticket = ++sourceRequest.current,
      service = sourceOwners.service;
    sourceWorking.current = true;
    setSourceProjectionError(null);
    setSourceUnavailable(null);
    assignSourceTarget(null);
    try {
      const target = await trackOperation(() =>
        service.resolve(request.entryId),
      );
      if (ticket !== sourceRequest.current) return;
      if (target.status !== "attached" && !ordinary) {
        setSourceUnavailable({ request, reason: target.reason });
        return;
      }
      let noteId = target.status === "attached" ? target.noteId : null;
      if (!noteId && ordinary) {
        const data = await trackOperation(() =>
          sourceOwners.collections!.read(),
        );
        noteId =
          data.study.entries.find((entry) => entry.id === request.entryId)
            ?.source?.noteId ?? null;
      }
      if (!noteId) throw new Error("This source note is no longer available.");
      const saved = await trackOperation(() => store.get(noteId!));
      if (ticket !== sourceRequest.current) return;
      if (!saved || saved.trashedAt)
        throw new Error("This source note is no longer available.");
      if (
        target.status === "attached" &&
        saved.revision !== target.noteRevision
      ) {
        setSourceUnavailable({ request, reason: "stale" });
        return;
      }
      if (!canNavigate()) return;
      selectedSnapshot.current = saved;
      setNotes((values) => [
        saved,
        ...values.filter((note) => note.id !== saved.id),
      ]);
      setSourceReturn(request);
      setSourceProjectionError(null);
      assignSourceTarget(
        target.status === "attached"
          ? { key: crypto.randomUUID(), ...target }
          : null,
      );
      setSourceUnavailable(
        target.status === "attached"
          ? null
          : { request, reason: target.reason },
      );
      setSelected(saved.id);
      setDrawer(false);
    } catch (failure) {
      if (ticket === sourceRequest.current)
        setSourceProjectionError(message(failure));
    } finally {
      if (ticket === sourceRequest.current) sourceWorking.current = false;
    }
  }
  function navigate(isTrash = false, nextTag = "") {
    if (!canNavigate()) return;
    requestHeading("notes", isTrash ? "trash" : nextTag ? sidebarTagKeys[tags.indexOf(nextTag)] ?? null : "notes");
    clearSourceRoute();
    setModule("notes");
    setSelected(null);
    setTrash(isTrash);
    setPinnedOnly(false);
    setLinkedOnly(false);
    setTag(nextTag);
    setDrawer(false);
  }
  async function create() {
    if (
      createInFlight.current !== null ||
      readOnlyRef.current ||
      !canNavigate()
    )
      return;
    const ticket = ++createGeneration.current;
    createInFlight.current = ticket;
    setCreatingNote(true);
    const current = () =>
      createGeneration.current === ticket && createInFlight.current === ticket;
    try {
      const note = await trackOperation(() =>
        store.create({
          title: "",
          document: { type: "doc", content: [{ type: "paragraph" }] },
          tags: [],
        }),
      );
      if (!current()) return;
      setNotes((values) => [
        note,
        ...values.filter((value) => value.id !== note.id),
      ]);
      if (readOnlyRef.current || !canNavigate()) {
        const value = readOnlyRef.current
          ? "Note created. Editing is currently unavailable."
          : checkClose() === "draft"
            ? "Note created. Finish or discard your unsaved changes before opening it."
            : "Note created. Wait for the current work to finish before opening it.";
        navigationGuardNotice.current = value;
        setNotice(value);
        return;
      }
      clearSourceRoute();
      setModule("notes");
      setTrash(false);
      setTag("");
      setPinnedOnly(false);
      setLinkedOnly(false);
      setQuery("");
      setDrawer(false);
      setSelected(note.id);
      createFocusTimer.current = setTimeout(() => {
        createFocusTimer.current = null;
        if (
          createGeneration.current === ticket &&
          !readOnlyRef.current &&
          selectedForCreateFocus.current === note.id
        )
          document.getElementById("note-title")?.focus();
      }, 0);
    } catch (e) {
      if (current()) setError(`Couldn’t create note. ${message(e)}`);
    } finally {
      if (current()) {
        createInFlight.current = null;
        setCreatingNote(false);
      }
    }
  }
  async function move(note: Note) {
    if (readOnly) return;
    if (library) {
      libraryAction.start(
        (id) => library.changeTrash(note.id, "trash", note.revision, id),
        (result) => {
          acceptLibrary(result);
          setUndo(result.undo);
          setNotice("Note moved to Trash");
          setSelected(null);
          selectedSnapshot.current = undefined;
        },
      );
      return;
    }
    try {
      const moved = await store.trash(note.id, note.revision);
      setUndo(moved);
      setNotice("Note moved to Trash");
      setSelected(null);
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  async function restore(note: Note) {
    if (readOnly) return;
    if (library) {
      libraryAction.start(
        (id) => library.changeTrash(note.id, "restore", note.revision, id),
        (result) => {
          acceptLibrary(result);
          setUndo(result.undo);
          setNotice("Note restored");
        },
      );
      return;
    }
    try {
      await store.restore(note.id, note.revision);
      setUndo(null);
      setNotice("Note restored");
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  async function readFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      cancelMarkdown();
      return;
    }
    if (fileReading.current || importPending.current) return;
    const ticket = ++importGeneration.current;
    fileReading.current = true;
    importHeld.current = true;
    setImportError("");
    if (importOrigin.current === "setup") setSetupImportState("reading");
    try {
      const parsed = await trackOperation(async () => {
        const selectedFiles = Array.from(files);
        if (selectedFiles.length > MAX_MARKDOWN_FILES)
          throw Error("Import at most 100 files at once.");
        if (
          selectedFiles.some(
            (file) =>
              !/[.](md|markdown|mdown)$/i.test(file.name) ||
              file.size > MAX_MARKDOWN_FILE_BYTES,
          )
        )
          throw Error("Choose Markdown files up to 2 MB each.");
        if (
          selectedFiles.reduce((total, file) => total + file.size, 0) >
          MAX_MARKDOWN_BATCH_BYTES
        )
          throw Error("Import batches up to 10 MB.");
        const content = await Promise.all(
          selectedFiles.map(async (file) => ({
            name: file.name,
            content: await file.text(),
          })),
        );
        if (ticket !== importGeneration.current) return null;
        return parseMarkdown(content);
      });
      if (ticket !== importGeneration.current || !parsed) return;
      setImports(parsed.length ? parsed : null);
      importHeld.current = parsed.length > 0;
      if (importOrigin.current === "setup")
        setSetupImportState(parsed.length ? "review" : "idle");
    } catch (failure) {
      if (ticket === importGeneration.current) {
        importHeld.current = false;
        setImportError(message(failure));
        if (importOrigin.current === "setup") setSetupImportState("failed");
      }
    } finally {
      if (ticket === importGeneration.current) {
        fileReading.current = false;
        if (fileRef.current) fileRef.current.value = "";
      }
    }
  }
  async function importAll() {
    if (
      !imports ||
      importPending.current ||
      fileReading.current ||
      readOnlyRef.current
    )
      return;
    const batch = [...imports],
      ticket = importGeneration.current,
      prior = setupImported;
    importPending.current = true;
    setImporting(true);
    setImportError("");
    if (importOrigin.current === "setup") setSetupImportState("running");
    let done = 0;
    try {
      await trackOperation(async () => {
        for (const input of batch) {
          if (ticket !== importGeneration.current) return;
          await store.create(input);
          if (ticket !== importGeneration.current) return;
          done++;
          setNotice(`Importing ${done} of ${batch.length} notes…`);
          if (importOrigin.current === "setup") setSetupImported(prior + done);
        }
      });
      if (ticket !== importGeneration.current) return;
      importHeld.current = false;
      setImports(null);
      setNotice(`Imported ${done} notes`);
      if (importOrigin.current === "setup") setSetupImportState("completed");
    } catch (failure) {
      if (ticket === importGeneration.current) {
        const remaining = batch.slice(done);
        setImports(remaining.length ? remaining : null);
        importHeld.current = remaining.length > 0;
        setImportError(
          `Imported ${done} of ${batch.length} notes. ${remaining.length} weren’t imported. ${message(failure)}`,
        );
        if (importOrigin.current === "setup") setSetupImportState("failed");
      }
    } finally {
      if (ticket === importGeneration.current) {
        importPending.current = false;
        setImporting(false);
        await refresh();
      }
    }
  }
  async function prepareExport() {
    if (!exportNotes || exportWorking.current) return;
    if (sourceOwner && !links.service) {
      setError(
        "Note links aren’t ready. Wait for them to open, then try exporting again.",
      );
      return;
    }
    exportWorking.current = true;
    setExportBusy(true);
    const ticket = exportGeneration.current,
      selected = [...exportNotes],
      archive = archiveExport,
      service = links.service;
    try {
      let output: { blob: Blob; name: string };
      if (service) {
        const result = await trackOperation(async () => {
          const intent = await service.prepareExport(
            selected.map((note) => note.id),
          );
          const result = await service.exportFiles(intent);
          await service.assertFreshExport(result);
          return result;
        });
        if (ticket !== exportGeneration.current) return;
        output = noteLinkDownload(result.files, archive);
        exportReceipt.current = { service, result };
      } else {
        output = buildDownload(selected, archive);
        exportReceipt.current = null;
      }
      const { blob, name } = output;
      setDownload({ url: URL.createObjectURL(blob), name });
      setExportNotes(null);
      setNotice("Export prepared");
    } catch {
      if (ticket === exportGeneration.current)
        setError("Couldn’t export notes. Your notes were not changed.");
    } finally {
      if (ticket === exportGeneration.current) {
        exportWorking.current = false;
        setExportBusy(false);
      }
    }
  }
  async function downloadNotes(event: React.MouseEvent<HTMLAnchorElement>) {
    const receipt = exportReceipt.current;
    if (!receipt) return;
    event.preventDefault();
    if (!download || exportWorking.current) return;
    const value = download,
      ticket = exportGeneration.current;
    exportWorking.current = true;
    try {
      await trackOperation(() =>
        receipt.service.assertFreshExport(receipt.result),
      );
      if (ticket !== exportGeneration.current) return;
      const a = document.createElement("a");
      a.href = value.url;
      a.download = value.name;
      a.click();
    } catch {
      if (ticket === exportGeneration.current) {
        setDownload(null);
        exportReceipt.current = null;
        setError("Notes changed. Prepare a new export before downloading.");
      }
    } finally {
      exportWorking.current = false;
    }
  }
  const headingCovered = drawer || searchActive || setupOpen || settings || signOutOpen || !!imports ||
    exportNotes !== null || erase || historyNote !== null || emptyConfirm !== null || incomingNoteIntentActive;
  const headingFor = (route: HeadingRoute) => ({
    controller: routeHeadings, cue: headingCue,
    active: module === route && !editing && !headingCovered,
  });
  const notesHeadingRef = useRouteHeading(headingFor("notes"), "notes", !loaded ? "pending" : editing ? "absent" : "target");
  useLayoutEffect(() => {
    if (headingCue && (module !== headingCue.route || !!editing || headingCovered)) routeHeadings.retire();
  }, [routeHeadings, headingCue, module, !!editing, headingCovered]);
  if (!loaded && !error)
    return (
      <main className="loading" aria-label="Loading notes" aria-busy="true">
        {showLoadingSkeleton && <div className="skeleton" />}
      </main>
    );
  return (
    <div
      className={
        desktop && wide && sidebarHidden ? "app desktop-sidebar-hidden" : "app"
      }
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <a className="skip" href="#main">
        Skip to notes
      </a>
      <header className="mobile-header" inert={drawer}>
        <button
          ref={menuRef}
          aria-label="Open navigation"
          aria-expanded={drawer}
          onClick={() => setDrawer(!drawer)}
        >
          <Menu size={18} />
        </button>
        <b>Orbyn Notes</b>
        <span>Beta · Local only</span>
      </header>
      {drawer && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => {
            setDrawer(false);
          }}
        />
      )}
      <aside
        id="notes-sidebar"
        ref={sidebarRootRef}
        role={drawer ? "dialog" : undefined}
        aria-modal={drawer ? true : undefined}
        className={drawer ? "sidebar open" : "sidebar"}
        aria-label="Notes navigation"
      >
        <SidebarSelection
          controller={sidebarSelection}
          activeKey={sidebarActiveKey}
          layoutVersion={sidebarLayout.current.version}
          privacyRevision={sidebarPrivacy}
          visible={loaded && (wide ? !(desktop && sidebarHidden) : drawer)}
        />
        <div className="sidebar-account" role="group" aria-label="Account">
          <span className="sidebar-account-avatar" aria-hidden="true">
            {accountInitial}
          </span>
          <span className="sidebar-account-email" title={session.email}>
            <bdi>{session.email}</bdi>
          </span>
          <button
            className="sidebar-account-create"
            type="button"
            aria-label="New note"
            title="New note"
            disabled={readOnly || creatingNote}
            onClick={() => void create()}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {sourceOwner ? (
          <button
            className="search"
            onClick={() => enterSearch()}
            aria-label="Search notes, clips and cards"
          >
            <Search size={15} aria-hidden="true" />
            <span>Search notes</span>
            <kbd>Ctrl K</kbd>
          </button>
        ) : (
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Search notes"
              placeholder="Search notes"
              value={query}
              onChange={(e) => {
                if (module !== "notes") {
                  if (!canNavigate()) return;
                  setModule("notes");
                  setSelected(null);
                }
                setQuery(e.target.value);
              }}
            />
          </label>
        )}
        <nav>
          <button
            ref={sidebarSelection.rowRef("notes")}
            className={
              module === "notes" && !trash && !tag && !pinnedOnly && !linkedOnly
                ? "nav active"
                : "nav"
            }
            onClick={() => navigate()}
          >
            <FileText size={15} />
            <span className="nav-label">All notes</span>{" "}
            <span>{notes.filter((n) => !n.trashedAt).length}</span>
          </button>
          <button
            ref={sidebarSelection.rowRef("journal")}
            className={module === "journal" ? "nav active" : "nav"}
            onClick={() => {
              if (!canNavigate()) return;
              requestHeading("journal", "journal");
              setModule("journal");
              setSelected(null);
              setDrawer(false);
            }}
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3.8" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
            </svg>
            <span className="nav-label">Journal</span>
          </button>
          <button
            ref={sidebarSelection.rowRef("study")}
            className={module === "study" ? "nav active" : "nav"}
            onClick={() => {
              if (!canNavigate()) return;
              requestHeading("study", "study");
              setModule("study");
              setSelected(null);
              setDrawer(false);
            }}
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="6.5" y="3.5" width="12" height="15" rx="2" />
              <path d="M4 7v12a2 2 0 0 0 2 2h9" />
            </svg>
            <span className="nav-label">Study</span>
          </button>
          <button
            ref={sidebarSelection.rowRef("clips")}
            className={module === "clips" ? "nav active" : "nav"}
            onClick={() => {
              if (!canNavigate()) return;
              requestHeading("clips", "clips");
              setModule("clips");
              setSelected(null);
              setDrawer(false);
            }}
          >
            <Paperclip size={15} />
            <span className="nav-label">Clips</span>
          </button>
          {library && (
            <>
              <button
                ref={sidebarSelection.rowRef("pinned")}
                className={
                  module === "notes" && pinnedOnly ? "nav active" : "nav"
                }
                disabled={readOnly}
                onClick={() => {
                  if (!canNavigate()) return;
                  requestHeading("notes", "pinned");
                  setModule("notes");
                  setSelected(null);
                  setTrash(false);
                  setTag("");
                  setPinnedOnly(true);
                  setLinkedOnly(false);
                  setDrawer(false);
                }}
              >
                <Pin size={15} />
                <span className="nav-label">Pinned</span>
                <span>
                  {snapshot?.metadata.filter(
                    (meta) =>
                      meta.pinned &&
                      notes.some(
                        (note) => note.id === meta.noteId && !note.trashedAt,
                      ),
                  ).length ?? 0}
                </span>
              </button>
              {links.service && (
                <button
                  ref={sidebarSelection.rowRef("linked")}
                  className={
                    module === "notes" && linkedOnly ? "nav active" : "nav"
                  }
                  onClick={() => {
                    if (!canNavigate()) return;
                    requestHeading("notes", "linked");
                    clearSourceRoute();
                    setModule("notes");
                    setSelected(null);
                    setTrash(false);
                    setTag("");
                    setPinnedOnly(false);
                    setLinkedOnly(true);
                    setDrawer(false);
                  }}
                >
                  <span className="nav-label">Linked</span>
                </button>
              )}
              <button
                ref={sidebarSelection.rowRef("tags")}
                className={module === "tags" ? "nav active" : "nav"}
                disabled={readOnly}
                onClick={() => {
                  if (!canNavigate()) return;
                  requestHeading("tags", "tags");
                  setModule("tags");
                  setSelected(null);
                  setDrawer(false);
                }}
              >
                <Tags size={15} />
                <span className="nav-label">Manage tags</span>
              </button>
            </>
          )}
          <p className="group">Tags</p>
          {tags.map((t, index) => {
            const count = notes.filter(
              (note) => !note.trashedAt && note.tags.includes(t),
            ).length;
            return (
              <button
                key={t}
                ref={sidebarSelection.rowRef(sidebarTagKeys[index]!)}
                aria-label={`${t}, ${count} ${count === 1 ? "note" : "notes"}`}
                className={
                  module === "notes" && tag === t ? "nav active" : "nav"
                }
                onClick={() => navigate(false, t)}
              >
                <span
                  className="tag-swatch"
                  aria-hidden="true"
                  style={
                    snapshot?.tags.find(
                      (value) => value.state === "active" && value.name === t,
                    )?.color
                      ? {
                          background: snapshot.tags.find(
                            (value) =>
                              value.state === "active" && value.name === t,
                          )!.color!,
                        }
                      : undefined
                  }
                />
                <span className="nav-label" title={t}>
                  {t}
                </span>
                <span>{count}</span>
              </button>
            );
          })}
          <button
            ref={sidebarSelection.rowRef("trash")}
            className={module === "notes" && trash ? "nav active" : "nav"}
            onClick={() => navigate(true)}
          >
            <Trash2 size={15} />
            <span className="nav-label">Trash</span>
            <span>{notes.filter((n) => n.trashedAt).length}</span>
          </button>
        </nav>
        <footer>
          <p title="Notes stay encrypted in this browser. This beta does not sync.">
            ◉ Beta · Local only
          </p>
          <button
            className="nav"
            onClick={(event) => {
              if (!canNavigate()) return;
              settingsReturnFocus.current = drawer
                ? (desktop?.navigationRef.current ?? menuRef.current)
                : event.currentTarget;
              setSettings(true);
              setDrawer(false);
            }}
          >
            <Settings size={15} />
            <span className="nav-label">Settings</span>
          </button>
        </footer>
      </aside>
      <SidebarResize
        value={sidebarWidth}
        onChange={setSidebarWidth}
        controls="notes-sidebar"
        disabled={!wide || !!(desktop && sidebarHidden)}
      />
      <main id="main" className="sheet" inert={drawer}>
        <div className="desktop-sheet-content">
        <SearchSurface
          active={searchActive}
          privacyVersion={searchPrivacyVersion}
        >
          {searchActionError && (
            <p role="alert" className="banner">
              {searchActionError}
            </p>
          )}
          {searchOwner.service ? (
            <SearchView
              state={searchOwner.state}
              query={searchQuery}
              tab={searchTab}
              onQueryChange={editSearchQuery}
              onSubmit={(raw) => enterSearch(raw, true)}
              onTabChange={selectSearchTab}
              onClear={clearSearch}
              onOpen={(target) => void openSearchTarget(target)}
              onPage={(cursor) =>
                runSearchAction(() => searchOwner.service!.page(cursor))
              }
              onContinue={(handle) =>
                runSearchAction(() => searchOwner.service!.continue(handle))
              }
              onCancelPage={() => searchOwner.service?.cancelPage()}
              onCancel={cancelSearchWork}
              navigationState={searchNavigation}
            />
          ) : (
            <section className="empty" aria-label="Search">
              <h1>Search</h1>
              <p role="status">
                {searchOwner.error || sourceOwners.error
                  ? "Search couldn’t open. Your saved data was not changed."
                  : "Opening local search…"}
              </p>
              {(searchOwner.error || sourceOwners.error) && (
                <button
                  onClick={() => {
                    searchOwner.retry();
                    if (sourceOwners.error) sourceOwners.retry();
                  }}
                >
                  Try again
                </button>
              )}
              <button onClick={clearSearch}>Clear search</button>
            </section>
          )}
        </SearchSurface>
        {!searchActive && searchOrigin && (
          <div className="search-return">
            <button onClick={returnToSearch}>Back to search</button>
          </div>
        )}
        <div
          className="workspace-route"
          hidden={searchActive}
          inert={searchActive}
        >
          {offline && module === "notes" && (
            <p className="banner">
              You’re offline. Notes still saves in this browser. This beta does
              not sync.
            </p>
          )}
          {sourceOwner && sourceOwners.error && (
            <div className="banner error" role="alert">
              {sourceOwners.error}
              <button onClick={sourceOwners.retry}>Try again</button>
            </div>
          )}
          {legacyReadOnly && (
            <div className="banner" role="status">
              Library metadata exceeds its supported limit. You can read and
              export your notes. Editing and library changes are unavailable.
              Export a copy, or erase this workspace from Settings.
            </div>
          )}
          <LibraryActionFeedback
            action={libraryFeedbackAction}
            reload={reloadLibrary}
          />
          {error && (
            <div role="alert" className="banner error">
              {error}
              <button
                onClick={() => {
                  setError("");
                  void refresh();
                }}
              >
                Try again
              </button>
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              {undo && (
                <button
                  disabled={libraryAction.busy || !!libraryAction.error}
                  onClick={() => {
                    if (library && "expiresAt" in undo) {
                      const receipt = { ...undo };
                      libraryAction.start(
                        (id) => library.undoTrash(receipt, id),
                        (result) => {
                          acceptLibrary(result);
                          setUndo(null);
                          setNotice("Action undone");
                        },
                      );
                    } else if (!("expiresAt" in undo)) void restore(undo);
                  }}
                >
                  Undo
                </button>
              )}
              {download && (
                <a
                  href={download.url}
                  download={download.name}
                  onClick={downloadNotes}
                >
                  Download {notice === "Export prepared" ? "" : "again"}
                </a>
              )}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {importError && !setupOpen && !imports && (
            <p className="banner error" role="alert">
              {importError}
            </p>
          )}
          {linkNotice && (
            <p className="banner" role="status">
              {linkNotice}
            </p>
          )}
          {linkAdmission?.mode === "index-recovery" && (
            <p role="status" className="banner">
              Note links need repair. Your notes are still available.
              <button onClick={() => setLinkRecoveryOpen(true)}>
                Review note links
              </button>
            </p>
          )}
          {links.error && (
            <p role="alert">
              {links.error}
              <button onClick={links.retry}>Retry note links</button>
            </p>
          )}
          {(["study", "journal", "clips"] as const)
            .filter(
              (view) =>
                (module === view ||
                  (searchOrigin?.module === view && view !== "journal")) &&
                !(view === "journal" && (setupOpen || searchActive)),
            )
            .map((view) => (
              <div
                key={view}
                hidden={!!editing || module !== view}
                inert={!!editing || module !== view}
                style={
                  editing || module !== view
                    ? undefined
                    : { display: "flex", flex: 1, minHeight: 0 }
                }
              >
                <Suspense
                  fallback={
                    <section
                      aria-label={`Opening ${view === "journal" ? "Journal" : view === "clips" ? "Clips" : "Study"}`}
                      aria-busy="true"
                    />
                  }
                >
                  <CollectionsHost
                    heading={headingFor(view)}
                    session={session}
                    onReopen={
                      sourceOwner
                        ? () => {
                            if (canNavigate()) sourceOwners.retry();
                          }
                        : undefined
                    }
                    covered={
                      !!editing ||
                      module !== view ||
                      searchActive ||
                      setupOpen ||
                      settings ||
                      signOutOpen ||
                      !!imports ||
                      exportNotes !== null ||
                      erase ||
                      historyNote !== null ||
                      emptyConfirm !== null ||
                      incomingNoteIntentActive
                    }
                    collections={
                      sourceOwner ? sourceOwners.collections : undefined
                    }
                    onOpenSource={
                      sourceOwners.service
                        ? (request) => void openSource(request)
                        : undefined
                    }
                    openEntry={studyEntry}
                    openClip={view === "clips" ? clipSearchRequest : null}
                    holdClipSearchOrigin={searchOrigin?.module === "clips"}
                    restoreClipSearchOrigin={restoreClipSearchOrigin}
                    openCard={view === "study" ? cardSearchRequest : null}
                    onReturnToSearch={returnToSearch}
                    onSearchReaderResult={searchReaderResult}
                    view={view}
                    onEpochChange={() => {
                      invalidateSidebarSelection();
                      retireCreate();
                      selectedSnapshot.current = undefined;
                      setSelected(null);
                    }}
                    onOpenNote={(id) => {
                      if (!canNavigate()) return;
                      const linked = notes.find(
                        (note) => note.id === id && !note.trashedAt,
                      );
                      if (!linked) {
                        setNotice("This note is no longer available.");
                        return;
                      }
                      setSelected(linked.id);
                      setDrawer(false);
                    }}
                  />
                </Suspense>
              </div>
            ))}
          {module === "study" && sourceProjectionError && (
            <p role="status" className="banner">
              {sourceProjectionError}
            </p>
          )}
          {module === "study" && sourceUnavailable && (
            <div className="banner" role="status">
              {sourceUnavailable.reason === "legacy"
                ? "This older card has no saved passage location."
                : sourceUnavailable.reason === "stale"
                  ? "The source passage changed."
                  : sourceUnavailable.reason === "trashed"
                    ? "This source note is in Trash."
                    : "This source note is no longer available."}
              {(sourceUnavailable.reason === "legacy" ||
                sourceUnavailable.reason === "stale") &&
                !editing && (
                  <button
                    onClick={() =>
                      void openSource(sourceUnavailable.request, true)
                    }
                  >
                    Open note without passage
                  </button>
                )}
            </div>
          )}
          {module === "study" && editing && (
            <div className="banner">
              From a Study card.{" "}
              <button
                onClick={() => {
                  if (!canNavigate()) return;
                  setSelected(null);
                  assignSourceTarget(null);
                  setSourceProjectionError(null);
                  setSourceReturn(null);
                  setSourceUnavailable(null);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLElement>(
                        "#main .study-review-stack button, #main .study-view",
                      )
                      ?.focus({ preventScroll: true }),
                  );
                }}
              >
                Back to card
              </button>
            </div>
          )}
          {module === "tags" && library && snapshot && (
            <TagsView
              heading={headingFor("tags")}
              readOnly={readOnly}
              key={snapshot.token.epoch}
              library={library}
              snapshot={snapshot}
              onResult={acceptLibrary}
              reload={reloadLibrary}
              onOpenTag={(name) => navigate(false, name)}
            />
          )}
          <div className="note-actor-pool" hidden={!editing}>
            {noteActors.map((actor) => (
              <div
                key={`${session.accountId}:${snapshot?.token.epoch ?? ""}:${searchPrivacyVersion}:${actor.id}`}
                className="note-actor"
                hidden={actor.id !== selected}
                inert={actor.id !== selected || searchActive}
                aria-hidden={actor.id !== selected || searchActive}
                data-note-actor-active={actor.id === selected && !searchActive}
              >
                <NoteEditor
                  active={actor.id === selected && !searchActive}
                  key={actor.id}
                  note={actor}
                  formatNoteLink={formatNoteLink}
                  noteLinks={
                    links.service
                      ? {
                          service: links.service,
                          noteId: actor.id,
                          onOpen: (target) => {
                            void openNoteTarget(target);
                          },
                        }
                      : undefined
                  }
                  store={store}
                  readOnly={readOnly}
                  sourceWriter={library?.updateWithSourceSteps}
                  sourceLibrary={library}
                  source={
                    sourceOwners.service && sourceOwners.collections && library
                      ? {
                          library,
                          collections: sourceOwners.collections,
                          service: sourceOwners.service,
                          target: actor.id === selected ? sourceTarget : null,
                          onTargetUnavailable: () => {
                            if (
                              actor.id !== selected ||
                              !sourceTarget ||
                              activeSourceTarget.current !== sourceTarget.key
                            )
                              return;
                            assignSourceTarget(null);
                            setSourceProjectionError(
                              "This saved passage target changed. Open the source again from the card.",
                            );
                          },
                          onOpenCard: openStudyEntry,
                        }
                      : undefined
                  }
                  tagCatalog={snapshot?.tags.filter(
                    (tag) => tag.state === "active",
                  )}
                  pinned={!!metadata.get(actor.id)?.pinned}
                  onPin={
                    library && snapshot
                      ? () => {
                          const token = { ...snapshot.token },
                            pinned = !metadata.get(actor.id)?.pinned;
                          libraryAction.start(
                            (id) =>
                              library.setPinned(actor.id, pinned, token, id),
                            acceptLibrary,
                          );
                        }
                      : undefined
                  }
                  onHistory={
                    library && !readOnly
                      ? () => setHistoryNote(actor)
                      : undefined
                  }
                  onSaved={(n) =>
                    setNotes((v) => [n, ...v.filter((x) => x.id !== n.id)])
                  }
                  onBack={() => {
                    setSelected(null);
                    setModule("notes");
                  }}
                  onTrash={(n) => void move(n)}
                  onExport={(n) => requestExport([n])}
                />
              </div>
            ))}
          </div>
          {(module === "notes" || editing) && !editing && (
            <>
              <header className="page-heading notes-library-heading">
                <div>
                  <h1 ref={notesHeadingRef}>
                    {linkedOnly
                      ? "Linked"
                      : trash
                        ? "Trash"
                        : pinnedOnly
                          ? "Pinned"
                          : tag
                            ? `# ${tag}`
                            : query
                              ? "Search results"
                              : "All notes"}
                  </h1>
                  <span className="notes-library-count">
                    {linkedOnly && linkedQuery?.status !== "ready"
                      ? "Checking links"
                      : `${visible.length} ${visible.length === 1 ? "note" : "notes"}`}
                  </span>
                </div>
                <div className="actions notes-library-toolbar">
                  {!trash && (
                    <div className="notes-library-view" role="group" aria-label="View">
                      <button
                        aria-label="List view"
                        aria-pressed={!grid}
                        onClick={() => setGrid(false)}
                      >
                        List
                      </button>
                      <button
                        aria-label="Grid view"
                        aria-pressed={grid}
                        onClick={() => setGrid(true)}
                      >
                        Grid
                      </button>
                    </div>
                  )}
                  {library && snapshot && (
                    <div className="library-sort">
                      <select
                        aria-label="Sort notes"
                        value={sort}
                        disabled={
                          readOnly ||
                          libraryAction.busy ||
                          !!libraryAction.error
                        }
                        onChange={(event) => {
                          if (readOnlyRef.current) return;
                          const value = event.target.value as NoteSort,
                            token = { ...snapshot.token };
                          libraryAction.start(
                            (id) => library.setSort(value, token, id),
                            acceptLibrary,
                          );
                        }}
                      >
                        <option value="edited">Edited</option>
                        <option value="created">Created</option>
                        <option value="title">Title</option>
                      </select>
                    </div>
                  )}
                  {trash && library && snapshot && (
                    <button
                      className="danger"
                      disabled={
                        !visible.length ||
                        readOnly ||
                        libraryAction.busy ||
                        !!libraryAction.error
                      }
                      onClick={() =>
                        setEmptyConfirm({ mode: "ready", snapshot })
                      }
                    >
                      Empty Trash
                    </button>
                  )}
                  {!trash && (
                    <>
                      <button
                        disabled={importing || readOnly}
                        onClick={() => chooseMarkdown()}
                      >
                        Import Markdown
                      </button>
                      <button
                        className="primary"
                        disabled={readOnly || creatingNote}
                        onClick={() => void create()}
                      >
                        <Plus size={13} />
                        New note
                      </button>
                    </>
                  )}
                </div>
              </header>
              {trash && (
                <p className="banner">
                  Notes stay here until you empty Trash. Emptying Trash also
                  removes their version history and can’t be undone.
                </p>
              )}
              {!loaded ? (
                <p className="empty">Loading notes…</p>
              ) : linkedOnly && linkedQuery?.status !== "ready" ? (
                <section className="empty" aria-live="polite">
                  <h2>
                    {linkedQuery?.status === "invalid"
                      ? "Note links need repair"
                      : linkedQuery?.status === "paused-limit"
                        ? "Note-link checking is paused"
                        : "Checking note links…"}
                  </h2>
                  <p>
                    {linkedQuery?.status === "invalid"
                      ? "Review note-link recovery. Your notes are still available."
                      : "Complete checking to see which notes are linked."}
                  </p>
                  {linkedQuery?.status === "invalid" && (
                    <button onClick={() => setLinkRecoveryOpen(true)}>
                      Review note links
                    </button>
                  )}
                  {linkedQuery?.status !== "invalid" && links.service && (
                    <button
                      onClick={() => {
                        if (linkVerificationPending.current) return;
                        linkVerificationPending.current = true;
                        void trackOperation(() => links.service!.verifyGraph())
                          .catch(() =>
                            setLinkNotice(
                              "Couldn’t check note links. Try again.",
                            ),
                          )
                          .finally(() => {
                            linkVerificationPending.current = false;
                          });
                      }}
                    >
                      Continue verification
                    </button>
                  )}
                  <button onClick={() => navigate()}>Show all notes</button>
                </section>
              ) : visible.length === 0 ? (
                <section
                  className={
                    query || trash || pinnedOnly || linkedOnly
                      ? "empty"
                      : "empty library-empty"
                  }
                >
                  <span className="library-empty-icon">
                    <FileText size={20} aria-hidden="true" />
                  </span>
                  <h2>
                    {query
                      ? "No matching notes"
                      : trash
                        ? "Trash is empty"
                        : pinnedOnly
                          ? "No pinned notes yet"
                          : linkedOnly
                            ? "No linked notes yet"
                            : "No notes yet"}
                  </h2>
                  <p>
                    {query
                      ? "Try another title, word or tag."
                      : trash
                        ? "Notes you move to Trash appear here."
                        : pinnedOnly
                          ? "Pin a note from its menu to see it here."
                          : linkedOnly
                            ? "Link to a note from the editor to connect your notes."
                            : "Write your first note, or bring in what you already have."}
                  </p>
                  {query ? (
                    <button onClick={() => setQuery("")}>Clear search</button>
                  ) : (
                    !trash && (
                      <>
                        <p>Notes are encrypted on this device.</p>
                        <div className="library-empty-actions">
                          <button
                            className="primary"
                            disabled={readOnly || creatingNote}
                            onClick={() => void create()}
                          >
                            New note
                          </button>
                          <button
                            disabled={readOnly}
                            onClick={() => chooseMarkdown()}
                          >
                            Import notes
                          </button>
                        </div>
                        <p className="library-local-copy">
                          This beta doesn’t sync or back up notes. Export a copy
                          before clearing{" "}
                          {desktop ? "app data" : "this browser’s data"}.
                        </p>
                      </>
                    )
                  )}
                </section>
              ) : (
                <div
                  className={
                    grid && !trash ? "note-collection grid" : "note-collection"
                  }
                >
                  {visible.map((n) => (
                    <article className="note-row" key={n.id}>
                      {trash ? (
                        <>
                          <div>
                            <h2>{n.title || "Untitled note"}</h2>
                            <p>{plainText(n.document).slice(0, 160)}</p>
                          </div>
                          <button
                            disabled={
                              readOnly ||
                              libraryAction.busy ||
                              !!libraryAction.error
                            }
                            onClick={() => void restore(n)}
                          >
                            Restore
                          </button>
                          <button onClick={() => requestExport([n])}>
                            Export Markdown
                          </button>
                        </>
                      ) : (
                        <button
                          className="note-open"
                          onClick={() => setSelected(n.id)}
                        >
                          <h2>{n.title || "Untitled note"}</h2>
                          <p>{plainText(n.document).slice(0, 180)}</p>
                          <div className="metadata">
                            {metadata.get(n.id)?.pinned && (
                              <Pin size={13} aria-label="Pinned" />
                            )}
                            {n.tags.map((t) => (
                              <span className="tag" key={t}>
                                {t}
                              </span>
                            ))}
                            <time dateTime={n.updatedAt}>
                              {new Date(n.updatedAt).toLocaleDateString()}
                            </time>
                          </div>
                        </button>
                      )}
                      {!trash && library && snapshot && (
                        <div className="library-row-actions">
                          <button
                            aria-label={`${metadata.get(n.id)?.pinned ? "Unpin" : "Pin"} ${n.title || "Untitled note"}`}
                            aria-pressed={!!metadata.get(n.id)?.pinned}
                            disabled={
                              readOnly ||
                              libraryAction.busy ||
                              !!libraryAction.error
                            }
                            onClick={() => {
                              if (readOnlyRef.current) return;
                              const token = { ...snapshot.token },
                                pinned = !metadata.get(n.id)?.pinned;
                              libraryAction.start(
                                (id) =>
                                  library.setPinned(n.id, pinned, token, id),
                                acceptLibrary,
                              );
                            }}
                          >
                            <Pin size={15} />
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".md,.markdown,.mdown,text/markdown"
          onChange={(e) => void readFiles(e.target.files)}
        />
        </div>
      </main>
      {linkRecoveryOpen && links.service && (
        <Dialog
          title="Note links"
          onClose={() => {
            if (linkRecoveryCanClose.current()) setLinkRecoveryOpen(false);
          }}
        >
          <NoteLinksPanel
            embedded
            service={links.service}
            canClose={linkRecoveryCanClose}
            dirty={false}
            onOpen={(target) => {
              void openNoteTarget(target);
            }}
            onClose={() => setLinkRecoveryOpen(false)}
          />
        </Dialog>
      )}
      {setupOpen && (
        <FirstRunSetup
          email={session.email}
          environment={desktop ? "desktop" : "browser"}
          readOnly={readOnly}
          importState={setupImportState}
          importedCount={setupImported}
          remainingCount={imports?.length ?? 0}
          importMessage={importError}
          onChooseMarkdown={() => chooseMarkdown("setup")}
          onComplete={finishSetup}
          onClose={finishSetup}
        />
      )}
      {historyNote && library && (
        <VersionHistory
          readOnly={readOnly}
          noteLinks={
            links.service
              ? {
                  service: links.service,
                  noteId: historyNote.id,
                  onOpen: (target) => {
                    void openNoteTarget(target);
                  },
                }
              : undefined
          }
          note={notes.find((note) => note.id === historyNote.id) ?? historyNote}
          library={library}
          reload={reloadLibrary}
          onClose={() => setHistoryNote(null)}
          onResult={(result) => {
            acceptLibrary(result);
            if (result.note) selectedSnapshot.current = result.note;
          }}
        />
      )}
      {emptyConfirm?.mode === "ready" && library && (
        <Dialog
          title="Empty Trash?"
          onClose={() => {
            if (!libraryAction.busy && !libraryAction.error)
              setEmptyConfirm(null);
          }}
        >
          <p>
            Permanently remove{" "}
            {
              emptyConfirm.snapshot.notes.filter((note) => note.trashedAt)
                .length
            }{" "}
            notes and their version history? This can’t be undone. Study source
            links to these notes will become unavailable.
          </p>
          <LibraryActionFeedback
            action={libraryFeedbackAction}
            reload={reloadLibrary}
          />
          <button
            disabled={libraryAction.busy}
            onClick={() => setEmptyConfirm(null)}
          >
            Cancel
          </button>
          <button
            className="danger"
            disabled={readOnly || libraryAction.busy || !!libraryAction.error}
            onClick={() => {
              if (readOnlyRef.current) return;
              const token = { ...emptyConfirm.snapshot.token };
              libraryAction.start(
                (id) => library.emptyTrash(token, id),
                (result) => {
                  acceptLibrary(result);
                  setEmptyConfirm(null);
                  setUndo(null);
                  selectedSnapshot.current = undefined;
                  setSelected(null);
                  setNotice(`Removed ${result.removedCount} notes permanently`);
                },
              );
            }}
          >
            Empty Trash
          </button>
        </Dialog>
      )}
      {settings && (
        <Dialog
          title="Settings"
          className="settings-dialog"
          returnFocusTo={settingsReturnFocus.current}
          onClose={() => {
            if (settingsStudyGuard.current)
              settingsStudyGuard.current.requestLeave(() => setSettings(false));
            else setSettings(false);
          }}
        >
          <SettingsView
            studyOwner={
              sourceOwners.collections
                ? {
                    status: "ready",
                    store: sourceOwners.collections,
                    identity: session,
                    retry: sourceOwners.retry,
                  }
                : sourceOwners.error
                  ? { status: "error", retry: sourceOwners.retry }
                  : sourceOwner
                    ? { status: "loading" }
                    : { status: "unavailable" }
            }
            onStudyGuardReady={(guard) => {
              settingsStudyGuard.current = guard;
            }}
            email={session.email}
            preferences={prefs}
            onSignOut={() => {
              setSignOutError("");
              setSignOutOpen(true);
            }}
            onExport={() => requestExport(notes, true)}
            onErase={() => setErase(true)}
            onDone={() => setSettings(false)}
            onSetup={() => openSetup("manual")}
            setupUnavailable={incomingNoteIntentActive}
          />
        </Dialog>
      )}
      {signOutOpen && (
        <Dialog
          title="Sign out of Notes?"
          onClose={() => {
            if (!signOutBusy) setSignOutOpen(false);
          }}
        >
          <p>
            Your encrypted notes stay in this browser. Sign in to the same
            account in this browser to open them again. They are not backed up
            or synced.
          </p>
          {signOutError && (
            <p className="error" role="alert">
              {signOutError}
            </p>
          )}
          <button disabled={signOutBusy} onClick={() => setSignOutOpen(false)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={signOutBusy}
            onClick={async () => {
              setSignOutBusy(true);
              setSignOutError("");
              try {
                await onSignOut();
                setSignOutOpen(false);
              } catch {
                setSignOutError("Couldn’t sign out. Try again.");
              } finally {
                setSignOutBusy(false);
              }
            }}
          >
            {signOutBusy ? "Signing out…" : "Sign out"}
          </button>
        </Dialog>
      )}
      {imports && (
        <Dialog
          title="Import Markdown"
          onClose={() => {
            if (!importPending.current) cancelMarkdown();
          }}
        >
          <p>{imports.length} files ready. Original files remain untouched.</p>
          {importError && <p role="alert">{importError}</p>}
          {readOnly && (
            <p role="status">
              Import is unavailable while Notes is read-only. You can cancel
              without changing the originals.
            </p>
          )}
          <div className="stack">
            <button
              className="primary"
              disabled={importing || readOnly}
              onClick={() => void importAll()}
            >
              {importing ? "Importing…" : "Import remaining"}
            </button>
            <button disabled={importing} onClick={cancelMarkdown}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {exportNotes && (
        <Dialog
          title="Export Markdown"
          onClose={() => {
            if (!exportWorking.current) setExportNotes(null);
          }}
        >
          <p>
            Exported files are readable copies. Anyone with them can read your
            notes. Notes Markdown export does not include Study, Journal, Clips,
            tag colors, pins or version history. Note references preserve local
            identity tokens, not access grants. Markdown import does not restore
            the note-link graph.
          </p>
          <button disabled={exportBusy} onClick={() => setExportNotes(null)}>
            Cancel
          </button>
          <button
            disabled={exportBusy}
            className="primary"
            onClick={() => void prepareExport()}
          >
            Export
          </button>
        </Dialog>
      )}
      {erase && (
        <Dialog
          title="Erase notes from this browser?"
          onClose={() => {
            if (!busy && !libraryAction.busy && !libraryAction.error)
              setErase(false);
          }}
        >
          <p>
            This permanently removes this account’s notes and Trash, tags, pins
            and version history, Study decks, cards and reviews, saved Clips,
            and protected Journal entries, habits and recovery drafts from this
            device. There is no synced copy. This can’t be undone. Your account
            stays signed in.
          </p>
          <p>
            Notes Markdown export does not include Study, Journal, Clips, tag
            colors, pins or version history. Export Journal, Study and Clips
            separately before erasing. Their exports do not provide automatic
            restoration.
          </p>
          <LibraryActionFeedback
            action={libraryFeedbackAction}
            reload={reloadLibrary}
          />
          <div className="stack">
            <button onClick={() => requestExport(notes, true)}>
              Export all notes
            </button>
            <button
              disabled={busy || libraryAction.busy || !!libraryAction.error}
              onClick={() => {
                if (!canNavigate()) return;
                setErase(false);
                setEraseText("");
                setSettings(false);
                setModule("journal");
                setSelected(null);
                setDrawer(false);
              }}
            >
              Open Journal to export
            </button>
            <button
              disabled={busy || libraryAction.busy || !!libraryAction.error}
              onClick={() => {
                if (!canNavigate()) return;
                setErase(false);
                setEraseText("");
                setSettings(false);
                setModule("study");
                setSelected(null);
                setDrawer(false);
              }}
            >
              Open Study to export decks
            </button>
            <button
              disabled={busy || libraryAction.busy || !!libraryAction.error}
              onClick={() => {
                if (!canNavigate()) return;
                setErase(false);
                setEraseText("");
                setSettings(false);
                setModule("clips");
                setSelected(null);
                setDrawer(false);
              }}
            >
              Open Clips to export
            </button>
            <label>
              Type ERASE to confirm
              <input
                value={eraseText}
                onChange={(e) => setEraseText(e.target.value)}
              />
            </label>
            <button
              disabled={
                busy ||
                libraryAction.busy ||
                !!libraryAction.error ||
                eraseText !== "ERASE"
              }
              className="danger"
              onClick={async () => {
                setBusy(true);
                try {
                  if (libraryRead?.mode === "legacy-read-only" && library) {
                    const deviceGeneration =
                      libraryRead.recovery.deviceGeneration;
                    libraryAction.start(
                      (id) =>
                        library.eraseLegacy(
                          { deviceGeneration, confirmation: "ERASE" },
                          id,
                        ),
                      (result) => {
                        acceptLibrary(result);
                        setErase(false);
                        setSettings(false);
                        setEraseText("");
                        setSelected(null);
                        selectedSnapshot.current = undefined;
                      },
                    );
                    return;
                  }
                  await store.erase();
                  selectedSnapshot.current = undefined;
                  setErase(false);
                  setSettings(false);
                  setEraseText("");
                  setSelected(null);
                  await refresh();
                } catch {
                  setError("Couldn’t erase notes. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Erase notes
            </button>
            <button
              disabled={busy || libraryAction.busy || !!libraryAction.error}
              onClick={() => setErase(false)}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
