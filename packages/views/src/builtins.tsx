// Built-in views for M1: list, gallery, table, detail. calendar/map/steps get a placeholder
// (M2/M3). Each consumes the runtime only.

import { t as tr } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { CSSProperties, ReactNode } from "react";
import { actionInfo, type Resolved } from "potyro";
import { PartProblem } from "./part-failure.js";
import type { BuiltinViewProps, DisplayCell } from "./types.js";
import { displayFieldFor, fieldLabel, formatValue, getView, humanizeKey, shownValue } from "./format.js";
import { useDisplayCells } from "./cells.js";
import { useDynamicText } from "./dynamic.js";
import { enumSwatch } from "./enum.js";
import { useRowGroups, type RowGroup } from "./row-groups.js";
import { Fold, foldKey } from "./fold.js";
import { byPeople, editLockFor } from "./edit-lock.js";
import { MoneyValue, moneyColumn, MoneyTotal } from "./money-input.js";
import { Lead, initialOf, leadSwatch, type LeadKind } from "./lead.js";
import { useReportCount } from "./page-count.js";
import { pageOf } from "./backdrop.js";

/**
 * What a view's `onOpen` says to do with a row: go to a page (the data form), or run the app's own
 * function with the record (`onOpen: (record, ctx) => …`). A sealed app's function reaches the view
 * as a stand-in string and is called through the host like every other binding, so both forms
 * work for every app. `undefined` when the view declares nothing: the view keeps its default.
 */
export function rowOpener(runtime: BuiltinViewProps["runtime"], pageId: string, onOpen: unknown, navigate: (page: string, param: Record<string, string>) => void): ((row: Resolved) => void) | undefined {
  if (!onOpen) return undefined;
  if (typeof onOpen === "object" && typeof (onOpen as { page?: unknown }).page === "string") {
    const spec = onOpen as { page: string; param?: Record<string, string> };
    return (row) => navigate(spec.page, mapOnOpen(spec, row));
  }
  return (row) => {
    void runtime.resolveBinding({ kind: "view", page: pageId, path: "onOpen" }, row, runtime.ctx).catch((e: unknown) => console.warn(`[potyro] onOpen of page ${pageId} failed:`, e));
  };
}

/** `onOpen`'s route params, for the data form only (a function has none). */
export function onOpenParam(onOpen: unknown): Record<string, string> | undefined {
  return typeof onOpen === "object" && onOpen ? (onOpen as { param?: Record<string, string> }).param : undefined;
}

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
/**
 * A page whose data could not be read says so, instead of loading forever — in the words every part
 * of an app uses when it fails (#271). ViewHost leaves these views to say it themselves.
 */
function LoadError({ message }: { message: string }) {
  const { t } = useLingui();
  return (
    <div className="k-load-error">
      <PartProblem text={t`its records could not be listed: ${message}`} />
    </div>
  );
}

