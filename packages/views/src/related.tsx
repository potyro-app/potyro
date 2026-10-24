// Records that point at the one on the page (`sections: [{ related: { entity, via, view } }]`): a
// plant's care log under the plant, a recipe's cooks under the recipe, an exercise's history under
// the exercise. As a list, a timeline, or a chart of how much (or how often) per day, week or month.
//
// Declarative like every built-in, so it renders for a shared app exactly as for your own: the rows
// are a query by the relation, and a display binding that is a function is called through the host
// at its path (`sections.<i>.related.display.primary`), the way a stats tile's fold is.

import { useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
import { useEffect, useMemo, useState } from "react";
import type { Resolved } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { displayFieldFor, formatDateValue, humanizeKey } from "./format.js";
import { mapOnOpen } from "./builtins.js";
import { Lead } from "./lead.js";
import { Glyph } from "./glyph.js";
import { byPeople } from "./edit-lock.js";
import { formatDateRelative, startOfDay, toDate } from "./dates.js";

export interface RelatedSpec {
  entity: string;
  via: string;
  view?: "list" | "timeline" | "chart";
  display?: { primary?: unknown; secondary?: unknown; icon?: unknown };
  date?: string;
  value?: string;
  by?: "day" | "week" | "month";
  limit?: number;
  onOpen?: { page: string; param?: Record<string, string> };
}

/** How many records a related section shows when it names no `limit`. */
const DEFAULT_LIMIT = 20;
/** How many bars a related chart shows: the latest stretch of days, weeks or months. */
const BARS = { day: 14, week: 12, month: 12 } as const;

/** A relation's value as the id it points at — resolved one level, so often a record. */
function idOf(v: unknown): string {
  if (v && typeof v === "object") return String((v as { id?: unknown }).id ?? "");
  return v == null ? "" : String(v);
}

/** Whether a record's `via` points at `id` (a to-many relation points at it among others). */
export function pointsAt(row: Resolved, via: string, id: string): boolean {
  const v = row[via];
  return Array.isArray(v) ? v.some((x) => idOf(x) === id) : idOf(v) === id;
}

/** Start of the bucket a date falls in. */
function bucketStart(d: Date, by: "day" | "week" | "month"): Date {
  const day = startOfDay(d);
  if (by === "day") return day;
  if (by === "month") return new Date(day.getFullYear(), day.getMonth(), 1);
  const monday = new Date(day);
  monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return monday;
}

function nextBucket(d: Date, by: "day" | "week" | "month"): Date {
  const n = new Date(d);
  if (by === "day") n.setDate(n.getDate() + 1);
  else if (by === "week") n.setDate(n.getDate() + 7);
  else n.setMonth(n.getMonth() + 1);
  return n;
}

export interface RelatedBar {
  start: Date;
  value: number;
}

/** The chart's bars: the last few buckets up to now, each summing `value` (or counting). */
export function relatedBars(rows: readonly Resolved[], spec: Pick<RelatedSpec, "date" | "value" | "by">, now = new Date()): RelatedBar[] {
  const by = spec.by ?? "week";
  const count = BARS[by];
  let start = bucketStart(now, by);
  for (let i = 1; i < count; i++) {
    if (by === "day") start.setDate(start.getDate() - 1);
    else if (by === "week") start.setDate(start.getDate() - 7);
    else start = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  }
  const bars: RelatedBar[] = [];
  for (let b = start, i = 0; i < count; i++, b = nextBucket(b, by)) bars.push({ start: new Date(b), value: 0 });
  for (const row of rows) {
    const d = spec.date ? toDate(row[spec.date]) : null;
    if (!d) continue;
    const key = bucketStart(d, by).getTime();
    const bar = bars.find((x) => x.start.getTime() === key);
    if (!bar) continue;
    bar.value += spec.value ? Number(row[spec.value]) || 0 : 1;
  }
  return bars;
}

interface Cell {
  primary: string;
  secondary?: string;
  icon?: string;
}

interface RelatedProps extends Pick<BuiltinViewProps, "runtime" | "navigate" | "onEdit" | "onCreate"> {
  /** The record page's own page ref; a function binding is called at `sections.<index>.related…`. */
  pageId: string;
  index: number;
  recordId: string;
  spec: RelatedSpec;
}

export function RelatedRecords({ runtime, pageId, index, recordId, spec, navigate, onEdit, onCreate }: RelatedProps) {
  const { t } = useLingui();
  const filter = useMemo(() => (r: Resolved) => pointsAt(r, spec.via, recordId), [spec.via, recordId]);
  const { rows, loading } = runtime.useQuery(spec.entity, { filter });
  const entityDef = runtime.definition.entities[spec.entity];
  const view = spec.view ?? "list";

  const sorted = useMemo(() => {
    const dated = spec.date ? [...rows].sort((a, b) => (toDate(b[spec.date!])?.getTime() ?? 0) - (toDate(a[spec.date!])?.getTime() ?? 0)) : [...rows];
    return view === "chart" ? dated : dated.slice(0, spec.limit ?? DEFAULT_LIMIT);
  }, [rows, spec.date, spec.limit, view]);

  const cells = useRelatedCells(runtime, pageId, index, spec, sorted);

  const open = (row: Resolved): void => {
    if (spec.onOpen) return navigate(spec.onOpen.page, mapOnOpen(spec.onOpen, row));
    const page = runtime.definition.pages.find((p) => (p.view as { type?: string; entity?: string }).type === "detail" && (p.view as { entity?: string }).entity === spec.entity);
    if (page) return navigate(page.id, { [(page.view as { param?: string }).param ?? "id"]: String(row.id) });
    onEdit?.(spec.entity, String(row.id));
  };
  // Records only the app writes (`editableBy: "app"`) are not added by hand.
  const add = onCreate && byPeople(runtime, spec.entity) ? () => onCreate(spec.entity, { [spec.via]: recordId }) : undefined;

  if (loading) return <p className="k-loading">{t`Loading`}</p>;

  if (view === "chart") {
    const bars = relatedBars(rows, spec);
    const max = Math.max(1, ...bars.map((b) => b.value));
    const total = bars.reduce((s, b) => s + b.value, 0);
    const by = spec.by ?? "week";
    const label = (d: Date): string =>
      by === "month" ? fmt.date(d, { month: "short" }) : fmt.date(d, { day: "numeric", month: by === "day" ? undefined : "short" });
    return (
      <div className="k-rel-chart">
        <p className="k-rel-total">
          <span className="k-rel-total-value">{fmt.number(total)}</span>
        </p>
        <ol className="k-rel-bars" aria-label={t({ message: "By date", comment: "A small bar chart of related records over time" })}>
          {bars.map((b) => (
            <li key={b.start.getTime()} className="k-rel-bar" title={`${label(b.start)}: ${fmt.number(b.value)}`}>
              <span className="k-rel-bar-fill" style={{ transform: `scaleY(${b.value / max})` }} aria-hidden />
              <span className="k-visually-hidden">{`${label(b.start)}: ${fmt.number(b.value)}`}</span>
            </li>
          ))}
        </ol>
        <div className="k-rel-axis" aria-hidden>
          <span>{label(bars[0]!.start)}</span>
          <span>{label(bars[bars.length - 1]!.start)}</span>
        </div>
        {add ? <AddButton onAdd={add} first={rows.length === 0} /> : null}
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="k-rel-empty">
        <p className="k-muted">{t`Nothing here yet.`}</p>
        {add ? <AddButton onAdd={add} first /> : null}
      </div>
    );
  }

  return (
    <>
      <ul className={`k-list k-rel-list${view === "timeline" ? " k-rel-timeline" : ""}`} data-lead={view === "timeline" ? "none" : "monogram"}>
        {sorted.map((row, i) => {
          const cell = cells[i] ?? { primary: String(row[displayFieldFor(runtime, spec.entity)] ?? "") };
          const when = spec.date ? toDate(row[spec.date]) : null;
          return (
            <li key={row.id} className="k-list-row" data-clickable="true" onClick={() => open(row)}>
              {view === "timeline" ? (
                <span className="k-rel-when" aria-hidden={!when}>
                  {when ? formatDateRelative(when, "day") : ""}
                </span>
              ) : (
                <Lead text={cell.primary} kind={cell.icon || entityDef?.icon ? "icon" : "monogram"} icon={cell.icon ?? entityDef?.icon} />
              )}
              <span className="k-list-text">
                <span className="k-primary" data-k-value>
                  {cell.icon && view === "timeline" ? (
                    <>
                      <Glyph icon={cell.icon} size={16} />{" "}
                    </>
                  ) : null}
                  {cell.primary || humanizeKey(spec.entity)}
                </span>
                {cell.secondary ? (
                  <span className="k-secondary" data-k-value>
                    {cell.secondary}
                  </span>
                ) : null}
              </span>
              <span className="k-row-chevron" aria-hidden>
                <Glyph icon="chevron-right" size={18} />
              </span>
            </li>
          );
        })}
      </ul>
      {add ? <AddButton onAdd={add} first={false} /> : null}
    </>
  );
}

function AddButton({ onAdd, first }: { onAdd: () => void; first: boolean }) {
  const { t } = useLingui();
  return (
    <button type="button" className="k-add-row-btn k-rel-add" onClick={onAdd}>
      <span className="k-lead k-add-row-mark" aria-hidden>
        ＋
      </span>
      <span>{first ? t({ message: "Add the first one", comment: "Button on an empty page: make its first record" }) : t({ message: "Add another", comment: "Under a short list: make one more record like these" })}</span>
    </button>
  );
}

/** Each row's words: a binding that is a field key reads the record; a function runs through the host. */
function useRelatedCells(runtime: BuiltinViewProps["runtime"], pageId: string, index: number, spec: RelatedSpec, rows: Resolved[]): Cell[] {
  const [cells, setCells] = useState<Cell[]>([]);
  useEffect(() => {
    let alive = true;
    const ctx = runtime.ctx;
    const shown = (v: unknown): string => (v == null ? "" : v instanceof Date ? formatDateValue(v) : String(v));
    const read = async (key: "primary" | "secondary" | "icon", row: Resolved): Promise<string> => {
      const b = spec.display?.[key];
      if (b == null) return "";
      if (typeof b === "string" && b !== "__potyro_fn__") return shown(row[b]);
      // A function (or a sealed app's stand-in for one): called at its path, with the record.
      const v = await runtime.core.app.callFold(pageId, `sections.${index}.related.display.${key}`, row as never, ctx);
      return shown(v);
    };
    void Promise.all(
      rows.map(async (row): Promise<Cell> => {
        const primary = (await read("primary", row)) || shown(row[displayFieldFor(runtime, spec.entity)]);
        const dated = spec.date && spec.view !== "timeline" ? toDate(row[spec.date]) : null;
        const secondary = (await read("secondary", row)) || (dated ? formatDateValue(dated) : "");
        const icon = (await read("icon", row)).trim();
        return { primary, ...(secondary ? { secondary } : {}), ...(icon ? { icon } : {}) };
      }),
    ).then(
      (cs) => {
        if (alive) setCells(cs);
      },
      () => {
        // A binding that failed leaves its row with the record's own name: the list still shows.
      },
    );
    return () => {
      alive = false;
    };
  }, [runtime, pageId, index, spec, rows]);
  return cells;
}
