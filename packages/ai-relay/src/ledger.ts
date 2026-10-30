// What the relay has to remember across a restart: the month's spend, each device's use of its
// allowance, and the demand counts (docs/16 "AI for apps").
//
// One calendar month (UTC) at a time. A new month starts the spend and every device afresh; the demand
// counts are kept per month and survive the roll, because they are what the counts route reports.
// The service's spend today (UTC) is kept beside it, for the daily cap (budget.ts).
//
// It never moves backwards. A request that went out in one month and settles in the next is
// written for the month it went out in, which has ended: that write is DROPPED (and counted,
// `stale()`), and a read for an ended month is 0. Rolling back to it would wipe the month that has
// begun. The same holds for the day.
// A device id is random (shell `deviceId()`) and says nothing about the person. Nothing here is an
// address, a key or a request's content.

/** The calendar month (UTC) a moment falls in, as "2026-10". */
export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
/** The calendar day (UTC) a moment falls in, as "2026-10-30". */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** What people can be counted doing. Counts only: no id, no address, no time finer than the month. */
export const COUNT_EVENTS = ["exhausted", "own-key", "want-plan", "visit"] as const;
export type CountEvent = (typeof COUNT_EVENTS)[number];
export type MonthCounts = Partial<Record<CountEvent, number>>;

/** The month's spend and counts. Kept in memory by default; server.ts keeps it in a file. */
export interface Ledger {
  /** US dollars the whole service spent this month, on every route. */
  spent(month: string): number;
  addSpend(month: string, usd: number): void;
  /** Requests a device made on `/complete` this month. */
  count(month: string, device: string): number;
  addCount(month: string, device: string): void;
  /** US dollars a device spent this month on the chat route. */
  deviceSpent(month: string, device: string): number;
  /** Adds to the device's spend and to the service's, in one write. */
  debit(month: string, device: string, usd: number): void;
  /**
   * Notes that a device has used up its allowance this month. The first time it does, `exhausted`
   * is counted for the month and this answers true; after that, false.
   */
  markExhausted(month: string, device: string): boolean;
  addEvent(month: string, event: CountEvent): void;
  /** Every month's counts, oldest first. A copy. */
  events(): Record<string, MonthCounts>;
  /** US dollars the whole service spent on `day` ("2026-10-30"), every route. */
  daySpent(day: string): number;
  addDaySpend(day: string, usd: number): void;
  /** Writes dropped because their month or day had already ended (a request that settled late). */
  stale(): number;
}

export interface LedgerOptions {
  /** Told each time a write is dropped as stale, with how many have been so far. Never what it was. */
  onStale?: (total: number) => void;
}

/**
 * The ledger's whole state. `month`, `spent` and `devices` are the original shape (before the chat
 * route); the rest is optional so a file written by an older relay still loads.
 */
export interface LedgerState {
  month: string;
  spent: number;
  /** `/complete` requests per device this month. */
  devices: Record<string, number>;
  /** Chat spend per device this month, in US dollars. */
  deviceUsd?: Record<string, number>;
  /** Devices that used up an allowance this month. */
  exhausted?: Record<string, true>;
  /** Demand counts per month ("2026-10"). */
  events?: Record<string, MonthCounts>;
  /** The day `daySpent` is for ("2026-10-30"). */
  day?: string;
  /** The service's spend that day, in US dollars. */
  daySpent?: number;
}

interface FullState {
  month: string;
  spent: number;
  devices: Record<string, number>;
  deviceUsd: Record<string, number>;
  exhausted: Record<string, true>;
  events: Record<string, MonthCounts>;
  day: string;
  daySpent: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function numbers(o: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(o)) if (finite(n)) out[k] = n;
  return out;
}

/**
 * A saved state, if it is one. A damaged file is not a reason to start the month at zero silently —
 * the server refuses to start. A field an older relay did not write is simply empty.
 */
