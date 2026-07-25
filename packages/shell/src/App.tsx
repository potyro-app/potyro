// The shell UI: app header + provenance badge, page nav, view-chrome (pantry picker), the
// active view, an add-recipe panel, and toasts. Renders whatever app the composition root
// loaded (trusted or sandboxed) — the UI is app-agnostic.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { Provenance } from "@karta/host";
import { RecordForm, ViewHost } from "@karta/views";
import { FilterChrome } from "./filter-chrome.js";
import type { Toaster } from "./toaster.js";

interface EditorState {
  entity: string;
  id?: string;
}

interface AppProps {
  runtime: KartaRuntime;
  provenance: Provenance;
  toaster: Toaster;
  appId?: string;
  apps?: readonly string[];
  onExport?: () => void;
}

export function App({ runtime, provenance, toaster, appId, apps, onExport }: AppProps) {
  const def = runtime.definition;
  const visiblePages = def.pages.filter((p) => !p.hidden);
  const [pageId, setPageId] = useState(visiblePages[0]?.id ?? def.pages[0]!.id);
  const [paramsByPage, setParamsByPage] = useState<Record<string, Record<string, unknown>>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);

  const params = paramsByPage[pageId] ?? {};
  const setParam = (key: string, value: unknown): void =>
    setParamsByPage((prev) => ({ ...prev, [pageId]: { ...(prev[pageId] ?? {}), [key]: value } }));

  const navigate = (target: string, param?: Record<string, string>): void => {
    setPageId(target);
    if (param) setParamsByPage((prev) => ({ ...prev, [target]: { ...(prev[target] ?? {}), ...param } }));
  };

  const onEdit = (entity: string, id: string): void => setEditor({ entity, id });

  // Entity for the "+ New" button: the current page's view entity, else the first entity.
  const currentEntity =
    (def.pages.find((p) => p.id === pageId)?.view as { entity?: string } | undefined)?.entity ??
    Object.keys(def.entities)[0]!;
  const currentEntityLabel = def.entities[currentEntity]?.label ?? currentEntity;

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
          {apps && apps.length > 1 ? (
            <select
              className="k-app-switch"
              aria-label="Switch app"
              value={appId ?? ""}
              onChange={(e) => {
                location.search = `?app=${e.target.value}`;
              }}
            >
              {apps.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          ) : null}
          {onExport ? (
            <button type="button" className="k-add" onClick={onExport}>
              Export
            </button>
          ) : null}
          <button type="button" className="k-add" onClick={() => setEditor({ entity: currentEntity })}>
            + New {currentEntityLabel}
          </button>
        </div>
      </header>

      <nav className="k-nav" aria-label="Pages">
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

      <ViewChrome runtime={runtime} pageId={pageId} params={params} setParam={setParam} />
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

      {editor ? (
        <div className="k-modal-scrim" onClick={() => setEditor(null)}>
          <div className="k-modal" onClick={(e) => e.stopPropagation()}>
            <RecordForm
              runtime={runtime}
              entity={editor.entity}
              recordId={editor.id}
              onDone={() => setEditor(null)}
              onCancel={() => setEditor(null)}
            />
          </div>
        </div>
      ) : null}

      <Toasts toaster={toaster} />
    </div>
  );
}

/** View-chrome: the pantry picker for the "what can I cook?" page (writes ctx.params.pantry). */
function ViewChrome({
  runtime,
  pageId,
  params,
  setParam,
}: {
  runtime: KartaRuntime;
  pageId: string;
  params: Record<string, unknown>;
  setParam: (k: string, v: unknown) => void;
}) {
  const view = runtime.definition.pages.find((p) => p.id === pageId)?.view as { filter?: unknown } | undefined;
  const isPantryPage = pageId === "cook-with";
  const { rows } = runtime.useQuery("ingredient");
  if (!isPantryPage || !view?.filter) return null;

  const selected = new Set((params.pantry as string[]) ?? []);
  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParam("pantry", [...next]);
  };

  return (
    <section className="k-chrome" aria-label="Pantry">
      <span className="k-chrome-label">In my pantry:</span>
      <div className="k-chips">
        {rows.map((ing) => (
          <button
            key={ing.id}
            type="button"
            className="k-chip"
            data-on={selected.has(ing.id)}
            onClick={() => toggle(ing.id)}
          >
            {String(ing.name)}
          </button>
        ))}
        {rows.length === 0 ? <span className="k-muted">No ingredients yet.</span> : null}
      </div>
    </section>
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
