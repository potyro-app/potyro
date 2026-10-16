// The live side of Ticker: Coinbase's ticks in, at most one write every few seconds per symbol out;
// a point a minute for the sparkline and the chart; the ECB's rates fetched every half hour; alerts
// that ring once; the store kept small. And the demo: a made-up market played through the same path.

import type { Ctx, Resolved } from "potyro";
import { createLive } from "./live.js";
import {
  candlesUrl,
  changePct,
  CHOICES,
  Coalescer,
  COINBASE_WS,
  crossed,
  DEFAULT_WATCHLIST,
  demoWalk,
  fxHistoryUrl,
  fxLatestUrl,
  prunePoints,
  readCandles,
  readFxHistory,
  readFxLatest,
  readTick,
  sparkline,
  subscribeMessage,
  thin,
  toDate,
  type Kind,
  type Tick,
} from "./prices.js";
import { alertText, priceText, type FeedState } from "./words.js";

/** A symbol's price is written at most this often. */
export const WRITE_EVERY_MS = 3000;
/** Points kept per symbol: an hour of minutes for crypto, 30 working days for a currency. */
export const KEEP_POINTS = 60;
/** How often the currencies are fetched again while watching (they change once a working day). */
export const FX_EVERY_MS = 30 * 60_000;
/** Characters in a sparkline. */
const SPARK = 16;

const minuteOf = (t: number): number => Math.floor(t / 60_000) * 60_000;

interface Sym {
  id: string;
  code: string;
  kind: Kind;
  name: string;
  above: number | null;
  below: number | null;
}

// ------------------------------------------------------------------ module state

let feedId: string | null = null;
let symbols: Sym[] = [];
/** code → its points, oldest first, as written. */
const points = new Map<string, Array<{ id: string; at: number; price: number }>>();
const coalesce = new Coalescer(WRITE_EVERY_MS);
let writeTimer: unknown = null;
let writing: Promise<void> | null = null;
let fxTimer: unknown = null;
let startedHere = false;
let demoRunning = false;
let demoTimer: unknown = null;
let wrote = 0;

const later = (fn: () => void, ms: number): unknown => (typeof setTimeout === "function" ? setTimeout(fn, ms) : null);
const cancel = (t: unknown): void => {
  if (t !== null && typeof clearTimeout === "function") clearTimeout(t as ReturnType<typeof setTimeout>);
};

const crypto = () => symbols.filter((s) => s.kind === "crypto").map((s) => s.code);

const live = createLive({
  url: COINBASE_WS,
  // Coinbase forgets subscriptions with the connection: say them again on every connect.
  hello: () => [subscribeMessage(crypto())],
  onText: (text, ctx) => take(text, ctx),
  onState: (state, ctx) => void setState(ctx, state),
});

export const liveState = () => live.state;
export const isDemoRunning = (): boolean => demoRunning;
export const wasStartedHere = (): boolean => startedHere;

// ------------------------------------------------------------------ records

async function loadSymbols(ctx: Ctx): Promise<void> {
  const rows = await ctx.query("symbol");
  symbols = rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    kind: r.kind === "fx" ? "fx" : "crypto",
    name: String(r.name ?? r.code),
    above: typeof r.above === "number" ? r.above : null,
    below: typeof r.below === "number" ? r.below : null,
  }));
  const pts = await ctx.query("point");
  points.clear();
  for (const p of pts) {
    const at = toDate(p.at)?.getTime();
    if (at === undefined) continue;
    const list = points.get(String(p.code)) ?? [];
    list.push({ id: String(p.id), at, price: Number(p.price) });
    points.set(String(p.code), list);
  }
  for (const list of points.values()) list.sort((a, b) => a.at - b.at);
}

async function ensureWatchlist(ctx: Ctx): Promise<void> {
  if ((await ctx.query("symbol", { limit: 1 })).length) return;
  for (const code of DEFAULT_WATCHLIST) {
    const c = CHOICES.find((x) => x.code === code)!;
    await ctx.create("symbol", { code: c.code, kind: c.kind, name: c.name });
  }
}