export function readState(s: unknown): FullState | null {
  if (s == null) return null;
  const notLedger = (): never => {
    throw new Error("the ledger file is not a ledger");
  };
  if (!isRecord(s)) return notLedger();
  const { month, spent, devices, deviceUsd, exhausted, events, day, daySpent } = s;
  if (typeof month !== "string" || !finite(spent) || !isRecord(devices)) return notLedger();
  if (day !== undefined && typeof day !== "string") return notLedger();
  if (daySpent !== undefined && !finite(daySpent)) return notLedger();
  if (deviceUsd !== undefined && !isRecord(deviceUsd)) return notLedger();
  if (exhausted !== undefined && !isRecord(exhausted)) return notLedger();
  if (events !== undefined && !isRecord(events)) return notLedger();
  const months: Record<string, MonthCounts> = {};
  for (const [m, counts] of Object.entries(events ?? {})) {
    if (!isRecord(counts)) return notLedger();
    const kept: MonthCounts = {};
    for (const e of COUNT_EVENTS) if (finite(counts[e])) kept[e] = counts[e] as number;
    months[m] = kept;
  }
  const done: Record<string, true> = {};
  for (const [d, v] of Object.entries(exhausted ?? {})) if (v === true) done[d] = true;
  return {
    month,
    spent,
    devices: numbers(devices),
    deviceUsd: numbers(deviceUsd ?? {}),
    exhausted: done,
    events: months,
    day: day ?? "",
    daySpent: daySpent ?? 0,
  };
}

export function memoryLedger(initial?: LedgerState | null, opts: LedgerOptions = {}): Ledger & { snapshot(): LedgerState } {
  let state: FullState = readState(initial) ?? { month: "", spent: 0, devices: {}, deviceUsd: {}, exhausted: {}, events: {}, day: "", daySpent: 0 };
  let stale = 0;
  /** A month before the one the ledger is in: ended. ("2026-09" < "2026-10" as strings.) */
  const ended = (month: string): boolean => state.month !== "" && month < state.month;
  const drop = (): void => {
    stale += 1;
    opts.onStale?.(stale);
  };
  // A new month: spend and devices start again, the counts and the day carry on. Never an ended one.
  const at = (month: string): FullState =>
    state.month === month ? state : (state = { ...state, month, spent: 0, devices: {}, deviceUsd: {}, exhausted: {} });
  const bump = (month: string, event: CountEvent): void => {
    const counts = (state.events[month] ??= {});
    counts[event] = (counts[event] ?? 0) + 1;
  };
  return {
    spent: (m) => (ended(m) ? 0 : at(m).spent),
    addSpend: (m, usd) => (ended(m) ? drop() : void (at(m).spent += usd)),
    count: (m, d) => (ended(m) ? 0 : (at(m).devices[d] ?? 0)),
    addCount: (m, d) => (ended(m) ? drop() : void (at(m).devices[d] = (at(m).devices[d] ?? 0) + 1)),
    deviceSpent: (m, d) => (ended(m) ? 0 : (at(m).deviceUsd[d] ?? 0)),
    debit: (m, d, usd) => {
      if (ended(m)) return drop();
      const s = at(m);
      s.spent += usd;
      s.deviceUsd[d] = (s.deviceUsd[d] ?? 0) + usd;
    },
    markExhausted: (m, d) => {
      if (ended(m)) return false;
      const s = at(m);
      if (s.exhausted[d]) return false;
      s.exhausted[d] = true;
      bump(m, "exhausted");
      return true;
    },
    // Counts are kept per month: one for an ended month goes to that month, and moves nothing.
    addEvent: (m, e) => {
      if (!ended(m)) at(m);
      bump(m, e);
    },
    events: () => structuredClone(state.events),
    daySpent: (d) => (d === state.day ? state.daySpent : 0),
    addDaySpend: (d, usd) => {
      if (state.day !== "" && d < state.day) return drop();
      if (d !== state.day) state = { ...state, day: d, daySpent: 0 };
      state.daySpent += usd;
    },
    stale: () => stale,
    snapshot: () => state,
  };
}

/** A memory ledger that starts from `initial` and calls `save` after every change. */
export function persistentLedger(initial: LedgerState | null, save: (s: LedgerState) => void, opts: LedgerOptions = {}): Ledger {
  const mem = memoryLedger(initial, opts);
  const saving =
    <A extends unknown[], R>(f: (...a: A) => R) =>
    (...a: A): R => {
      const r = f(...a);
      save(mem.snapshot());
      return r;
    };
  return {
    spent: mem.spent,
    count: mem.count,
    deviceSpent: mem.deviceSpent,
    events: mem.events,
    daySpent: mem.daySpent,
    stale: mem.stale,
    addSpend: saving(mem.addSpend),
    addCount: saving(mem.addCount),
    debit: saving(mem.debit),
    addEvent: saving(mem.addEvent),
    addDaySpend: saving(mem.addDaySpend),
    // Only a change is written.
    markExhausted: (m, d) => {
      const fresh = mem.markExhausted(m, d);
      if (fresh) save(mem.snapshot());
      return fresh;
    },
  };
}
