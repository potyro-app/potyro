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
import { listUserApps } from "./user-apps.js";
import type { Toaster } from "./toaster.js";

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
  mode?: "auto" | "form" | "menu";
  open?: boolean;
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

export function App({ runtime, provenance, toaster, appId, apps, currentKind, onExport, onImport, generator }: AppProps) {
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
  const openRecord = (entity: string, id: string): void => {
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

  const accent = def.theme?.accent ?? "#E4A93C";

  return (
    <div className="k-app" style={{ ["--accent" as string]: accent }}>
      <header className="k-header">
        <div className="k-brand">
          <span className="k-logo" aria-hidden>◆</span>
          <h1>{def.name}</h1>
          <span className={`k-prov k-prov-${provenance}`}>{provenance}</span>
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
        </div>
      ) : null}

      <nav className="k-nav" aria-label="Pages">
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
