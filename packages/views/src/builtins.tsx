// Built-in views for M1: list, gallery, table, detail. calendar/map/steps get a placeholder
// (M2/M3). Each consumes the runtime only.

import type { Resolved } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { displayFieldFor, fieldLabel, formatValue, getView, humanizeKey } from "./format.js";
import { useDisplayCells } from "./cells.js";
import { useDynamicText } from "./dynamic.js";
import { FieldValue } from "./field-value.js";
import { resolveGroups, type ResolvedGroup } from "./groups.js";
import { ActionMenu, type MenuEntry } from "./menu.js";
import { enumSwatch } from "./enum.js";

export function mapOnOpen(onOpen: { page: string; param?: Record<string, string> } | undefined, row: Resolved) {
  if (!onOpen?.param) return {};
  const out: Record<string, string> = {};
  for (const [target, sourceKey] of Object.entries(onOpen.param)) out[target] = String(row[sourceKey] ?? "");
  return out;
}

/**
 * Delete a record, after asking.
 *
 * `runtime.remove()` has been in the Runtime API from the start, but no view ever called it — so
 * every app could create records and had no way to get rid of one. Deletion is irreversible here
 * (there is no undo yet), which is exactly why it asks first, through the host's own `ctx.ui.confirm`
 * rather than `window.confirm`.
 */
export function useDeleteRecord(runtime: BuiltinViewProps["runtime"], entity: string): (id: string, label: string) => Promise<boolean> {
  // Resolves to whether the record is gone: a caller that leaves the page afterwards must not
  // leave it on "no" — declining used to send you back to the list as if you had deleted.
  return async (id, label) => {
    const ok = await runtime.ctx.ui.confirm(`Delete ${label}? This can't be undone.`);
    if (!ok) return false;
    try {
      await runtime.remove(entity, id);
      return true;
    } catch (e) {
      runtime.ctx.ui.toast(e instanceof Error ? e.message : "Could not delete that record");
      return false;
    }
  };
}

export function RowActions({
  runtime,
  entity,
  actions,
  id,
  onEdit,
  onDelete,
  label,
}: {
  runtime: BuiltinViewProps["runtime"];
  entity: string;
  actions: string[] | undefined;
  id: string;
  onEdit?: (entity: string, id: string) => void;
  onDelete?: () => Promise<void>;
  label: string;
}) {
  if (!actions?.length && !onEdit && !onDelete) return null;
  return (
    <span className="k-row-actions" onClick={(e) => e.stopPropagation()}>
      {actions?.map((a) => (
        <button
          key={a}
          type="button"
          className="k-action"
          onClick={() => void runtime.runAction(entity, a, id)}
        >
          {/* The action KEY is an identifier, not a label — "startWorkout" is not a button name. */}
          {humanizeKey(a)}
        </button>
      ))}
      {onEdit ? (
        <button type="button" className="k-action" aria-label="Edit" onClick={() => onEdit(entity, id)}>
          Edit
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" className="k-action k-action-danger" aria-label={`Delete ${label}`} onClick={() => void onDelete()}>
          Delete
        </button>
      ) : null}
    </span>
  );
}

