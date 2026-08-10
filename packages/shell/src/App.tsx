// The shell UI: app header + provenance badge, page nav, view-chrome (pantry picker), the
// active view, an add-recipe panel, and toasts. Renders whatever app the composition root
// loaded (trusted or sandboxed) — the UI is app-agnostic.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ActivityItem, KartaRuntime } from "@karta/runtime";
import type { Provenance } from "@karta/host";
import { RecordForm, ViewHost, createDefaults } from "@karta/views";
import { FilterChrome } from "./filter-chrome.js";
import { SummaryStrip } from "./summary-strip.js";
import { Studio } from "./studio.js";
import { Launcher, openBuiltinApp, openUserApp, goHome } from "./launcher.js";
import { SyncStatus } from "./sync-status.js";
import { History } from "./history.js";
import { ActivityPanel, loadActivity, markSeen } from "./activity-panel.js";
import { ChatPanel, RecordThread, chatSupported, unreadCount, useThread } from "./chat-panel.js";
import { ROOM_THREAD } from "@karta/store";
import { listUserApps, getUserApp, saveUserApp, setUserAppTrusted } from "./user-apps.js";
import {
  SYSTEM_PROMPT,
  buildModifyMessage,
  buildRepairMessage,
  extractSource,
  parseModifyReply,
  type ModifyContext,
  type ModifyReply,
} from "@karta/generator/backends";
import { VIEW_FIELDS, PAGE_FIELDS } from "karta";
import { listVersions } from "./app-history.js";
import { listDiagnoses, recordDiagnosis } from "./app-diagnoses.js";
import { StructurePanel } from "./structure-panel.js";
import type { Edit } from "./app-source.js";
import type { StructureTarget } from "./structure-panel.js";
import { buildAndValidate } from "./validate-app.js";
import type { Toaster } from "./toaster.js";
import { Picker, type PickerHost } from "./picker.js";
import type { NavHost } from "./nav-host.js";

import { canGenerate, generateViaCli } from "./generate-client.js";

interface EditorState {
  entity: string;
  id?: string;
  /** Preset values for a new record (a quick action's prefill). */
  initial?: Record<string, unknown>;
  /** After creating, open the new record's detail. */
  openAfter?: boolean;
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
  runtime: KartaRuntime;
  provenance: Provenance;
  toaster: Toaster;
  appId?: string;
  apps?: readonly string[];
  /** How the current app was launched — for highlighting it in the launcher. */
  currentKind?: "builtin" | "user";
  onExport?: () => void;
  onImport?: () => void;
  /** Enables the Studio + launcher (the shell's top-level app only — not the preview). */
  generator?: boolean;
}

