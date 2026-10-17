// The shell UI: app header + provenance badge, page nav, view-chrome (pantry picker), the
// active view, an add-recipe panel, and toasts. Renders whatever app the composition root
// loaded (trusted or sandboxed) — the UI is app-agnostic.

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { DatabaseIcon } from "./data-icon.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { replayCase, type ActivityItem, type Case, type PotyroRuntime, type ReplayReport, type ReplayTarget } from "@potyro/runtime";
import type { Provenance } from "@potyro/host";
import { LayoutHost, PageCountContext, RecordForm, TRUST_REQUEST, ViewHost, backdropKind, backdropOf, byPeople, createDefaults, usePageTitles } from "@potyro/views";
import { PageHeader, type PageCta } from "./page-header.js";
import { PrimaryBar } from "./page-primary.js";
import { FilterChrome } from "./filter-chrome.js";
import { SummaryStrip } from "./summary-strip.js";
import { Studio } from "./studio.js";
import { CaseRecorder } from "./case-recorder.js";
import { saveCase, hasRecordedActivity, caseLabel } from "./app-cases.js";
import { CaseReport } from "./case-report.js";
import { FixPanel } from "./fix-panel.js";
import { startFix } from "./start-fix.js";
import { currentLocale } from "./locale.js";
import { canInvestigate, engineLabel } from "./engines.js";
import { useEngineConfig } from "./engine-store.js";
import type { LoopDeps, LoopOutcome, LoopStep } from "@potyro/generator/agent";
import { Launcher, openInstalledApp } from "./launcher.js";
import { AppChrome, type ChromePage, type ChromeQuick, type ChromeTool } from "./chrome.js";
import { SyncStatus } from "./sync-status.js";
import { History } from "./history.js";
import { ActivityPanel, loadActivity, markSeen } from "./activity-panel.js";
import { ChatPanel, ChatPeek, RecordThread, chatSupported, unreadCount, useThread } from "./chat-panel.js";
import { ROOM_THREAD } from "@potyro/store";
import { getUserApp, saveUserApp, setUserAppTrusted } from "./user-apps.js";
import { TrustDialog } from "./trust-dialog.js";
import type { Resolved } from "potyro";
import { InlineEdit } from "./inline-edit.js";
import { describePoint, type Pointed, type PointRef } from "./point-target.js";
import { buildAndValidate } from "./validate-app.js";
import { modulesOf } from "./app-modules.js";
import { withLibrariesStoodIn } from "./package-modules.js";
import { AskPanel } from "./ask-panel.js";
import { useAskEnabled } from "./ask-setting.js";
import { clearAskMaterial, peekAskMaterial } from "./share-inbox.js";
import type { Toaster } from "./toaster.js";
import { Picker, type PickerHost } from "./picker.js";
import { UiSurfaces, type UiHost } from "./ui-host.js";
import type { NavHost } from "./nav-host.js";
import { ViewErrorBoundary } from "./view-error-boundary.js";

import { chooseScope } from "./scope.js";
import { ScopeEmpty, ScopeSwitcher, useOpeningScope } from "./scope-switcher.js";
import { appKey, recordSignals } from "./launcher-store.js";
import { PeoplePanel } from "./people-panel.js";
import { ClaimPrompt } from "./guests-panel.js";
import { ShareSheet } from "./share-sheet.js";
import { takeStudioHandoff } from "./studio-handoff.js";
import { canRemix, RemixDialog } from "./remix.js";
import { LockBanner, WRITE_CONTROLS, useAppLock, type AppLock } from "./app-lock.js";
import { isRtl, languageNote, shownName } from "./app-words.js";
import { languagePrefs } from "./locale.js";
import { optionLabel } from "@potyro/views";
import { acceptLinkParams } from "potyro";
import type { Arrival } from "./app-link.js";

interface EditorState {
  entity: string;
  id?: string;
  /** Preset values for a new record (a quick action's prefill). */
  initial?: Record<string, unknown>;
  /** After creating, open the new record's detail. */
  openAfter?: boolean;
  /** After creating, hand the new id to whoever asked for the record (the scope picker's "New…"). */
  onCreated?: (id: string) => void;
}

// Declarative quick action (mirrors potyro's QuickAction; kept structural to avoid a hard dep here).
interface QuickActionDef {
  id: string;
  label: string;
  icon?: string;
  entity: string;
  mode?: "auto" | "form" | "menu" | "instant";
  open?: boolean;
  openPage?: string;
  prefill?: Record<string, unknown>;
}

interface QuickMenuState {
  qa: QuickActionDef;
  field: string;
  options: string[];
}

// Sentinel page id for the grid "home" overview (grid nav mode only).
const HOME = "__home__";

/**
 * Survives the reload that re-runs an edited app, or one let run as yours, so it doesn't cost you your
 * place: the page, and what it was opened with — a game's code from a link must not be lost to the
 * reload that lets the game run (docs/24 §11). Plain text (a page id) in what older builds wrote.
 */
const RETURN_TO_PAGE = "potyro:return-to-page";

function readReturning(): { page: string; params: Record<string, unknown> } | null {
  const raw = globalThis.sessionStorage?.getItem(RETURN_TO_PAGE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { page?: unknown; params?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.page === "string") {
      const params = parsed.params && typeof parsed.params === "object" && !Array.isArray(parsed.params) ? (parsed.params as Record<string, unknown>) : {};
      return { page: parsed.page, params };
    }
  } catch {
    // an older build's page id
  }
  return { page: raw, params: {} };
}

function holdReturning(page: string, params: Record<string, unknown>): void {
  globalThis.sessionStorage?.setItem(RETURN_TO_PAGE, JSON.stringify({ page, params }));
}
/** Set across a re-run that edit mode asked for (a move), so it is still on when the app is back. */
const KEEP_EDITING = "potyro:keep-editing";

// One object-type tile on the grid home: icon + label + live record count. Reuses the entity's list
// page query for the count, so it reflects the same data the list shows.
function GridTile({
  runtime,
  pageId,
  label,
  icon,
  onOpen,
}: {
  runtime: PotyroRuntime;
  pageId: string;
  label: string;
  icon: string;
  onOpen: () => void;
}) {
  const { rows } = runtime.usePageQuery(pageId, {});
  return (
    <button type="button" className="k-objtile" onClick={onOpen}>
      <span className="k-objtile-icon" aria-hidden>{icon}</span>
      <span className="k-objtile-count">{rows.length}</span>
      <span className="k-objtile-name">{label}</span>
    </button>
  );
}

interface AppProps {
  /** Whether this app uses the CRDT store — drives the sync status pill. */
  sync?: boolean;
  /** Lets `ctx.navigate` from app code actually change pages — bound on mount. */
  navHost?: NavHost;
  /** Backs a real `ctx.ui.pick` modal; omit for surfaces that never pick. */
  picker?: PickerHost;
  /** Backs `ctx.ui.sheet`/`menu`/`form`/`progress` (#112); omit for surfaces that never ask. */
  questions?: UiHost;
  runtime: PotyroRuntime;
  provenance: Provenance;
  toaster: Toaster;
  appId?: string;
  /**
   * What to CALL this app here — the name the person gave it, not the one written in its source.
   *
   * Three names exist and they were not agreed: the definition's `name` (what the model wrote),
   * the saved app's `name` (Rename, in the tile menu) and the launcher tile's `displayName` (Edit
   * tile). The top bar read the first, so renaming a copy of Groceries to "Todo" left the app
   * still calling itself Groceries on every screen.
   *
   * This is the SAVED app's name. The tile's `displayName` is deliberately not it: editing a tile
   * labels a shortcut on this device, and the app goes on saying what it says. Absent — a preview,
   * a fixture — the definition's name stands.
   */
  name?: string;
  /** The colour this device gave this app (its tile's hue), if any. */
  appAccent?: string;
  /** How the current app was launched — for highlighting it in the launcher. */
  currentKind?: "user";
  onExport?: () => void;
  onImport?: () => void;
  /** This app's records, on the Data page. */
  onData?: () => void;
  /** Enables the Studio + launcher (the shell's top-level app only — not the preview). */
  generator?: boolean;
  /** Set while this copy may not write to the shared data (KA-22, #63). */
  lock?: AppLock;
  /**
   * The Studio's preview of a sealed app (no `appId` of its own): promoting it is the Studio's to do,
   * and this is how the trust dialog in here does it.
   */
  onPromote?: () => void;
  /** Opened from a link to one of its pages (docs/24 §11): which page, and the params the link carried — checked here against the page. */
  arrival?: Arrival;
  /**
   * Answers a screen's "Run it as mine…" instead of the trust dialog: a demo link, where nothing is
   * installed to promote, offers "Keep this app" first (#267).
   */
  onTrustRequest?: () => void;
}

