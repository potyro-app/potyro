// Prices in, prices out: Coinbase's ticker messages and candles, the ECB's reference rates through
// Frankfurter, and the app's own sums — the coalescing that turns many ticks a second into one write
// every few seconds per symbol, the change, the sparkline, and when an alert should ring.
//
// Crypto: Coinbase Exchange's public feed, wss://ws-feed.exchange.coinbase.com — after
// `{"type":"subscribe","product_ids":[…],"channels":["ticker"]}` it answers `{"type":"subscriptions",…}`
// and then one `{"type":"ticker","product_id","price","open_24h","time",…}` per trade. No key.
//
// Currencies: there is no public, keyless WebSocket for exchange rates, so they are fetched — the
// ECB's reference rates through Frankfurter (api.frankfurter.dev), which change once a working day
// around 16:00 CET. The app says so wherever it shows one.

export const COINBASE_WS_HOST = "ws-feed.exchange.coinbase.com";
export const COINBASE_WS = `wss://${COINBASE_WS_HOST}`;
export const COINBASE_REST_HOST = "api.exchange.coinbase.com";
export const FX_HOST = "api.frankfurter.dev";

export type Kind = "crypto" | "fx";

export interface Choice {
  code: string;
  kind: Kind;
  name: string;
}

/** What can be added. Crypto codes are Coinbase products; currency pairs are BASE/QUOTE. */
export const CHOICES: Choice[] = [
  { code: "BTC-USD", kind: "crypto", name: "Bitcoin" },
  { code: "ETH-USD", kind: "crypto", name: "Ether" },
  { code: "SOL-USD", kind: "crypto", name: "Solana" },
  { code: "XRP-USD", kind: "crypto", name: "XRP" },
  { code: "DOGE-USD", kind: "crypto", name: "Dogecoin" },
  { code: "ADA-USD", kind: "crypto", name: "Cardano" },
  { code: "LTC-USD", kind: "crypto", name: "Litecoin" },
  { code: "BTC-EUR", kind: "crypto", name: "Bitcoin" },
  { code: "ETH-EUR", kind: "crypto", name: "Ether" },
  { code: "EUR/USD", kind: "fx", name: "Euro → US dollar" },
  { code: "USD/BRL", kind: "fx", name: "US dollar → Brazilian real" },
  { code: "EUR/PLN", kind: "fx", name: "Euro → Polish złoty" },
  { code: "GBP/USD", kind: "fx", name: "Pound → US dollar" },
  { code: "USD/JPY", kind: "fx", name: "US dollar → Japanese yen" },
  { code: "EUR/CHF", kind: "fx", name: "Euro → Swiss franc" },
  { code: "EUR/BRL", kind: "fx", name: "Euro → Brazilian real" },
];

export const DEFAULT_WATCHLIST = ["BTC-USD", "ETH-USD", "EUR/USD"];

export const subscribeMessage = (ids: string[], type: "subscribe" | "unsubscribe" = "subscribe"): string => JSON.stringify({ type, product_ids: ids, channels: ["ticker"] });

/** The currency a price is in: "USD" for BTC-USD, "BRL" for USD/BRL. */
export const quoteOf = (code: string): string => code.split(/[-/]/)[1] ?? "USD";

export interface Tick {
  code: string;
  price: number;
  open24: number | null;
  time: Date;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** One Coinbase message → a tick, or null (the subscriptions reply, heartbeats, errors, junk). */
export function readTick(raw: string): Tick | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  const t = m as { type?: unknown; product_id?: unknown; price?: unknown; open_24h?: unknown; time?: unknown };
  if (t?.type !== "ticker" || typeof t.product_id !== "string") return null;
  const price = num(t.price);
  if (price === null || price <= 0) return null;
  const time = typeof t.time === "string" ? new Date(t.time) : new Date();
  return { code: t.product_id, price, open24: num(t.open_24h), time: Number.isNaN(time.getTime()) ? new Date() : time };
}

/** Coinbase's error message, if this is one (`{"type":"error","message":…,"reason":…}`). */
export function readError(raw: string): string | null {
  try {
    const m = JSON.parse(raw) as { type?: unknown; message?: unknown; reason?: unknown };
    return m?.type === "error" ? String(m.reason ?? m.message ?? "error") : null;
  } catch {
    return null;
  }
}

export const candlesUrl = (code: string): string => `https://${COINBASE_REST_HOST}/products/${encodeURIComponent(code)}/candles?granularity=60`;

/** Candles `[time, low, high, open, close, volume]`, newest first → closes per minute, oldest first. */
export function readCandles(body: unknown, max = 60): Array<{ at: Date; price: number }> {
  if (!Array.isArray(body)) return [];
  return body
    .filter((c): c is number[] => Array.isArray(c) && c.length >= 5 && c.every((x) => typeof x === "number"))
    .slice(0, max)
    .map((c) => ({ at: new Date(c[0]! * 1000), price: c[4]! }))
    .reverse();
}

export const fxLatestUrl = (base: string, quotes: string[]): string => `https://${FX_HOST}/v1/latest?base=${base}&symbols=${quotes.join(",")}`;
export const fxHistoryUrl = (base: string, quote: string, from: Date): string => `https://${FX_HOST}/v1/${from.toISOString().slice(0, 10)}..?base=${base}&symbols=${quote}`;

