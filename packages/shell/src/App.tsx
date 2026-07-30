// The shell UI: app header + provenance badge, page nav, view-chrome (pantry picker), the
// active view, an add-recipe panel, and toasts. Renders whatever app the composition root
// loaded (trusted or sandboxed) — the UI is app-agnostic.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { Provenance } from "@karta/host";
import { RecordForm, ViewHost, createDefaults } from "@karta/views";
import { FilterChrome } from "./filter-chrome.js";
import { Studio } from "./studio.js";
import { Launcher, openBuiltinApp, openUserApp, goHome } from "./launcher.js";
import { listUserApps, getUserApp, saveUserApp, setUserAppTrusted } from "./user-apps.js";
import { SYSTEM_PROMPT, buildModifyMessage, buildRepairMessage, extractSource } from "@karta/generator/backends";
import { buildAndValidate } from "./validate-app.js";
import type { Toaster } from "./toaster.js";
import { Picker, type PickerHost } from "./picker.js";
import { generateViaCli } from "./generate-client.js";

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

export function App({ runtime, provenance, toaster, appId, apps, currentKind, onExport, onImport, generator, picker }: AppProps) {
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

  const [pageId, setPageId] = useState<string>(navMode === "grid" ? HOME : (visiblePages[0]?.id ?? def.pages[0]!.id));
  const [paramsByPage, setParamsByPage] = useState<Record<string, Record<string, unknown>>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);

  const params = paramsByPage[pageId] ?? {};
  const setParam = (key: string, value: unknown): void =>
    setParamsByPage((prev) => ({ ...prev, [pageId]: { ...(prev[pageId] ?? {}), [key]: value } }));

  const navigate = (target: string, param?: Record<string, string>): void => {
    setPageId(target);
    if (param) setParamsByPage((prev) => ({ ...prev, [target]: { ...(prev[target] ?? {}), ...param } }));
  };

  const onEdit = (entity: string, id: string): void => setEditor({ entity, id });

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

  // ⑤ Edit mode → agent: point at a piece of UI and describe a change; the target + your text go to
  // the Modify agent, which edits THIS app's source. Only for your own saved apps (editable source).
  const canEdit = Boolean(generator && currentKind === "user" && appId);
  const [editMode, setEditMode] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<string | null>(null);
  const [modifyText, setModifyText] = useState("");
  const [modifyBusy, setModifyBusy] = useState(false);
  const [modifyError, setModifyError] = useState<string | null>(null);
  // Editing runs a real model call for a minute or more; silence reads as a hang.
  const [modifyProgress, setModifyProgress] = useState<string | null>(null);

  const editMark = (label: string) =>
    editMode ? (
      <button
        type="button"
        className="k-editmark"
        aria-label={`Edit ${label}`}
        title={`Ask the agent to change ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setModifyText("");
          setModifyError(null);
          setModifyTarget(label);
        }}
      >
        ✎
      </button>
    ) : null;

  // Build a modify/repair prompt and run it through the local `claude -p` dev endpoint.
  const runAgent = async (currentSource: string, instruction: string, repairIssues?: string[]): Promise<string> => {
    // The contract goes in `system`, not the prompt — see generate-client.ts.
    const parts = ["The current app:", "```ts", currentSource, "```", ""];
    parts.push(repairIssues ? buildRepairMessage(repairIssues) : buildModifyMessage(instruction));
    const text = await generateViaCli({
      system: SYSTEM_PROMPT,
      prompt: parts.join("\n"),
      onProgress: (s) => setModifyProgress(`Working… ${s}s`),
    });
    return extractSource(text);
  };

  const applyModify = async (): Promise<void> => {
    if (!appId || !modifyTarget) return;
    const app = getUserApp(appId);
    if (!app) return;
    setModifyBusy(true);
    setModifyError(null);
    setModifyProgress("Working…");
    try {
      const instruction = `Regarding ${modifyTarget}: ${modifyText.trim()}`;
      let next = await runAgent(app.source, instruction);
      // Validate the edited app the same way the Studio does; auto-repair once so Edit mode can't
      // save broken structure (e.g. a malformed list) that would reach the user as broken UI.
      let issues = await buildAndValidate(next);
      if (issues.length) next = await runAgent(next, instruction, issues);
      saveUserApp({ id: appId, name: app.name, source: next }, new Date().toISOString());
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
          {generator ? (
            <button type="button" className="k-add" onClick={() => setGenOpen(true)}>
              Studio
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
          {editMark("the quick action buttons")}
        </div>
      ) : null}

      <nav className="k-nav" aria-label="Pages">
        {editMark("the navigation / tabs")}
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
          {editMark("the object grid home")}
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
          <main className="k-main">
            {editMark(currentPageLabel)}
            <ViewHost
              runtime={runtime}
              pageId={pageId}
              params={params}
              setParam={setParam}
              navigate={navigate}
              onEdit={onEdit}
            />
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
        <div className="k-modal-scrim" onClick={() => (modifyBusy ? undefined : setModifyTarget(null))}>
          <div className="k-modal k-modifydialog" onClick={(e) => e.stopPropagation()}>
            <h3>Change {modifyTarget}</h3>
            <p className="k-muted">Describe the change — the agent edits this app, keeping the rest.</p>
            <textarea
              className="k-input k-modify-text"
              aria-label="Describe the change"
              placeholder='e.g. "make this a grid of icons, and put Start Session first"'
              rows={4}
              autoFocus
              value={modifyText}
              onChange={(e) => setModifyText(e.target.value)}
            />
            {modifyProgress && !modifyError ? <p className="k-muted">{modifyProgress}</p> : null}
            {modifyError ? <p className="k-form-error">{modifyError}</p> : null}
            <div className="k-form-actions">
              <button type="button" className="k-add" disabled={modifyBusy} onClick={() => setModifyTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="k-add k-primary-action"
                disabled={modifyBusy || modifyText.trim().length === 0}
                onClick={() => void applyModify()}
              >
                {modifyBusy ? "Applying…" : "Apply with AI"}
              </button>
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
