// The shell UI: app header + provenance badge, page nav, view-chrome (pantry picker), the
// active view, an add-recipe panel, and toasts. Renders whatever app the composition root
// loaded (trusted or sandboxed) — the UI is app-agnostic.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { replayCase, type ActivityItem, type Case, type KartaRuntime, type ReplayReport, type ReplayTarget } from "@karta/runtime";
import type { Provenance } from "@karta/host";
import { LayoutHost, RecordForm, ViewHost, createDefaults, usePageTitles } from "@karta/views";
import { FilterChrome } from "./filter-chrome.js";
import { SummaryStrip } from "./summary-strip.js";
import { Studio } from "./studio.js";
import { CaseRecorder } from "./case-recorder.js";
import { saveCase, hasRecordedActivity, caseLabel } from "./app-cases.js";
import { CaseReport } from "./case-report.js";
import { FixPanel } from "./fix-panel.js";
import { startFix } from "./start-fix.js";
import { canInvestigate, engineLabel } from "./engines.js";
import { useEngineConfig } from "./engine-store.js";
import type { LoopDeps, LoopOutcome, LoopStep } from "@karta/generator/agent";
import { Launcher, openInstalledApp } from "./launcher.js";
import { AppChrome, type ChromePage, type ChromeQuick, type ChromeTool } from "./chrome.js";
import { SyncStatus } from "./sync-status.js";
import { History } from "./history.js";
import { ActivityPanel, loadActivity, markSeen } from "./activity-panel.js";
import { ChatPanel, RecordThread, chatSupported, unreadCount, useThread } from "./chat-panel.js";
import { ROOM_THREAD } from "@karta/store";
import { getUserApp, saveUserApp, setUserAppTrusted } from "./user-apps.js";
import {
  buildRepairInstruction,
  guardedModify,
  type ModifyContext,
} from "@karta/generator/backends";
import { VIEW_FIELDS, PAGE_FIELDS, type Resolved } from "karta";
import { listVersions } from "./app-history.js";
import { listDiagnoses, recordDiagnosis } from "./app-diagnoses.js";
import { StructurePanel } from "./structure-panel.js";
import type { Edit } from "./app-source.js";
import type { StructureTarget } from "./structure-panel.js";
import { buildAndValidate, loadDefinition } from "./validate-app.js";
import type { Toaster } from "./toaster.js";
import { Picker, type PickerHost } from "./picker.js";
import { UiSurfaces, type UiHost } from "./ui-host.js";
import type { NavHost } from "./nav-host.js";
import { ViewErrorBoundary } from "./view-error-boundary.js";

import { canUseEngine, modifyTurn } from "./model-turn.js";
import { checkConcurrency, describeHazards } from "./check-concurrency.js";
import { describeDrift, schemaDrift } from "./schema-drift.js";
import { shellDialogs } from "./dialog.js";
import { chooseScope } from "./scope.js";
import { appKey, recordSignals } from "./launcher-store.js";

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

// Declarative quick action (mirrors karta's QuickAction; kept structural to avoid a hard dep here).
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

/** Survives the reload that re-runs an edited app, so an edit doesn't cost you your place. */
const RETURN_TO_PAGE = "karta:return-to-page";

