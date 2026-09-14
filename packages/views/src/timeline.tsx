// The timeline (#110): records whose meaning is WHEN — a journal, a workout history, a care log —
// on a rail by date, under sticky day, week or month headings.
//
// A calendar is a month grid, right for planning and wrong for reading history; a list sorted by
// date loses the day and week structure. The card is a list row's content (the same `display`
// bindings) framed on a rail, and the dot wears an enum option's colour.
//
// It loads a few groups at a time: a year of entries sorts and groups at once (cheap), but only
// the groups near the screen are rendered and have their display bindings resolved (the part that
// crosses the isolate bridge per row).

import { useEffect, useMemo, useRef, useState } from "react";
import type { EnumField, Resolved, DateTimeField } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { useDisplayCells } from "./cells.js";
import { getView } from "./format.js";
import { mapOnOpen } from "./builtins.js";
import { enumSwatch } from "./enum.js";
import { useDynamicText } from "./dynamic.js";
import { daysFromToday, relativeDay, startOfDay, toDate } from "./dates.js";

interface TimelineDef {
  entity: string;
  date: unknown;
  color?: string;
  groupBy?: "day" | "week" | "month";
  newest?: "first" | "last";
  onOpen?: { page: string; param?: Record<string, string> };
}

export interface TimelineGroup<T> {
  key: number;
  heading: string;
  entries: { row: T; date: Date }[];
}

/** How many rows the first render holds, and how many more each scroll near the end adds. */
export const PAGE_ROWS = 40;

const DAY = 86_400_000;
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const SHORT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long" });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** Monday at midnight of `d`'s week. */
const weekOf = (d: Date): Date => new Date(startOfDay(d).getTime() - ((d.getDay() + 6) % 7) * DAY);

function range(from: Date, to: Date): string {
  const f = SHORT as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
  return f.formatRange ? f.formatRange(from, to) : `${SHORT.format(from)} – ${SHORT.format(to)}`;
}