async function setState(ctx: Ctx, state: FeedState, extra: Record<string, unknown> = {}): Promise<void> {
  const data = { state, since: new Date(), ...extra };
  try {
    if (!feedId) {
      const first = (await ctx.query("feed"))[0];
      feedId = first ? String(first.id) : null;
    }
    if (feedId) await ctx.patch("feed", feedId, data);
    else feedId = String((await ctx.create("feed", data)).id);
  } catch {
    // the app was closed under it
  }
}

/** One minute's point for a symbol: the current minute's is moved with the price, a new minute adds one. */
async function point(ctx: Ctx, code: string, at: number, price: number, demo: boolean): Promise<void> {
  const list = points.get(code) ?? [];
  const last = list.at(-1);
  if (last && last.at === at) {
    last.price = price;
    await ctx.patch("point", last.id, { price });
  } else {
    const r = await ctx.create("point", { code, at: new Date(at), price, demo });
    list.push({ id: String(r.id), at, price });
    points.set(code, list);
  }
  // The oldest go: the store holds an hour per symbol, however long it runs.
  while (list.length > KEEP_POINTS) {
    const gone = list.shift()!;
    try {
      await ctx.delete("point", gone.id);
    } catch {
      // already gone
    }
  }
}

const sparkOf = (code: string): string => sparkline(thin((points.get(code) ?? []).map((p) => p.price), SPARK));

/** A price for a symbol: the record, its point, its alert. */
async function writePrice(ctx: Ctx, s: Sym, price: number, base: number | null, updated: Date, demo: boolean, at = minuteOf(updated.getTime())): Promise<void> {
  await point(ctx, s.code, at, price, demo);
  const change = changePct(price, base);
  await ctx.patch("symbol", s.id, {
    price,
    base,
    change: change === null ? null : Math.round(change * 100) / 100,
    trend: change === null || Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down",
    spark: sparkOf(s.code),
    updated,
    demo,
  });
  const hit = crossed(price, s);
  if (hit) await ring(ctx, s, hit, price, demo);
}

async function ring(ctx: Ctx, s: Sym, dir: "above" | "below", price: number, demo: boolean): Promise<void> {
  const level = dir === "above" ? s.above! : s.below!;
  // Once: the line is cleared, so a price that hovers on it does not ring again and again.
  if (dir === "above") s.above = null;
  else s.below = null;
  await ctx.patch("symbol", s.id, { [dir]: null });
  const title = alertText(s.code, dir, level, ctx);
  const body = priceText(price, s.code, ctx);
  await ctx.create("alert", { code: s.code, name: s.name, direction: dir, level, price, at: new Date(), demo });
  const n = ctx.caps.notifications;
  try {
    if (n) await n.schedule({ id: `alert-${s.code}-${Date.now()}`, at: new Date(Date.now() + 1000), title, body });
    else ctx.ui.toast(`🔔 ${title} — ${body}`);
    await ctx.caps.haptics?.vibrate([120, 80, 120]);
  } catch {
    ctx.ui.toast(`🔔 ${title} — ${body}`);
  }
}

// ------------------------------------------------------------------ crypto: the stream

function take(raw: string, ctx: Ctx): void {
  const t = readTick(raw);
  if (!t) return;
  coalesce.add(t);
  schedule(ctx);
}

/** Write what is due now, and wake for whatever becomes due next. */
function schedule(ctx: Ctx): void {
  if (writing || writeTimer !== null) return;
  const wait = coalesce.nextIn(Date.now());
  if (wait === null) return;
  if (wait === 0) {
    void write(ctx);
    return;
  }
  writeTimer = later(() => {
    writeTimer = null;
    void write(ctx);
  }, wait);
  if (writeTimer === null) void write(ctx);
}

export function write(ctx: Ctx): Promise<void> {
  if (writing) return writing;
  writing = (async () => {
    const now = Date.now();
    const due: Tick[] = coalesce.due(now);
    for (const t of due) {
      coalesce.wrote(t, now);
      const s = symbols.find((x) => x.code === t.code);
      if (!s) continue;
      try {
        await writePrice(ctx, s, t.price, t.open24, t.time, demoRunning);
        wrote++;
      } catch {
        return; // the app was closed under it
      }
    }
  })().finally(() => {
    writing = null;
    schedule(ctx);
  });
  return writing;
}

