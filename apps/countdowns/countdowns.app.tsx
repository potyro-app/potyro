// Countdowns — days until each thing that matters. The nearest one is the whole top of the screen:
// one big number, "days until Lisbon trip", the date. The rest follow as a short list, soonest
// first, and what has passed is folded away underneath. Adding is one short form: what, when, an
// emoji if you like. The launcher tile shows the next one and how many fall in the coming week.
//
// Days are counted as whole calendar days in the person's own time zone (dates.ts), so "tomorrow"
// reads 1 all day and only turns at midnight. Where the device lets apps remind people
// (`ctx.caps.notifications`), an event added here rings at nine on its morning — nothing in the app
// needs it. The demo writes its four events relative to today, so it is never stale.
//
// In six languages (#303), in words.ts.
import { defineApp } from "potyro";
import type { Ctx, Resolved, ViewProps } from "potyro";
import { useState } from "react";
import { dayKey, daysFromNow, daysLeft, morningOf, split } from "./dates.js";
import { W } from "./words.js";

const WEEK = 7;

// ---- what the app does ----

/** One short form, then the countdown starts. A reminder for the morning where the device offers one. */
async function addEvent(ctx: Ctx): Promise<void> {
  const answer = await ctx.ui.form<{ title: string; date: string; icon?: string }>({
    title: ctx.t(W.add),
    fields: {
      title: { type: "text", required: true, label: ctx.t(W.fTitle), placeholder: ctx.t(W.fTitlePlaceholder) },
      date: { type: "datetime", precision: "day", required: true, label: ctx.t(W.fDate) },
      icon: { type: "text", label: ctx.t(W.fIcon), help: ctx.t(W.fIconHelp) },
    },
    initial: { date: dayKey(ctx.today()) },
    submit: ctx.t(W.save),
  });
  if (!answer) return;
  const event = await ctx.create("event", { title: answer.title.trim(), date: answer.date, icon: (answer.icon ?? "").trim().slice(0, 4) });
  ctx.ui.toast(ctx.t(W.added, { title: String(event.title) }));
  await remind(event, ctx);
}

/** Nine on the morning of the day, when the device can do that; silently nothing where it cannot. */
async function remind(event: Resolved, ctx: Ctx): Promise<void> {
  const at = morningOf(event.date);
  if (!ctx.caps.notifications || !at || at.getTime() <= ctx.now().getTime()) return;
  await ctx.caps.notifications.schedule({ id: `event:${event.id}`, at, title: ctx.t(W.reminderTitle, { title: String(event.title) }) }).catch(() => undefined);
}

/** Four events around today — a trip, a birthday, an exam, one that has passed — so a demo is never empty or stale. */
async function playDemo(ctx: Ctx): Promise<void> {
  const today = ctx.today();
  const rows = [
    { title: ctx.t(W.demoTrip), icon: "✈️", date: daysFromNow(today, 12) },
    { title: ctx.t(W.demoBirthday), icon: "🎂", date: daysFromNow(today, 33) },
    { title: ctx.t(W.demoExam), icon: "🚗", date: daysFromNow(today, 61) },
    { title: ctx.t(W.demoPast), icon: "🏠", date: daysFromNow(today, -18) },
  ];
  for (const row of rows) await ctx.create("event", row);
}

// ---- the screen ----