/** Sort by date and fold into headed groups: "Today", "This week", "25 – 31 Aug", "August". */
export function groupTimeline<T>(entries: { row: T; date: Date }[], groupBy: "day" | "week" | "month" = "day", newest: "first" | "last" = "first", now = new Date()): TimelineGroup<T>[] {
  const sorted = [...entries].sort((a, b) => (newest === "first" ? b.date.getTime() - a.date.getTime() : a.date.getTime() - b.date.getTime()));
  const groups: TimelineGroup<T>[] = [];
  for (const e of sorted) {
    const d = e.date;
    let key: number;
    let heading: string;
    const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
    if (groupBy === "week") {
      const start = weekOf(d);
      key = start.getTime();
      const back = Math.round((weekOf(now).getTime() - key) / (7 * DAY));
      heading = back === 0 ? "This week" : back === 1 ? "Last week" : back === -1 ? "Next week" : `${range(start, new Date(key + 6 * DAY))}${year}`;
    } else if (groupBy === "month") {
      key = d.getFullYear() * 12 + d.getMonth();
      heading = key === now.getFullYear() * 12 + now.getMonth() ? "This month" : year ? MONTH_YEAR.format(d) : MONTH.format(d);
    } else {
      key = startOfDay(d).getTime();
      const rel = relativeDay(d, now);
      heading = rel === "today" || rel === "yesterday" || rel === "tomorrow" ? capital(rel) : `${WEEKDAY.format(d)}${year}`;
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else groups.push({ key, heading, entries: [e] });
  }
  return groups;
}

/** What a card says about its date, beside the heading that already names the day, week or month. */
export function whenText(d: Date, groupBy: "day" | "week" | "month", withTime: boolean, now = new Date()): string {
  const time = withTime ? TIME.format(d) : "";
  if (groupBy === "day") return time;
  const n = daysFromToday(d, now);
  const day = n === 0 ? "Today" : n === -1 ? "Yesterday" : WEEKDAY.format(d);
  return time ? `${day} ${time}` : day;
}

export function TimelineView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const view = getView(runtime, pageId) as unknown as TimelineDef;
  const entityDef = runtime.definition.entities[view.entity];
  const groupBy = view.groupBy ?? "day";
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing here yet.");
  const colorField = view.color ? (entityDef?.fields[view.color] as EnumField | undefined) : undefined;
  const dateField = typeof view.date === "string" ? (entityDef?.fields[view.date] as DateTimeField | undefined) : undefined;
  const withTime = dateField?.precision === "minute";

  // A date field is read straight off the row; only a date FUNCTION costs a host call per row.
  const [dated, setDated] = useState<{ row: Resolved; date: Date }[] | null>(null);
  useEffect(() => {
    if (loading) return;
    let alive = true;
    const read = async (row: Resolved): Promise<Date | null> =>
      typeof view.date === "string" ? toDate(row[view.date]) : toDate(await runtime.resolveBinding({ kind: "view", page: pageId, path: "date" }, row, runtime.ctx));
    void Promise.all(rows.map(async (row) => ({ row, date: await read(row) }))).then((all) => {
      if (alive) setDated(all.filter((e): e is { row: Resolved; date: Date } => e.date !== null));
    });
    return () => {
      alive = false;
    };
  }, [runtime, pageId, rows, loading, view.date]);

  const groups = useMemo(() => (dated ? groupTimeline(dated, groupBy, view.newest) : []), [dated, groupBy, view.newest]);

  // Whole groups up to at least `limit` rows are rendered; a sentinel near the end asks for more.
  const [limit, setLimit] = useState(PAGE_ROWS);
  const { shown, shownRows } = useMemo(() => {
    const out: TimelineGroup<Resolved>[] = [];
    let count = 0;
    for (const g of groups) {
      if (count >= limit) break;
      out.push(g);
      count += g.entries.length;
    }
    return { shown: out, shownRows: out.flatMap((g) => g.entries.map((e) => e.row)) };
  }, [groups, limit]);
  const more = shownRows.length < (dated?.length ?? 0);
  const cells = useDisplayCells(runtime, pageId, shownRows);
  const cellIndex = useMemo(() => new Map(shownRows.map((r, i) => [r.id, i])), [shownRows]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    if (typeof IntersectionObserver === "undefined") {
      setLimit(Number.POSITIVE_INFINITY);
      return;
    }
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) setLimit((l) => l + PAGE_ROWS);
    }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown.length]);

  const openRow = view.onOpen
    ? (row: Resolved) => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, row))
    : onEdit
      ? (row: Resolved) => onEdit(view.entity, String(row.id))
      : undefined;

  if (loading || dated === null) return <p className="k-loading">Loading…</p>;
  if (!dated.length) return <p className="k-empty">{emptyText}</p>;

  return (
    <div className="k-tl">
      {shown.map((g) => (
        <section key={g.key} className="k-tl-group" aria-label={`${g.heading}, ${g.entries.length}`}>
          <h3 className="k-tl-head">{g.heading}</h3>
          <ol className="k-tl-items">
            {g.entries.map(({ row, date }) => {
              const cell = cells[cellIndex.get(row.id) ?? -1] ?? {};
              const tone = colorField && typeof row[view.color!] === "string" ? enumSwatch(colorField, row[view.color!] as string) : {};
              const when = whenText(date, groupBy, withTime);
              const body = (
                <>
                  {cell.mediaUrl ? <img className="k-tl-thumb" src={cell.mediaUrl} alt="" width={44} height={44} /> : null}
                  <span className="k-tl-text">
                    <span className="k-primary">{cell.primary ?? " "}</span>
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
                  {when ? (
                    <time className="k-tl-when" dateTime={date.toISOString()}>
                      {when}
                    </time>
                  ) : null}
                </>
              );
              return (
                <li key={row.id} className="k-tl-item" data-grey={(colorField && !tone.style) || undefined} {...tone}>
                  <span className="k-tl-dot" aria-hidden />
                  {openRow ? (
                    <button type="button" className="k-tl-card" onClick={() => openRow(row)}>
                      {body}
                    </button>
                  ) : (
                    <div className="k-tl-card">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {more ? <div ref={sentinel} className="k-tl-more" aria-hidden /> : null}
    </div>
  );
}