/** Frankfurter's latest: rates for one base, and the day they are from. */
export function readFxLatest(body: unknown): { base: string; date: string; rates: Record<string, number> } | null {
  const b = body as { base?: unknown; date?: unknown; rates?: Record<string, unknown> } | null;
  if (!b || typeof b.base !== "string" || typeof b.date !== "string" || !b.rates || typeof b.rates !== "object") return null;
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.rates)) {
    const n = num(v);
    if (n !== null) rates[k] = n;
  }
  return { base: b.base, date: b.date, rates };
}

/** Frankfurter's series → a rate per working day, oldest first. */
export function readFxHistory(body: unknown, quote: string): Array<{ at: Date; price: number }> {
  const rates = (body as { rates?: Record<string, Record<string, unknown>> } | null)?.rates;
  if (!rates || typeof rates !== "object") return [];
  return Object.entries(rates)
    .map(([day, r]) => ({ at: new Date(`${day}T16:00:00Z`), price: num(r?.[quote]) }))
    .filter((p): p is { at: Date; price: number } => p.price !== null && !Number.isNaN(p.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ------------------------------------------------------------------ coalescing ticks

/**
 * Prices tick many times a second; a write is a record change every view follows. So ticks are only
 * remembered (the last one per symbol, and the first price since the last write), and `due` hands
 * out each symbol whose price moved at most once every `everyMs`.
 */
export class Coalescer {
  private latest = new Map<string, Tick>();
  private written = new Map<string, number>();
  private lastWrite = new Map<string, number>();
  constructor(readonly everyMs: number) {}

  add(t: Tick): void {
    this.latest.set(t.code, t);
  }

  /** Ticks to write now: the newest per symbol, for symbols whose price changed and whose last write is old enough. */
  due(now: number): Tick[] {
    const out: Tick[] = [];
    for (const [code, t] of this.latest) {
      if (this.written.get(code) === t.price) continue;
      if (now - (this.lastWrite.get(code) ?? 0) < this.everyMs) continue;
      out.push(t);
    }
    return out;
  }

  /** Mark a tick as written. */
  wrote(t: Tick, now: number): void {
    this.written.set(t.code, t.price);
    this.lastWrite.set(t.code, now);
  }

  /** When the next symbol becomes due (ms from now), or null when nothing is waiting. */
  nextIn(now: number): number | null {
    let next: number | null = null;
    for (const [code, t] of this.latest) {
      if (this.written.get(code) === t.price) continue;
      const wait = Math.max(0, this.everyMs - (now - (this.lastWrite.get(code) ?? 0)));
      next = next === null ? wait : Math.min(next, wait);
    }
    return next;
  }

  /** Every tick not written yet, whatever its last write: for an end (the demo's) that must not leave one behind. */
  rest(): Tick[] {
    return [...this.latest.values()].filter((t) => this.written.get(t.code) !== t.price);
  }

  clear(): void {
    this.latest.clear();
    this.written.clear();
    this.lastWrite.clear();
  }
}

// ------------------------------------------------------------------ change, sparkline, alerts

/** Percent change from `from` to `to`, or null without a base. */
export const changePct = (to: number, from: number | null | undefined): number | null => (from && from > 0 ? ((to - from) / from) * 100 : null);

/** A sparkline in eight steps, scaled between the series' own low and high. */
export function sparkline(values: readonly number[]): string {
  const bars = "▁▂▃▄▅▆▇█";
  if (!values.length) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return values.map(() => bars[3]).join("");
  return values.map((v) => bars[Math.round(((v - lo) / (hi - lo)) * 7)]).join("");
}

/** Every `step`-th value, ending on the last, so a long series fits in `n` characters. */
export function thin(values: readonly number[], n: number): number[] {
  if (values.length <= n) return [...values];
  const step = values.length / n;
  return Array.from({ length: n }, (_, i) => values[Math.min(values.length - 1, Math.round((i + 1) * step) - 1)]!);
}

/** Which alert a move rings: "above" when it reached the upper line, "below" the lower; null otherwise. */
export function crossed(price: number, o: { above?: number | null; below?: number | null }): "above" | "below" | null {
  if (typeof o.above === "number" && o.above > 0 && price >= o.above) return "above";
  if (typeof o.below === "number" && o.below > 0 && price <= o.below) return "below";
  return null;
}

/** The record ids to delete so each symbol keeps its newest `max` points. */
export function prunePoints<T extends { id: string; code: string; at: Date | null }>(rows: readonly T[], max: number): string[] {
  const bySymbol = new Map<string, T[]>();
  for (const r of rows) bySymbol.set(r.code, [...(bySymbol.get(r.code) ?? []), r]);
  const out: string[] = [];
  for (const list of bySymbol.values()) {
    list.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    out.push(...list.slice(max).map((r) => r.id));
  }
  return out;
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** A demo price walk: deterministic, small steps around a start, the way a quiet market moves. */
export function demoWalk(start: number, steps: number, seed: number): number[] {
  let x = seed % 2147483647 || 1;
  const rnd = () => ((x = (x * 48271) % 2147483647) / 2147483647) * 2 - 1;
  const out: number[] = [];
  let p = start;
  for (let i = 0; i < steps; i++) {
    p *= 1 + rnd() * 0.0012 + 0.00005;
    out.push(p);
  }
  return out;
}
