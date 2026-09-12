// Direct controls for the declarative parts of the page you pointed at.
//
// Renaming a label, hiding a field, reordering fields, retitling a page — none of these need a
// language model, and routing them through one is where the risk/benefit is worst: a model round
// trip to change a few characters is slower and can still go wrong.
//
// Every control here is rendered from what `app-source.inspect()` could actually LOCATE in the
// source, never from the schema. So a control exists only when there is a real byte range behind it,
// and the panel cannot offer a change it is unable to make. Where it can't, it says why and leaves
// the agent as the way through — the same honesty as the NOT-IN-APP boundary in Edit mode.

import { useEffect, useState } from "react";
import { humanizeKey } from "@karta/views";
import { applyEdit, inspect, type AppShape, type Edit, type EntityShape } from "./app-source.js";

/**
 * What the ✎ was clicked on.
 *
 * The panel renders controls for THIS. It used to take only a page id and always show that page's
 * entity fields, so clicking "navigation / tabs" showed "Fields of place" — the panel looked like it
 * ignored where you pointed, because it did.
 */
export interface StructureTarget {
  kind: "page" | "nav" | "quickActions" | "home";
  pageId: string;
}

export interface StructurePanelProps {
  source: string;
  target: StructureTarget;
  /** Apply an edit: validate, save as a version, re-run. Resolves when it has been dealt with. */
  onApply: (edit: Edit, next: string, note: string) => Promise<void>;
  busy: boolean;
}