/** The last hour of minutes for symbols without a recent point, from Coinbase's candles. */
async function backfillCrypto(ctx: Ctx): Promise<void> {
  const fetch = ctx.caps.network?.fetch;
  if (!fetch) return;
  for (const s of symbols.filter((x) => x.kind === "crypto")) {
    const last = points.get(s.code)?.at(-1);
    if (last && Date.now() - last.at < 10 * 60_000) continue;
    try {
      const res = await fetch(candlesUrl(s.code));
      if (!res.ok) continue;
      const closes = readCandles(await res.json(), KEEP_POINTS);
      for (const c of closes) await point(ctx, s.code, minuteOf(c.at.getTime()), c.price, false);
      const newest = closes.at(-1);
      if (newest) await ctx.patch("symbol", s.id, { price: newest.price, spark: sparkOf(s.code), updated: newest.at, demo: false });
    } catch {
      // the stream fills it in from now on
    }
  }
}

// ------------------------------------------------------------------ currencies: fetched

/** The ECB's latest rate for every currency pair, and 30 working days behind it for the sparkline. */
export async function refreshFx(ctx: Ctx): Promise<boolean> {
  const fetch = ctx.caps.network?.fetch;
  const fx = symbols.filter((s) => s.kind === "fx");
  if (!fetch || !fx.length) return false;
  let ok = true;
  for (const s of fx) {
    const [base, quote] = s.code.split("/") as [string, string];
    try {
      if ((points.get(s.code)?.length ?? 0) < 5) {
        const res = await fetch(fxHistoryUrl(base, quote, new Date(Date.now() - 45 * 86_400_000)));
        if (res.ok) for (const p of readFxHistory(await res.json(), quote)) await point(ctx, s.code, p.at.getTime(), p.price, false);
      }
      const res = await fetch(fxLatestUrl(base, [quote]));
      const latest = res.ok ? readFxLatest(await res.json()) : null;
      const rate = latest?.rates[quote];
      if (!latest || rate === undefined) {
        ok = false;
        continue;
      }
      const day = new Date(`${latest.date}T16:00:00Z`);
      const list = points.get(s.code) ?? [];
      const before = list.filter((p) => p.at < day.getTime()).at(-1)?.price ?? null;
      await writePrice(ctx, s, rate, before, day, false, day.getTime());
    } catch {
      ok = false;
    }
  }
  return ok;
}

function scheduleFx(ctx: Ctx): void {
  cancel(fxTimer);
  fxTimer = later(() => {
    fxTimer = null;
    // Only while the stream is wanted: after Stop, or once the person left, it stops too.
    if (!startedHere || demoRunning || live.state === "off" || live.state === "denied" || live.state === "blocked") return;
    void refreshFx(ctx).then(() => scheduleFx(ctx));
  }, FX_EVERY_MS);
}

// ------------------------------------------------------------------ what the buttons do

/**
 * The work a button starts. A shared copy's box gives each call about a second (the realm's
 * watchdog), and an hour of candles or a month of rates takes longer — so the button starts the work
 * and returns; the work goes on, one job after another, its progress on the status line.
 */
let busy: Promise<void> = Promise.resolve();
function inBackground(ctx: Ctx, work: () => Promise<void>): void {
  busy = busy.then(work).catch((e: unknown) => ctx.log("ticker: a job failed", e instanceof Error ? e.message : String(e)));
}
/** For tests: when the work started so far is done. */
export const idle = (): Promise<void> => busy;

export async function watchLive(ctx: Ctx): Promise<void> {
  stopDemo();
  startedHere = true;
  if (live.state === "live" || live.state === "connecting") {
    ctx.ui.toast(ctx.t({ en: "Already live.", "pt-BR": "Já está ao vivo.", de: "Läuft schon live.", es: "Ya está en vivo.", pl: "Już na żywo.", it: "Già in diretta." }));
    return;
  }
  inBackground(ctx, () => starting(ctx));
}

