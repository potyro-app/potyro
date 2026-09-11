// Built-in views for M1: list, gallery, table, detail. calendar/map/steps get a placeholder
// (M2/M3). Each consumes the runtime only.

import type { Resolved } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { displayFieldFor, fieldLabel, formatValue, getView, humanizeKey } from "./format.js";
import { useDisplayCells } from "./cells.js";
import { useDynamicText } from "./dynamic.js";
import { FieldValue } from "./field-value.js";

function mapOnOpen(onOpen: { page: string; param?: Record<string, string> } | undefined, row: Resolved) {
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
function useDeleteRecord(runtime: BuiltinViewProps["runtime"], entity: string): (id: string, label: string) => Promise<void> {
  return async (id, label) => {
    const ok = await runtime.ctx.ui.confirm(`Delete ${label}? This can't be undone.`);
    if (!ok) return;
    try {
      await runtime.remove(entity, id);
    } catch (e) {
      runtime.ctx.ui.toast(e instanceof Error ? e.message : "Could not delete that record");
    }
  };
}

function RowActions({
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

  return (
    <ul className="k-list">
      {rows.map((row, i) => {
        const cell = cells[i] ?? {};
        return (
          <li
            key={row.id}
            className="k-list-row"
            data-clickable={Boolean(openRow)}
            onClick={openRow ? () => openRow(row) : undefined}
          >
            {cell.mediaUrl ? <img className="k-thumb" src={cell.mediaUrl} alt="" width={48} height={48} /> : null}
            <span className="k-list-text">
              <span className="k-primary">{cell.primary ?? String(row.id)}</span>
              {cell.secondary ? <span className="k-secondary">{cell.secondary}</span> : null}
              {cell.badges?.length ? (
                <span className="k-badges">
                  {cell.badges.map((b) => (
                    <span key={b} className="k-badge">
                      {b}
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
              onEdit={onEdit}
              onDelete={() => remove(String(row.id), String(cell.primary ?? "this record"))}
              label={String(cell.primary ?? "this record")}
            />
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
    await remove(id, label);
    if (listPage) navigate(listPage.id);
  };

  return (
    <article className="k-detail">
      {(view.sections ?? []).map((section, si) => (
        <section key={si} className="k-section">
          {section.title ? <h3>{section.title}</h3> : null}
          <dl>
            {section.fields.map((f) => (
              <div className="k-field" key={f}>
                <dt>{fieldLabel(runtime, view.entity, f)}</dt>
                <dd>
                  <FieldValue runtime={runtime} entity={view.entity} fieldKey={f} value={record[f]} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <div className="k-detail-actions">
        {onEdit ? (
          <button type="button" className="k-action" onClick={() => onEdit(view.entity, id)}>
            Edit
          </button>
        ) : null}
        <button type="button" className="k-action k-action-danger" onClick={() => void onDelete()}>
          Delete
        </button>
        {(view.actions ?? []).map((a, ai) =>
            typeof a === "string" ? (
              <button key={ai} type="button" className="k-action" onClick={() => void runtime.runAction(view.entity, a, id)}>
                {/* The action KEY is an identifier, not a label — "snapPhoto" is not a button name. */}
                {humanizeKey(a)}
              </button>
            ) : (
              <button
                key={ai}
                type="button"
                className="k-action k-primary-action"
                onClick={() => navigate(a.navigate.page, mapDetailNav(a.navigate.param, record))}
              >
                {a.label}
              </button>
            ),
          )}
      </div>
    </article>
  );
}

function mapDetailNav(param: Record<string, string> | undefined, record: Resolved): Record<string, string> {
  if (!param) return {};
  const out: Record<string, string> = {};
  for (const [target, sourceKey] of Object.entries(param)) out[target] = String(record[sourceKey] ?? "");
  return out;
}

