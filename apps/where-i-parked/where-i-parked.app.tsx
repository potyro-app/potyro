// Where I parked — one tap keeps the spot where the car is; later it says how far and which way, and
// opens a map to it. One job, one screen: with no car parked, the screen is one big button; with one,
// it is the spot's card — when, where, a note, a photo, the meter — and "Find my car".
//
// Where you are comes only through `ctx.caps.geo` (CLAUDE.md rule 2), a photo only through
// `ctx.caps.camera`; the app never touches the browser's own APIs. A spot is a record; the one with
// no `found` time is the car now, and "Found it" stamps it into the history. Distance and bearing
// are plain functions in geo.ts, with tests. The map app's job is the route: "Open in a map" is a
// link to the pin on OpenStreetMap, as Places does. In six languages (#303), in words.ts.
import { defineApp } from "potyro";
import type { Ctx, MediaRef, Resolved, ViewProps } from "potyro";
import { useEffect, useState } from "react";
import { bearingDeg, compass, COMPASS_WORDS, distanceM, distanceText, mapUrl, type Point } from "./geo.js";
import { W } from "./words.js";

const LANGS = ["en", "pt-BR", "de", "es", "pl", "it"] as const;
/** Closer than this is "right by it": the phone's own fix is rarely better. */
const HERE_M = 25;

const asDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
const point = (v: unknown): Point | null => {
  const p = v as { lat?: unknown; lng?: unknown } | null;
  return p && typeof p.lat === "number" && typeof p.lng === "number" ? { lat: p.lat, lng: p.lng } : null;
};

/** The spot the car is at now: the newest one nobody has found again. */
export function currentSpot(spots: Resolved[]): Resolved | undefined {
  return spots.filter((s) => !s.found).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
}

// ---- what the app does ----

/** Where the device is, or null when it will not say (no capability, refused, no fix). */
async function locate(ctx: Ctx): Promise<Point | null> {
  try {
    const here = await ctx.caps.geo?.current();
    return here ? { lat: here.lat, lng: here.lng } : null;
  } catch {
    return null;
  }
}

/** The big tap: where the car is, now. A device that will not say still gets a spot, without a pin. */
async function parkHere(ctx: Ctx): Promise<Resolved> {
  void ctx.caps.haptics?.vibrate(30).catch(() => undefined);
  const here = await locate(ctx);
  const spot = await ctx.create("spot", { at: ctx.now().toISOString(), ...(here ? { location: here } : {}) });
  if (!here) ctx.ui.toast(W.noGeo);
  return spot;
}

async function addNote(spot: Resolved, ctx: Ctx): Promise<void> {
  const note = await ctx.ui.prompt(W.notePrompt, { default: spot.note ? String(spot.note) : "" });
  if (note === null) return;
  await ctx.patch("spot", spot.id, { note: note.trim() });
}

async function addPhoto(spot: Resolved, ctx: Ctx): Promise<void> {
  if (!ctx.caps.camera) return ctx.ui.toast(W.noCamera);
  let blob: Blob;
  try {
    blob = await ctx.caps.camera.capture({ source: "camera" });
  } catch {
    return; // cancelled, or refused: nothing to say
  }
  const photo = await ctx.media.put(blob);
  await ctx.patch("spot", spot.id, { photo });
}

/** When the parking runs out: kept on the spot, and counted down by the shell's own timer. */
async function setMeter(spot: Resolved, ctx: Ctx): Promise<void> {
  const answer = await ctx.ui.form<{ meter: string }>({
    title: W.meterTitle,
    fields: { meter: { type: "datetime", precision: "minute", required: true, label: W.meterLabel } },
    initial: { meter: spot.meter ? String(spot.meter) : new Date(ctx.now().getTime() + 60 * 60_000).toISOString() },
    submit: W.save,
  });
  if (!answer) return;
  const ends = asDate(answer.meter);
  if (!ends) return;
  await ctx.patch("spot", spot.id, { meter: ends.toISOString() });
  const seconds = Math.round((ends.getTime() - ctx.now().getTime()) / 1000);
  if (seconds > 0) await ctx.ui.timer({ id: `meter-${spot.id}`, label: W.meterTimer, seconds });
}