async function starting(ctx: Ctx): Promise<void> {
  await ensureWatchlist(ctx);
  // Real prices only from here: a made-up hour would draw the sparkline and the chart.
  for (const e of ["point", "alert"]) for (const r of await ctx.query(e, { filter: (r) => r.demo === true })) await ctx.delete(e, String(r.id));
  await loadSymbols(ctx);
  coalesce.clear();
  await setState(ctx, "connecting");
  await backfillCrypto(ctx);
  const fxOk = await refreshFx(ctx);
  await setState(ctx, "connecting", { fxOk });
  if (!crypto().length) {
    // Currencies only: nothing streams. They were fetched now, and they change once a working day.
    await setState(ctx, "off");
    ctx.ui.toast(
      fxOk
        ? ctx.t({ en: "Currencies updated: the ECB's rates, which change once a working day.", "pt-BR": "Moedas atualizadas: as taxas do BCE, que mudam uma vez por dia útil.", de: "Währungen aktualisiert: die Kurse der EZB, die sich einmal pro Werktag ändern.", es: "Divisas actualizadas: los tipos del BCE, que cambian una vez por día hábil.", pl: "Zaktualizowano waluty: kursy EBC, zmieniane raz na dzień roboczy.", it: "Valute aggiornate: i tassi della BCE, che cambiano una volta per giorno lavorativo." })
        : ctx.t({ en: "Couldn't fetch the currencies right now.", "pt-BR": "Não foi possível obter as moedas agora.", de: "Die Währungen konnten gerade nicht geladen werden.", es: "No se pudieron obtener las divisas ahora.", pl: "Nie udało się teraz pobrać walut.", it: "Non è stato possibile scaricare le valute ora." }),
    );
    return;
  }
  live.start(ctx);
  scheduleFx(ctx);
}

export async function stopWatching(ctx: Ctx): Promise<void> {
  startedHere = true;
  stopDemo();
  live.stop();
  cancel(fxTimer);
  fxTimer = null;
  await setState(ctx, "off");
}

function stopDemo(): void {
  cancel(demoTimer);
  demoTimer = null;
  demoRunning = false;
}

/** Add a symbol from the list; while live it is subscribed at once. */
export async function addSymbol(ctx: Ctx): Promise<void> {
  const have = new Set((await ctx.query("symbol")).map((r) => String(r.code)));
  const pick = await ctx.ui.sheet<string>({
    title: { en: "Add to the watchlist", "pt-BR": "Adicionar à lista", de: "Zur Liste hinzufügen", es: "Añadir a la lista", pl: "Dodaj do listy", it: "Aggiungi alla lista" },
    items: CHOICES.filter((c) => !have.has(c.code)).map((c) => ({
      id: c.code,
      label: c.code,
      detail: c.kind === "crypto" ? `${c.name} · Coinbase` : `${c.name} · ECB`,
      icon: c.kind === "crypto" ? "🪙" : "💱",
    })),
  });
  if (!pick) return;
  const c = CHOICES.find((x) => x.code === pick)!;
  await ctx.create("symbol", { code: c.code, kind: c.kind, name: c.name });
  inBackground(ctx, async () => {
    await loadSymbols(ctx);
    if (c.kind === "crypto") await live.send(subscribeMessage([c.code]));
    else if (live.state === "live") await refreshFx(ctx);
  });
}

/** Take a symbol off the watchlist, with its points. */
export async function removeSymbol(r: Resolved, ctx: Ctx): Promise<void> {
  const ok = await ctx.ui.confirm(ctx.t({ en: "Take {code} off the watchlist?", "pt-BR": "Tirar {code} da lista?", de: "{code} von der Liste nehmen?", es: "¿Quitar {code} de la lista?", pl: "Usunąć {code} z listy?", it: "Togliere {code} dalla lista?" }, { code: String(r.code) }), {
    ok: ctx.t({ en: "Remove", "pt-BR": "Remover", de: "Entfernen", es: "Quitar", pl: "Usuń", it: "Rimuovi" }),
    destructive: true,
  });
  if (!ok) return;
  await ctx.delete("symbol", String(r.id));
  ctx.navigate("watchlist");
  inBackground(ctx, async () => {
    if (r.kind === "crypto") await live.send(subscribeMessage([String(r.code)], "unsubscribe"));
    for (const p of await ctx.query("point", { filter: (p) => p.code === r.code })) await ctx.delete("point", String(p.id));
    await loadSymbols(ctx);
  });
}

