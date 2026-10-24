// Calendar built-in view (M2, issue #17). Renders records on a month grid, positioned by a `date`
// binding, with optional `title`/`color` bindings. Like the other built-ins it consumes the runtime
// only — bindings resolve through `runtime.resolveBinding` (never called directly), so a function
// binding works identically for trusted apps and untrusted ones running in the QuickJS-WASM isolate.

import { fmt } from "@potyro/i18n";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { Resolved } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { Glyph } from "./glyph.js";

/** Sunday first, as the grid is: each day's short name in the active language (1 January 2023 was a Sunday). */
const weekdays = (): string[] => Array.from({ length: 7 }, (_, i) => fmt.date(new Date(2023, 0, 1 + i), { weekday: "short" }));
const GRID_CELLS = 42; // 6 weeks × 7 days — a stable grid height regardless of month length

export interface CalendarCell {
  date: Date;
  inMonth: boolean;
}

export interface CalendarEvent {
  id: string;
  date: Date;
  title: string;
  color?: string;
}

/** Pure 6-week (42-cell) grid covering `month`, starting on Sunday. Exported for unit testing. */
export function buildMonthGrid(month: Date): CalendarCell[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstWeekday = new Date(year, m, 1).getDay(); // 0 = Sunday
  const cells: CalendarCell[] = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    const date = new Date(year, m, 1 - firstWeekday + i);
    cells.push({ date, inMonth: date.getMonth() === m });
  }
  return cells;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Coerce a resolved binding value to a Date. Handles Date (trusted) and ISO string/number (isolate). */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Resolve date/title/color per row via the runtime (async host calls), outside of render. */
function useCalendarEvents(runtime: PotyroRuntime, pageId: string, rows: Resolved[]): CalendarEvent[] {
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    let alive = true;
    const ctx = runtime.ctx;

    void Promise.all(
      rows.map(async (row): Promise<CalendarEvent | null> => {
        const date = toDate(await runtime.resolveBinding({ kind: "view", page: pageId, path: "date" }, row, ctx));
        if (!date) return null;
        const title = String((await runtime.resolveBinding({ kind: "view", page: pageId, path: "title" }, row, ctx)) ?? "");
        const colorRaw = await runtime.resolveBinding({ kind: "view", page: pageId, path: "color" }, row, ctx);
        return { id: row.id, date, title, color: colorRaw == null ? undefined : String(colorRaw) };
      }),
    ).then((evs) => {
      if (alive) setEvents(evs.filter((e): e is CalendarEvent => e !== null));
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, pageId, rows]);

  return events;
}

export function CalendarView(props: BuiltinViewProps) {
  const { t } = useLingui();
  const { runtime, pageId, params } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const events = useCalendarEvents(runtime, pageId, rows);
  const [monthOffset, setMonthOffset] = useState(0);

  const today = runtime.ctx.now();
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const grid = useMemo(() => buildMonthGrid(month), [month.getFullYear(), month.getMonth()]);
  const monthLabel = fmt.date(month, { month: "long", year: "numeric" });

  if (loading) return <p className="k-loading">{t`Loading`}</p>;

  const anyThisMonth = events.some((e) => grid.some((c) => sameDay(c.date, e.date)));

  return (
    <section className="k-calendar" aria-label={t`Calendar — ${monthLabel}`}>
      <header className="k-cal-header">
        <button type="button" className="k-action" onClick={() => setMonthOffset((n) => n - 1)} aria-label={t`Previous month`}>
          <Glyph icon="chevron-left" size={18} />
        </button>
        <h2 className="k-cal-title">{monthLabel}</h2>
        <button type="button" className="k-action" onClick={() => setMonthOffset((n) => n + 1)} aria-label={t`Next month`}>
          <Glyph icon="chevron-right" size={18} />
        </button>
      </header>

      <div className="k-cal-weekdays">
        {weekdays().map((w) => (
          <span key={w} className="k-cal-weekday">
            {w}
          </span>
        ))}
      </div>

      <div className="k-cal-weeks" role="grid">
        {grid.map((cell, i) => {
          const dayEvents = events.filter((e) => sameDay(e.date, cell.date));
          return (
            <div
              key={i}
              className="k-cal-cell"
              role="gridcell"
              data-in-month={cell.inMonth}
              data-today={sameDay(cell.date, today)}
            >
              <span className="k-cal-daynum">{fmt.number(cell.date.getDate())}</span>
              {dayEvents.map((e) => (
                <span key={e.id} className="k-cal-event" title={e.title}>
                  {e.color ? <span className="k-cal-dot" style={{ background: e.color }} aria-hidden /> : null}
                  <span className="k-cal-event-label">{e.title}</span>
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {anyThisMonth ? null : <p className="k-empty k-cal-empty">{t`Nothing scheduled this month.`}</p>}
    </section>
  );
}