export function App({ runtime, provenance, toaster, appId, name, appAccent, currentKind, sync, onExport, onImport, onData, generator, picker, questions, navHost, lock, onPromote, arrival, onTrustRequest }: AppProps) {
  const { t } = useLingui();
  const def = runtime.definition;
  // The saved name (Rename) as it is; one still matching the source follows it, in the person's language.
  const appLabel = shownName(name, runtime.core.app.definition, [runtime.language.current ?? "", ...languagePrefs()]);
  // The app lacks the person's language: one quiet line in its menu, never a banner (#302).
  const langNote = languageNote(runtime.core.app.definition, languagePrefs());
  const intoName = langNote?.into.name ?? "";
  const intoTag = langNote?.into.tag ?? "";
  const locked = useAppLock(lock);
  // Page titles may be functions of ctx (#133: "Places in Berlin"); resolved through the runtime.
  const titles = usePageTitles(runtime);
  // Detail pages are per-record surfaces reached by tapping a row — not top-level destinations. Keep
  // them out of the tab bar so nav shows real sections only (no redundant singular "Session" tabs).
  const visiblePages = def.pages.filter((p) => !p.hidden && (p.view as { type?: string }).type !== "detail");

  // Top-level object types = entities that own a visible list-like page (else every entity).
  const topEntities = Array.from(
    new Set(visiblePages.map((p) => (p.view as { entity?: string }).entity).filter((e): e is string => Boolean(e))),
  );
  const baseEntities = topEntities.length ? topEntities : Object.keys(def.entities);
  // Nav model: a grid "home" of object types, or a tab bar. Default: grid for many objects, tabs few.
  const navMode: "grid" | "tabs" = (def as { nav?: "grid" | "tabs" }).nav ?? (baseEntities.length >= 3 ? "grid" : "tabs");

  // The same "first tab, or home" landing spot used to pick an opening page, reused as the crash
  // boundary's escape hatch (ViewErrorBoundary below) — a page guaranteed to be real, since it comes
  // from the app's own declared pages rather than wherever `navigate` was just headed.
  const landingPage = (): string => (navMode === "grid" ? HOME : (visiblePages[0]?.id ?? def.pages[0]!.id));

  // Where it opens: back where a reload left it; else where a link said (docs/24 §11); else the landing.
  // A link's page is one the app declares, and its params only those the page takes from a link —
  // as text, capped (`acceptLinkParams`). The page just receives them: nothing runs because of a link.
  const [opening] = useState<{ page: string; params: Record<string, unknown> }>(() => {
    // READ ONLY. Clearing it here would make this initialiser impure, and StrictMode double-invokes
    // initialisers on purpose — the second call would find nothing and fall back to the first tab,
    // which is exactly how "come back to the page you were on" silently did nothing.
    const returning = readReturning();
    if (returning && (returning.page === HOME || def.pages.some((p) => p.id === returning.page))) return returning;
    const linked = arrival?.page ? def.pages.find((p) => p.id === arrival.page) : undefined;
    if (linked) return { page: linked.id, params: acceptLinkParams(linked, arrival?.params ?? {}) };
    return { page: landingPage(), params: {} };
  });
  const [pageId, setPageId] = useState<string>(opening.page);
  // Consumed once, after mount, so it can't affect a later boot.
  useEffect(() => {
    globalThis.sessionStorage?.removeItem(RETURN_TO_PAGE);
  }, []);
  const [paramsByPage, setParamsByPage] = useState<Record<string, Record<string, unknown>>>(() =>
    Object.keys(opening.params).length ? { [opening.page]: opening.params } : {},
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  // This app's saved source as the Studio opened. The app below the Studio runs the module it booted
  // with, so a save (or a restore) made in there is invisible until a reload — closing the Studio
  // showed the old version of the app you had just changed.
  const sourceAtStudioOpen = useRef<string | undefined>(undefined);
  // And its trust: an app let run as yours from the Studio's preview must not go on running sealed here.
  const trustAtStudioOpen = useRef<boolean | undefined>(undefined);
  const genOpenRef = useRef(false);
  genOpenRef.current = genOpen;
  const openStudio = (): void => {
    sourceAtStudioOpen.current = appId ? getUserApp(appId)?.source : undefined;
    trustAtStudioOpen.current = appId ? getUserApp(appId)?.trusted : undefined;
    setGenOpen(true);
  };
  const closeStudio = (): void => {
    setGenOpen(false);
    const now = appId ? getUserApp(appId) : undefined;
    if (now && (now.source !== sourceAtStudioOpen.current || now.trusted !== trustAtStudioOpen.current)) location.reload();
  };
  const [launcherOpen, setLauncherOpen] = useState(false);
  // Ctrl/⌘K opens the switcher with its field focused (#85): "switch to X" is a name in your head.
  useEffect(() => {
    if (!generator) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLauncherOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [generator]);
  const [studioPrefill, setStudioPrefill] = useState<string | undefined>(undefined);
  // The part of the app edit mode was on when it asked the Studio for more (#284).
  const [studioPoint, setStudioPoint] = useState<Pointed | undefined>(undefined);
  // Which saved app the Studio opens on: this one, when it is opened as "change this app"; none when
  // the launcher opens it to create something new.
  const [studioAppId, setStudioAppId] = useState<string | undefined>(undefined);
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);

  const params = paramsByPage[pageId] ?? {};
  // Which record the page in front of you is about, or null if it is not a record page. Read from
  // the declared view rather than tracked separately, so it stays right however the page was
  // reached — a nav action, a list tap, or a link opened cold.
  const detailTarget = ((): { entity: string; id: string } | null => {
    const view = def.pages.find((p) => p.id === pageId)?.view as
      | { type?: string; entity?: string; param?: string }
      | undefined;
    if (view?.type !== "detail" || !view.entity) return null;
    const id = String(params[view.param ?? "id"] ?? "");
    return id ? { entity: view.entity, id } : null;
  })();
  const setParam = (key: string, value: unknown): void =>
    setParamsByPage((prev) => ({ ...prev, [pageId]: { ...(prev[pageId] ?? {}), [key]: value } }));

  // The app-wide selection (#134). The runtime owns the value and re-runs watchers when it changes;
  // the header chip below reads it, so it re-renders on the same signal, and the page remounts on a
  // change (see the boundary's `key`) so a map created once opens where the new selection says.
  const scopeDef = def.scope;
  const [, bumpScope] = useState(0);
  useEffect(() => runtime.core.onInvalidate(() => bumpScope((n) => n + 1)), [runtime]);
  const scopeAppId = appId ?? def.id;
  const scoped = scopeDef ? runtime.scope[scopeDef.entity] : undefined;
  // A new one, from the switcher or because there is none yet: the form, then it is the selection.
  const newScope = (): void => {
    if (scopeDef) setEditor({ entity: scopeDef.entity, openAfter: false, onCreated: (id) => void chooseScope(runtime, scopeAppId, id) });
  };
  // An app that needs a selection opens on one (scope-switcher.tsx), never on a question; with none
  // at all, its pages offer the first one in place.
  const noScopeYet = useOpeningScope(runtime, scopeAppId);

  // Holds the case being recorded, if any. One per mounted app instance — see case-recorder.ts for
  // why `navigate` below, and not `createNavBridge`, is where it has to be wrapped.
  const recorder = useRef(new CaseRecorder());
  // Mirrors `recorder.current.recording` in React state: the recorder is a plain class field, so
  // mutating it alone (start/stop) would never trigger a re-render — the "Something's wrong" button
  // would keep showing after a click until some unrelated state change happened to repaint it.
  const [recording, setRecording] = useState(false);

  /**
   * While recording, look at what the page ACTUALLY RENDERED once it has had time to settle, and
   * attach it to the step that navigated here.
   *
   * This exists because the first person to use this feature hit a map stuck on "Loading…" forever,
   * and the whole system told them it could not reproduce the problem. It could not: replay checked
   * that the page resolved and its query ran, and had no idea what was on screen. Everything
   * reported ok while they were looking at a hung view.
   *
   * SETTLE_MS is the entire subtlety. Observe immediately and every page is mid-render, so all of
   * them look broken; observe never and a hung view is indistinguishable from a working one. Waiting
   * first makes `loading: true` mean "it never finished", which is the fact worth recording.
   */
  useEffect(() => {
    if (!recording) return;
    const SETTLE_MS = 1200;
    const t = setTimeout(() => {
      const main = document.querySelector(".k-main");
      if (!main) return;
      recorder.current.observe({
        loading: Boolean(main.querySelector(".k-loading")),
        text: (main.textContent ?? "").trim(),
      });
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [recording, pageId, params]);
  const [noting, setNoting] = useState(false);
  /** Whether this recording has an expectation yet — the only thing that ever says what the person
   *  expected, since a case's title is always "". Gates Stop; see `onStopRecording`. */
  const [noted, setNoted] = useState(false);
  /** Set when Stop opened the note prompt, so saving the note finishes the stop the person asked
   *  for instead of silently dropping it. */
  const stopAfterNote = useRef(false);
  const [noteText, setNoteText] = useState("");
  // `theCase` rides along with its own report so "Fix this" has the actual recording to hand
  // `startFix` — the report alone (what replay found) isn't enough; the loop needs the steps
  // themselves to replay again against a candidate.
  const [caseReport, setCaseReport] = useState<{ report: ReplayReport; lostSteps: number; theCase: Case } | null>(null);

  // --- Fix this: investigate a reported case with the agent, and watch it work (start-fix.ts) ----
  // Which engine answers is read from the SAME store Studio's Model settings write to (engine-
  // store.ts) — there is exactly one picker for "which model am I using", and this is the second
  // reader of it, not a second one.
  const [engineCfg] = useEngineConfig();
  const [fixOpen, setFixOpen] = useState(false);
  const [fixSteps, setFixSteps] = useState<LoopStep[]>([]);
  const [fixOutcome, setFixOutcome] = useState<LoopOutcome | undefined>(undefined);
  const fixAbort = useRef<AbortController | null>(null);
  // Bumped by `openFix` (and on unmount, below). `runFix` captures the value current at call time and
  // every write it schedules — `onStep` and the `.then(setFixOutcome)` — compares against it first.
  // Without this, closing (or Stop) only REQUESTS an abort; the in-flight `startFix` promise keeps
  // running, and an impatient second "Fix this" click starts a new run before the old one lands. The
  // old run's closures are still bound to `setFixOutcome`/`setFixSteps` and would otherwise overwrite
  // the new run's outcome and splice a stray step into its feed — same shape of bug `loadActivity`'s
  // `alive` flag guards against above, generalized to a counter because more than one stale run can
  // be superseded in sequence.
  const fixRunId = useRef(0);

  /** Only apps you can actually change afterwards — the same requirement Edit mode already has
   *  (`canEdit` below): a builtin example has no source in "My Apps" to edit or re-save. */
  const canFix = Boolean(appId && currentKind === "user");

  /** One run of the loop, optionally resuming a `question` with the transcript it handed back plus
   *  the person's answer appended (see `LoopDeps.resumeFrom`'s own doc comment for why that seeds
   *  `messages` instead of starting over). */
  const runFix = (resumeFrom?: LoopDeps["resumeFrom"]): void => {
    if (!appId || !caseReport) return;
    const source = getUserApp(appId)?.source;
    if (!source) return;
    const controller = new AbortController();
    fixAbort.current = controller;
    // Captured now, not read fresh later: this is what lets a superseded run's own callbacks tell
    // themselves apart from the run that's current by the time they actually fire.
    const runId = fixRunId.current;
    setFixOutcome(undefined);
    void modulesOf(appId).then((modules) => startFix({
      modules,
      source,
      theCase: caseReport.theCase,
      runtime,
      store: runtime.core.store,
      engine: engineCfg,
      language: currentLocale(),
      onStep: (step) => {
        if (fixRunId.current !== runId) return; // a superseded run's step; the panel moved on
        setFixSteps((prev) => [...prev, step]);
      },
      signal: controller.signal,
      resumeFrom,
    })).then((outcome) => {
      if (fixRunId.current !== runId) return; // a superseded run's outcome; do not overwrite the current one
      setFixOutcome(outcome);
    });
  };

  const openFix = (): void => {
    fixRunId.current += 1;
    setFixSteps([]);
    setFixOpen(true);
    runFix();
  };

  const answerFix = (text: string): void => {
    if (!fixOutcome || fixOutcome.kind !== "question") return;
    runFix([...fixOutcome.transcript, { role: "user", content: text }]);
  };

  /**
   * Apply the ONE thing this whole feature exists to make safe to apply: `fix.source`, the
   * candidate that replayed the user's own recorded case and passed (loop.ts's THE RULE). Saved the
   * same way an AI edit is (`origin: "edited"`), with the loop's own `rationale` riding along so
   * History reads the same as any other agent change — see `applyModify` above for the sibling path.
   *
   * `note` is `caseLabel(theCase)` — the case's own title, else the person's own recorded
   * expectation, else its id (app-cases.ts, shared with Studio's case list so the two surfaces agree
   * on what "this case" is called). NOT a description of what the agent did — that is `rationale`.
   * History's whole point is legibility later: "Fixed a reported case" would read the same on every
   * row forever, telling a future you nothing about which report this was answering.
   */
  const applyFix = (source: string): void => {
    if (!appId || !caseReport) return;
    const app = getUserApp(appId);
    if (!app) return;
    const rationale = fixOutcome?.kind === "fix" ? fixOutcome.rationale : undefined;
    void saveUserApp(
      { id: appId, name: app.name, source, origin: "edited", note: caseLabel(caseReport.theCase), rationale },
      new Date().toISOString(),
    ).then(() => location.reload());
  };

  const closeFix = (): void => {
    fixAbort.current?.abort();
    fixAbort.current = null;
    setFixOpen(false);
    setFixSteps([]);
    setFixOutcome(undefined);
  };

  // Defensive, not live: today `App` is mounted exactly once by `main.tsx`'s `boot()`, page-to-page
  // navigation is a full reload rather than a client-side unmount, and Studio's `<App key=
  // {preview.build}>` remount never receives an `appId` (so "Fix this" can't even appear there) — so
  // this cleanup can't currently run while a fix is in flight. It stays anyway, matching the
  // `loadActivity` `alive`-flag idiom above, so a future mount-topology change (SPA routing, or the
  // Studio preview one day getting an `appId`) doesn't reopen this as a live leak: bump the run id so
  // any settling `startFix` promise is ignored by the guards in `runFix`, and abort so the loop
  // actually stops instead of running to completion for nobody.
  useEffect(() => {
    return () => {
      fixRunId.current += 1;
      fixAbort.current?.abort();
    };
  }, []);

  const navigateRaw = (target: string, param?: Record<string, string>): void => {
    setPageId(target);
    if (param) setParamsByPage((prev) => ({ ...prev, [target]: { ...(prev[target] ?? {}), ...param } }));
  };
  // Both a tap (passed to views as `navigate`) and `ctx.navigate` (via navHost) come through here,
  // so this is the only place that sees everything a person actually did.
  const navigate = recorder.current.wrapNav(navigateRaw);

  // `ctx.navigate` from an action lands here. Bound through a ref so the binding survives re-renders
  // without re-registering on every one.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => navHost?.bind((page, param) => navigateRef.current(page, param)), [navHost]);

  const startRecording = (): void => {
    // Recording is keyed by appId (app-cases.ts filters on it), so there is nothing meaningful to
    // record without one — the button is hidden in that case (see the header below).
    if (!appId) return;
    recorder.current.start(appId, "");
    setRecording(true);
    setNoted(false);
  };

  const saveNote = (): void => {
    recorder.current.note(noteText);
    setNoteText("");
    setNoting(false);
    setNoted(true);
    // Stop was what asked for this note — finish the stop the person already requested rather than
    // making them press it a second time.
    if (stopAfterNote.current) {
      stopAfterNote.current = false;
      void finishStop();
    }
  };

  /**
   * Stop, save the case, then replay it against THIS runtime's real data and show what happened.
   *
   * Replay only ever reads (`query`), never `runAction` — an action step would otherwise mutate the
   * very records the report is about, corrupting the evidence the user just handed over. Cases with
   * an action step report "cannot run action — no action runner" rather than touching live data.
   *
   * The report is computed and shown REGARDLESS of whether `saveCase` persisted anything — replay
   * runs against the in-memory `Case` the recorder just handed back, not the store, so a save
   * failure (network hiccup, quota, OPFS not ready) must not cost the user the report they are
   * about to see. `saveCase` itself never throws (see app-cases.ts), but the ordering here doesn't
   * depend on that fact holding forever.
   */
  const onStopRecording = async (): Promise<void> => {
    // ASK FOR THE NOTE HERE, not after the fact. A case's title is always "" (startRecording above),
    // so the note is the ONLY thing that ever says what the person expected — and without it there
    // is literally nothing for an agent to investigate. Letting the recording be saved anyway
    // produced the worst possible sequence: record, get a report, press "Fix this", and only THEN
    // be told the recording was useless, with the work already done and the moment passed. The
    // person is here now; ask now.
    if (!noted) {
      stopAfterNote.current = true;
      setNoting(true);
      return;
    }
    await finishStop();
  };

  const finishStop = async (): Promise<void> => {
    const c = recorder.current.stop();
    const lostSteps = recorder.current.lost;
    setRecording(false);
    if (!c) return;
    // A case with nothing but `expect` notes has no step replay can act on — its outcomes list
    // would be empty, and an empty list reads as a pass forever (replayPassed's own guard exists
    // because of exactly this). Saving it would leave a case that reports success with nothing
    // ever having been recorded, which is worse than not saving at all.
    if (!hasRecordedActivity(c)) {
      toaster.push(t`Nothing was recorded — navigate the app or run an action before stopping.`);
      return;
    }
    await saveCase(c);
    const target: ReplayTarget = {
      definition: runtime.definition,
      // `queryPage` (not `ctx.query`) so replay sees what the person actually saw — the page's own
      // filter, sort and display bindings — not an unfiltered dump of the entity.
      query: async (_entity, pageId) => (await runtime.queryPage(pageId)).rows,
    };
    setCaseReport({ report: await replayCase(target, c), lostSteps, theCase: c });
  };

  const onEdit = (entity: string, id: string): void => setEditor({ entity, id });
  // Placing a point on the map opens the create form already carrying it — unless the app said nothing
  // is added by hand (`quickActions: []`, a live feed's records): then a map has no place button.
  const handAdds = (def as { quickActions?: unknown[] }).quickActions?.length !== 0;
  const onCreate = handAdds
    ? (entity: string, initial: Record<string, unknown>): void => setEditor({ entity, initial, openAfter: false })
    : undefined;

  const entityLabel = (e: string): string => def.entities[e]?.label ?? e;
  const addLabel = (noun: string): string => t({ message: `Add: ${noun}`, comment: "A quick action that makes a new record; noun is the app's word for it" });

  // Quick actions: the app's declared triggers, else an auto "Add: <Entity>" per top-level object —
  // never "New <Entity>", which would have to agree with the noun (docs/20 Q3). A declared empty list
  // is an app saying "none": records it makes itself (a live feed's) are not for adding by hand.
  const declaredQuick = (def as { quickActions?: QuickActionDef[] }).quickActions;
  // An entity only the app's code writes (`editableBy: "app"`) is never offered for adding by hand.
  const quickActions: QuickActionDef[] = (
    declaredQuick ? declaredQuick : baseEntities.map((e): QuickActionDef => ({ id: `new-${e}`, label: addLabel(entityLabel(e)), entity: e, mode: "auto", open: true }))
  ).filter((qa) => byPeople(runtime, qa.entity));

  // Which enum field a quick action picks inline (the "menu" style): explicit menu → the first enum;
  // auto → a lone enum with no OTHER required fields ("select the type"); form → none.
  const menuFieldFor = (qa: QuickActionDef): string | null => {
    const fields = def.entities[qa.entity]?.fields ?? {};
    const enums = Object.entries(fields).filter(([, f]) => (f as { type?: string }).type === "enum").map(([k]) => k);
    if (qa.mode === "form") return null;
    if (qa.mode === "menu") return enums[0] ?? null;
    if (enums.length !== 1) return null; // auto
    const required = Object.entries(fields).filter(([, f]) => (f as { required?: boolean }).required).map(([k]) => k);
    return required.every((k) => k === enums[0]) ? enums[0]! : null;
  };

  // After creating, open the new record: its detail page if one exists, else jump to its list.
  const openRecord = (entity: string, id: string, preferPage?: string): void => {
    if (preferPage) {
      const target = def.pages.find((p) => p.id === preferPage);
      if (target) {
        const param = (target.view as { param?: string }).param ?? "id";
        navigate(preferPage, { [param]: id });
        return;
      }
    }
    const detail = def.pages.find(
      (p) => (p.view as { type?: string; entity?: string }).type === "detail" && (p.view as { entity?: string }).entity === entity,
    );
    if (detail) {
      const param = (detail.view as { param?: string }).param ?? "id";
      navigate(detail.id, { [param]: id });
      return;
    }
    const list = visiblePages.find((p) => (p.view as { entity?: string }).entity === entity);
    if (list) setPageId(list.id);
  };

  const triggerQuick = (qa: QuickActionDef): void => {
    // `instant`: no form at all — create from field defaults + prefill and go. This is what makes a
    // quick action quick; anything else is a form standing between the user and the thing they
    // opened the app to do.
    if (qa.mode === "instant") {
      void createDefaults(runtime, qa.entity, qa.prefill).then((values) => runtime.create(qa.entity, values)).then((rec) => {
        if (qa.open === false) return;
        if (qa.openPage) {
          const target = def.pages.find((p) => p.id === qa.openPage);
          const param = (target?.view as { param?: string } | undefined)?.param ?? "id";
          navigate(qa.openPage, { [param]: rec.id });
          return;
        }
        openRecord(qa.entity, rec.id);
      });
      return;
    }
    const field = menuFieldFor(qa);
    const options = field ? ((def.entities[qa.entity]?.fields[field] as { options?: string[] }).options ?? []) : [];
    if (field && options.length) {
      setQuickMenu({ qa, field, options });
    } else {
      setEditor({ entity: qa.entity, initial: qa.prefill, openAfter: qa.open !== false });
    }
  };

  const pickQuick = async (option: string): Promise<void> => {
    const m = quickMenu;
    if (!m) return;
    setQuickMenu(null);
    // Seed defaults like the form does (bare create() doesn't), then set the picked value + prefill.
    const values = await createDefaults(runtime, m.qa.entity, { [m.field]: option, ...(m.qa.prefill ?? {}) });
    const created = await runtime.create(m.qa.entity, values);
    if (m.qa.open !== false) openRecord(m.qa.entity, created.id);
  };

  // Recomputed when the store changes, so a peer's write raises the count without a reload.
  useEffect(() => {
    if (!appId) return;
    let alive = true;
    const refresh = (): void => {
      void loadActivity(runtime, appId).then((items) => {
        if (alive) setActivity(items);
      });
    };
    refresh();
    const stops = Object.keys(runtime.definition.entities).map((entity) =>
      runtime.core.store.subscribe(entity, refresh),
    );
    return () => {
      alive = false;
      for (const stop of stops) stop();
    };
  }, [runtime, appId]);

  // Edit mode: change the app's own words — and the order of its fields and tabs — where they are
  // on screen (inline-edit.tsx). Only for your own saved apps (editable source). No model: anything
  // bigger goes to the Studio.
  const canEdit = Boolean(generator && currentKind === "user" && appId);
  // Whether the app names people at all (a `member` field): then People is worth a place in the menu
  // before it is shared, to set up its guests.
  const namesPeople = Object.values(runtime.definition.entities).some((e) => Object.values(e.fields).some((f) => f.type === "member"));
  const [editMode, setEditMode] = useState(() => canEdit && globalThis.sessionStorage?.getItem(KEEP_EDITING) === "1");
  useEffect(() => {
    globalThis.sessionStorage?.removeItem(KEEP_EDITING);
  }, []);
  // The source edit mode reads and writes. Set when it opens; each save moves it on.
  const [editSource, setEditSource] = useState<string | null>(null);
  // Whether anything was saved this sitting — the running app only shows it after a re-run.
  const [editChanged, setEditChanged] = useState(false);
  useEffect(() => {
    setEditSource(editMode && appId ? getUserApp(appId)?.source ?? null : null);
  }, [editMode, appId]);
  // Reviewing/rolling back what an edit did — same gate as editing: your own saved app.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  // Share (docs/24): a link anyone can try, or — for a synced app — the people in it.
  const [shareOpen, setShareOpen] = useState(false);
  // Make it mine (docs/24 §6): your own copy of this sealed app, to change in the Studio.
  const [remixOpen, setRemixOpen] = useState(false);
  // What changed while you were away (KA-36). `null` means this store keeps no history — a local-only
  // app — and the control is hidden rather than showing an empty panel that would claim nothing
  // happened.
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  // Ask (#213): a model adds records in this app's own shape. Offered until the person turns it off
  // for this app, and never in a read-only one — everything it does is a write.
  // Text shared into Potyro and handed to this app (#213) opens Ask with it filled in.
  // Read in the initializer (which a dev render runs twice), used up once mounted.
  const [shared] = useState(() => (appId ? peekAskMaterial(appId) : null));
  useEffect(() => {
    if (shared) clearAskMaterial();
  }, [shared]);
  const [askOpen, setAskOpen] = useState(shared !== null);
  const askOn = useAskEnabled(appId) && !locked;
  // Talking to the people you share with (KA-35). Only a CRDT store can carry it, and only a synced
  // app has a CRDT store — so on a local-only app the control is absent rather than present and
  // pointing at nobody. The room is loaded whether or not the panel is open, because the unread
  // badge is the whole reason to notice a message at all.
  const canChat = chatSupported(runtime.core.store);
  const [chatOpen, setChatOpen] = useState(false);
  const room = useThread(runtime, canChat ? ROOM_THREAD : null);
  const roomUnread = appId ? unreadCount(room.messages, appId, ROOM_THREAD, runtime.ctx.me?.id) : 0;
  // What the balloon says, and when it stops saying it.
  //
  // A count says there is something to read and nothing about whether it can wait. Most messages in
  // a shared app are one line — "got the milk", "running late" — so the line IS the notification,
  // and the chat only has to be opened when there is something to say back.
  //
  // Dismissal is remembered by MESSAGE id, not as a flag: closing this one must not silence the
  // next one, which is a different thing someone said.
  const [peeked, setPeeked] = useState<string | null>(null);
  const chatBtnRef = useRef<HTMLButtonElement>(null);
  const lastFromOther = roomUnread > 0 ? [...room.messages].reverse().find((m) => m.by !== runtime.ctx.me?.id) : undefined;
  const peekMessage = !chatOpen && lastFromOther && lastFromOther.id !== peeked ? lastFromOther : undefined;
  // The launcher badge (#86): the count this app already shows, kept on its launcher entry as it
  // changes, so the home screen can show it without running the app. Opening the chat moves the
  // watermark, which brings this to zero and clears the badge.
  //
  // Edits are deliberately NOT counted. Dragging one item up a list patches every item it passed, so
  // one move read as five changes and loading a backup read as hundreds — a number nobody can act on,
  // sitting on top of the one they can. The changes panel still lists them, for anyone who looks.
  useEffect(() => {
    if (!appId || currentKind !== "user") return;
    recordSignals(appKey("user", appId), { chat: roomUnread });
  }, [appId, currentKind, roomUnread]);
  /**
   * Re-run the app so it shows what edit mode saved. A reload, because the module is evaluated at
   * boot; `RETURN_TO_PAGE` lands you back on the page you were on, and `KEEP_EDITING` keeps edit mode
   * on when the re-run was for a move rather than for finishing.
   */
  const rerunApp = (keepEditing: boolean): void => {
    holdReturning(pageId, params);
    if (keepEditing) sessionStorage.setItem(KEEP_EDITING, "1");
    location.reload();
  };
  const finishEditing = (): void => {
    if (editChanged) rerunApp(false);
    else setEditMode(false);
  };

  /**
   * Save a change made in edit mode. No model, no repair round.
   *
   * It is still validated and still written as a version — a change you made by hand deserves the
   * same audit trail and the same way back as one the agent made. It is recorded as `adjusted`
   * rather than `edited` so History can tell them apart: an agent edit goes through the model and
   * may touch functions, this one only replaced a literal or moved a declaration.
   */
  const saveAdjusted = async (next: string, note: string): Promise<string | null> => {
    const app = appId ? getUserApp(appId) : undefined;
    if (!appId || !app) return t`This app isn't saved on this device, so it can't be changed here.`;
    try {
      // Its libraries stand in (#266): this checks the structure of the change, and a library that
      // needs a full web page cannot start in the sealed box the check runs in. Opening the app still
      // runs, and checks, the real ones.
      const issues = await buildAndValidate(next, withLibrariesStoodIn(await modulesOf(appId)));
      // A change that doesn't validate is a bug in the editor, not something to hand to a model to
      // repair. Discard it and say so rather than saving a broken app.
      if (issues.length) {
        const issue = issues[0];
        return t`That change didn't validate, so nothing was saved: ${issue}`;
      }
      await saveUserApp({ id: appId, name: app.name, source: next, origin: "adjusted", note }, new Date().toISOString());
      setEditSource(next);
      setEditChanged(true);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const askStudioAbout = (prefill: string, point?: PointRef): void => {
    setStudioPrefill(prefill);
    setStudioPoint(point ? describePoint(point, def) : undefined);
    setStudioAppId(appId);
    openStudio();
  };

  // A remix opens here with the Studio asking what to change (docs/24 §6): left by Make it mine.
  useEffect(() => {
    if (!generator || currentKind !== "user") return;
    const handoff = takeStudioHandoff(appId);
    if (handoff) askStudioAbout(handoff.prompt ?? "");
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownTitle = titles[pageId] ?? pageId;
  // Said to the person (the error boundary, the start of a Studio message from edit mode).
  const currentPageLabel = pageId === HOME ? t`the object grid (home)` : t`the "${shownTitle}" page`;

  // Promote/demote trust. Promotion runs the app DIRECTLY (not in the isolate) — a deliberate,
  // prompted decision (CLAUDE.md rule 3). Only for your own saved apps.
  const [trustPrompt, setTrustPrompt] = useState(false);
  const setTrust = (trusted: boolean): void => {
    if (!appId) {
      // A preview: the Studio promotes the app it is showing, when it is a sealed one.
      setTrustPrompt(false);
      if (trusted) onPromote?.();
      return;
    }
    setUserAppTrusted(appId, trusted, new Date().toISOString());
    // Back on this page, with what it was opened with: letting a game run as yours from its join page keeps the code.
    holdReturning(pageId, params);
    location.reload();
  };

  /**
   * What colour this app is.
   *
   * In order: the colour you gave THIS app (Edit tile — which until now tinted the tile and nothing
   * else, so a choice made there was invisible the moment the app opened), then the colour the app
   * declares for itself, then your accent for everything that has none, then Potyro's own gold.
   *
   * Yours outranks the app's on purpose: you chose it for this app, knowing what the app looks
   * like. The app's `theme.accent` is a default from whoever wrote it.
   */
  const accent = appAccent ?? def.theme?.accent ?? "#E4A93C";

  // What the chrome shows (#111). Pages carry an icon — the entity's, else one for the view type —
  // because a tab bar without icons is a row of truncated words. Through `navigate`, NOT
  // `setPageId`: the recorder taps `navigate`, and clicking a tab is the most ordinary way anyone
  // moves around an app.
  const viewGlyph: Record<string, string> = { list: "☰", gallery: "▦", table: "⊞", calendar: "📅", map: "🗺", steps: "✓", checklist: "☑", aggregate: "Σ", custom: "◇", detail: "◇" };
  const pageIcon = (p: (typeof def.pages)[number]): string => {
    const v = p.view as { type?: string; entity?: string };
    return (p as { icon?: string }).icon || (v.entity && def.entities[v.entity]?.icon) || viewGlyph[v.type ?? ""] || "◇";
  };
  const chromePages: ChromePage[] = [
    ...(navMode === "grid" ? [{ id: HOME, title: t({ message: "Home", comment: "The page that shows an app's kinds of record as tiles" }), icon: "⊞", active: pageId === HOME, onOpen: () => navigate(HOME) }] : []),
    ...visiblePages.map((p) => ({ id: p.id, title: titles[p.id] ?? p.id, icon: pageIcon(p), active: p.id === pageId, onOpen: () => navigate(p.id) })),
  ];
  const currentPage = def.pages.find((p) => p.id === pageId);
  // A page that asks for the whole screen gets it each time it opens; leaving full screen holds until
  // the person goes to another page (or asks for it back from the tools).
  const [leftFullscreen, setLeftFullscreen] = useState<string | null>(null);
  // How many records the page's view shows, for its header — told by the view (PageCountContext).
  const [, setPageCount] = useState<number | undefined>(undefined);
  const [ctaBusy, setCtaBusy] = useState(false);
  const fullscreen = Boolean(currentPage?.fullscreen) && leftFullscreen !== pageId;
  const exitFullscreen = useCallback(() => setLeftFullscreen(pageId), [pageId]);
  useEffect(() => setLeftFullscreen(null), [pageId]);
  const currentEntity = (currentPage?.view as { entity?: string } | undefined)?.entity;
  // A view with its own way to add (the checklist's "Add an item…", the map's "Add place here")
  // already does the one thing the top bar's "+" would, and better — the map's puts the new record
  // where you tapped. Two buttons for one act is one too many, so the page's own wins and the "+"
  // drops. Other entities' actions stay; only the one this page adds inline goes.
  const pageView = currentPage?.view as { type?: string; quickAdd?: unknown; geo?: unknown } | undefined;
  const addsInline = Boolean(pageView?.quickAdd) || (pageView?.type === "map" && typeof pageView.geo === "string") ? currentEntity : undefined;
  // A custom view is a screen the app drew itself, with its own controls: what it adds, it offers
  // itself, so the shell's "+" stays out of it.
  const ownsScreen = pageView?.type === "custom";
  const chromeQuick: ChromeQuick[] = quickActions
    .filter((qa) => qa.entity !== addsInline)
    .map((qa) => ({
      id: qa.id,
      label: qa.label,
      icon: qa.icon ?? def.entities[qa.entity]?.icon ?? "＋",
      entity: qa.entity,
      onRun: () => triggerQuick(qa),
    }));
  // A hidden page (a record's detail, a custom walk-through) is a sub-page: the top bar gets a back
  // control to the entity's list, and the "+" stays out of the page's own actions.
  const isSubPage = Boolean(currentPage?.hidden);
  // The page's header (page-header.tsx): every page that lists or sums records — not a record's own
  // page, a map that fills the screen, or a screen the app drew itself.
  const showHero =
    pageId !== HOME &&
    !isSubPage &&
    !fullscreen &&
    (Boolean(currentPage?.layout) || !["detail", "map", "custom"].includes(pageView?.type ?? ""));
  // The page's ONE primary action (`primaryAction`): a quick action by id, or one of its own actions
  // by index. It is the bar at the bottom of the page (page-primary.tsx), and the top bar's "+" stands
  // down for it.
  const primaryRef = (currentPage as { primaryAction?: string | number } | undefined)?.primaryAction;
  const ctaQuick = typeof primaryRef === "string" ? quickActions.find((qa) => qa.id === primaryRef) : undefined;
  const ctaAction = typeof primaryRef === "number" ? currentPage?.actions?.[primaryRef] : undefined;
  const cta: PageCta | undefined = ctaQuick
    ? { label: ctaQuick.label, icon: ctaQuick.icon ?? def.entities[ctaQuick.entity]?.icon, onRun: () => triggerQuick(ctaQuick) }
    : ctaAction && typeof primaryRef === "number"
    ? {
        label: ctaAction.label,
        icon: ctaAction.icon,
        busy: ctaBusy,
        onRun: () => {
          setCtaBusy(true);
          void runtime.runPageAction(pageId, primaryRef, params).finally(() => setCtaBusy(false));
        },
      }
    : undefined;
  // The page's own add (`add`): one of its actions — "Add a recipe" with its photo, paste and type —
  // is the phone's "+", in place of a plain form for the kind it shows.
  const addRef = (currentPage as { add?: number } | undefined)?.add;
  const addAction = typeof addRef === "number" ? currentPage?.actions?.[addRef] : undefined;
  const pageAdd: ChromeQuick | undefined =
    addAction && typeof addRef === "number"
      ? { id: `page-add-${addRef}`, label: addAction.label, icon: addAction.icon ?? "＋", entity: currentEntity ?? "", onRun: () => void runtime.runPageAction(pageId, addRef, params) }
      : undefined;
  const backTo = (): void => {
    const list = visiblePages.find((p) => (p.view as { entity?: string }).entity === currentEntity);
    navigate(list?.id ?? landingPage());
  };
  const chromeTools: ChromeTool[] = [
    ...(currentPage?.fullscreen && !fullscreen
      ? [{ key: "fullscreen", label: t`Full screen`, icon: "⛶", onSelect: () => setLeftFullscreen(null) }]
      : []),
    ...(askOn ? [{ key: "ask", label: t({ message: "Ask", comment: "The feature that adds records with AI" }), icon: "✧", hint: t`add with AI`, onSelect: () => setAskOpen(true) }] : []),
    // The Studio needs no model: its source editor and History are how a broken app gets repaired
    // on a build with no engine at all.
    ...(generator ? [{ key: "studio", label: "Studio" /* i18n-ignore — a name */, icon: "✦", hint: t`change this app`, onSelect: () => {
            setStudioPrefill(undefined);
            setStudioPoint(undefined);
            setStudioAppId(currentKind === "user" ? appId : undefined);
            openStudio();
          } }] : []),
    ...(canEdit ? [{ key: "edit-mode", label: t`Edit mode`, icon: "✎", active: editMode, onSelect: () => (editMode ? finishEditing() : setEditMode(true)) }] : []),
    ...(canEdit ? [{ key: "history", label: t`History`, icon: "⟲", onSelect: () => setHistoryOpen(true) }] : []),
    // What other people changed. In the menu with the rest of the shell's own tools rather than a
    // button in the top bar: it is read occasionally, the chat is read constantly, and on a phone
    // the two of them together left no room for the app's own name.
    ...(activity
      ? [{ key: "changes", label: t({ message: "Changes", comment: "What other people changed in a shared app" }), icon: "✻", hint: activity.length ? plural(activity.length, { one: "# new", other: "# new" }) : undefined, news: activity.length > 0, onSelect: () => setActivityOpen(true) }]
      : []),
    // Who is in a shared app, and inviting and removing them (#58).
    // Solo too, when the app names people: its guests are set up before it is shared (docs/04 §Guests).
    ...((sync || namesPeople) && appId ? [{ key: "people", label: t`People`, icon: "👥", onSelect: () => setPeopleOpen(true) }] : []),
    // Someone else's app, sealed: the one obvious way to your own copy of it.
    ...(generator && currentKind === "user" && appId && provenance === "untrusted" && canRemix(getUserApp(appId) ?? {})
      ? [{ key: "remix", label: t({ message: "Make it mine", comment: "App menu: your own copy of this app, to change in the Studio" }), icon: "✧", hint: t`your own copy to change`, onSelect: () => setRemixOpen(true) }]
      : []),
    ...(generator && currentKind === "user" && appId ? [{ key: "share", label: t({ message: "Share", comment: "App menu: share this app" }), icon: "↗", hint: t`a link anyone can try`, onSelect: () => setShareOpen(true) }] : []),
    ...(onData ? [{ key: "data", label: t({ message: "Data", comment: "The page with every app's records" }), icon: <DatabaseIcon />, hint: t`every record`, onSelect: onData }] : []),
    ...(onImport ? [{ key: "import", label: t`Import`, icon: "⇣", onSelect: onImport }] : []),
    ...(onExport ? [{ key: "export", label: t`Export`, icon: "⇡", onSelect: onExport }] : []),
    // "This app is in English." Where it can be changed, the line offers the translation, which the
    // Studio makes (docs/20 §3.3); elsewhere it only says so.
    ...(langNote
      ? [
          // (the person's own request, so in their language; the tag says exactly which)
          canEdit
            ? { key: "language", label: langNote.offer, icon: "🌐", hint: langNote.line, onSelect: () => askStudioAbout(t`Translate this app into ${intoName} (${intoTag}).`) }
            : { key: "language", label: langNote.line, icon: "🌐", disabled: true, onSelect: () => {} },
        ]
      : []),
  ];
  const chromeReport: ChromeTool[] = appId
    ? recording
      ? [
          { key: "stop-recording", label: t`Stop recording`, icon: "■", onSelect: () => void onStopRecording() },
          { key: "add-note", label: t`Add a note`, icon: "✎", onSelect: () => setNoting(true) },
        ]
      : [{ key: "report", label: t`Something's wrong`, icon: "⚑", onSelect: startRecording }]
    : [];
  // Promote/demote trust from the tools, where it belongs — not as a pill in everyone's face.
  // A sealed custom screen's "Run it as mine…" asks for the same dialog (views never decide trust).
  useEffect(() => {
    // Not while the Studio is open over this app: its preview has its own dialog, and one tap must
    // not open two. Where nothing is installed to promote (a demo link), the host answers instead.
    const open = (): void => {
      if (onTrustRequest) onTrustRequest();
      else if (!genOpenRef.current) setTrustPrompt(true);
    };
    globalThis.addEventListener(TRUST_REQUEST, open);
    return () => globalThis.removeEventListener(TRUST_REQUEST, open);
  }, [onTrustRequest]);
  const chromeTrust: ChromeTool | undefined = canEdit
    ? {
        key: "trust",
        label: provenance === "trusted" ? t`Runs as yours` : t`Runs sealed`,
        icon: "🛡",
        hint: provenance === "trusted" ? t({ message: "review", comment: "Trust menu hint: look at how an app that runs as yours runs" }) : t({ message: "run as yours", comment: "Trust menu hint: let a sealed app run as yours" }),
        className: `k-prov-btn k-prov-${provenance}`,
        onSelect: () => setTrustPrompt(true),
      }
    : undefined;

  const engineName = engineLabel(engineCfg);

  return (
    <div
      className="k-app"
      // The app's words are in this language (#302): screen readers pronounce them right, and a
      // right-to-left one turns the app's own area round (Q11 — a first step, not full RTL).
      lang={runtime.language.current}
      dir={isRtl(runtime.language.current) ? "rtl" : undefined}
      data-provenance={provenance}
      data-locked={locked ? "" : undefined}
      // What the page sits on (`background`): a glow of the app's colour unless it says otherwise.
      data-backdrop={backdropKind(backdropOf(def as Parameters<typeof backdropOf>[0], currentPage as Parameters<typeof backdropOf>[1]))}
      style={{ ["--accent" as string]: accent }}
      // Locked: a tap on a control that writes explains instead of acting. Capture phase, so it wins
      // over the control's own handler; the store would refuse the write anyway, but only after a
      // form had been filled in or a delete confirmed.
      onClickCapture={(e) => {
        if (!locked || !lock) return;
        const target = e.target as Element | null;
        if (!target?.closest?.(WRITE_CONTROLS)) return;
        e.preventDefault();
        e.stopPropagation();
        toaster.push(lock.refusal() ?? "Read-only.");
      }}
    >
      <AppChrome
        name={appLabel}
        icon={def.icon ?? "◆"}
        scope={scopeDef ? <ScopeSwitcher runtime={runtime} appName={appLabel} appId={scopeAppId} onNew={newScope} /> : null}
        status={
          <>
            {/* Provenance is shown only when it is unusual (#87): an app that runs in the sandbox
                gets a quiet mark, never red — that is the safe state. A trusted app says nothing. */}
            {provenance === "untrusted" ? (
              // A button, not a label: on a phone this mark was the only visible sign of the sandbox,
              // and the way out was the last entry of the ⋯ menu.
              <button
                type="button"
                className="k-prov k-prov-untrusted"
                aria-label={t`Runs sealed: review`}
                title={t`Runs in the sealed box. Tap to let it run as yours.`}
                onClick={() => setTrustPrompt(true)}
              >
                🛡 <Trans comment="A small mark in the header of an app that runs sealed">sealed</Trans>
              </button>
            ) : null}
            <SyncStatus sync={sync} />
          </>
        }
        pages={chromePages}
        quick={chromeQuick}
        pageAdd={pageAdd}
        // One loud button per page: when the page has its own, the sidebar's are plain.
        quietQuick={Boolean(cta || pageAdd)}
        currentEntity={currentEntity}
        tools={chromeTools}
        report={chromeReport}
        recording={recording}
        trust={chromeTrust}
        onApps={generator ? () => setLauncherOpen(true) : undefined}
        extras={
          canChat ? (
            // The balloon hangs off the button it is about, so it needs the button's box to hang from.
            <span className="k-chat-host">
              <button
                ref={chatBtnRef}
                type="button"
                className="k-add k-chat-btn"
                aria-label={roomUnread ? plural(roomUnread, { one: "Chat — # unread", other: "Chat — # unread" }) : t({ message: "Chat", comment: "The button that opens a shared app's chat" })}
                data-unread={roomUnread || undefined}
                onClick={() => setChatOpen(true)}
              >
                💬 <Trans comment="The button that opens a shared app's chat">Chat</Trans>
                {roomUnread ? <span className="k-activity-count">{roomUnread}</span> : null}
              </button>
              {peekMessage ? (
                <ChatPeek
                  runtime={runtime}
                  message={peekMessage}
                  anchor={chatBtnRef}
                  onOpen={() => {
                    setPeeked(peekMessage.id);
                    setChatOpen(true);
                  }}
                  onDismiss={() => setPeeked(peekMessage.id)}
                />
              ) : null}
            </span>
          ) : null
        }
        onBack={isSubPage ? backTo : undefined}
        // Which page this is, on a wide screen, when there is more than one to be on.
        // A record's own page always has one: its way back sits beside it.
        pageTitle={pageId === HOME || (visiblePages.length < 2 && !currentPage?.hidden) ? undefined : titles[pageId] ?? pageId}
        pageKey={pageId === HOME ? undefined : pageId}
        showQuick={!isSubPage && !ownsScreen && !cta}
        // A map fills the page: it is the thing you came to look at, and every phone map app shows
        // it edge to edge with the controls on top.
        fullBleed={pageView?.type === "map" && !currentPage?.layout}
        locked={Boolean(locked)}
        fullscreen={fullscreen ? { onExit: exitFullscreen } : undefined}
      >
      {locked ? <LockBanner state={locked} /> : null}
      {pageId === HOME ? (
        <main className="k-main k-home">
          {/* The app's front door: its name, big, on its own colour — then what it holds, then every
              page it has. A grid home used to be two small tiles at the top of an empty screen. */}
          <header className="k-page-hero k-home-hero" data-backdrop="wash">
            <div className="k-page-hero-body">
              <div className="k-page-hero-top">
                <span className="k-page-hero-icon k-home-icon" aria-hidden>
                  {def.icon ?? "◆"}
                </span>
                <h2 className="k-page-title">{appLabel}</h2>
              </div>
            </div>
          </header>
          <div className="k-objgrid" aria-label={t({ message: "Objects", comment: "The tiles of an app's kinds of record" })}>
            {baseEntities.map((e) => {
              const lp = visiblePages.find((p) => (p.view as { entity?: string }).entity === e);
              if (!lp) return null;
              return (
                <GridTile
                  key={e}
                  runtime={runtime}
                  pageId={lp.id}
                  label={entityLabel(e)}
                  icon={def.entities[e]?.icon ?? "◇"}
                  onOpen={() => navigate(lp.id)}
                />
              );
            })}
          </div>
          {visiblePages.length ? (
            <section className="k-home-pages" aria-label={t({ message: "All pages", comment: "On an app's home: a list of every page it has" })}>
              <h3 className="k-home-pages-title">
                <Trans comment="On an app's home: a list of every page it has">All pages</Trans>
              </h3>
              <ul className="k-list" data-lead="icon">
                {visiblePages.map((p) => (
                  <li key={p.id} className="k-list-row" data-clickable="true" onClick={() => navigate(p.id)}>
                    <span className="k-lead" data-glyph="icon" aria-hidden>
                      {pageIcon(p)}
                    </span>
                    <span className="k-list-text">
                      <button type="button" className="k-home-page-link" onClick={(e) => { e.stopPropagation(); navigate(p.id); }}>
                        {titles[p.id] ?? p.id}
                      </button>
                      {(p as { description?: string }).description ? <span className="k-secondary">{(p as { description?: string }).description}</span> : null}
                    </span>
                    <span className="k-row-chevron" aria-hidden>
                      ›
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </main>
      ) : (
        // `key={pageId}`: a fresh boundary per page, not a stuck one — navigating away from a page
        // that crashed (the fallback's own "Back to a working page" button, or any other nav) mounts
        // a clean boundary for wherever you land, instead of carrying yesterday's error state into a
        // page that never had a problem.
        <ViewErrorBoundary key={`${pageId}:${scoped?.id ?? ""}`} pageLabel={currentPageLabel} onRecover={() => setPageId(landingPage())}>
          {showHero ? <PageHeader runtime={runtime} pageId={pageId} params={params} /> : null}
          <FilterChrome runtime={runtime} pageId={pageId} params={params} setParam={setParam} />
          {showHero ? null : <SummaryStrip runtime={runtime} pageId={pageId} params={params} />}
          <main className="k-main">
            <PageCountContext.Provider value={setPageCount}>
            {noScopeYet ? (
              <ScopeEmpty runtime={runtime} onNew={newScope} />
            ) : currentPage?.layout ? (
              // Several views on one page (#105); each item is a view under its own page ref.
              <LayoutHost
                runtime={runtime}
                pageId={pageId}
                layout={currentPage.layout}
                params={params}
                setParam={setParam}
                navigate={navigate}
                onEdit={onEdit}
                onCreate={onCreate}
              />
            ) : (
              <ViewHost
                runtime={runtime}
                pageId={pageId}
                params={params}
                setParam={setParam}
                navigate={navigate}
                onEdit={onEdit}
                onCreate={onCreate}
              />
            )}
            </PageCountContext.Provider>
            {/* The record's own conversation, under the record — the half of KA-35 nothing else can
                do. Rendered by the SHELL and not by the detail view, because `views` is reachable
                from a page an app declares and messages must stay out of app code's reach entirely
                (hard rule 3). The shell already knows which record is open: it is the detail page's
                param. */}
            {canChat && appId && detailTarget ? (
              <RecordThread
                runtime={runtime}
                appId={appId}
                entity={detailTarget.entity}
                recordId={detailTarget.id}
                label={entityLabel(detailTarget.entity)}
              />
            ) : null}
          </main>
          {showHero && cta ? (
            <PrimaryBar runtime={runtime} pageId={pageId} params={params} cta={cta} actionIndex={typeof primaryRef === "number" ? primaryRef : undefined} />
          ) : null}
        </ViewErrorBoundary>
      )}

      </AppChrome>

      {editor && byPeople(runtime, editor.entity) ? (
        // The form brings its own sheet (#101): full-screen on a phone with the actions in a fixed
        // footer, a capped modal on a wide screen; it asks before discarding edits.
        <RecordForm
          runtime={runtime}
          entity={editor.entity}
          recordId={editor.id}
          initial={editor.initial}
          onDone={(id) => {
            const ed = editor;
            setEditor(null);
            if (id) ed?.onCreated?.(id);
            if (ed?.openAfter && id) openRecord(ed.entity, id);
          }}
          onCancel={() => setEditor(null)}
        />
      ) : null}

      {quickMenu ? (
        <div className="k-modal-scrim" onClick={() => setQuickMenu(null)}>
          <div className="k-quickmenu" onClick={(e) => e.stopPropagation()}>
            <h4>{quickMenu.qa.label}</h4>
            <div className="k-quickmenu-options">
              {quickMenu.options.map((opt) => (
                <button key={opt} type="button" className="k-add" onClick={() => void pickQuick(opt)}>
                  {optionLabel(def.entities[quickMenu.qa.entity]?.fields[quickMenu.field] as { labels?: Record<string, string> } | undefined, opt)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {trustPrompt ? (
        <TrustDialog
          name={def.name}
          permissions={def.permissions ?? {}}
          trusted={provenance === "trusted"}
          onCancel={() => setTrustPrompt(false)}
          onPromote={() => setTrust(true)}
          onRevoke={() => setTrust(false)}
        />
      ) : null}

      {editMode && editSource ? (
        <InlineEdit
          source={editSource}
          where={currentPageLabel}
          save={saveAdjusted}
          rerun={() => rerunApp(true)}
          askStudio={askStudioAbout}
          done={finishEditing}
        />
      ) : null}

      {launcherOpen ? (
        <Launcher
          variant="overlay"
          selected={appId ? { kind: currentKind ?? "user", id: appId } : undefined}
          onOpen={openInstalledApp}
          onNewApp={(prefill) => {
            setLauncherOpen(false);
            setStudioPrefill(prefill);
            setStudioPoint(undefined);
            setStudioAppId(undefined);
            openStudio();
          }}
          onClose={() => setLauncherOpen(false)}
        />
      ) : null}

      {shareOpen && appId && getUserApp(appId) ? (
        <ShareSheet app={getUserApp(appId)!} onClose={() => setShareOpen(false)} onInvite={sync ? () => setPeopleOpen(true) : undefined} clipRoot={() => document.querySelector(".k-app")} />
      ) : null}
      {remixOpen && appId && getUserApp(appId) ? <RemixDialog app={getUserApp(appId)!} onClose={() => setRemixOpen(false)} /> : null}
      {peopleOpen && appId ? (
        <PeoplePanel
          appId={appId}
          appName={appLabel}
          meId={runtime.ctx.me?.id}
          meName={runtime.ctx.me?.name}
          sync={Boolean(sync)}
          guests={runtime.core.guests}
          onClose={() => setPeopleOpen(false)}
          toast={(m) => runtime.ctx.ui.toast(m)}
        />
      ) : null}
      {historyOpen && appId ? (
        <History
          appId={appId}
          appName={appLabel}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => location.reload()}
        />
      ) : null}

      {askOpen && askOn && appId ? <AskPanel appId={appId} runtime={runtime} engine={engineCfg} initialMaterial={shared ?? undefined} onClose={() => setAskOpen(false)} /> : null}

      {activityOpen && activity && appId ? (
        <ActivityPanel
          runtime={runtime}
          appId={appId}
          items={activity}
          onClose={() => {
            setActivityOpen(false);
            // Seen: clear the count without another round-trip to the log.
            setActivity([]);
          }}
        />
      ) : null}

      {chatOpen && appId ? <ChatPanel runtime={runtime} appId={appId} onClose={() => setChatOpen(false)} /> : null}

      {genOpen ? <Studio onClose={closeStudio} initialDescription={studioPrefill} initialAppId={studioAppId} initialPoint={studioPoint} /> : null}

      {noting ? (
        <div className="k-modal-scrim" onClick={() => { stopAfterNote.current = false; setNoting(false); }}>
          <div className="k-modal k-case-note" onClick={(e) => e.stopPropagation()}>
            <h3>
              <Trans>What did you expect?</Trans>
            </h3>
            <textarea
              className="k-input"
              aria-label={t`What did you expect?`}
              rows={3}
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="k-form-actions">
              <button type="button" className="k-add" onClick={() => { stopAfterNote.current = false; setNoting(false); }}>
                <Trans>Cancel</Trans>
              </button>
              <button type="button" className="k-add k-primary-action" onClick={saveNote}>
                <Trans>Save note</Trans>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {caseReport ? (
        <div className="k-case-and-fix">
          <CaseReport report={caseReport.report} lostSteps={caseReport.lostSteps} onClose={() => setCaseReport(null)} />
          {canFix ? (
            <div className="k-fix-entry">
              {canInvestigate(engineCfg.engine) ? (
                <button type="button" className="k-add k-primary-action" disabled={fixOpen} onClick={openFix}>
                  <Trans>Fix this</Trans>
                </button>
              ) : (
                // The friendlier half of the same fact `startFix` itself refuses on: a dead button
                // would say nothing about WHY, and this is the reason before you've spent a click.
                <p className="k-muted k-fix-entry-reason">
                  {t`${engineName} can’t investigate this step by step — pick a cloud engine, like OpenRouter, in the Studio’s Model settings to use Fix this.`}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {fixOpen ? (
        <FixPanel outcome={fixOutcome} steps={fixSteps} onApply={applyFix} onAnswer={answerFix} onStop={() => fixAbort.current?.abort()} onClose={closeFix} />
      ) : null}

      {picker ? <Picker host={picker} /> : null}
      {questions ? <UiSurfaces host={questions} runtime={runtime} /> : null}
      {/* Joined a shared app whose people were named before they joined: which one are you? */}
      {sync && appId && runtime.ctx.me ? <ClaimPrompt book={runtime.core.guests} meId={runtime.ctx.me.id} appId={appId} appName={appLabel} toast={(m) => runtime.ctx.ui.toast(m)} /> : null}
      <Toasts toaster={toaster} />
    </div>
  );
}

function Toasts({ toaster }: { toaster: Toaster }) {
  const toasts = useSyncExternalStore(toaster.subscribe, toaster.get, toaster.get);
  useEffect(() => {}, [toasts]);
  return (
    <div className="k-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="k-toast">
          {t.msg}
        </div>
      ))}
    </div>
  );
}