/** Price alerts: a line above, a line below; either may be left empty. */
export async function setAlert(r: Resolved, ctx: Ctx): Promise<void> {
  const unit = String(r.code).split(/[-/]/)[1] ?? "";
  const help = ctx.t({ en: "Now {price}. Leave empty for none.", "pt-BR": "Agora {price}. Deixe vazio para nenhum.", de: "Jetzt {price}. Leer lassen für keinen.", es: "Ahora {price}. Déjalo vacío para ninguno.", pl: "Teraz {price}. Zostaw puste, by nie ustawiać.", it: "Ora {price}. Lascia vuoto per nessuno." }, { price: typeof r.price === "number" ? priceText(r.price, String(r.code), ctx) : "–" });
  const answer = await ctx.ui.form<{ above?: number | null; below?: number | null }>({
    title: ctx.t({ en: "Alert for {code}", "pt-BR": "Alerta para {code}", de: "Alarm für {code}", es: "Alerta para {code}", pl: "Alert dla {code}", it: "Avviso per {code}" }, { code: String(r.code) }),
    fields: {
      above: { type: "number", min: 0, unit, help, label: { en: "Tell me when it goes above", "pt-BR": "Avise quando passar de", de: "Sag Bescheid, wenn es über", es: "Avísame cuando suba de", pl: "Powiadom, gdy przekroczy", it: "Avvisami quando supera" } },
      below: { type: "number", min: 0, unit, label: { en: "Tell me when it drops below", "pt-BR": "Avise quando cair abaixo de", de: "Sag Bescheid, wenn es unter", es: "Avísame cuando baje de", pl: "Powiadom, gdy spadnie poniżej", it: "Avvisami quando scende sotto" } },
    },
    initial: { above: typeof r.above === "number" ? r.above : undefined, below: typeof r.below === "number" ? r.below : undefined },
    submit: { en: "Save", "pt-BR": "Salvar", de: "Speichern", es: "Guardar", pl: "Zapisz", it: "Salva" },
  });
  if (!answer) return;
  const above = typeof answer.above === "number" && answer.above > 0 ? answer.above : null;
  const below = typeof answer.below === "number" && answer.below > 0 ? answer.below : null;
  await ctx.patch("symbol", String(r.id), { above, below });
  const s = symbols.find((x) => x.id === String(r.id));
  if (s) Object.assign(s, { above, below });
  ctx.ui.toast(
    above || below
      ? ctx.t({ en: "Alert set. It rings once, while the app is open.", "pt-BR": "Alerta criado. Ele toca uma vez, com o app aberto.", de: "Alarm gesetzt. Er meldet sich einmal, solange die App offen ist.", es: "Alerta creada. Suena una vez, con la app abierta.", pl: "Alert ustawiony. Zadziała raz, gdy aplikacja jest otwarta.", it: "Avviso impostato. Suona una volta, con l'app aperta." })
      : ctx.t({ en: "No alert for {code}.", "pt-BR": "Sem alerta para {code}.", de: "Kein Alarm für {code}.", es: "Sin alerta para {code}.", pl: "Brak alertu dla {code}.", it: "Nessun avviso per {code}." }, { code: String(r.code) }),
  );
}

// ------------------------------------------------------------------ the demo

/** Where the demo's market starts, per symbol: roughly where it stood when this app was made. */
const DEMO_START: Record<string, number> = { "BTC-USD": 82275, "ETH-USD": 2449.8, "SOL-USD": 161.2, "XRP-USD": 0.548, "DOGE-USD": 0.1312, "ADA-USD": 0.392, "LTC-USD": 71.4, "BTC-EUR": 73420, "ETH-EUR": 2186, "EUR/USD": 1.1208, "USD/BRL": 5.057, "EUR/PLN": 4.37, "GBP/USD": 1.325, "USD/JPY": 151.2, "EUR/CHF": 0.938, "EUR/BRL": 5.668 };
/** One demo tick every this long — a busy market, so the coalescing shows. */
export const DEMO_TICK_MS = 120;
/** How long the demo plays. */
export const DEMO_TICKS = 500;