const CSS = `
.cd { display: grid; gap: var(--space-4, 1rem); padding: 0 var(--space-2, 0.5rem) calc(var(--space-6, 2rem) + var(--k-chrome-bottom, 0px)); }
.cd * { box-sizing: border-box; }
.cd button { touch-action: manipulation; font: inherit; color: inherit; cursor: pointer; }
.cd-hero { position: relative; display: grid; justify-items: center; text-align: center; gap: 0.15rem; padding: var(--space-6, 2rem) var(--space-4, 1rem) var(--space-5, 1.5rem); border-radius: var(--radius-lg, 22px); background: radial-gradient(120% 70% at 50% 115%, color-mix(in oklab, var(--accent, #d9622b) 13%, transparent), transparent 70%), var(--surface-raised, var(--surface, #fff)); border: 1px solid var(--line, #e2dcd2); box-shadow: var(--shadow, 0 10px 30px oklch(20% 0.02 60 / 0.08)); overflow: hidden; }
.cd-hero-icon { font-size: 2.4rem; line-height: 1; margin-bottom: 0.4rem; }
.cd-hero-n { font-family: var(--font-display, Georgia, serif); font-weight: 700; font-size: clamp(5.5rem, 34vw, 9rem); line-height: 0.9; letter-spacing: -0.04em; color: var(--accent, #d9622b); font-variant-numeric: tabular-nums; }
.cd-hero-n[data-today="true"] { font-size: clamp(3.4rem, 20vw, 5.5rem); line-height: 1.05; }
.cd-hero-unit { font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.18em; color: var(--ink-soft, #7a7067); margin-top: 0.5rem; }
.cd-hero-title { font-family: var(--font-display, Georgia, serif); font-size: 1.55rem; line-height: 1.2; margin-top: 0.35rem; max-width: 20ch; text-wrap: balance; }
.cd-hero-date { color: var(--ink-soft, #7a7067); margin-top: 0.2rem; }
.cd-hero-open { position: absolute; inset: 0; opacity: 0; border: 0; background: transparent; }
.cd-h { margin: var(--space-2, 0.5rem) var(--space-2, 0.5rem) 0; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft, #7a7067); }
.cd-list { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.cd-row { display: grid; grid-template-columns: 2.4rem 1fr auto; align-items: center; gap: 0.7rem; width: 100%; padding: 0.7rem 0.9rem; border-radius: var(--radius, 14px); background: var(--surface, #fff); border: 1px solid var(--line, #e2dcd2); text-align: left; }
.cd-row:active { transform: scale(0.99); }
.cd-row-icon { font-size: 1.5rem; line-height: 1; text-align: center; }
.cd-row-icon[data-blank="true"] { width: 2.2rem; height: 2.2rem; border-radius: 999px; background: color-mix(in oklab, var(--accent, #d9622b) 14%, transparent); }
.cd-row-title { font-weight: 600; line-height: 1.25; }
.cd-row-date { font-size: 0.85rem; color: var(--ink-soft, #7a7067); }
.cd-row-n { font-family: var(--font-display, Georgia, serif); font-size: 1.5rem; font-weight: 700; line-height: 1; color: var(--accent, #d9622b); font-variant-numeric: tabular-nums; text-align: right; }
.cd-row-n small { display: block; font-family: var(--font-ui, system-ui, sans-serif); font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft, #7a7067); margin-top: 0.2rem; }
.cd-row[data-past="true"] { opacity: 0.72; }
.cd-row[data-past="true"] .cd-row-n { color: var(--ink-soft, #7a7067); }
.cd-fold { display: flex; align-items: center; justify-content: space-between; gap: 1rem; width: 100%; padding: 0.6rem 0.9rem; border: 0; border-radius: var(--radius, 14px); background: transparent; color: var(--ink-soft, #7a7067); font-weight: 600; }
.cd-empty { display: grid; justify-items: center; gap: 0.6rem; padding: var(--space-6, 2rem) var(--space-4, 1rem); text-align: center; }
.cd-empty-icon { font-size: 3rem; line-height: 1; }
.cd-empty h2 { margin: 0; font-family: var(--font-display, Georgia, serif); font-size: 1.5rem; }
.cd-empty p { margin: 0; color: var(--ink-soft, #7a7067); max-width: 28ch; }
.cd-empty button { margin-top: 0.4rem; padding: 0.75rem 1.3rem; border: 0; border-radius: 999px; background: var(--accent, #d9622b); color: var(--on-accent, #fff); font-weight: 700; }
`;

