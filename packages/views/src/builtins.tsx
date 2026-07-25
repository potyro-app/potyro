// Built-in views for M1: list, gallery, table, detail. calendar/map/steps get a placeholder
// (M2/M3). Each consumes the runtime only.

import type { Resolved } from "karta";
import { useEffect, useState } from "react";
import type { BuiltinViewProps } from "./types.js";
import { fieldLabel, formatValue, getView } from "./format.js";
import { useDisplayCells } from "./cells.js";
import { FieldValue } from "./field-value.js";

function mapOnOpen(onOpen: { page: string; param?: Record<string, string> } | undefined, row: Resolved) {
  if (!onOpen?.param) return {};
  const out: Record<string, string> = {};
  for (const [target, sourceKey] of Object.entries(onOpen.param)) out[target] = String(row[sourceKey] ?? "");
  return out;
}

function RowActions({
  runtime,
  entity,
  actions,
  id,
}: {
  runtime: BuiltinViewProps["runtime"];
  entity: string;
  actions: string[] | undefined;
  id: string;
}) {
  if (!actions?.length) return null;
  return (
    <span className="k-row-actions">
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          className="k-action"
          onClick={(e) => {
            e.stopPropagation();
            void runtime.runAction(entity, a, id);
          }}
        >
          {a}
        </button>
      ))}
    </span>
  );
}

export function ListView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const cells = useDisplayCells(runtime, pageId, rows);
  const view = getView(runtime, pageId) as {
    entity: string;
    rowActions?: string[];
    onOpen?: { page: string; param?: Record<string, string> };
    emptyText?: string;
  };

  if (loading) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">{view.emptyText ?? "Nothing here yet."}</p>;

  return (
    <ul className="k-list">
      {rows.map((row, i) => {
        const cell = cells[i] ?? {};
        return (
          <li
            key={row.id}
            className="k-list-row"
            data-clickable={Boolean(view.onOpen)}
            onClick={view.onOpen ? () => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, row)) : undefined}
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
            <RowActions runtime={runtime} entity={view.entity} actions={view.rowActions} id={row.id} />
          </li>
        );
      })}
    </ul>
  );
}

export function GalleryView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const cells = useDisplayCells(runtime, pageId, rows);
  const view = getView(runtime, pageId) as { onOpen?: { page: string; param?: Record<string, string> }; emptyText?: string };

  if (loading) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">{view.emptyText ?? "Nothing here yet."}</p>;

  return (
    <div className="k-gallery">
      {rows.map((row, i) => {
        const cell = cells[i] ?? {};
        return (
          <button
            key={row.id}
            type="button"
            className="k-card"
            onClick={view.onOpen ? () => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, row)) : undefined}
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
  const { runtime, pageId, params } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const view = getView(runtime, pageId) as { display?: { columns: string[] } };
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
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {columns.map((c) => (
              <td key={c}>{formatValue(row[c])}</td>
            ))}
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

  if (loading) return <p className="k-loading">Loading…</p>;
  if (!record) return <p className="k-empty">Not found.</p>;

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
        {(view.actions ?? []).map((a, ai) =>
            typeof a === "string" ? (
              <button key={ai} type="button" className="k-action" onClick={() => void runtime.runAction(view.entity, a, id)}>
                {a}
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

/** map / steps land in M3 — a clear placeholder keeps navigation working (calendar shipped in M2). */
export function PlaceholderView(props: BuiltinViewProps) {
  const view = getView(props.runtime, props.pageId);
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), []);
  return (
    <div className="k-placeholder-view">
      <p>
        The <strong>{view.type}</strong> view arrives in a later milestone.
      </p>
    </div>
  );
}