// One object-type tile on the grid home: icon + label + live record count. Reuses the entity's list
// page query for the count, so it reflects the same data the list shows.
function GridTile({
  runtime,
  pageId,
  label,
  icon,
  onOpen,
}: {
  runtime: KartaRuntime;
  pageId: string;
  label: string;
  icon: string;
  onOpen: () => void;
}) {
  const { rows } = runtime.usePageQuery(pageId, {});
  return (
    <button type="button" className="k-objtile" onClick={onOpen}>
      <span className="k-objtile-icon" aria-hidden>{icon}</span>
      <span className="k-objtile-name">{label}</span>
      <span className="k-objtile-count">{rows.length}</span>
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
  runtime: KartaRuntime;
  provenance: Provenance;
  toaster: Toaster;
  appId?: string;
  /** How the current app was launched — for highlighting it in the launcher. */
  currentKind?: "user";
  onExport?: () => void;
  onImport?: () => void;
  /** Enables the Studio + launcher (the shell's top-level app only — not the preview). */
  generator?: boolean;
}

export function App({ runtime, provenance, toaster, appId, currentKind, sync, onExport, onImport, generator, picker, questions, navHost }: AppProps) {
  const def = runtime.definition;
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

  const [pageId, setPageId] = useState<string>(() => {
    // READ ONLY. Clearing it here would make this initialiser impure, and StrictMode double-invokes
    // initialisers on purpose — the second call would find nothing and fall back to the first tab,
    // which is exactly how "come back to the page you were on" silently did nothing.
    const returning = globalThis.sessionStorage?.getItem(RETURN_TO_PAGE);
    if (returning && (returning === HOME || def.pages.some((p) => p.id === returning))) return returning;
    return landingPage();
  });
  // Consumed once, after mount, so it can't affect a later boot.
  useEffect(() => {
    globalThis.sessionStorage?.removeItem(RETURN_TO_PAGE);
  }, []);
  const [paramsByPage, setParamsByPage] = useState<Record<string, Record<string, unknown>>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  // This app's saved source as the Studio opened. The app below the Studio runs the module it booted
  // with, so a save (or a restore) made in there is invisible until a reload — closing the Studio
  // showed the old version of the app you had just changed.
  const sourceAtStudioOpen = useRef<string | undefined>(undefined);
  const openStudio = (): void => {
    sourceAtStudioOpen.current = appId ? getUserApp(appId)?.source : undefined;
    setGenOpen(true);
  };
  const closeStudio = (): void => {
    setGenOpen(false);
    const now = appId ? getUserApp(appId)?.source : undefined;
    if (now !== undefined && now !== sourceAtStudioOpen.current) location.reload();
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
  const scopeEntity = scopeDef ? def.entities[scopeDef.entity] : undefined;
  const scopeLabel = scopeDef?.label ?? scopeEntity?.label ?? scopeDef?.entity ?? "";
  const scopeName = (r: Resolved): string => String(r[scopeEntity?.displayField ?? "id"] ?? r.id);
  const pickScope = async (): Promise<void> => {
    if (!scopeDef) return;
    const NEW = { __new: true as const };
    const rows = await runtime.ctx.query(scopeDef.entity);
    const picked = await runtime.ctx.ui.pick<Resolved | typeof NEW>([...rows, NEW], {
      label: (r) => ("__new" in r ? `＋ New ${scopeEntity?.label ?? scopeDef.entity}` : scopeName(r)),
    });
    if (!picked || Array.isArray(picked)) return;
    if ("__new" in picked) {
      setEditor({ entity: scopeDef.entity, openAfter: false, onCreated: (id) => void chooseScope(runtime, scopeAppId, id) });
      return;
    }
    await chooseScope(runtime, scopeAppId, picked.id);
  };
  // A required scope is asked for as the app opens, once; the chip stays there to ask again.
  useEffect(() => {
    if (scopeDef?.required && !scoped) void pickScope();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    void startFix({
      source,
      theCase: caseReport.theCase,
      runtime,
      store: runtime.core.store,
      engine: engineCfg,
      onStep: (step) => {
        if (fixRunId.current !== runId) return; // a superseded run's step; the panel moved on
        setFixSteps((prev) => [...prev, step]);
      },
      signal: controller.signal,
      resumeFrom,
    }).then((outcome) => {
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
      toaster.push("Nothing was recorded — navigate the app or run an action before stopping.");
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
  // Placing a point on the map opens the create form already carrying it.
  const onCreate = (entity: string, initial: Record<string, unknown>): void =>
    setEditor({ entity, initial, openAfter: false });

  const entityLabel = (e: string): string => def.entities[e]?.label ?? e;

  // Quick actions: the app's declared triggers, else an auto "New <Entity>" per top-level object.
  const declaredQuick = (def as { quickActions?: QuickActionDef[] }).quickActions ?? [];
  const quickActions: QuickActionDef[] = declaredQuick.length
    ? declaredQuick
    : baseEntities.map((e) => ({ id: `new-${e}`, label: `New ${entityLabel(e)}`, entity: e, mode: "auto", open: true }));

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

  // ⑤ Edit mode → agent: point at a piece of UI and describe a change; the target + your text go to
  // the Modify agent, which edits THIS app's source. Only for your own saved apps (editable source).
  const canEdit = Boolean(generator && currentKind === "user" && appId);
  // Whether a MODEL can be reached — the dev route, or an engine the person chose with its key
  // (model-turn.ts). A deployed build has no `/__generate` route, so offering `claude -p` there showed
  // "Is `pnpm dev` still running?". Structural editing and History stay available either way.
  const canAskAgent = canUseEngine(engineCfg);
  const [editMode, setEditMode] = useState(false);
  // Reviewing/rolling back what an edit did — same gate as editing: your own saved app.
  const [historyOpen, setHistoryOpen] = useState(false);
  // What changed while you were away (KA-36). `null` means this store keeps no history — a local-only
  // app — and the control is hidden rather than showing an empty panel that would claim nothing
  // happened.
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  // Talking to the people you share with (KA-35). Only a CRDT store can carry it, and only a synced
  // app has a CRDT store — so on a local-only app the control is absent rather than present and
  // pointing at nobody. The room is loaded whether or not the panel is open, because the unread
  // badge is the whole reason to notice a message at all.
  const canChat = chatSupported(runtime.core.store);
  const [chatOpen, setChatOpen] = useState(false);
  const room = useThread(runtime, canChat ? ROOM_THREAD : null);
  const roomUnread = appId ? unreadCount(room.messages, appId, ROOM_THREAD, runtime.ctx.me?.id) : 0;
  // The launcher badge (#86): the counts this app already shows, kept on its launcher entry as they
  // change, so the home screen can show them without running the app. Opening the chat or the
  // changes panel moves the watermarks, which brings these to zero and clears the badge.
  const changesUnseen = activity?.length ?? 0;
  useEffect(() => {
    if (!appId || currentKind !== "user") return;
    recordSignals(appKey("user", appId), { changes: changesUnseen, chat: roomUnread });
  }, [appId, currentKind, changesUnseen, roomUnread]);
  const [modifyTarget, setModifyTarget] = useState<string | null>(null);
  const [modifyText, setModifyText] = useState("");
  const [modifyBusy, setModifyBusy] = useState(false);
  const [modifyError, setModifyError] = useState<string | null>(null);
  // Not an error: the agent looked and reported the cause lives in the host, not in this app.
  const [modifyDiagnosis, setModifyDiagnosis] = useState<string | null>(null);
  // The source as it stands, read when the panel opens — the structural controls are derived from
  // what can actually be located in it.
  const [modifySource, setModifySource] = useState<string | null>(null);
  const [modifyKind, setModifyKind] = useState<StructureTarget["kind"]>("page");
  // Set once a structural control has actually changed something, so the dialog can say so and offer
  // "Done" instead of leaving "Apply with AI" looking like the way to save.
  const [modifyApplied, setModifyApplied] = useState<string | null>(null);
  // Editing runs a real model call for a minute or more; silence reads as a hang.
  const [modifyProgress, setModifyProgress] = useState<string | null>(null);

  // What the ✎ was clicked on. The panel renders controls for THIS, not for whatever page happens to
  // be open — clicking "navigation / tabs" used to show the current page's entity fields, which is
  // why it looked like the panel ignored you.
  /**
   * Close the edit panel, re-running the app if anything was actually changed.
   *
   * The re-run is a reload because the module is evaluated at boot; deferring it to here is what lets
   * you make several changes in one sitting. `RETURN_TO_PAGE` carries the open page across it, so you
   * land back where you were instead of on the first tab.
   */
  const closeModify = (): void => {
    const applied = modifyApplied;
    setModifyTarget(null);
    setModifyApplied(null);
    if (applied) {
      sessionStorage.setItem(RETURN_TO_PAGE, pageId);
      location.reload();
    }
  };

  const editMark = (label: string, kind: StructureTarget["kind"]) =>
    editMode ? (
      <button
        type="button"
        className="k-editmark"
        aria-label={`Edit ${label}`}
        title={`Change ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setModifyText("");
          setModifyError(null);
          setModifyDiagnosis(null);
          setModifySource(appId ? getUserApp(appId)?.source ?? null : null);
          setModifyKind(kind);
          setModifyTarget(label);
        }}
      >
        ✎
      </button>
    ) : null;

  // What the agent may declare about the view the user pointed at. Derived from the Zod schema
  // (VIEW_FIELDS), so what the agent is told the boundary is cannot drift from what is enforced.
  const modifyTargetView = ((): ModifyContext["target"] => {
    const page = def.pages.find((p) => p.id === pageId);
    const viewType = (page?.view as { type?: string } | undefined)?.type;
    if (!viewType || !VIEW_FIELDS[viewType]) return undefined;
    return { viewType, pageTitle: page ? titles[page.id] : undefined, fields: VIEW_FIELDS[viewType]!, pageFields: PAGE_FIELDS };
  })();

  // One turn with the chosen engine — the dev route or the person's own key (model-turn.ts).
  const askAgent = (currentSource: string, instruction: string, ctx?: ModifyContext): Promise<string> =>
    modifyTurn({
      engine: engineCfg,
      source: currentSource,
      instruction,
      ctx,
      onProgress: (text, s) => setModifyProgress(s === undefined ? text : `${text}… ${s}s`),
    });

  /** An edit round: the model sends SEARCH/REPLACE edits, `guardedModify` applies them, and it may
   *  legitimately come back as "this isn't the app's to fix". */
  const runModify = (currentSource: string, instruction: string, ctx: ModifyContext) =>
    guardedModify({
      attempt: (instr) => askAgent(currentSource, instr, ctx),
      shapeOf: loadDefinition,
      before: { pages: def.pages, entities: def.entities },
      instruction,
      source: currentSource,
    });

  /** A repair round, through the same gate as the edit. A diagnosis or a failure here is an error
   *  (there is nothing to save), never a version. */
  const runRepair = async (currentSource: string, issues: string[]): Promise<string> => {
    // Judged against the source being REPAIRED, not the app as it was before the modify. `def` is the
    // running app — pre-modify — so a repair that deletes a page the modify had just added would
    // compare clean against it, report no loss, and get saved. The Studio's `shapeOrEmpty` does the
    // same thing for the same reason; a source that does not load has no shape to lose, so an empty
    // shape stands in rather than failing the whole repair.
    const before = await loadDefinition(currentSource).then(
      (d) => ({ pages: d.pages, entities: d.entities }),
      () => ({ pages: [], entities: {} }),
    );
    const result = await guardedModify({
      attempt: (instr) => askAgent(currentSource, instr),
      shapeOf: loadDefinition,
      before,
      instruction: buildRepairInstruction(issues),
      source: currentSource,
    });
    if (result.kind === "diagnosis") throw new Error(`Nothing was saved — the repair was declined: ${result.text}`);
    if (result.kind === "failed") throw new Error(`Nothing was saved — the repair could not be applied: ${result.reason}`);
    if (result.loss !== null) {
      throw new Error(`Nothing was saved — the repair rewrote the app rather than editing it: it ${result.loss}`);
    }
    return result.source;
  };

  /**
   * Save a direct structural edit. No model, no repair round.
   *
   * It is still validated and still written as a version — a change you made by hand deserves the
   * same audit trail and the same way back as one the agent made. It is recorded as `adjusted`
   * rather than `edited` so History can tell them apart: an agent edit goes through the model and
   * may touch functions, this one only touched declarative data.
   */
  const applyStructuralEdit = async (_edit: Edit, next: string, note: string): Promise<void> => {
    setModifyApplied(note);
    if (!appId) return;
    const app = getUserApp(appId);
    if (!app) return;
    setModifyBusy(true);
    setModifyError(null);
    try {
      const issues = await buildAndValidate(next);
      if (issues.length) {
        // A structural edit that doesn't validate is a bug in the editor, not something to hand to a
        // model to repair. Discard it and say so rather than saving a broken app.
        setModifyError(`That change didn't validate, so nothing was saved: ${issues[0]}`);
        setModifyBusy(false);
        return;
      }
      await saveUserApp(
        { id: appId, name: app.name, source: next, origin: "adjusted", note },
        new Date().toISOString(),
      );
      // Re-inspect from the SAVED source, so a second change is computed from the first rather than
      // from the source as it was when the panel opened — two reorders in a row would otherwise both
      // be derived from the original and fight each other.
      setModifySource(next);
      setModifyBusy(false);
      // Deliberately no reload here. Reloading per click meant moving a field two places cost two
      // full app restarts, each closing this panel, turning Edit mode off and dropping you back on
      // the first tab. The app is re-run once, when you close the panel.
    } catch (e) {
      setModifyError(e instanceof Error ? e.message : String(e));
      setModifyBusy(false);
    }
  };

  const applyModify = async (): Promise<void> => {
    if (!appId || !modifyTarget) return;
    const app = getUserApp(appId);
    if (!app) return;
    setModifyBusy(true);
    setModifyError(null);
    setModifyDiagnosis(null);
    setModifyProgress("Working…");
    try {
      const instruction = `Regarding ${modifyTarget}: ${modifyText.trim()}`;
      // What has already been tried on this app, so a repeated complaint escalates instead of
      // producing a third rewrite of whatever function looked closest last time.
      const [priorVersions, priorDiagnoses] = await Promise.all([listVersions(appId), listDiagnoses(appId)]);
      const reply = await runModify(app.source, instruction, {
        target: modifyTargetView,
        priorAttempts: priorVersions
          .filter((v) => v.origin === "edited" && v.note)
          .slice(0, 4)
          .map((v) => v.note!),
        priorDiagnoses: priorDiagnoses.slice(0, 3).map((d) => d.text),
      });

      // The agent says this isn't the app's to fix. Record it and show it — appending a version here
      // would be recording an edit that was deliberately not made, and would feed the next prompt a
      // source change that never happened.
      if (reply.kind === "diagnosis") {
        // Only an unprompted verdict is recorded: one reached after "your previous attempt removed X"
        // is a retreat under pressure, and recording it would feed it to every later prompt as fact.
        if (!reply.trace.noMatchRetry && !reply.trace.lossRetry) {
          await recordDiagnosis(appId, { complaint: instruction, text: reply.text, target: modifyTarget }, new Date().toISOString());
        }
        setModifyDiagnosis(reply.text);
        setModifyBusy(false);
        setModifyProgress(null);
        return;
      }
      // Say what went wrong in words: an edit that did not match twice, or prose instead of a change.
      if (reply.kind === "failed") {
        setModifyError(`Nothing was changed — ${reply.reason}`);
        setModifyBusy(false);
        setModifyProgress(null);
        return;
      }
      // Edit mode SAVES on success, so a result that still drops part of the app after the retry
      // must not get that far. The Studio can show such a result because nothing is saved until
      // the person clicks Save; here the person would find out from a missing page.
      if (reply.loss !== null) {
        setModifyError(`Nothing was saved — this change rewrote the app rather than editing it: it ${reply.loss}. Try a smaller, more specific change.`);
        setModifyBusy(false);
        setModifyProgress(null);
        return;
      }

      // Validate the edited app the same way the Studio does; auto-repair once so Edit mode can't
      // save broken structure (e.g. a malformed list) that would reach the user as broken UI.
      let next = reply.source;
      const issues = await buildAndValidate(next);
      if (issues.length) {
        setModifyProgress("Fixing structure… (one more round, up to three calls)");
        next = await runRepair(next, issues);
        // Re-validate. Before this, whatever the repair returned was saved — a second slip reached
        // the person as broken UI with a History entry that looked like a successful edit.
        const still = await buildAndValidate(next);
        if (still.length) {
          setModifyError(`Nothing was saved — the change did not validate even after a repair: ${still[0]}`);
          setModifyBusy(false);
          setModifyProgress(null);
          return;
        }
      }

      // Will two people survive this edit? An AI edit can change any function in the module, and the way this
      // breaks is silent: the app still parses, still validates, still works alone (KA-38). This is
      // the only gate that can see it. Reported, never blocking — plenty of apps are never shared,
      // and an unsafe reorder is still fine for one person.
      setModifyProgress("Checking it still works for two people…");
      const risk = await checkConcurrency(next, appId);
      const hazards = describeHazards(risk);

      // And whether it quietly changed how data is stored. An app with no records behaves perfectly
      // after a change like that; it is only wrong in the presence of data that already exists,
      // which is the one thing none of the other gates has.
      const drift = describeDrift(await schemaDrift(app.source, next));

      // Awaited, not fired-and-forgotten: the reload below would otherwise race the history write
      // and lose the very version you'd want to roll back to.
      await saveUserApp(
        { id: appId, name: app.name, source: next, origin: "edited", note: instruction, rationale: reply.rationale },
        new Date().toISOString(),
      );
      // Before the reload, or neither is ever seen. Saved either way — these say what was saved.
      if (drift) await shellDialogs.confirm(`Saved — ${drift}`);
      if (hazards.length) {
        await shellDialogs.confirm(
          `Saved — but this change is not safe to share yet:\n\n• ${hazards.join("\n• ")}\n\n` +
            `On your own it works fine. With someone else, changes made at the same moment can be ` +
            `silently lost. History has the previous version.`,
        );
      }
      location.reload(); // re-run the app with the edited source (its data persists in user:<id>)
    } catch (e) {
      setModifyError(e instanceof Error ? e.message : String(e));
      setModifyBusy(false);
      setModifyProgress(null);
    }
  };

  const currentPageLabel = pageId === HOME ? "the object grid (home)" : `the "${titles[pageId] ?? pageId}" page`;

  // Promote/demote trust. Promotion runs the app DIRECTLY (not in the isolate) — a deliberate,
  // prompted decision (CLAUDE.md rule 3). Only for your own saved apps.
  const [trustPrompt, setTrustPrompt] = useState(false);
  const grantedCaps = Object.entries(def.permissions ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  const setTrust = (trusted: boolean): void => {
    if (!appId) return;
    setUserAppTrusted(appId, trusted, new Date().toISOString());
    location.reload();
  };

  const accent = def.theme?.accent ?? "#E4A93C";

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
    ...(navMode === "grid" ? [{ id: HOME, title: "Home", icon: "⊞", active: pageId === HOME, onOpen: () => navigate(HOME) }] : []),
    ...visiblePages.map((p) => ({ id: p.id, title: titles[p.id] ?? p.id, icon: pageIcon(p), active: p.id === pageId, onOpen: () => navigate(p.id) })),
  ];
  const chromeQuick: ChromeQuick[] = quickActions.map((qa) => ({
    id: qa.id,
    label: qa.label,
    icon: qa.icon ?? def.entities[qa.entity]?.icon ?? "＋",
    entity: qa.entity,
    onRun: () => triggerQuick(qa),
  }));
  const currentPage = def.pages.find((p) => p.id === pageId);
  const currentEntity = (currentPage?.view as { entity?: string } | undefined)?.entity;
  // A hidden page (a record's detail, a custom walk-through) is a sub-page: the top bar gets a back
  // control to the entity's list, and the floating quick action stays out of the page's own actions.
  const isSubPage = Boolean(currentPage?.hidden);
  const backTo = (): void => {
    const list = visiblePages.find((p) => (p.view as { entity?: string }).entity === currentEntity);
    navigate(list?.id ?? landingPage());
  };
  const chromeTools: ChromeTool[] = [
    // The Studio needs no model: its source editor and History are how a broken app gets repaired
    // on a build with no engine at all.
    ...(generator ? [{ key: "studio", label: "Studio", icon: "✦", hint: "change this app", onSelect: () => {
            setStudioPrefill(undefined);
            setStudioAppId(currentKind === "user" ? appId : undefined);
            openStudio();
          } }] : []),
    ...(canEdit ? [{ key: "edit-mode", label: "Edit mode", icon: "✎", active: editMode, onSelect: () => setEditMode((v) => !v) }] : []),
    ...(canEdit ? [{ key: "history", label: "History", icon: "⟲", onSelect: () => setHistoryOpen(true) }] : []),
    ...(onImport ? [{ key: "import", label: "Import", icon: "⇣", onSelect: onImport }] : []),
    ...(onExport ? [{ key: "export", label: "Export", icon: "⇡", onSelect: onExport }] : []),
  ];
  const chromeReport: ChromeTool[] = appId
    ? recording
      ? [
          { key: "stop-recording", label: "Stop recording", icon: "■", onSelect: () => void onStopRecording() },
          { key: "add-note", label: "Add a note", icon: "✎", onSelect: () => setNoting(true) },
        ]
      : [{ key: "report", label: "Something's wrong", icon: "⚑", onSelect: startRecording }]
    : [];
  // Promote/demote trust from the tools, where it belongs — not as a pill in everyone's face.
  const chromeTrust: ChromeTool | undefined = canEdit
    ? {
        key: "trust",
        label: provenance === "trusted" ? "Runs directly" : "Runs in a sandbox",
        icon: "🛡",
        hint: provenance === "trusted" ? "review" : "allow direct",
        className: `k-prov-btn k-prov-${provenance}`,
        onSelect: () => setTrustPrompt(true),
      }
    : undefined;

  return (
    <div className="k-app" data-provenance={provenance} style={{ ["--accent" as string]: accent }}>
      <AppChrome
        name={def.name}
        icon={def.icon ?? "◆"}
        scope={
          scopeDef ? (
            <button
              type="button"
              className="k-scope"
              data-empty={!scoped || undefined}
              aria-label={`${scopeLabel}: ${scoped ? scopeName(scoped) : "none chosen"} — change`}
              title={`Which ${scopeLabel.toLowerCase()} the app is showing`}
              onClick={() => void pickScope()}
            >
              <span className="k-scope-label">{scopeLabel}</span>
              {scoped ? scopeName(scoped) : `Choose…`} ▾
            </button>
          ) : null
        }
        status={
          <>
            {/* Provenance is shown only when it is unusual (#87): an app that runs in the sandbox
                gets a quiet mark, never red — that is the safe state. A trusted app says nothing. */}
            {provenance === "untrusted" ? (
              <span className="k-prov k-prov-untrusted" title="Runs in a sandbox — click Runs in a sandbox in the menu to review">
                🛡 sandbox
              </span>
            ) : null}
            <SyncStatus sync={sync} />
          </>
        }
        pages={chromePages}
        quick={chromeQuick}
        currentEntity={currentEntity}
        tools={chromeTools}
        report={chromeReport}
        recording={recording}
        trust={chromeTrust}
        onApps={generator ? () => setLauncherOpen(true) : undefined}
        extras={
          <>
            {activity ? (
              <button
                type="button"
                className="k-add k-activity-btn"
                aria-label={activity.length ? `What changed — ${activity.length} since you last looked` : "What changed"}
                data-unread={activity.length || undefined}
                onClick={() => setActivityOpen(true)}
              >
                ✻ Changes
                {activity.length ? <span className="k-activity-count">{activity.length}</span> : null}
              </button>
            ) : null}
            {canChat ? (
              <button
                type="button"
                // Its own class, not `k-activity-btn`: that one is how the activity spec finds the
                // Changes button, and sharing it made the selector ambiguous.
                className="k-add k-chat-btn"
                aria-label={roomUnread ? `Chat — ${roomUnread} unread` : "Chat"}
                data-unread={roomUnread || undefined}
                onClick={() => setChatOpen(true)}
              >
                💬 Chat
                {roomUnread ? <span className="k-activity-count">{roomUnread}</span> : null}
              </button>
            ) : null}
          </>
        }
        navMark={editMark("the navigation / tabs", "nav")}
        quickMark={editMark("the quick action buttons", "quickActions")}
        onBack={isSubPage ? backTo : undefined}
        pageTitle={pageId === HOME ? undefined : titles[pageId] ?? pageId}
        showQuick={!isSubPage}
      >
      {pageId === HOME ? (
        <main className="k-main">
          {editMark("the object grid home", "home")}
          <div className="k-objgrid" aria-label="Objects">
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
        </main>
      ) : (
        // `key={pageId}`: a fresh boundary per page, not a stuck one — navigating away from a page
        // that crashed (the fallback's own "Back to a working page" button, or any other nav) mounts
        // a clean boundary for wherever you land, instead of carrying yesterday's error state into a
        // page that never had a problem.
        <ViewErrorBoundary key={`${pageId}:${scoped?.id ?? ""}`} pageLabel={currentPageLabel} onRecover={() => setPageId(landingPage())}>
          <FilterChrome runtime={runtime} pageId={pageId} params={params} setParam={setParam} />
          <SummaryStrip runtime={runtime} pageId={pageId} params={params} />
          <main className="k-main">
            {editMark(currentPageLabel, "page")}
            {currentPage?.layout ? (
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
        </ViewErrorBoundary>
      )}

      </AppChrome>

      {editor ? (
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
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {trustPrompt ? (
        <div className="k-modal-scrim" onClick={() => setTrustPrompt(false)}>
          <div className="k-modal k-trustdialog" onClick={(e) => e.stopPropagation()}>
            {provenance === "trusted" ? (
              <>
                <h3>Trusted app</h3>
                <p className="k-muted">
                  <strong>{def.name}</strong> runs directly on this device (not sandboxed). Revoke to run it in the
                  isolate again.
                </p>
                <div className="k-form-actions">
                  <button type="button" className="k-add" onClick={() => setTrustPrompt(false)}>Close</button>
                  <button type="button" className="k-add" onClick={() => setTrust(false)}>Revoke trust</button>
                </div>
              </>
            ) : (
              <>
                <h3>Promote to trusted?</h3>
                <p className="k-muted">
                  Trusted apps run <strong>directly</strong> with full access — no sandbox. Only promote an app you
                  wrote or fully trust. <strong>{def.name}</strong> declares:
                </p>
                <ul className="k-trust-caps">
                  {grantedCaps.length ? grantedCaps.map((c) => <li key={c}>{c}</li>) : <li className="k-muted">no special capabilities</li>}
                </ul>
                <div className="k-form-actions">
                  <button type="button" className="k-add" onClick={() => setTrustPrompt(false)}>Cancel</button>
                  <button type="button" className="k-add k-primary-action" onClick={() => setTrust(true)}>Promote to trusted</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {modifyTarget ? (
        <div className="k-modal-scrim" onClick={() => (modifyBusy ? undefined : closeModify())}>
          <div className="k-modal k-modifydialog" onClick={(e) => e.stopPropagation()}>
            <h3>Change {modifyTarget}</h3>

            {/* Direct controls first, the agent second. A label, a field's order and whether a field
                shows in the form are declarative data — they need no model, and a model round trip for a
                string is slower and can still go wrong. */}
            {modifySource ? (
              <StructurePanel
                source={modifySource}
                target={{ kind: modifyKind, pageId }}
                busy={modifyBusy}
                onApply={applyStructuralEdit}
              />
            ) : null}

            {canAskAgent ? (
              <>
                <p className="k-muted">
                  {modifySource
                    ? "Anything the controls above can't do — describe it, and the agent edits this app."
                    : "Describe the change — the agent edits this app, keeping the rest."}
                </p>
                <textarea
                  className="k-input k-modify-text"
                  aria-label="Describe the change"
                  placeholder='e.g. "make this a grid of icons, and put Start Session first"'
                  rows={4}
                  value={modifyText}
                  onChange={(e) => setModifyText(e.target.value)}
                />
              </>
            ) : (
              // Say what this build cannot do, rather than leaving a box that fails on submit. The
              // controls above still work — they never needed a model.
              <p className="k-muted">
                To describe a change and have the agent make it, choose a model in the Studio&rsquo;s Model
                settings — your own Anthropic or OpenRouter key works on any copy of Karta.
              </p>
            )}
            {modifyProgress && !modifyError ? <p className="k-muted">{modifyProgress}</p> : null}
            {modifyError ? <p className="k-form-error">{modifyError}</p> : null}
            {modifyDiagnosis ? (
              // Deliberately not styled as an error. Nothing failed: the agent was asked for a change
              // this app cannot express and said so instead of inventing one that could not work.
              <div className="k-diagnosis" role="note">
                <p className="k-diagnosis-head">This one isn&rsquo;t in your app</p>
                <p className="k-diagnosis-body">{modifyDiagnosis}</p>
                <p className="k-muted">
                  Nothing was changed. It&rsquo;s saved in History so a later edit doesn&rsquo;t retry it.
                </p>
              </div>
            ) : null}
            <div className="k-form-actions">
              <button type="button" className="k-add" disabled={modifyBusy} onClick={closeModify}>
                {modifyDiagnosis || modifyApplied ? "Close" : "Cancel"}
              </button>
              {/* Only offered once there is something to send. Otherwise it is the only button that
                  looks like "save", so a direct edit — which has already been applied — reads as
                  needing a model call it does not need. */}
              {canAskAgent && (modifyText.trim().length > 0 || modifyBusy) ? (
                <button type="button" className="k-add k-primary-action" disabled={modifyBusy} onClick={() => void applyModify()}>
                  {modifyBusy ? "Applying…" : "Apply with AI"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {launcherOpen ? (
        <Launcher
          variant="overlay"
          selected={appId ? { kind: currentKind ?? "user", id: appId } : undefined}
          onOpen={openInstalledApp}
          onNewApp={(prefill) => {
            setLauncherOpen(false);
            setStudioPrefill(prefill);
            setStudioAppId(undefined);
            openStudio();
          }}
          onClose={() => setLauncherOpen(false)}
        />
      ) : null}

      {historyOpen && appId ? (
        <History
          appId={appId}
          appName={def.name}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => location.reload()}
        />
      ) : null}

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

      {genOpen ? <Studio onClose={closeStudio} initialDescription={studioPrefill} initialAppId={studioAppId} /> : null}

      {noting ? (
        <div className="k-modal-scrim" onClick={() => { stopAfterNote.current = false; setNoting(false); }}>
          <div className="k-modal k-case-note" onClick={(e) => e.stopPropagation()}>
            <h3>What did you expect?</h3>
            <textarea
              className="k-input"
              aria-label="What did you expect?"
              rows={3}
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="k-form-actions">
              <button type="button" className="k-add" onClick={() => { stopAfterNote.current = false; setNoting(false); }}>Cancel</button>
              <button type="button" className="k-add k-primary-action" onClick={saveNote}>Save note</button>
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
                  Fix this
                </button>
              ) : (
                // The friendlier half of the same fact `startFix` itself refuses on: a dead button
                // would say nothing about WHY, and this is the reason before you've spent a click.
                <p className="k-muted k-fix-entry-reason">
                  {engineLabel(engineCfg)} can&rsquo;t investigate this step by step — pick a cloud
                  engine, like OpenRouter, in the Studio&rsquo;s Model settings to use Fix this.
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