/** The demo: an hour of made-up history, then a made-up market ticking several times a second. */
export async function playDemo(ctx: Ctx): Promise<void> {
  live.stop();
  stopDemo();
  cancel(fxTimer);
  startedHere = true;
  demoRunning = true;
  inBackground(ctx, () => demo(ctx));
}

async function demo(ctx: Ctx): Promise<void> {
  await ensureWatchlist(ctx);
  await loadSymbols(ctx);
  coalesce.clear();
  demoRunning = true;
  await setState(ctx, "demo");
  const now = minuteOf(Date.now());
  const walks = new Map<string, number[]>();
  for (const [i, s] of symbols.entries()) {
    const start = DEMO_START[s.code] ?? 100;
    const history = demoWalk(start, KEEP_POINTS + DEMO_TICKS, 7919 * (i + 1));
    walks.set(s.code, history.slice(KEEP_POINTS));
    // An hour of minutes (a month of days for a currency) behind it.
    const step = s.kind === "fx" ? 86_400_000 : 60_000;
    const back = s.kind === "fx" ? 30 : KEEP_POINTS;
    for (let k = 0; k < back; k++) await point(ctx, s.code, now - (back - k) * step, history[k]!, true);
    await writePrice(ctx, s, history[back - 1]!, history[0]!, new Date(), true, now - step);
  }
  const cryptoSyms = symbols.filter((s) => s.kind === "crypto");
  let n = 0;
  const step = (): void => {
    if (!demoRunning) return;
    if (n >= DEMO_TICKS || !cryptoSyms.length) {
      void (async () => {
        // The last made-up prices are written now, as made-up ones, before the demo says it is done.
        cancel(writeTimer);
        writeTimer = null;
        await writing;
        const now = Date.now();
        for (const t of coalesce.rest()) {
          coalesce.wrote(t, now);
          const s = symbols.find((x) => x.code === t.code);
          if (s) await writePrice(ctx, s, t.price, t.open24, t.time, true);
        }
        demoRunning = false;
        await setState(ctx, "demo-done");
      })();
      return;
    }
    const s = cryptoSyms[n % cryptoSyms.length]!;
    const price = walks.get(s.code)![Math.floor(n / cryptoSyms.length)]!;
    const open = DEMO_START[s.code] ?? price;
    // Exactly what Coinbase sends, through the same reading.
    take(JSON.stringify({ type: "ticker", product_id: s.code, price: String(price), open_24h: String(open), time: new Date().toISOString(), side: "buy" }), ctx);
    n++;
    demoTimer = later(step, DEMO_TICK_MS);
    if (demoTimer === null) step();
  };
  step();
}

export async function clearDemo(ctx: Ctx): Promise<void> {
  stopDemo();
  inBackground(ctx, () => clearing(ctx));
}

async function clearing(ctx: Ctx): Promise<void> {
  // Made-up ticks still waiting for their write must not land after the clearing.
  coalesce.clear();
  cancel(writeTimer);
  writeTimer = null;
  await writing;
  for (const e of ["point", "alert"]) for (const r of await ctx.query(e, { filter: (r) => r.demo === true })) await ctx.delete(e, String(r.id));
  // Every price shown came from the demo or is older than it: blank them all; "Watch live" fills them again.
  for (const r of await ctx.query("symbol")) {
    await ctx.patch("symbol", String(r.id), { price: null, base: null, change: null, trend: "flat", spark: "", updated: null, demo: false });
  }
  await loadSymbols(ctx);
  await setState(ctx, live.state);
  ctx.ui.toast(ctx.t({ en: "Demo prices cleared.", "pt-BR": "Preços da demo apagados.", de: "Demo-Preise gelöscht.", es: "Precios de la demo borrados.", pl: "Usunięto ceny z demo.", it: "Prezzi della demo cancellati." }));
}

/** For tests. */
export const writesSoFar = (): number => wrote;
export function resetForTests(): void {
  live.stop();
  stopDemo();
  cancel(writeTimer);
  cancel(fxTimer);
  writeTimer = null;
  fxTimer = null;
  writing = null;
  busy = Promise.resolve();
  feedId = null;
  symbols = [];
  points.clear();
  coalesce.clear();
  startedHere = false;
  wrote = 0;
}