export function useDeleteRecord(runtime: BuiltinViewProps["runtime"], entity: string): (id: string, label: string) => Promise<boolean> {
  // Resolves to whether the record is gone: a caller that leaves the page afterwards must not
  // leave it on "no" — declining used to send you back to the list as if you had deleted.
  return async (id, label) => {
    const ok = await runtime.ctx.ui.confirm(tr`Delete ${label}?`, { detail: tr`This can't be undone.`, ok: tr`Delete`, destructive: true });
    if (!ok) return false;
    try {
      await runtime.remove(entity, id);
      return true;
    } catch (e) {
      runtime.ctx.ui.toast(e instanceof Error ? e.message : tr`Could not delete that record`);
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
  const { t } = useLingui();
  const explain = (): void => runtime.ctx.ui.toast(locked!);
  // A feed's records (`editableBy: "app"`) are not people's to delete; the app's own actions stay.
  if (!byPeople(runtime, entity)) onDelete = undefined;
  if (!actions?.length && !onEdit && !onDelete) return null;
  return (
    <span className="k-row-actions" onClick={(e) => e.stopPropagation()}>
      {actions?.map((a) => {
        // The action KEY is an identifier, not a label — "startWorkout" is not a button name.
        const info = actionInfo(runtime.definition.entities[entity], a);
        const icon = actionIcon(runtime, entity, a);
        return (
          <button key={a} type="button" className="k-action k-row-action" onClick={() => void runtime.runAction(entity, a, id)}>
            {icon ? (
              <span className="k-row-action-icon" aria-hidden>
                {icon}
              </span>
            ) : null}
            <span className="k-row-action-label">{info?.label ?? humanizeKey(a)}</span>
          </button>
        );
      })}
      {onEdit ? (
        <button type="button" className="k-action k-icon-action" aria-label={t`Edit`} title={t`Edit`} aria-disabled={locked ? true : undefined} onClick={() => (locked ? explain() : onEdit(entity, id))}>
          <span aria-hidden>✎</span>
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className="k-action k-action-danger k-icon-action"
          aria-label={t`Delete ${label}`}
          title={t`Delete`}
          aria-disabled={locked ? true : undefined}
          onClick={() => (locked ? explain() : void onDelete())}
        >
          <span aria-hidden>🗑</span>
        </button>
      ) : null}
    </span>
  );
}

/** An action's own glyph, when its definition declares one (`ActionDef.icon`). */
function actionIcon(runtime: BuiltinViewProps["runtime"], entity: string, key: string): string | undefined {
  const def = runtime.definition.entities[entity]?.actions?.[key] as { icon?: unknown } | undefined;
  return def && typeof def === "object" && typeof def.icon === "string" ? def.icon : undefined;
}

/**
 * A page with nothing on it yet: what it is for, and the way to start — not a line of grey text at the
 * top of an empty screen. The words are the app's (`emptyText`, the page's `description`); the
 * button is the same "Add" the page's quick action offers.
 */
export function EmptyState({
  runtime,
  pageId,
  entity,
  text,
  onCreate,
}: {
  runtime: BuiltinViewProps["runtime"];
  pageId: string;
  entity: string;
  text: string;
  onCreate?: BuiltinViewProps["onCreate"];
}) {
  const { t } = useLingui();
  const def = runtime.definition.entities[entity];
  return (
    <div className="k-empty-state" data-page={pageId}>
      <span className="k-empty-mark" aria-hidden>
        {def?.icon ?? pageOf(runtime.definition, pageId)?.icon ?? runtime.definition.icon ?? "◇"}
      </span>
      <p className="k-empty k-empty-title" data-k-wording>
        {text}
      </p>
      {onCreate ? (
        // Its own words, not the floating button's "Add: …": two buttons with one name are one too many
        // to tell apart by ear.
        <button type="button" className="k-add k-primary-action k-empty-add" onClick={() => onCreate(entity, {})}>
          <span aria-hidden>＋</span> {t({ message: "Add the first one", comment: "Button on an empty page: make its first record" })}
        </button>
      ) : null}
    </div>
  );
}

/** Under a short list, the way to add the next one — in the list's own shape, where the eye already is. */
function AddRow({ onAdd, as = "li" }: { onAdd: () => void; as?: "li" | "div" }) {
  const { t } = useLingui();
  const body = (
    <button type="button" className="k-add-row-btn" onClick={onAdd}>
      <span className="k-lead k-add-row-mark" aria-hidden>
        ＋
      </span>
      <span>{t({ message: "Add another", comment: "Under a short list: make one more record like these" })}</span>
    </button>
  );
  return as === "li" ? <li className="k-add-row">{body}</li> : <div className="k-add-row k-card-add">{body}</div>;
}

/**
 * The lead a page gets when it names none: the record's initial — unless every row starts with the
 * same letter ("M5.2 · Vanuatu", "M4.8 · Ecuador"), when an initial says nothing and the entity's
 * icon, in each row's own colour, does the job; without an icon, nothing.
 */
export function autoLead(primaries: readonly string[], icon: string | undefined): LeadKind {
  if (primaries.length > 1 && new Set(primaries.map(initialOf)).size === 1) return icon ? "icon" : "none";
  return "monogram";
}

/** A card with no photo wears its record's colour. */
const leadStyle = (badges: DisplayCell["badges"], text: string): CSSProperties => leadSwatch(badges, text) as CSSProperties;

/** Below this many rows a list leaves most of a phone empty; it offers the next one in place. */
const SHORT_LIST = 4;

export function ListView(props: BuiltinViewProps) {
  const { t } = useLingui();
  const { runtime, pageId, params, navigate, onEdit, onCreate } = props;
  const { rows, loading, error } = runtime.usePageQuery(pageId, params);
  const cells = useDisplayCells(runtime, pageId, rows);
  const view = getView(runtime, pageId) as {
    entity: string;
    rowActions?: string[];
    onOpen?: { page: string; param?: Record<string, string> };
    group?: unknown;
    collapsible?: boolean;
    money?: string | false;
    display?: { lead?: LeadKind };
  };
  const remove = useDeleteRecord(runtime, view.entity);
  // Amounts down the right, and what they come to (KA-26). A list of money nobody can add up is not
  // what anyone came to a ledger for, so the total is the default rather than something to wire.
  const money = moneyColumn(runtime, view.entity, view.money);
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", t`Nothing here yet.`);
  const groups = useRowGroups(runtime, pageId, rows, view);
  useReportCount(loading || error ? undefined : rows.length);
  const entityDef = runtime.definition.entities[view.entity];

  // Tapping a row opens its detail if the app wired one, else opens the editor — so a record is
  // always reachable to view/edit even when the generated app didn't link a detail page.
  const openRow = rowOpener(runtime, pageId, view.onOpen, navigate) ?? (onEdit ? (row: Resolved) => onEdit(view.entity, String(row.id)) : undefined);

  if (error) return <LoadError message={error} />;
  if (loading || !groups) return <p className="k-loading">{t`Loading…`}</p>;
  if (!rows.length) return <EmptyState runtime={runtime} pageId={pageId} entity={view.entity} text={emptyText} onCreate={byPeople(runtime, view.entity) ? onCreate : undefined} />;

  // A row carries the app's own row actions and a chevron; Edit is the tap itself, and Delete
  // lives on the detail page (#111). Only a row with nowhere to open keeps its Delete.
  const hasDetail = Boolean(view.onOpen);
  // In a split layout (#105) the opened row's id sits in the page's params under the param its
  // `onOpen` maps from "id"; that row is the selected one.
  const selectedKey = Object.entries(onOpenParam(view.onOpen) ?? {}).find(([, source]) => source === "id")?.[0];
  // Cells line up with `rows`; a grouped row is looked up by id (a tag puts one row in two groups).
  const cellIndex = new Map(rows.map((r, i) => [r.id, i]));
  const lead = view.display?.lead ?? autoLead(rows.map((r, i) => cells[i]?.primary ?? String(r[displayFieldFor(runtime, view.entity)] ?? "")), entityDef?.icon);
  // A short, ungrouped list offers the next one in its own shape, so two rows are not two rows and a
  // screen of nothing.
  // Only on a page that IS this list: a layout's "Overdue" is a selection, not a place to add to.
  const offerAdd = onCreate && byPeople(runtime, view.entity) && !pageId.includes("#") && rows.length < SHORT_LIST && groups.length === 1 ? () => onCreate(view.entity, {}) : undefined;
  const renderRows = (list: Resolved[]) => (
    <ul className="k-list" data-lead={lead}>
      {list.map((row) => {
        const cell = cells[cellIndex.get(row.id) ?? -1] ?? {};
        const primary = cell.primary ?? String(row[displayFieldFor(runtime, view.entity)] ?? row.id);
        return (
          <li
            key={row.id}
            className="k-list-row"
            data-clickable={Boolean(openRow)}
            data-active={selectedKey !== undefined && params[selectedKey] === row.id ? "true" : undefined}
            onClick={openRow ? () => openRow(row) : undefined}
          >
            <Lead url={cell.mediaUrl} text={primary} badges={cell.badges} kind={cell.icon ? "icon" : lead} icon={cell.icon ?? entityDef?.icon} />
            <span className="k-list-text">
              <span className="k-primary" data-k-value>{primary}</span>
              {cell.secondary ? <span className="k-secondary" data-k-value>{cell.secondary}</span> : null}
              {cell.badges?.length ? (
                <span className="k-badges">
                  {cell.badges.map((b) => (
                    <span key={b.text} className="k-badge" data-tinted={b.field ? "true" : undefined} {...enumSwatch(b.field, b.text)}>
                      {b.label ?? b.text}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            {money ? <MoneyValue field={money.field} value={row[money.key]} /> : null}
            <RowActions
              runtime={runtime}
              entity={view.entity}
              actions={view.rowActions}
              id={String(row.id)}
              onDelete={hasDetail ? undefined : async () => void (await remove(String(row.id), String(primary)))}
              label={String(primary)}
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
      {offerAdd ? <AddRow onAdd={offerAdd} /> : null}
    </ul>
  );
  return (
    <div className="k-view-list">
      <Grouped runtime={runtime} pageId={pageId} groups={groups} collapsible={view.collapsible === true} render={renderRows} />
      {money ? (
        <MoneyTotal field={money.field} rows={rows} valueKey={money.key} noun={runtime.definition.entities[view.entity]?.label ?? view.entity} />
      ) : null}
    </div>
  );
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
  const { t } = useLingui();
  const { runtime, pageId, params, navigate, onEdit, onCreate } = props;
  const { rows, loading, error } = runtime.usePageQuery(pageId, params);
  const cells = useDisplayCells(runtime, pageId, rows);
  const view = getView(runtime, pageId) as {
    entity: string;
    onOpen?: { page: string; param?: Record<string, string> };
    group?: unknown;
    collapsible?: boolean;
    aspect?: "square" | "portrait" | "landscape";
    caption?: "below" | "over";
    display?: { lead?: LeadKind };
  };
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", t`Nothing here yet.`);
  const groups = useRowGroups(runtime, pageId, rows, view);
  useReportCount(loading || error ? undefined : rows.length);
  const entityDef = runtime.definition.entities[view.entity];

  const openCard = rowOpener(runtime, pageId, view.onOpen, navigate) ?? (onEdit ? (row: Resolved) => onEdit(view.entity, String(row.id)) : undefined);

  if (error) return <LoadError message={error} />;
  if (loading || !groups) return <p className="k-loading">{t`Loading…`}</p>;
  if (!rows.length) return <EmptyState runtime={runtime} pageId={pageId} entity={view.entity} text={emptyText} onCreate={byPeople(runtime, view.entity) ? onCreate : undefined} />;

  const cellIndex = new Map(rows.map((r, i) => [r.id, i]));
  const lead = view.display?.lead ?? autoLead(rows.map((r, i) => cells[i]?.primary ?? String(r[displayFieldFor(runtime, view.entity)] ?? "")), entityDef?.icon);
  // Only on a page that IS this list: a layout's "Overdue" is a selection, not a place to add to.
  const offerAdd = onCreate && byPeople(runtime, view.entity) && !pageId.includes("#") && rows.length < SHORT_LIST && groups.length === 1 ? () => onCreate(view.entity, {}) : undefined;
  const renderCards = (list: Resolved[]) => (
    <div className="k-gallery" data-aspect={view.aspect ?? "landscape"} data-caption={view.caption ?? "below"}>
      {list.map((row) => {
        const cell = cells[cellIndex.get(row.id) ?? -1] ?? {};
        const primary = cell.primary ?? String(row[displayFieldFor(runtime, view.entity)] ?? row.id);
        return (
          <button
            key={row.id}
            type="button"
            className="k-card"
            data-photo={cell.mediaUrl ? "true" : undefined}
            onClick={openCard ? () => openCard(row) : undefined}
          >
            {/* A photo fills the top of the card and the words sit under it (or on it, `caption:
                "over"`); without one the card is the record's own colour with its initial, never a
                striped placeholder that says "missing". */}
            <span className="k-card-media" style={cell.mediaUrl ? undefined : leadStyle(cell.badges, primary)}>
              {cell.mediaUrl ? (
                <img src={cell.mediaUrl} alt="" loading="lazy" decoding="async" draggable={false} />
              ) : lead === "none" && !cell.icon ? null : (
                <Lead text={primary} badges={cell.badges} kind={cell.icon ? "icon" : lead} icon={cell.icon ?? entityDef?.icon} className="k-card-glyph" />
              )}
            </span>
            <span className="k-card-caption">
              <span className="k-primary" data-k-value>{primary}</span>
              {cell.secondary ? <span className="k-secondary" data-k-value>{cell.secondary}</span> : null}
              {cell.badges?.length ? (
                <span className="k-badges">
                  {cell.badges.slice(0, 3).map((b) => (
                    <span key={b.text} className="k-badge" data-tinted={b.field ? "true" : undefined} {...enumSwatch(b.field, b.text)}>
                      {b.label ?? b.text}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
      {offerAdd ? <AddRow onAdd={offerAdd} as="div" /> : null}
    </div>
  );
  return <Grouped runtime={runtime} pageId={pageId} groups={groups} collapsible={view.collapsible === true} render={renderCards} />;
}

export function TableView(props: BuiltinViewProps) {
  const { t } = useLingui();
  const { runtime, pageId, params } = props;
  const { rows, loading, error } = runtime.usePageQuery(pageId, params);
  const view = getView(runtime, pageId) as { entity: string; display?: { columns: string[] }; group?: unknown; collapsible?: boolean };
  // A feed's records (`editableBy: "app"`) are not edited by hand.
  const onEdit = byPeople(runtime, view.entity) ? props.onEdit : undefined;
  const columns = view.display?.columns ?? [];
  const groups = useRowGroups(runtime, pageId, rows, view);
  // An enum or tags column reads as its options' words (`labels`, #302), not their stored values;
  // a computed column as its own `labels` or `format`.
  const cellValue = (key: string, v: unknown): unknown => shownValue(runtime, view.entity, key, v);
  useReportCount(loading || error ? undefined : rows.length);

  if (error) return <LoadError message={error} />;
  if (loading || !groups) return <p className="k-loading">{t`Loading…`}</p>;
  if (!rows.length) return <p className="k-empty">{t`No matching rows.`}</p>;
  // Figures line up on the right, as in every table people read for numbers; a column is numeric
  // when its values are.
  const numeric = new Set(columns.filter((c) => rows.some((r) => typeof r[c] === "number") && rows.every((r) => r[c] == null || typeof r[c] === "number")));

  const renderTable = (list: Resolved[]) => (
    // The table scrolls INSIDE this, so a table wider than the phone does not make the PAGE wider
    // than the phone. It did: the whole app slid sideways, taking the header with it and, on
    // Firefox for Android, the bottom bar — reported as "the bottom menu disappears".
    <div className="k-table-scroll">
      <table className="k-table">
        <thead>
          <tr>
            {columns.map((c) => (
              // The field's own label, or its key made readable. Printed raw, `caloriesPerServing`
              // becomes one twenty-character word that cannot wrap, which is most of what made these
              // tables too wide in the first place. `data-k-field` is how the shell's edit mode finds
              // it to rename in place; `data-k-value` marks a record's own text, which it never offers.
              <th key={c} data-k-field={`${view.entity}.${c}`} data-num={numeric.has(c) || undefined}>
                {fieldLabel(runtime, view.entity, c)}
              </th>
            ))}
            {onEdit ? <th className="k-table-tool" aria-label={t`Edit`} /> : null}
          </tr>
        </thead>
        <tbody>
          {list.map((row) => (
            <tr key={row.id} data-clickable={Boolean(onEdit)} onClick={onEdit ? () => onEdit(view.entity, String(row.id)) : undefined}>
              {columns.map((c, ci) => (
                <td key={c} data-k-value data-num={numeric.has(c) || undefined} data-lead={ci === 0 || undefined}>
                  {formatValue(cellValue(c, row[c]))}
                </td>
              ))}
              {onEdit ? (
                <td className="k-table-tool">
                  <button
                    type="button"
                    className="k-action k-icon-action"
                    aria-label={t`Edit`}
                    title={t`Edit`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(view.entity, String(row.id));
                    }}
                  >
                    <span aria-hidden>✎</span>
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return <Grouped runtime={runtime} pageId={pageId} groups={groups} collapsible={view.collapsible === true} render={renderTable} />;
}