export function App({ runtime, provenance, toaster, appId, apps, currentKind, sync, onExport, onImport, generator, picker, navHost }: AppProps) {
  const def = runtime.definition;
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

  const [pageId, setPageId] = useState<string>(() => {
    // READ ONLY. Clearing it here would make this initialiser impure, and StrictMode double-invokes
    // initialisers on purpose — the second call would find nothing and fall back to the first tab,
    // which is exactly how "come back to the page you were on" silently did nothing.
    const returning = globalThis.sessionStorage?.getItem(RETURN_TO_PAGE);
    if (returning && (returning === HOME || def.pages.some((p) => p.id === returning))) return returning;
    return navMode === "grid" ? HOME : (visiblePages[0]?.id ?? def.pages[0]!.id);
  });
  // Consumed once, after mount, so it can't affect a later boot.
  useEffect(() => {
    globalThis.sessionStorage?.removeItem(RETURN_TO_PAGE);
  }, []);
  const [paramsByPage, setParamsByPage] = useState<Record<string, Record<string, unknown>>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
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

  const navigate = (target: string, param?: Record<string, string>): void => {
    setPageId(target);
    if (param) setParamsByPage((prev) => ({ ...prev, [target]: { ...(prev[target] ?? {}), ...param } }));
  };

  // `ctx.navigate` from an action lands here. Bound through a ref so the binding survives re-renders
  // without re-registering on every one.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => navHost?.bind((page, param) => navigateRef.current(page, param)), [navHost]);

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
      void runtime.create(qa.entity, createDefaults(runtime, qa.entity, qa.prefill)).then((rec) => {
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
    const values = createDefaults(runtime, m.qa.entity, { [m.field]: option, ...(m.qa.prefill ?? {}) });
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
  // Whether a MODEL can be reached, which is a different question from whether this is the full
  // shell. A deployed build has no `/__generate` route, so every AI surface offered itself and then
  // failed with "Is `pnpm dev` still running?" — see `canGenerate`. Structural editing and History
  // stay available either way; neither calls a model.
  const canAskAgent = canGenerate();
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
    return { viewType, pageTitle: page?.title, fields: VIEW_FIELDS[viewType]!, pageFields: PAGE_FIELDS };
  })();

  // One round-trip through the local `claude -p` dev endpoint. The contract goes in `system`, not
  // the prompt — see generate-client.ts.
  const askAgent = async (currentSource: string, message: string): Promise<string> =>
    generateViaCli({
      system: SYSTEM_PROMPT,
      prompt: ["The current app:", "```ts", currentSource, "```", "", message].join("\n"),
      onProgress: (s) => setModifyProgress(`Working… ${s}s`),
    });

  /** An edit round, which may legitimately come back as "this isn't the app's to fix". */
  const runModify = async (currentSource: string, instruction: string, ctx: ModifyContext): Promise<ModifyReply> =>
    parseModifyReply(await askAgent(currentSource, buildModifyMessage(instruction, ctx)));

  /** A repair round answers "your output didn't compile" — a diagnosis is not a legal reply here. */
  const runRepair = async (currentSource: string, issues: string[]): Promise<string> =>
    extractSource(await askAgent(currentSource, buildRepairMessage(issues)));

  /**
   * Save a direct structural edit. No model, no repair round.
   *
   * It is still validated and still written as a version — a change you made by hand deserves the
   * same audit trail and the same way back as one the agent made. It is recorded as `adjusted`
   * rather than `edited` so History can tell them apart: an agent edit is a whole-file rewrite,
   * this one only touched declarative data.
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
        await recordDiagnosis(appId, { complaint: instruction, text: reply.text, target: modifyTarget }, new Date().toISOString());
        setModifyDiagnosis(reply.text);
        setModifyBusy(false);
        setModifyProgress(null);
        return;
      }

      // Validate the edited app the same way the Studio does; auto-repair once so Edit mode can't
      // save broken structure (e.g. a malformed list) that would reach the user as broken UI.
      let next = reply.source;
      const issues = await buildAndValidate(next);
      if (issues.length) next = await runRepair(next, issues);
      // Awaited, not fired-and-forgotten: the reload below would otherwise race the history write
      // and lose the very version you'd want to roll back to.
      await saveUserApp(
        { id: appId, name: app.name, source: next, origin: "edited", note: instruction, rationale: reply.rationale },
        new Date().toISOString(),
      );
      location.reload(); // re-run the app with the edited source (its data persists in user:<id>)
    } catch (e) {
      setModifyError(e instanceof Error ? e.message : String(e));
      setModifyBusy(false);
      setModifyProgress(null);
    }
  };

  const currentPageLabel = pageId === HOME ? "the object grid (home)" : `the "${def.pages.find((p) => p.id === pageId)?.title ?? pageId}" page`;

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

  return (
    <div className="k-app" style={{ ["--accent" as string]: accent }}>
      <header className="k-header">
        <div className="k-brand">
          <span className="k-logo" aria-hidden>◆</span>
          <h1>{def.name}</h1>
          {canEdit ? (
            <button
              type="button"
              className={`k-prov k-prov-${provenance} k-prov-btn`}
              title={provenance === "trusted" ? "Trusted — runs directly. Click to review / revoke." : "Untrusted — runs in a sandbox. Click to promote to trusted."}
              onClick={() => setTrustPrompt(true)}
            >
              {provenance} ▾
            </button>
          ) : (
            <span className={`k-prov k-prov-${provenance}`}>{provenance}</span>
          )}
          <SyncStatus sync={sync} />
        </div>
        <div className="k-header-actions">
          {generator ? (
            <button type="button" className="k-add" aria-label="Home" title="Launcher home" onClick={goHome}>
              ⌂
            </button>
          ) : null}
          {generator ? (
            <button type="button" className="k-add k-apps-btn" aria-label="Switch app" onClick={() => setLauncherOpen(true)}>
              ⊞ Apps
            </button>
          ) : null}
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
          {generator && canAskAgent ? (
            <button type="button" className="k-add" onClick={() => setGenOpen(true)}>
              Studio
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="k-add"
              aria-label="History"
              title="History — review and roll back changes to this app"
              onClick={() => setHistoryOpen(true)}
            >
              ⟲ History
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="k-add"
              aria-label="Edit mode"
              data-active={editMode}
              title="Edit mode — click a UI element to change it with the agent"
              onClick={() => setEditMode((v) => !v)}
            >
              ✎ Edit
            </button>
          ) : null}
          {onImport ? (
            <button type="button" className="k-add" onClick={onImport}>
              Import
            </button>
          ) : null}
          {onExport ? (
            <button type="button" className="k-add" onClick={onExport}>
              Export
            </button>
          ) : null}
        </div>
      </header>

      {quickActions.length ? (
        <div className="k-quickbar">
          {quickActions.map((qa) => (
            <button key={qa.id} type="button" className="k-add k-primary-action k-quick" onClick={() => triggerQuick(qa)}>
              <span aria-hidden>{qa.icon ?? def.entities[qa.entity]?.icon ?? "＋"}</span> {qa.label}
            </button>
          ))}
          {editMark("the quick action buttons", "quickActions")}
        </div>
      ) : null}

      <nav className="k-nav" aria-label="Pages">
        {editMark("the navigation / tabs", "nav")}
        {navMode === "grid" ? (
          <button type="button" className="k-tab" data-active={pageId === HOME} onClick={() => setPageId(HOME)}>
            ⊞ Home
          </button>
        ) : null}
        {visiblePages.map((p) => (
          <button
            key={p.id}
            type="button"
            className="k-tab"
            data-active={p.id === pageId}
            onClick={() => setPageId(p.id)}
          >
            {p.title}
          </button>
        ))}
      </nav>

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
                  onOpen={() => setPageId(lp.id)}
                />
              );
            })}
          </div>
        </main>
      ) : (
        <>
          <FilterChrome runtime={runtime} pageId={pageId} params={params} setParam={setParam} />
          <SummaryStrip runtime={runtime} pageId={pageId} params={params} />
          <main className="k-main">
            {editMark(currentPageLabel, "page")}
            <ViewHost
              runtime={runtime}
              pageId={pageId}
              params={params}
              setParam={setParam}
              navigate={navigate}
              onEdit={onEdit}
              onCreate={onCreate}
            />
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
        </>
      )}

      {editor ? (
        <div className="k-modal-scrim" onClick={() => setEditor(null)}>
          <div className="k-modal" onClick={(e) => e.stopPropagation()}>
            <RecordForm
              runtime={runtime}
              entity={editor.entity}
              recordId={editor.id}
              initial={editor.initial}
              onDone={(id) => {
                const ed = editor;
                setEditor(null);
                if (ed?.openAfter && id) openRecord(ed.entity, id);
              }}
              onCancel={() => setEditor(null)}
            />
          </div>
        </div>
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
                shows in the form are declarative data — they need no model, and asking one to change
                a string means it rewrites the whole file, functions included. */}
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
                This copy of Karta has no agent, so changes here are the structural ones above.
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
          builtins={apps ?? []}
          userApps={listUserApps()}
          selected={appId ? { kind: currentKind ?? "builtin", id: appId } : undefined}
          onOpenBuiltin={openBuiltinApp}
          onOpenUser={openUserApp}
          onNewApp={() => {
            setLauncherOpen(false);
            setGenOpen(true);
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

      {genOpen ? <Studio onClose={() => setGenOpen(false)} /> : null}

      {picker ? <Picker host={picker} /> : null}
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