export function ListView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const cells = useDisplayCells(runtime, pageId, rows);
  const view = getView(runtime, pageId) as {
    entity: string;
    rowActions?: string[];
    onOpen?: { page: string; param?: Record<string, string> };
  };
  const remove = useDeleteRecord(runtime, view.entity);
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing here yet.");

  // Tapping a row opens its detail if the app wired one, else opens the editor — so a record is
  // always reachable to view/edit even when the generated app didn't link a detail page.
  const openRow = view.onOpen
    ? (row: Resolved) => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, row))
    : onEdit
    ? (row: Resolved) => onEdit(view.entity, String(row.id))
    : undefined;

  if (loading) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">{emptyText}</p>;

  // A row carries the app's own row actions and a chevron; Edit is the tap itself, and Delete
  // lives on the detail page (#111). Only a row with nowhere to open keeps its Delete.
  const hasDetail = Boolean(view.onOpen);
  // In a split layout (#105) the opened row's id sits in the page's params under the param its
  // `onOpen` maps from "id"; that row is the selected one.
  const selectedKey = Object.entries(view.onOpen?.param ?? {}).find(([, source]) => source === "id")?.[0];
  return (
    <ul className="k-list">
      {rows.map((row, i) => {
        const cell = cells[i] ?? {};
        return (
          <li
            key={row.id}
            className="k-list-row"
            data-clickable={Boolean(openRow)}
            data-active={selectedKey !== undefined && params[selectedKey] === row.id ? "true" : undefined}
            onClick={openRow ? () => openRow(row) : undefined}
          >
            {cell.mediaUrl ? <img className="k-thumb" src={cell.mediaUrl} alt="" width={48} height={48} /> : null}
            <span className="k-list-text">
              <span className="k-primary">{cell.primary ?? String(row.id)}</span>
              {cell.secondary ? <span className="k-secondary">{cell.secondary}</span> : null}
              {cell.badges?.length ? (
                <span className="k-badges">
                  {cell.badges.map((b) => (
                    <span key={b.text} className="k-badge" data-tinted={b.field ? "true" : undefined} {...enumSwatch(b.field, b.text)}>
                      {b.text}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <RowActions
              runtime={runtime}
              entity={view.entity}
              actions={view.rowActions}
              id={String(row.id)}
              onDelete={hasDetail ? undefined : async () => void (await remove(String(row.id), String(cell.primary ?? "this record")))}
              label={String(cell.primary ?? "this record")}
            />
            {openRow ? (
              <span className="k-row-chevron" aria-hidden>
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function GalleryView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const cells = useDisplayCells(runtime, pageId, rows);
  const view = getView(runtime, pageId) as { entity: string; onOpen?: { page: string; param?: Record<string, string> } };
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing here yet.");

  const openCard = view.onOpen
    ? (row: Resolved) => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, row))
    : onEdit
    ? (row: Resolved) => onEdit(view.entity, String(row.id))
    : undefined;

  if (loading) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">{emptyText}</p>;

  return (
    <div className="k-gallery">
      {rows.map((row, i) => {
        const cell = cells[i] ?? {};
        return (
          <button
            key={row.id}
            type="button"
            className="k-card"
            onClick={openCard ? () => openCard(row) : undefined}
          >
            {cell.mediaUrl ? <img className="k-card-media" src={cell.mediaUrl} alt="" /> : <div className="k-card-media k-placeholder" />}
            <span className="k-primary">{cell.primary ?? String(row.id)}</span>
            {cell.secondary ? <span className="k-secondary">{cell.secondary}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TableView(props: BuiltinViewProps) {
  const { runtime, pageId, params, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const view = getView(runtime, pageId) as { entity: string; display?: { columns: string[] } };
  const columns = view.display?.columns ?? [];

  if (loading) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">No matching rows.</p>;

  return (
    <table className="k-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
          {onEdit ? <th aria-label="Edit" /> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-clickable={Boolean(onEdit)} onClick={onEdit ? () => onEdit(view.entity, String(row.id)) : undefined}>
            {columns.map((c) => (
              <td key={c}>{formatValue(row[c])}</td>
            ))}
            {onEdit ? (
              <td>
                <button type="button" className="k-action" onClick={(e) => { e.stopPropagation(); onEdit(view.entity, String(row.id)); }}>Edit</button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DetailView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate, onEdit } = props;
  const view = getView(runtime, pageId) as {
    entity: string;
    param?: string;
    sections?: { title?: string; fields: string[] }[];
    actions?: (string | { label: string; navigate: { page: string; param?: Record<string, string> } })[];
  };
  const id = String((view.param && params[view.param]) ?? "");
  const { record, loading } = runtime.useRecord(view.entity, id);
  const remove = useDeleteRecord(runtime, view.entity);

  // Deleting the record you are looking at leaves this page with nothing to show, so go back to a
  // page that lists this entity (falling back to the first page rather than stranding you on "Not
  // found.").
  const listPage =
    runtime.definition.pages.find(
      (p) =>
        (p.view as { type?: string }).type !== "detail" &&
        (p.view as { entity?: string }).entity === view.entity,
    ) ?? runtime.definition.pages[0];

  if (loading) return <p className="k-loading">Loading…</p>;
  if (!record) return <p className="k-empty">Not found.</p>;

  const label = String(record[displayFieldFor(runtime, view.entity)] ?? "this record");
  const onDelete = async (): Promise<void> => {
    if (!(await remove(id, label))) return;
    if (listPage) navigate(listPage.id);
  };

  // The page's own `sections` override; otherwise the entity's `groups`, the same arrangement the
  // form uses (#100), so what was edited under "Nutrition" is read back under "Nutrition".
  const groups: ResolvedGroup[] = view.sections
    ? view.sections.map((s) => ({ ...(s.title ? { title: s.title } : {}), fields: s.fields, collapsed: false }))
    : resolveGroups(runtime.definition.entities[view.entity], "detail");
  const fieldsOf = (group: ResolvedGroup) => (
    <dl>
      {group.fields.map((f) => (
        <div className="k-field" key={f}>
          <dt>{fieldLabel(runtime, view.entity, f)}</dt>
          <dd>
            <FieldValue runtime={runtime} entity={view.entity} fieldKey={f} value={record[f]} />
          </dd>
        </div>
      ))}
    </dl>
  );

  return (
    <article className="k-detail">
      <h2 className="k-detail-title">{label}</h2>
      {/* The app's first action is the one filled button; its other actions sit beside it, plain.
          Edit and Delete are behind "More actions", Delete last and styled as the one thing you
          might regret — never inline next to the thing you came to do (#111). */}
      <div className="k-detail-actions">
        {(view.actions ?? []).map((a, ai) =>
            typeof a === "string" ? (
              <button key={ai} type="button" className={`k-add${ai === 0 ? " k-primary-action" : ""}`} onClick={() => void runtime.runAction(view.entity, a, id)}>
                {/* The action KEY is an identifier, not a label — "snapPhoto" is not a button name. */}
                {humanizeKey(a)}
              </button>
            ) : (
              <button
                key={ai}
                type="button"
                className={`k-add${ai === 0 ? " k-primary-action" : ""}`}
                onClick={() => navigate(a.navigate.page, mapDetailNav(a.navigate.param, record))}
              >
                {a.label}
              </button>
            ),
          )}
        {/* No app action at all: Edit is the one thing to do here, so it is the filled button. */}
        {!(view.actions ?? []).length && onEdit ? (
          <button type="button" className="k-add k-primary-action" onClick={() => onEdit(view.entity, id)}>
            Edit
          </button>
        ) : null}
        <ActionMenu
          label="More actions"
          title={label}
          entries={[
            ...((view.actions ?? []).length && onEdit ? [{ key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit(view.entity, id) } as MenuEntry] : []),
            ...(((view.actions ?? []).length && onEdit) ? ["separator" as const] : []),
            { key: "delete", label: "Delete", icon: "🗑", danger: true, onSelect: () => void onDelete() },
          ]}
        />
      </div>
      {groups.map((group, si) =>
        group.collapsed ? (
          <details key={si} className="k-section">
            <summary className="k-section-title">
              <h3>{group.title}</h3>
            </summary>
            {fieldsOf(group)}
          </details>
        ) : (
          <section key={si} className="k-section">
            {group.title ? <h3>{group.title}</h3> : null}
            {fieldsOf(group)}
          </section>
        ),
      )}
    </article>
  );
}

function mapDetailNav(param: Record<string, string> | undefined, record: Resolved): Record<string, string> {
  if (!param) return {};
  const out: Record<string, string> = {};
  for (const [target, sourceKey] of Object.entries(param)) out[target] = String(record[sourceKey] ?? "");
  return out;
}

