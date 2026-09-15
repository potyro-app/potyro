// Built-in views for M1: list, gallery, table, detail. calendar/map/steps get a placeholder
// (M2/M3). Each consumes the runtime only.

import type { ReactNode } from "react";
import type { Resolved } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { displayFieldFor, fieldLabel, formatValue, getView, humanizeKey } from "./format.js";
import { useDisplayCells } from "./cells.js";
import { useDynamicText } from "./dynamic.js";
import { FieldValue } from "./field-value.js";
import { resolveGroups, type ResolvedGroup } from "./groups.js";
import { ActionMenu, type MenuEntry } from "./menu.js";
import { enumSwatch } from "./enum.js";
import { useRowGroups, type RowGroup } from "./row-groups.js";
import { Fold, foldKey } from "./fold.js";
import { editLockFor } from "./edit-lock.js";

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
    const ok = await runtime.ctx.ui.confirm(`Delete ${label}?`, { detail: "This can't be undone.", ok: "Delete", destructive: true });
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
  locked,
}: {
  runtime: BuiltinViewProps["runtime"];
  entity: string;
  actions: string[] | undefined;
  id: string;
  onEdit?: (entity: string, id: string) => void;
  onDelete?: () => Promise<void>;
  label: string;
  /** Set when this row is someone else's to change (`editableBy: "creator"`): Edit and Delete explain instead. */
  locked?: string | null;
}) {
  const explain = (): void => runtime.ctx.ui.toast(locked!);
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
        <button type="button" className="k-action" aria-label="Edit" aria-disabled={locked ? true : undefined} onClick={() => (locked ? explain() : onEdit(entity, id))}>
          Edit
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className="k-action k-action-danger"
          aria-label={`Delete ${label}`}
          aria-disabled={locked ? true : undefined}
          onClick={() => (locked ? explain() : void onDelete())}
        >
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
    group?: unknown;
    collapsible?: boolean;
  };
  const remove = useDeleteRecord(runtime, view.entity);
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing here yet.");
  const groups = useRowGroups(runtime, pageId, rows, view);

  // Tapping a row opens its detail if the app wired one, else opens the editor — so a record is
  // always reachable to view/edit even when the generated app didn't link a detail page.
  const openRow = view.onOpen
    ? (row: Resolved) => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, row))
    : onEdit
    ? (row: Resolved) => onEdit(view.entity, String(row.id))
    : undefined;

  if (loading || !groups) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">{emptyText}</p>;

  // A row carries the app's own row actions and a chevron; Edit is the tap itself, and Delete
  // lives on the detail page (#111). Only a row with nowhere to open keeps its Delete.
  const hasDetail = Boolean(view.onOpen);
  // In a split layout (#105) the opened row's id sits in the page's params under the param its
  // `onOpen` maps from "id"; that row is the selected one.
  const selectedKey = Object.entries(view.onOpen?.param ?? {}).find(([, source]) => source === "id")?.[0];
  // Cells line up with `rows`; a grouped row is looked up by id (a tag puts one row in two groups).
  const cellIndex = new Map(rows.map((r, i) => [r.id, i]));
  const renderRows = (list: Resolved[]) => (
    <ul className="k-list">
      {list.map((row) => {
        const cell = cells[cellIndex.get(row.id) ?? -1] ?? {};
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
              locked={editLockFor(runtime, view.entity, row)}
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
  return <Grouped runtime={runtime} pageId={pageId} groups={groups} collapsible={view.collapsible === true} render={renderRows} />;
}

/**
 * The rows under their headings (#108), or just the rows when the view does not group. Rows with no
 * value for the binding come first, under no heading.
 */
function Grouped({
  runtime,
  pageId,
  groups,
  collapsible,
  render,
}: {
  runtime: BuiltinViewProps["runtime"];
  pageId: string;
  groups: RowGroup[];
  collapsible: boolean;
  render: (rows: Resolved[]) => ReactNode;
}) {
  if (groups.length === 1 && groups[0]!.key === "") return <>{render(groups[0]!.rows)}</>;
  return (
    <div className="k-groups">
      {groups.map((g) =>
        g.key === "" ? (
          <div key="" className="k-group-ungrouped">
            {render(g.rows)}
          </div>
        ) : (
          <Fold
            key={g.key}
            variant="group"
            storageKey={foldKey(runtime.definition.id, pageId, `group:${g.key}`)}
            title={g.label}
            count={g.rows.length}
            collapsible={collapsible}
          >
            {render(g.rows)}
          </Fold>
        ),
      )}
    </div>
  );
}

export function GalleryView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const cells = useDisplayCells(runtime, pageId, rows);
  const view = getView(runtime, pageId) as { entity: string; onOpen?: { page: string; param?: Record<string, string> }; group?: unknown; collapsible?: boolean };
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing here yet.");
  const groups = useRowGroups(runtime, pageId, rows, view);

  const openCard = view.onOpen
    ? (row: Resolved) => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, row))
    : onEdit
    ? (row: Resolved) => onEdit(view.entity, String(row.id))
    : undefined;

  if (loading || !groups) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">{emptyText}</p>;

  const cellIndex = new Map(rows.map((r, i) => [r.id, i]));
  const renderCards = (list: Resolved[]) => (
    <div className="k-gallery">
      {list.map((row) => {
        const cell = cells[cellIndex.get(row.id) ?? -1] ?? {};
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
  return <Grouped runtime={runtime} pageId={pageId} groups={groups} collapsible={view.collapsible === true} render={renderCards} />;
}

export function TableView(props: BuiltinViewProps) {
  const { runtime, pageId, params, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const view = getView(runtime, pageId) as { entity: string; display?: { columns: string[] }; group?: unknown; collapsible?: boolean };
  const columns = view.display?.columns ?? [];
  const groups = useRowGroups(runtime, pageId, rows, view);

  if (loading || !groups) return <p className="k-loading">Loading…</p>;
  if (!rows.length) return <p className="k-empty">No matching rows.</p>;

  const renderTable = (list: Resolved[]) => (
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
        {list.map((row) => (
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
  return <Grouped runtime={runtime} pageId={pageId} groups={groups} collapsible={view.collapsible === true} render={renderTable} />;
}

export function DetailView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate, onEdit } = props;
  const view = getView(runtime, pageId) as {
    entity: string;
    param?: string;
    sections?: { title?: string; fields: string[]; collapsible?: boolean; collapsed?: boolean }[];
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
  const locked = editLockFor(runtime, view.entity, record);
  const explain = (): void => runtime.ctx.ui.toast(locked!);
  const onDelete = async (): Promise<void> => {
    if (!(await remove(id, label))) return;
    if (listPage) navigate(listPage.id);
  };

  // The page's own `sections` override; otherwise the entity's `groups`, the same arrangement the
  // form uses (#100), so what was edited under "Nutrition" is read back under "Nutrition".
  const groups: ResolvedGroup[] = view.sections
    ? view.sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        fields: s.fields,
        collapsed: s.collapsed === true,
        collapsible: s.collapsible === true || s.collapsed === true,
      }))
    : resolveGroups(runtime.definition.entities[view.entity], "detail");
  const fieldsOf = (group: ResolvedGroup) => (
    <dl>
      {group.fields.map((f) => (
        <div className="k-field" key={f}>
          {/* A section that is one field already says its name in the heading; saying it again
              under the heading ("Ingredients / Ingredients") is noise. It stays for assistive tech. */}
          <dt className={group.fields.length === 1 && group.title === fieldLabel(runtime, view.entity, f) ? "k-visually-hidden" : undefined}>
            {fieldLabel(runtime, view.entity, f)}
          </dt>
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
          <button
            type="button"
            className="k-add k-primary-action"
            aria-disabled={locked ? true : undefined}
            onClick={() => (locked ? explain() : onEdit(view.entity, id))}
          >
            Edit
          </button>
        ) : null}
        {locked ? (
          // Edit and Delete are all this menu holds; someone else's record offers neither, so the
          // menu is inactive rather than a list of things that would each refuse.
          <button type="button" className="k-menu-btn" aria-label="More actions" aria-disabled onClick={explain}>
            ⋯
          </button>
        ) : (
        <ActionMenu
          label="More actions"
          title={label}
          entries={[
            ...((view.actions ?? []).length && onEdit ? [{ key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit(view.entity, id) } as MenuEntry] : []),
            ...(((view.actions ?? []).length && onEdit) ? ["separator" as const] : []),
            { key: "delete", label: "Delete", icon: "🗑", danger: true, onSelect: () => void onDelete() },
          ]}
        />
        )}
      </div>
      {groups.map((group, si) =>
        (group.collapsible || group.collapsed) && group.title ? (
          // A section that folds (#108): the heading is the button, the fold is remembered per page
          // on this device, and a section that is one list says how many rows it holds.
          <section key={si} className="k-section k-section-fold">
            <Fold
              variant="section"
              storageKey={foldKey(runtime.definition.id, pageId, `section:${group.title}`)}
              title={group.title}
              count={sectionCount(runtime, view.entity, group, record)}
              collapsible
              initiallyOpen={!group.collapsed}
            >
              {fieldsOf(group)}
            </Fold>
          </section>
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

/** How many rows a section holds, when the section is a single list field; otherwise no count. */
function sectionCount(runtime: BuiltinViewProps["runtime"], entity: string, group: ResolvedGroup, record: Resolved): number | undefined {
  if (group.fields.length !== 1) return undefined;
  const field = runtime.definition.entities[entity]?.fields[group.fields[0]!];
  if (field?.type !== "list") return undefined;
  const value = record[group.fields[0]!];
  return Array.isArray(value) ? value.length : 0;
}

function mapDetailNav(param: Record<string, string> | undefined, record: Resolved): Record<string, string> {
  if (!param) return {};
  const out: Record<string, string> = {};
  for (const [target, sourceKey] of Object.entries(param)) out[target] = String(record[sourceKey] ?? "");
  return out;
}

