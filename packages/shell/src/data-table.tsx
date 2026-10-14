// The Data page's table: one kind of record, every stored value, editable through the app's own form.
//
// Columns are the fields the app declares, shown with the views' own `FieldValue`, so a money field
// reads as money and a relation by the name of what it points at. Values stored under names the app
// no longer declares are data too: they get columns of their own, shown raw and never edited.

import { useEffect, useMemo, useRef, useState } from "react";
import { FieldValue, RecordForm, displayFieldFor, fieldLabel, formatDateRelative } from "@potyro/views";
import type { Resolved } from "potyro";
import type { DataSession } from "./data-runtime.js";
import { shellDialogs } from "./dialog.js";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";

export function Count({ session, entity }: { session: DataSession; entity: string }) {
  const { rows, loading } = session.runtime.useQuery(entity);
  return <span className="k-data-count">{loading ? "" : fmt.number(rows.length)}</span>;
}

const SYSTEM = new Set(["id", "createdAt", "updatedAt", "createdBy"]);

export function Table({ session, entity, fields, opaque }: { session: DataSession; entity: string; fields: string[]; opaque: string[] }) {
  const { t } = useLingui();
  const { runtime } = session;
  const { rows, loading } = runtime.useQuery(entity);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  // Stored values the app no longer declares (a field it dropped) are data too — shown, not edited.
  const extra = useMemo(() => {
    const known = new Set([...fields, ...opaque, ...SYSTEM]);
    const found = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) if (!known.has(k)) found.add(k);
    return [...opaque, ...found];
  }, [rows, fields, opaque]);

  const title = displayFieldFor(runtime, entity);
  const shown = useMemo(() => (query.trim() ? rows.filter((r) => matches(r, query)) : rows), [rows, query]);
  const sorted = useMemo(() => [...shown].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))), [shown]);
  const [drawn, more, sentinel, scroller] = useDrawnRows(sorted.length, query);
  const shownCount = fmt.number(shown.length);
  const totalCount = fmt.number(rows.length);
  const rowName = (row: Resolved): string => String(row[title] ?? row.id);

  const remove = async (row: Resolved): Promise<void> => {
    const name = String(row[title] ?? t`this record`);
    const ok = await shellDialogs.confirm(t`Delete “${name}”?`, { detail: t`It is removed from the app too, and can’t be brought back.`, ok: t`Delete`, destructive: true });
    if (ok) await runtime.remove(entity, row.id);
  };

  return (
    <section className="k-data-table-wrap" aria-busy={loading}>
      <div className="k-data-toolbar">
        <input className="k-input k-data-search" type="search" placeholder={t`Find in these records`} aria-label={t`Find in these records`} value={query} onChange={(e) => setQuery(e.target.value)} />
        {!loading && rows.length ? (
          <span className="k-muted k-data-shown">{shown.length === rows.length
              ? plural(rows.length, { one: "# record", other: "# records" })
              : t({ message: `${shownCount} of ${totalCount}`, comment: "Data table: records matching the search, of all records" })}</span>
        ) : null}
      </div>
      {!loading && sorted.length === 0 ? (
        <p className="k-muted k-data-note">{rows.length ? t`Nothing matches.` : t`No records yet.`}</p>
      ) : (
        <div className="k-data-scroll" ref={scroller}>
          <table className="k-data-table">
            <thead>
              <tr>
                {fields.map((f) => (
                  <th key={f} scope="col">{fieldLabel(runtime, entity, f)}</th>
                ))}
                {extra.map((f) => (
                  <th key={f} scope="col" className="k-data-raw" title={t`Kept in storage; this app no longer shows it`}>{f}</th>
                ))}
                <th scope="col">
                  <Trans comment="Data table column: when the record was last changed">Changed</Trans>
                </th>
                <th scope="col"><span className="k-visually-hidden"><Trans>Actions</Trans></span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, drawn).map((row) => {
                const record = rowName(row);
                return (
                <tr key={row.id} onClick={() => setEditing(row.id)}>
                  {fields.map((f) => (
                    <td key={f}><FieldValue runtime={runtime} entity={entity} fieldKey={f} value={row[f]} /></td>
                  ))}
                  {extra.map((f) => (
                    <td key={f} className="k-data-raw">{raw(row[f])}</td>
                  ))}
                  <td className="k-muted k-data-when">{row.updatedAt ? formatDateRelative(new Date(String(row.updatedAt)), "minute") : "–"}</td>
                  <td className="k-data-actions">
                    <button type="button" className="k-add" aria-label={t`Edit ${record}`} onClick={(e) => (e.stopPropagation(), setEditing(row.id))}>
                      <Trans comment="Data table: edit this record">Edit</Trans>
                    </button>
                    <button type="button" className="k-add k-danger" aria-label={t`Delete ${record}`} onClick={(e) => (e.stopPropagation(), void remove(row))}>
                      <Trans comment="Data table: delete this record">Delete</Trans>
                    </button>
                  </td>
                </tr>
                );
              })}
              {drawn < sorted.length ? (
                <tr className="k-data-more" ref={sentinel}>
                  <td colSpan={fields.length + extra.length + 2}>
                    <button type="button" className="k-add" onClick={more}>
                      {plural(sorted.length - drawn, { one: "Show more (# left)", other: "Show more (# left)" })}
                    </button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <RecordForm runtime={runtime} entity={entity} recordId={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} /> : null}
    </section>
  );
}

function matches(row: Resolved, query: string): boolean {
  const q = query.trim().toLowerCase();
  return Object.values(row).some((v) => raw(v).toLowerCase().includes(q));
}

/** A value as plain text — for fields the panel can't type, and for search. */
function raw(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const named = (value as { name?: unknown; title?: unknown }).name ?? (value as { title?: unknown }).title;
    if (typeof named === "string") return named;
    return JSON.stringify(value);
  }
  return String(value);
}

/** Rows drawn at first, and added each time the end of the table comes into view. */
const ROWS_PER_STEP = 100;

/**
 * How many of the rows to draw.
 *
 * Every row is a dozen elements and a `FieldValue` per cell: 5,000 of them took six and a half
 * seconds to put on screen, for a table whose first twenty rows are all anyone sees. So the table
 * draws a step's worth and adds the next when the last row scrolls into view. Search and sorting
 * still see every row — only drawing waits. The button is there for keyboards and for anyone
 * who would rather ask.
 */
function useDrawnRows(total: number, resetOn: unknown) {
  const [drawn, setDrawn] = useState(ROWS_PER_STEP);
  const scroller = useRef<HTMLDivElement | null>(null);
  const sentinel = useRef<HTMLTableRowElement | null>(null);
  const more = (): void => setDrawn((n) => Math.min(total, n + ROWS_PER_STEP));

  // A new search starts from the top again.
  useEffect(() => setDrawn(ROWS_PER_STEP), [resetOn]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver !== "function") return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), {
      root: scroller.current,
      rootMargin: "400px 0px",
    });
    seen.observe(target);
    return () => seen.disconnect();
    // Re-armed after each step, so a sentinel still in view after drawing asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn, total]);

  return [drawn, more, sentinel, scroller] as const;
}