async function foundIt(spot: Resolved, ctx: Ctx): Promise<void> {
  await ctx.patch("spot", spot.id, { found: ctx.now().toISOString() });
  const timers = await ctx.ui.timers().catch(() => []);
  for (const t of timers) if (t.id === `meter-${spot.id}`) t.cancel();
  ctx.ui.toast(W.foundToast);
}

/** A demo opens on a parked car, never on an empty screen: one spot now, two found again. */
async function demo(ctx: Ctx): Promise<void> {
  const now = ctx.now().getTime();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const past = [
    { at: ago(2 * 24 * 60 + 35), found: ago(2 * 24 * 60 - 40), note: "Street, by the bakery", location: { lat: 52.5214, lng: 13.4082 } },
    { at: ago(6 * 24 * 60 + 120), found: ago(6 * 24 * 60), note: "P3, row F", location: { lat: 52.5058, lng: 13.3324 } },
  ];
  for (const p of past) await ctx.create("spot", p);
  await ctx.create("spot", { at: ago(40), note: "Level 2, near the stairs", location: { lat: 52.5163, lng: 13.3777 }, meter: new Date(now + 50 * 60_000).toISOString() });
}

// ---- the screen ----

const CSS = `
.wp { display: grid; gap: var(--space-4, 1rem); padding: var(--space-3, 0.75rem) var(--space-3, 0.75rem) calc(var(--space-5, 1.5rem) + var(--k-chrome-bottom, 0px)); max-width: 30rem; margin: 0 auto; box-sizing: border-box; }
.wp button { touch-action: manipulation; font: inherit; color: inherit; cursor: pointer; }
.wp-empty { display: grid; justify-items: center; gap: var(--space-4, 1rem); padding-top: 8vh; text-align: center; }
.wp-big { width: min(72vw, 17rem); aspect-ratio: 1; border-radius: 999px; border: 0; background: var(--accent, #2f6fed); color: var(--on-accent, #fff); font-size: 1.5rem; font-weight: 800; line-height: 1.15; display: grid; place-items: center; padding: 1.5rem; box-shadow: 0 18px 40px color-mix(in oklab, var(--accent, #2f6fed) 40%, transparent), inset 0 -6px 0 color-mix(in oklab, var(--accent, #2f6fed) 70%, black); transition: transform 120ms ease; }
.wp .wp-big { color: #fff; }
.wp-big > span { display: grid; justify-items: center; gap: 0.5rem; }
.wp-big:active { transform: scale(0.96); }
.wp-big:disabled { opacity: 0.6; cursor: default; }
.wp-big .wp-car { font-size: 3.2rem; line-height: 1; }
.wp-hint { margin: 0; max-width: 22rem; color: var(--ink-soft, #6b635a); }
.wp-card { display: grid; gap: var(--space-3, 0.75rem); padding: var(--space-4, 1rem); border-radius: 22px; background: var(--surface-raised, var(--surface, #fff)); border: 1px solid var(--line, #e2dcd2); box-shadow: 0 14px 34px oklch(20% 0.02 60 / 0.08); }
.wp-when { margin: 0; font-size: 1.45rem; font-weight: 800; line-height: 1.2; }
.wp-sub { margin: 0; color: var(--ink-soft, #6b635a); }
.wp-note { margin: 0; font-size: 1.1rem; }
.wp-photo { width: 100%; max-height: 42vh; object-fit: cover; border-radius: 14px; display: block; }
.wp-meter { margin: 0; padding: 0.5rem 0.75rem; border-radius: 12px; background: color-mix(in oklab, var(--accent, #2f6fed) 12%, transparent); font-weight: 600; }
.wp-meter[data-over="true"] { background: color-mix(in oklab, oklch(60% 0.18 30) 14%, transparent); }
.wp-find { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--space-3, 0.75rem); padding: var(--space-3, 0.75rem); border-radius: 16px; background: color-mix(in oklab, var(--ink, #2b241e) 5%, transparent); }
.wp-arrow { width: 3.2rem; height: 3.2rem; border-radius: 999px; background: var(--accent, #2f6fed); color: #fff; display: grid; place-items: center; font-size: 1.9rem; transition: transform 400ms ease; }
.wp-find b { font-size: 1.25rem; display: block; }
.wp-find span { color: var(--ink-soft, #6b635a); font-size: 0.95rem; }
.wp .wp-primary { border: 0; border-radius: 14px; padding: 0.95rem 1.2rem; font-size: 1.1rem; font-weight: 700; background: var(--accent, #2f6fed); color: #fff; }
.wp-primary:disabled { opacity: 0.6; cursor: default; }
.wp-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.wp-row > * { flex: 1 1 auto; }
.wp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; border: 1px solid var(--line, #e2dcd2); border-radius: 12px; padding: 0.65rem 0.9rem; background: var(--surface, #fff); color: inherit; text-decoration: none; font-weight: 600; }
.wp-found { border-color: transparent; background: color-mix(in oklab, var(--ink, #2b241e) 8%, transparent); }
.wp-wait { margin: 0; padding: var(--space-4, 1rem); color: var(--ink-soft, #6b635a); }
`;