function Soon({ runtime, navigate }: ViewProps) {
  const ctx = runtime.ctx;
  const { rows, loading } = runtime.useQuery("event");
  const [showPast, setShowPast] = useState(false);
  const today = ctx.today();
  const { upcoming, past } = split(rows, today);
  const [hero, ...rest] = upcoming;
  const dateOf = (r: Resolved) => ctx.format.date(new Date(String(r.date)), { weekday: "short", day: "numeric", month: "short" });
  const open = (r: Resolved) => navigate("event", { eventId: String(r.id) });
  const row = (r: Resolved & { left: number }) => (
    <li key={String(r.id)}>
      <button type="button" className="cd-row" data-past={r.left < 0} onClick={() => open(r)}>
        <span className="cd-row-icon" data-blank={!r.icon} aria-hidden>
          {String(r.icon ?? "")}
        </span>
        <span>
          <div className="cd-row-title">{String(r.title)}</div>
          <div className="cd-row-date">{dateOf(r)}</div>
        </span>
        <span className="cd-row-n">
          {r.left === 0 ? "" : Math.abs(r.left)}
          <small>{r.left === 0 ? ctx.t(W.today) : r.left < 0 ? ctx.t(W.ago) : ctx.t(W.days, { n: r.left })}</small>
        </span>
      </button>
    </li>
  );

  if (loading) return null;
  return (
    <div className="cd">
      <style>{CSS}</style>
      {hero ? (
        <section className="cd-hero" aria-label={ctx.t(W.soon)}>
          {hero.icon ? (
            <div className="cd-hero-icon" aria-hidden>
              {String(hero.icon)}
            </div>
          ) : null}
          {hero.left === 0 ? (
            <>
              <div className="cd-hero-n" data-today="true">
                {ctx.t(W.today)}
              </div>
              <h2 className="cd-hero-title">{ctx.t(W.isToday, { title: String(hero.title) })}</h2>
            </>
          ) : (
            <>
              <div className="cd-hero-n">{hero.left}</div>
              <div className="cd-hero-unit">{ctx.t(W.days, { n: hero.left })}</div>
              <h2 className="cd-hero-title">{ctx.t(W.until, { title: String(hero.title) })}</h2>
            </>
          )}
          <div className="cd-hero-date">{dateOf(hero)}</div>
          <button type="button" className="cd-hero-open" aria-label={String(hero.title)} onClick={() => open(hero)} />
        </section>
      ) : (
        <div className="cd-empty">
          <div className="cd-empty-icon" aria-hidden>
            🗓️
          </div>
          <h2>{ctx.t(W.emptyTitle)}</h2>
          <p>{ctx.t(W.emptyBody)}</p>
          <button type="button" onClick={() => void addEvent(ctx)}>
            {ctx.t(W.add)}
          </button>
        </div>
      )}
      {rest.length ? (
        <>
          <h3 className="cd-h">{ctx.t(W.upNext)}</h3>
          <ul className="cd-list">{rest.map(row)}</ul>
        </>
      ) : null}
      {past.length ? (
        <>
          <button type="button" className="cd-fold" aria-expanded={showPast} onClick={() => setShowPast((s) => !s)}>
            <span>{ctx.t(W.past, { n: past.length })}</span>
            <span>{showPast ? ctx.t(W.hide) : ctx.t(W.show)}</span>
          </button>
          {showPast ? <ul className="cd-list">{past.map(row)}</ul> : null}
        </>
      ) : null}
    </div>
  );
}

// ---- the app ----

export default defineApp({
  id: "countdowns",
  name: W.appName,
  icon: "⏳",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#d9622b" },
  permissions: { notifications: true },
  demo: playDemo,
  tile: async (ctx) => {
    const { upcoming } = split(await ctx.query("event"), ctx.today());
    const next = upcoming[0];
    if (!next) return { title: ctx.t(W.tileNone) };
    return {
      count: upcoming.filter((e) => e.left <= WEEK).length,
      title: ctx.t(W.tileTitle, { n: next.left, title: String(next.title) }),
      lines: upcoming.slice(1, 4).map((e) => `${e.icon ? `${String(e.icon)} ` : ""}${String(e.title)} · ${ctx.t(W.inDays, { n: e.left })}`),
    };
  },
  entities: {
    event: {
      label: W.event,
      icon: "⏳",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: W.fTitle },
        date: { type: "datetime", precision: "day", required: true, label: W.fDate },
        icon: { type: "text", label: W.fIcon, help: W.fIconHelp },
        note: { type: "text", multiline: true, label: W.fNote },
      },
      computed: {
        daysLeft: { value: (e, ctx) => daysLeft(e.date, ctx.today()) ?? 0, label: W.days },
      },
    },
  },
  pages: [
    {
      id: "soon",
      title: W.soon,
      icon: "⏳",
      actions: [{ label: W.add, icon: "＋", run: addEvent }],
      add: 0,
      view: { type: "custom", entity: "event", render: (props) => <Soon {...props} /> },
    },
    {
      id: "event",
      title: W.event,
      hidden: true,
      view: { type: "detail", entity: "event", param: "eventId", facts: ["daysLeft"] },
    },
  ],
});
