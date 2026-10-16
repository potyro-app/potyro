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

import { useReportCount } from "./page-count.js";
import { fmt } from "@potyro/i18n";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EnumField, Resolved, DateTimeField } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { useDisplayCells } from "./cells.js";
import { getView } from "./format.js";
import { mapOnOpen } from "./builtins.js";
import { enumSwatch } from "./enum.js";
import { useDynamicText } from "./dynamic.js";
import { daysFromToday, startOfDay, toDate } from "./dates.js";

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
// In the active language, read at call time so a switch reformats (#299).
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
const SHORT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const MONTH: Intl.DateTimeFormatOptions = { month: "long" };
const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

/** The first letter up, in any script ("today" → "Today", "dzisiaj" → "Dzisiaj"). */
const capital = (s: string): string => s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
/** Monday at midnight of `d`'s week. */
const weekOf = (d: Date): Date => new Date(startOfDay(d).getTime() - ((d.getDay() + 6) % 7) * DAY);

function range(from: Date, to: Date): string {
  return fmt.dateRange(from, to, SHORT);
}

/** Sort by date and fold into headed groups: "Today", "This week", "25 – 31 Aug", "August". */
export function groupTimeline<T>(entries: { row: T; date: Date }[], groupBy: "day" | "week" | "month" = "day", newest: "first" | "last" = "first", now = new Date()): TimelineGroup<T>[] {
  const sorted = [...entries].sort((a, b) => (newest === "first" ? b.date.getTime() - a.date.getTime() : a.date.getTime() - b.date.getTime()));
  const groups: TimelineGroup<T>[] = [];
  for (const e of sorted) {
    const d = e.date;
    let key: number;
    let heading: string;
    const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`; // i18n-ignore — a year number, not words
    if (groupBy === "week") {
      const start = weekOf(d);
      key = start.getTime();
      const back = Math.round((weekOf(now).getTime() - key) / (7 * DAY));
      heading = back === 0 ? t`This week` : back === 1 ? t`Last week` : back === -1 ? t`Next week` : `${range(start, new Date(key + 6 * DAY))}${year}`;
    } else if (groupBy === "month") {
      key = d.getFullYear() * 12 + d.getMonth();
      heading = key === now.getFullYear() * 12 + now.getMonth() ? t`This month` : fmt.date(d, year ? MONTH_YEAR : MONTH);
    } else {
      key = startOfDay(d).getTime();
      // Today, yesterday and tomorrow by their words in the active language; any other day by its date.
      const n = daysFromToday(d, now);
      heading = n >= -1 && n <= 1 ? capital(fmt.days(n)) : `${fmt.date(d, WEEKDAY)}${year}`;
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else groups.push({ key, heading, entries: [e] });
  }
  return groups;
}

/** What a card says about its date, beside the heading that already names the day, week or month. */
export function whenText(d: Date, groupBy: "day" | "week" | "month", withTime: boolean, now = new Date()): string {
  const time = withTime ? fmt.date(d, TIME) : "";
  if (groupBy === "day") return time;
  const n = daysFromToday(d, now);
  const day = n === 0 || n === -1 ? capital(fmt.days(n)) : fmt.date(d, WEEKDAY);
  return time ? `${day} ${time}` : day;
}

export function TimelineView(props: BuiltinViewProps) {
  const { t } = useLingui();
  const { runtime, pageId, params, navigate, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  useReportCount(loading ? undefined : rows.length);
  const view = getView(runtime, pageId) as unknown as TimelineDef;
  const entityDef = runtime.definition.entities[view.entity];
  const groupBy = view.groupBy ?? "day";
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", t`Nothing here yet.`);
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

  if (loading || dated === null) return <p className="k-loading">{t`Loading…`}</p>;
  if (!dated.length) return <p className="k-empty" data-k-wording>{emptyText}</p>;

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