/** Move `from` to `to` in a copy of `keys`. */
function moved(keys: readonly string[], from: number, to: number): string[] {
  const next = [...keys];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * The panel's picture of an entity's fields: its groups in order, then the fields in no group
 * (#100). A field moves within its group, over a group's edge into the neighbouring one, or out
 * of the last group into the ungrouped run — each step one ↑ or ↓, each one edit to the source.
 * An entity without groups is one ungrouped run, and moving there is the plain field reorder.
 */
interface Run {
  /** Index into `entity.groups`, or -1 for the ungrouped run. */
  group: number;
  title: string;
  keys: string[];
}

function runsOf(entity: EntityShape): Run[] {
  const groups = entity.groups ?? [];
  const placed = new Set(groups.flatMap((g) => g.fields));
  const runs: Run[] = groups.map((g, i) => ({ group: i, title: g.title ?? `Group ${i + 1}`, keys: [...g.fields] }));
  const rest = entity.fields.map((f) => f.key).filter((k) => !placed.has(k));
  if (rest.length || runs.length === 0) runs.push({ group: -1, title: groups.length ? "Not in a group" : "", keys: rest });
  return runs;
}

/** The edit that moves the field at `index` of run `r` one step in `direction`, or null at a wall. */
function stepEdit(entity: EntityShape, runs: Run[], r: number, index: number, direction: -1 | 1): Edit | null {
  const run = runs[r]!;
  const key = run.keys[index]!;
  const groups = (entity.groups ?? []).map((g) => [...g.fields]);
  const target = index + direction;
  if (target >= 0 && target < run.keys.length) {
    // Within the run.
    if (run.group < 0) {
      const order = entity.fields.map((f) => f.key);
      const from = order.indexOf(key);
      const to = order.indexOf(run.keys[target]!);
      return { kind: "field-order", entity: entity.key, order: moved(order, from, to) };
    }
    groups[run.group] = moved(groups[run.group]!, index, target);
    return { kind: "field-groups", entity: entity.key, groups };
  }
  // Over the run's edge into the neighbouring run.
  const neighbour = runs[r + direction];
  if (!neighbour) return null;
  if (run.group >= 0) {
    if (run.keys.length === 1) return null; // would leave the group empty — refused by the source
    groups[run.group] = groups[run.group]!.filter((k) => k !== key);
  }
  if (neighbour.group >= 0) {
    if (direction < 0) groups[neighbour.group] = [...groups[neighbour.group]!, key];
    else groups[neighbour.group] = [key, ...groups[neighbour.group]!];
  }
  return { kind: "field-groups", entity: entity.key, groups };
}

export function StructurePanel({ source, target, onApply, busy }: StructurePanelProps) {
  const { kind, pageId } = target;
  const [shape, setShape] = useState<AppShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which label input is being typed in, so a keystroke doesn't fight the re-inspected value.
  const [draft, setDraft] = useState<{ field: string; value: string } | null>(null);
  // A checkbox reflects the SOURCE, which doesn't change until the edit is saved and the app
  // re-runs. Without holding the intent here, ticking it visibly snaps back for the second it takes
  // to save — it reads as a control that doesn't work. Cleared if the edit is refused.
  const [pendingHidden, setPendingHidden] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    void inspect(source).then((s) => {
      if (live) setShape(s);
    });
    return () => {
      live = false;
    };
  }, [source]);

  if (!shape) return <p className="k-muted">Reading this app…</p>;

  const page = shape.pages.find((p) => p.id === pageId);
  // Fields belong to the PAGE target. Pointing at the tab bar is about the tabs, not about whatever
  // entity the open page happens to read.
  const entity: EntityShape | undefined =
    kind === "page" && page?.entity ? shape.entities.find((e) => e.key === page.entity) : undefined;

  /** Resolves to whether the edit was actually applied, so an optimistic control can roll back. */
  const run_ = async (edit: Edit): Promise<boolean> => {
    setError(null);
    const result = await applyEdit(source, edit);
    if (!result.ok) {
      setError(result.reason);
      return false;
    }
    await onApply(edit, result.source, result.note);
    return true;
  };

  if (shape.blocked) {
    return <p className="k-structure-blocked">{shape.blocked} You can still describe the change below.</p>;
  }

  // Only the pages that ARE tabs. The shell hides `hidden` pages and per-record `detail` pages from
  // the tab bar, so listing every page here offered to rename five "tabs" when three were on screen.
  // Mirrors `visiblePages` in App.tsx.
  const renamablePages = shape.pages.filter((p) => p.title !== undefined && !p.hidden && p.viewType !== "detail");
  if (kind === "nav") {
    return (
      <div className="k-structure">
        <p className="k-structure-heading">Tab names</p>
        {renamablePages.map((p) => (
          <label className="k-structure-row" key={p.id}>
            <span className="k-structure-label">{p.title}</span>
            <input
              className="k-input"
              defaultValue={p.title ?? ""}
              disabled={busy}
              aria-label={`Name for the ${p.title} tab`}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== p.title) void run_({ kind: "page-title", page: p.id, value });
              }}
            />
          </label>
        ))}
        {error ? <p className="k-form-error">{error}</p> : null}
      </div>
    );
  }

  if (kind !== "page" || !page) {
    return (
      <p className="k-structure-blocked">
        {kind === "quickActions"
          ? "Quick actions aren't editable directly yet — describe the change below and the agent will make it."
          : "There's nothing to change directly here. Describe the change below instead."}
      </p>
    );
  }

  const runs = entity ? runsOf(entity) : [];
  const computed = new Set(entity?.computed ?? []);
  const fieldByKey = new Map(entity?.fields.map((f) => [f.key, f]) ?? []);

  return (
    <div className="k-structure">
      <label className="k-structure-row">
        <span className="k-structure-label">Page name</span>
        <input
          className="k-input"
          defaultValue={page.title ?? ""}
          disabled={busy}
          aria-label="Page name"
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value && value !== page.title) void run_({ kind: "page-title", page: page.id, value });
          }}
        />
      </label>

      {entity?.blocked ? (
        <p className="k-structure-blocked">{entity.blocked} — describe the change below instead.</p>
      ) : entity ? (
        <>
          <p className="k-structure-heading">
            Fields of <strong>{entity.key}</strong>
          </p>
          {runs.map((run, r) => (
            <ul className="k-structure-fields" key={run.group} aria-label={run.title || undefined}>
              {run.title ? <li className="k-structure-group">{run.title}</li> : null}
              {run.keys.map((key, i) => {
                const field = fieldByKey.get(key);
                const up = stepEdit(entity, runs, r, i, -1);
                const down = stepEdit(entity, runs, r, i, 1);
                return (
                  <li key={key} className="k-structure-field">
                    <div className="k-structure-order">
                      <button
                        type="button"
                        className="k-add k-structure-move"
                        aria-label={`Move ${key} up`}
                        disabled={busy || !up}
                        onClick={() => up && void run_(up)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="k-add k-structure-move"
                        aria-label={`Move ${key} down`}
                        disabled={busy || !down}
                        onClick={() => down && void run_(down)}
                      >
                        ↓
                      </button>
                    </div>
                    {field ? (
                      <input
                        className="k-input k-structure-name"
                        aria-label={`Label for ${key}`}
                        // The key is what the app shows when no label is declared, so that is the
                        // placeholder — an empty box here means "use the default", not "no name".
                        placeholder={humanizeKey(key)}
                        value={draft?.field === key ? draft.value : field.label ?? ""}
                        disabled={busy}
                        onChange={(e) => setDraft({ field: key, value: e.target.value })}
                        onBlur={(e) => {
                          setDraft(null);
                          const value = e.target.value;
                          if (value !== (field.label ?? "")) {
                            void run_({ kind: "field-label", entity: entity.key, field: key, value });
                          }
                        }}
                      />
                    ) : (
                      // A computed value in a group: it shows on the detail page, has no label of
                      // its own to edit here and nothing to hide from a form.
                      <span className="k-structure-computed">
                        {humanizeKey(key)} <small>{computed.has(key) ? "computed" : "unknown"}</small>
                      </span>
                    )}
                    {field ? (
                      <label className="k-structure-hide">
                        <input
                          type="checkbox"
                          checked={pendingHidden[key] ?? field.hidden}
                          disabled={busy}
                          // Every row's visible text is the same three words, so the field's name has to be
                          // in the accessible name or the checkboxes are indistinguishable to a screen
                          // reader — and to anything else driving this by name.
                          aria-label={`Hide ${key} from the form`}
                          onChange={(e) => {
                            const value = e.target.checked;
                            setPendingHidden((p) => ({ ...p, [key]: value }));
                            void run_({ kind: "field-hidden", entity: entity.key, field: key, value }).then((applied) => {
                              if (!applied) setPendingHidden(({ [key]: _dropped, ...rest }) => rest);
                            });
                          }}
                        />
                        {/* Deliberately not "Remove": `hidden` only affects the create/edit form. A field
                            still listed in a view's `display` or a detail `section` keeps showing there,
                            and calling this "remove" would make it look half-broken. */}
                        <span>Hide from the form</span>
                      </label>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
          ))}
        </>
      ) : null}

      {error ? <p className="k-form-error">{error}</p> : null}
    </div>
  );
}