function Photo({ photo, ctx, alt }: { photo: MediaRef; ctx: Ctx; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ctx.media.url(photo).then((u) => live && setUrl(u), () => undefined);
    return () => {
      live = false;
    };
  }, [photo.key]);
  return url ? <img className="wp-photo" src={url} alt={alt} /> : null;
}

/** "340 m to the north-east", with an arrow that points there — from where the phone was when asked. */
function FindCar({ spot, ctx }: { spot: Resolved; ctx: Ctx }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "lost" } | { kind: "near" } | { kind: "away"; metres: number; bearing: number }>({ kind: "idle" });
  const target = point(spot.location);
  if (!target) return <p className="wp-sub">{ctx.t(W.noPin)}</p>;
  const find = async () => {
    setState({ kind: "busy" });
    const here = await locate(ctx);
    if (!here) return setState({ kind: "lost" });
    const metres = distanceM(here, target);
    if (metres < HERE_M) return setState({ kind: "near" });
    setState({ kind: "away", metres, bearing: bearingDeg(here, target) });
  };
  const label = state.kind === "idle" ? W.findCar : W.findAgain;
  return (
    <>
      {state.kind === "away" ? (
        <div className="wp-find" role="status">
          <span className="wp-arrow" aria-hidden style={{ transform: `rotate(${Math.round(state.bearing)}deg)` }}>
            ↑
          </span>
          <div>
            <b>{ctx.t(W.away, { distance: distanceText(state.metres, (n, o) => ctx.format.number(n, o)), direction: ctx.t(COMPASS_WORDS[compass(state.bearing)]) })}</b>
            <span>{ctx.format.date(ctx.now(), { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      ) : state.kind === "near" ? (
        <p className="wp-meter" role="status">
          {ctx.t(W.here)}
        </p>
      ) : state.kind === "lost" ? (
        <p className="wp-sub" role="status">
          {ctx.t(W.cannotLocate)}
        </p>
      ) : null}
      <button type="button" className="wp-primary" disabled={state.kind === "busy"} onClick={() => void find()}>
        {state.kind === "busy" ? ctx.t(W.locating) : ctx.t(label)}
      </button>
    </>
  );
}

function Park({ runtime }: ViewProps) {
  const ctx = runtime.ctx;
  const { rows, loading } = runtime.useQuery("spot");
  const [parking, setParking] = useState(false);
  if (loading) return <p className="wp-wait">…</p>;
  const spot = currentSpot(rows);

  if (!spot) {
    const park = async () => {
      setParking(true);
      try {
        await parkHere(ctx);
      } finally {
        setParking(false);
      }
    };
    return (
      <div className="wp">
        <style>{CSS}</style>
        <div className="wp-empty">
          <button type="button" className="wp-big" style={{ color: "#fff", fontSize: "1.5rem", fontWeight: 800 }} disabled={parking} onClick={() => void park()}>
            <span>
              <span className="wp-car" aria-hidden>
                🚗
              </span>
              <span>{parking ? ctx.t(W.locating) : ctx.t(W.parkHere)}</span>
            </span>
          </button>
          <p className="wp-hint">{ctx.t(W.parkHint)}</p>
        </div>
      </div>
    );
  }

  const at = asDate(spot.at);
  const meter = asDate(spot.meter);
  const over = meter ? meter.getTime() <= ctx.now().getTime() : false;
  const loc = point(spot.location);
  return (
    <div className="wp">
      <style>{CSS}</style>
      <section className="wp-card" aria-label={ctx.t(W.spot)}>
        <p className="wp-when">{at ? ctx.t(W.parkedAgo, { when: ctx.format.relative(at) }) : ctx.t(W.spot)}</p>
        {at ? <p className="wp-sub">{ctx.t(W.parkedAt, { time: ctx.format.date(at, { weekday: "short", hour: "2-digit", minute: "2-digit" }) })}</p> : null}
        {spot.note ? <p className="wp-note">{String(spot.note)}</p> : null}
        {spot.photo ? <Photo photo={spot.photo as MediaRef} ctx={ctx} alt={ctx.t(W.photo)} /> : null}
        {meter ? (
          <p className="wp-meter" data-over={over}>
            {ctx.t(over ? W.meterOver : W.meterEnds, { when: ctx.format.relative(meter) })}
          </p>
        ) : null}
        <FindCar spot={spot} ctx={ctx} />
        <div className="wp-row">
          {loc ? (
            <a className="wp-btn" href={mapUrl(loc)} target="_blank" rel="noopener noreferrer">
              🗺️ {ctx.t(W.openMap)}
            </a>
          ) : null}
          <button type="button" className="wp-btn wp-found" onClick={() => void foundIt(spot, ctx)}>
            ✓ {ctx.t(W.found)}
          </button>
        </div>
      </section>
      <div className="wp-row">
        <button type="button" className="wp-btn" onClick={() => void addNote(spot, ctx)}>
          ✎ {ctx.t(spot.note ? W.editNote : W.addNote)}
        </button>
        <button type="button" className="wp-btn" onClick={() => void addPhoto(spot, ctx)}>
          📷 {ctx.t(W.addPhoto)}
        </button>
        <button type="button" className="wp-btn" onClick={() => void setMeter(spot, ctx)}>
          ⏱ {ctx.t(W.setMeter)}
        </button>
      </div>
    </div>
  );
}

export default defineApp({
  id: "where-i-parked",
  name: W.appName,
  icon: "🚗",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: [...LANGS],
  theme: { accent: "#2f6fed" },
  nav: "tabs",
  category: "everyday",
  permissions: { geo: true, camera: true, haptics: true },
  demo,
  tile: async (ctx) => {
    const spot = currentSpot(await ctx.query("spot"));
    if (!spot) return { title: W.tileNone };
    const at = asDate(spot.at);
    return {
      count: 1,
      title: ctx.t(W.tileParked, { when: at ? ctx.format.relative(at) : "" }),
      lines: [spot.note ? String(spot.note) : ""].filter(Boolean),
      ...(spot.photo ? { image: spot.photo as MediaRef } : {}),
    };
  },
  entities: {
    spot: {
      label: W.spot,
      icon: "🚗",
      displayField: "note",
      fields: {
        location: { type: "geo", label: W.location },
        at: { type: "datetime", precision: "minute", required: true, default: (ctx: Ctx) => ctx.now(), label: W.at },
        note: { type: "text", label: W.note, placeholder: "Level 3, near the lift" },
        photo: { type: "media", accept: "image", label: W.photo },
        meter: { type: "datetime", precision: "minute", label: W.meter },
        found: { type: "datetime", precision: "minute", label: W.foundAt },
      },
      actions: {
        found: { label: W.found, icon: "✓", run: foundIt },
      },
    },
  },
  pages: [
    { id: "park", title: W.park, icon: "🚗", view: { type: "custom", entity: "spot", render: (props) => <Park {...props} /> } },
    {
      id: "map",
      title: W.map,
      icon: "🗺️",
      view: {
        type: "map",
        entity: "spot",
        geo: "location",
        filter: (s) => !s.found,
        display: { icon: () => "🚗", primary: (s, ctx) => (s.note ? String(s.note) : ctx.t(W.spot)), secondary: (s, ctx) => (s.at ? ctx.format.relative(String(s.at)) : "") },
      },
    },
    {
      id: "history",
      title: W.history,
      icon: "🕓",
      view: {
        type: "list",
        entity: "spot",
        filter: (s) => Boolean(s.found),
        sort: (a, b) => String(b.at).localeCompare(String(a.at)),
        display: {
          lead: "icon",
          primary: (s, ctx) => (s.note ? String(s.note) : ctx.format.date(String(s.at), { day: "numeric", month: "short" })),
          secondary: (s, ctx) => ctx.format.date(String(s.at), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
          media: "photo",
        },
        emptyText: W.historyEmpty,
      },
    },
  ],
});
