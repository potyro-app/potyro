// Calendar built-in view (M2, issue #17). Renders records on a month grid, positioned by a `date`
// binding, with optional `title`/`color` bindings. Like the other built-ins it consumes the runtime
// only — bindings resolve through `runtime.resolveBinding` (never called directly), so a function
// binding works identically for trusted apps and untrusted ones running in the QuickJS-WASM isolate.

import { useEffect, useMemo, useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { Resolved } from "karta";
import type { BuiltinViewProps } from "./types.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
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
function useCalendarEvents(runtime: KartaRuntime, pageId: string, rows: Resolved[]): CalendarEvent[] {
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
  const { runtime, pageId, params } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const events = useCalendarEvents(runtime, pageId, rows);
  const [monthOffset, setMonthOffset] = useState(0);

  const today = runtime.ctx.now();
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const grid = useMemo(() => buildMonthGrid(month), [month.getFullYear(), month.getMonth()]);
  const monthLabel = month.toLocaleString(undefined, { month: "long", year: "numeric" });

  if (loading) return <p className="k-loading">Loading…</p>;

  const anyThisMonth = events.some((e) => grid.some((c) => sameDay(c.date, e.date)));

  return (
    <section className="k-calendar" aria-label={`Calendar — ${monthLabel}`}>
      <header className="k-cal-header">
        <button type="button" className="k-action" onClick={() => setMonthOffset((n) => n - 1)} aria-label="Previous month">
          ‹
        </button>
        <h2 className="k-cal-title">{monthLabel}</h2>
        <button type="button" className="k-action" onClick={() => setMonthOffset((n) => n + 1)} aria-label="Next month">
          ›
        </button>
      </header>

      <div className="k-cal-weekdays">
        {WEEKDAYS.map((w) => (
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
              <span className="k-cal-daynum">{cell.date.getDate()}</span>
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

      {anyThisMonth ? null : <p className="k-empty k-cal-empty">Nothing scheduled this month.</p>}
    </section>
  );
}
