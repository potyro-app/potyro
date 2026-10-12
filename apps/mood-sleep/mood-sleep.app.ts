// How did you sleep? — a morning check-in (hours slept, mood 1–5, what the day had, a note) and a
// Patterns screen that charts it with chart.js, imported by URL (#266). The shell fetches chart.js
// once, when the app is added, and runs it from the copy it keeps: no network after that.
//
// The chart screen draws on a <canvas> with a library that needs a real web page, so this app runs
// as your own (trusted) app only. The numbers and the sentence on top are worked out in insights.ts,
// in plain functions the tests run without a browser.
import { defineApp } from "potyro";
import type { Ctx, Field, Resolved, ViewProps } from "potyro";
import { Chart, registerables } from "https://esm.sh/chart.js@4.5.1?bundle";
import type { ChartConfiguration, ChartDataset, Plugin, ScatterDataPoint, TooltipItem } from "https://esm.sh/chart.js@4.5.1?bundle";
import {
  dailySeries,
  dayKey,
  hoursText,
  insights,
  lastDays,
  LONG,
  monthDay,
  MOOD_FACES,
  MOOD_WORDS,
  one,
  scatterGroups,
  shortDay,
  stats,
  TAGS,
  toNights,
  trend,
  type CheckinRow,
  type Insight,
  type Night,
} from "./insights.js";
import { STYLES } from "./styles.js";

// ---- colour: the shell's tokens, resolved to something a canvas can paint ----

/** Any CSS colour (the tokens are oklch) as an [r, g, b, a] a canvas understands everywhere. */
function rgba(css: string, fallback: string): [number, number, number, number] {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = fallback;
  g.fillStyle = css; // an unknown colour is ignored, leaving the fallback
  g.fillRect(0, 0, 1, 1);
  const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data;
  return [r!, gg!, b!, a! / 255];
}
const css = ([r, g, b, a]: [number, number, number, number], alpha = a) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** A colour per tag, a light and a dark variant: readable on either paper. */
const TAG_COLORS: Record<string, [string, string]> = {
  exercise: ["#2f9e6b", "#5fd39b"],
  coffee: ["#a0622d", "#e0a76e"],
  alcohol: ["#b0457a", "#ee86ba"],
  "late screen": ["#3d6fd9", "#86b2ff"],
  nap: ["#11a0a0", "#5ad8d8"],
  stressed: ["#d4483d", "#ff8073"],
};
const EXTRA_TAG = ["#8a6d3b", "#d1b37a"] as [string, string];

interface Palette {
  dark: boolean;
  ink: string;
  soft: string;
  faint: string;
  line: string;
  surface: string;
  raised: string;
  sleep: [number, number, number, number];
  mood: [number, number, number, number];
  font: string;
  display: string;
  tag(tag: string): string;
}

function palette(el: HTMLElement): Palette {
  const s = getComputedStyle(el);
  const token = (name: string) => s.getPropertyValue(name).trim();
  const surface = rgba(token("--surface"), "#fffdf8");
  const dark = (surface[0] * 299 + surface[1] * 587 + surface[2] * 114) / 1000 < 128;
  const pick = (pair: [string, string]) => (dark ? pair[1] : pair[0]);
  return {
    dark,
    ink: css(rgba(token("--ink"), "#2b241e")),
    soft: css(rgba(token("--ink-soft"), "#6b6158")),
    faint: css(rgba(token("--ink-faint"), "#8d847b")),
    line: css(rgba(token("--line"), "#e4ddd3")),
    surface: css(surface),
    raised: css(rgba(token("--surface-raised"), "#ffffff")),
    sleep: rgba(token("--accent"), "#7c6cf0"),
    mood: rgba(dark ? "#ffa25c" : "#e8833a", "#e8833a"),
    font: token("--font-ui") || "system-ui, sans-serif",
    display: token("--font-display") || "Georgia, serif",
    tag: (tag) => css(rgba(pick(TAG_COLORS[tag] ?? EXTRA_TAG), "#888")),
  };
}

// ---- small DOM helpers: text goes in as text, never as markup ----

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

function sentence(i: Insight): Array<Node | string> {
  return i.parts.map((p) => (typeof p === "string" ? p : h("b", { "data-series": p.series }, p.value)));
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// ---- the two charts ----

/** Ticks on whole numbers only, whatever padding the axis has: hours and mood faces sit on integers. */
const wholeTicks = (axis: { min: number; max: number; ticks: Array<{ value: number }> }) => {
  axis.ticks = [];
  for (let v = Math.ceil(axis.min); v <= Math.floor(axis.max); v++) axis.ticks.push({ value: v });
};

/** A dashed rule at LONG hours on the sleep axis: the line the sentence on top talks about. */
const goalLine = (pal: () => Palette): Plugin<"line"> => ({
  id: "ms-goal",
  afterDatasetsDraw(chart) {
    const y = chart.scales.yS;
    if (!y) return;
    const at = y.getPixelForValue(LONG);
    const { left, right } = chart.chartArea;
    const g = chart.ctx;
    const p = pal();
    g.save();
    g.setLineDash([4, 5]);
    g.strokeStyle = css(p.sleep, 0.55);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(left, at);
    g.lineTo(right, at);
    g.stroke();
    g.setLineDash([]);
    // The label sits on a small pill of the card's colour, so a line passing under it cannot hide it.
    const label = `${LONG}h goal`;
    g.font = `600 11px ${p.font}`;
    const w = g.measureText(label).width + 10;
    g.fillStyle = p.surface;
    g.beginPath();
    g.roundRect(left + 4, at - 9, w, 18, 9);
    g.fill();
    g.strokeStyle = css(p.sleep, 0.35);
    g.stroke();
    g.fillStyle = css(p.sleep);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(label, left + 9, at);
    g.restore();
  },
});

function tooltipStyle(p: Palette) {
  return {
    backgroundColor: p.raised,
    borderColor: p.line,
    borderWidth: 1,
    titleColor: p.ink,
    bodyColor: p.soft,
    footerColor: p.faint,
    titleFont: { family: p.display, size: 14, weight: 600 as const },
    bodyFont: { family: p.font, size: 12 },
    footerFont: { family: p.font, size: 11, style: "italic" as const, weight: 400 as const },
    padding: 10,
    cornerRadius: 10,
    boxPadding: 4,
    usePointStyle: true,
    caretSize: 0,
  };
}

function lineConfig(w: { days: string[] }, series: ReturnType<typeof dailySeries>, notes: Map<string, Night>, pal: () => Palette): ChartConfiguration<"line"> {
  const p = pal();
  return {
    type: "line",
    data: {
      labels: w.days,
      datasets: [
        {
          label: "Sleep",
          data: series.hours,
          yAxisID: "yS",
          borderColor: css(p.sleep),
          borderWidth: 2.5,
          tension: 0.38,
          cubicInterpolationMode: "monotone",
          spanGaps: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: css(p.sleep),
          fill: "origin",
          backgroundColor: (c) => {
            const area = c.chart.chartArea;
            const q = pal();
            if (!area) return css(q.sleep, 0.15);
            const grad = c.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            grad.addColorStop(0, css(q.sleep, q.dark ? 0.38 : 0.26));
            grad.addColorStop(1, css(q.sleep, 0));
            return grad;
          },
        },
        {
          label: "Mood",
          data: series.mood,
          yAxisID: "yM",
          borderColor: css(p.mood),
          borderWidth: 2,
          tension: 0.3,
          cubicInterpolationMode: "monotone",
          spanGaps: true,
          pointRadius: 3.5,
          pointHoverRadius: 6,
          pointBorderWidth: 2,
          pointBackgroundColor: p.surface,
          pointBorderColor: css(p.mood),
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 700, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 6 } },
      scales: {
        x: {
          grid: { display: false },
          border: { color: p.line },
          ticks: { color: p.faint, font: { family: p.font, size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, callback: (_v, i) => shortDay(w.days[i] ?? "") },
        },
        yS: {
          position: "left",
          min: 3,
          max: 10,
          grid: { color: p.line, drawTicks: false },
          border: { display: false },
          ticks: { color: css(p.sleep), font: { family: p.font, size: 11, weight: 600 }, stepSize: 1, padding: 6, callback: (v) => `${v}h` },
        },
        yM: {
          position: "right",
          min: 0.5,
          max: 5.5,
          grid: { display: false },
          border: { display: false },
          afterBuildTicks: wholeTicks,
          ticks: { color: css(p.mood), font: { family: p.font, size: 13 }, padding: 6, callback: (v) => MOOD_FACES[Number(v)] ?? "" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(p),
          callbacks: {
            title: (items: TooltipItem<"line">[]) => {
              const d = w.days[items[0]?.dataIndex ?? 0] ?? "";
              return `${shortDay(d).split(" ")[0]} ${monthDay(d)}`;
            },
            label: (it: TooltipItem<"line">) => {
              const v = it.parsed.y;
              if (v == null) return "";
              return it.dataset.label === "Sleep" ? `Slept ${hoursText(v)}` : `Mood ${v} · ${MOOD_WORDS[v] ?? ""} ${MOOD_FACES[v] ?? ""}`;
            },
            footer: (items: TooltipItem<"line">[]) => notes.get(w.days[items[0]?.dataIndex ?? 0] ?? "")?.note || "",
          },
        },
      },
    },
    plugins: [goalLine(pal)],
  };
}

type Pt = ScatterDataPoint & { day?: string; note?: string };

function scatterConfig(nights: Night[], pal: () => Palette): ChartConfiguration<"scatter", Pt[]> {
  const p = pal();
  const groups = scatterGroups(nights);
  const line = trend(nights);
  const hours = nights.map((n) => n.hours).filter((x): x is number => x != null);
  const lo = Math.floor(Math.min(4.5, ...hours) * 2) / 2 - 0.25;
  const hi = Math.ceil(Math.max(9, ...hours) * 2) / 2 + 0.25;
  return {
    type: "scatter",
    data: {
      datasets: [
        ...groups.map((g) => {
          const color = g.tag ? p.tag(g.tag) : p.faint;
          return {
            label: g.tag || "nothing tagged",
            data: g.points as Pt[],
            backgroundColor: color.replace(/[\d.]+\)$/, "0.72)"),
            borderColor: p.surface,
            borderWidth: 1.5,
            pointRadius: 6.5,
            pointHoverRadius: 9,
            pointHoverBorderWidth: 2,
          };
        }),
        ...(line
          ? [
              {
                label: "trend",
                type: "line" as const,
                data: [line.from, line.to] as Pt[],
                borderColor: p.soft,
                borderWidth: 1.5,
                borderDash: [6, 6],
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                order: 10,
              } as unknown as ChartDataset<"scatter", Pt[]>,
            ]
          : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 600, easing: "easeOutBack" },
      scales: {
        x: {
          min: lo,
          max: hi,
          title: { display: true, text: "hours slept", color: css(p.sleep), font: { family: p.font, size: 11, weight: 600 } },
          grid: { color: p.line, drawTicks: false },
          border: { display: false },
          afterBuildTicks: wholeTicks,
          ticks: { color: p.faint, font: { family: p.font, size: 11 }, padding: 6, callback: (v) => `${v}h` },
        },
        y: {
          min: 0.5,
          max: 5.5,
          title: { display: true, text: "mood", color: css(p.mood), font: { family: p.font, size: 11, weight: 600 } },
          grid: { color: p.line, drawTicks: false },
          border: { display: false },
          afterBuildTicks: wholeTicks,
          ticks: { color: p.ink, font: { family: p.font, size: 14 }, padding: 6, callback: (v) => MOOD_FACES[Number(v)] ?? "" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(p),
          filter: (it) => it.dataset.label !== "trend",
          callbacks: {
            title: (items) => {
              const d = (items[0]?.raw as Pt | undefined)?.day;
              return d ? `${shortDay(d).split(" ")[0]} ${monthDay(d)}` : "";
            },
            label: (it) => {
              const pt = it.raw as Pt;
              const mood = Math.round(Number(pt.y));
              return `${hoursText(Number(pt.x))} · mood ${mood} ${MOOD_FACES[mood] ?? ""}`;
            },
            footer: (items) => (items[0]?.raw as Pt | undefined)?.note || "",
          },
        },
      },
    },
  };
}

// ---- the Patterns screen ----

function rowsToCheckins(rows: Resolved[]): CheckinRow[] {
  return rows.map((r) => ({ id: String(r.id), date: r.date as string | Date, hours: r.hours as number, mood: r.mood as number, note: r.note as string, tags: r.tags as string[] }));
}

async function logNight(ctx: Ctx): Promise<void> {
  const answer = await ctx.ui.form<{ date: string; hours: number; mood: number; tags?: string[]; note?: string }>({
    title: "How did you sleep?",
    fields: FIELDS,
    initial: { date: dayKey(ctx.today()), hours: 7, mood: 3 },
    submit: "Save",
  });
  if (!answer) return;
  await ctx.create("checkin", answer);
  ctx.ui.toast(`Logged ${hoursText(answer.hours)} · ${MOOD_FACES[answer.mood] ?? ""}`);
}

function mountPatterns(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  Chart.register(...registerables);

  const style = h("style", {}, STYLES);
  const root = h("div", { class: "ms" });
  el.append(style, root);

  let pal = palette(el);
  const current = () => pal;
  const applyVars = () => {
    root.style.setProperty("--ms-sleep", css(pal.sleep));
    root.style.setProperty("--ms-mood", css(pal.mood));
  };
  applyVars();

  // Hero
  const kicker = h("p", { class: "ms-kicker" });
  const insight = h("h2", { class: "ms-insight", "aria-live": "polite" });
  const also = h("p", { class: "ms-also" });
  const statsEl = h("dl", { class: "ms-stats" });
  const log = h("button", { class: "ms-log", type: "button" }, "🌙  Log last night");
  log.addEventListener("click", () => void logNight(ctx));
  root.append(h("header", { class: "ms-hero" }, h("div", { class: "ms-moon", "aria-hidden": "true" }), kicker, insight, also, statsEl, log));

  // Night by night
  const lineCanvas = h("canvas", { role: "img", "aria-label": "Hours slept and mood for each day, up to the last 30" });
  const lineCard = h(
    "section",
    { class: "ms-card ms-line", "aria-labelledby": "ms-line-title" },
    h(
      "div",
      { class: "ms-card-head" },
      h("div", {}, h("h3", { id: "ms-line-title" }, "Night by night"), h("p", { class: "ms-sub" }, "Sleep on the left, mood on the right")),
      h("ul", { class: "ms-legend" }, h("li", {}, h("i", { class: "sleep" }), "Sleep"), h("li", {}, h("i", { class: "mood" }), "Mood")),
    ),
    h("div", { class: "ms-plot" }, lineCanvas),
  );

  // Sleep vs mood
  const scatterCanvas = h("canvas", { role: "img", "aria-label": "Each night as a dot: hours slept across, mood up, coloured by what the day had" });
  const chips = h("div", { class: "ms-chips", role: "group", "aria-label": "Show nights by tag" });
  const scatterCard = h(
    "section",
    { class: "ms-card ms-scatter", "aria-labelledby": "ms-scatter-title" },
    h("div", { class: "ms-card-head" }, h("div", {}, h("h3", { id: "ms-scatter-title" }, "Does a long night lift the day?"), h("p", { class: "ms-sub" }, "Every dot is a night, coloured by what the day had"))),
    chips,
    h("div", { class: "ms-plot" }, scatterCanvas),
    h("p", { class: "ms-foot" }, "The dashed line is the trend: the steeper it climbs, the more sleep shows in your mood."),
  );
  root.append(lineCard, scatterCard);

  let lineChart: Chart<"line"> | null = null;
  let scatterChart: Chart<"scatter", Pt[]> | null = null;
  let all: Night[] = [];
  const hidden = new Set<string>();

  const renderText = (w: { nights: Night[]; days: string[] }) => {
    const said = insights(w.nights);
    insight.replaceChildren(...sentence(said[0]!));
    also.hidden = !said[1];
    also.replaceChildren(...(said[1] ? sentence(said[1]) : []));
    const last = w.days[w.days.length - 1];
    const first = w.days[0];
    kicker.textContent = last && first ? `${w.nights.length} check-in${w.nights.length === 1 ? "" : "s"} · ${first === last ? monthDay(last) : `${monthDay(first)} – ${monthDay(last)}`}` : "Your nights";
    const s = stats(w.nights);
    const stat = (label: string, value: string, unit = "") => h("div", {}, h("dt", {}, label), h("dd", {}, value, ...(unit ? [h("small", {}, unit)] : [])));
    statsEl.replaceChildren(
      stat("Average sleep", s.avgHours == null ? "–" : one(s.avgHours), "h"),
      stat("Average mood", s.avgMood == null ? "–" : one(s.avgMood), s.avgMood == null ? "" : (MOOD_FACES[Math.round(s.avgMood)] ?? "")),
      stat(`Nights ≥ ${LONG}h`, s.longShare == null ? "–" : String(Math.round(s.longShare * 100)), "%"),
    );
  };

  const renderChips = () => {
    const groups = scatterChart ? scatterChart.data.datasets.filter((d) => d.label !== "trend") : [];
    chips.replaceChildren(
      ...groups.map((d) => {
        const label = d.label ?? "";
        const b = h("button", { class: "ms-chip", type: "button", "aria-pressed": String(!hidden.has(label)) }, label);
        b.style.setProperty("--chip", label === "nothing tagged" ? pal.faint : pal.tag(label));
        b.addEventListener("click", () => {
          if (hidden.has(label)) hidden.delete(label);
          else hidden.add(label);
          b.setAttribute("aria-pressed", String(!hidden.has(label)));
          applyHidden();
          scatterChart?.update();
        });
        return b;
      }),
    );
  };
  const applyHidden = () => {
    scatterChart?.data.datasets.forEach((d, i) => scatterChart!.setDatasetVisibility(i, !hidden.has(d.label ?? "")));
  };

  const render = () => {
    const w = lastDays(all);
    renderText(w);
    root.classList.toggle("ms-empty", w.nights.length === 0);
    lineCard.hidden = scatterCard.hidden = w.nights.length === 0;
    if (!w.nights.length) return;
    const byDay = new Map(w.nights.map((n) => [n.day, n]));
    lineChart?.destroy();
    scatterChart?.destroy();
    lineChart = new Chart(lineCanvas, lineConfig(w, dailySeries(w), byDay, current));
    scatterChart = new Chart(scatterCanvas, scatterConfig(w.nights, current));
    applyHidden();
    scatterChart.update("none");
    renderChips();
  };

  // Live: a check-in added from the form, the list or another device redraws the screen.
  const stop = props.runtime.watchQuery("checkin", undefined, ({ rows, loading }) => {
    if (loading) return;
    all = toNights(rowsToCheckins(rows));
    render();
  });

  // Light or dark: the shell flips `data-theme` on <html>, or the system flips the scheme.
  const retheme = () => {
    const next = palette(el);
    if (next.dark === pal.dark && css(next.sleep) === css(pal.sleep)) return;
    pal = next;
    applyVars();
    render();
  };
  const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  scheme?.addEventListener("change", retheme);
  const watchTheme = new MutationObserver(retheme);
  watchTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });

  return () => {
    stop();
    scheme?.removeEventListener("change", retheme);
    watchTheme.disconnect();
    lineChart?.destroy();
    scatterChart?.destroy();
    root.remove();
    style.remove();
  };
}

// ---- the app ----

const FIELDS: Record<"date" | "hours" | "mood" | "tags" | "note", Field> = {
  date: { type: "datetime", label: "Date", required: true, help: "The morning you are checking in" },
  hours: { type: "number", label: "Hours slept", required: true, min: 0, max: 14, step: 0.25, unit: "h", width: "half" },
  mood: { type: "number", label: "Mood", required: true, integer: true, min: 1, max: 5, step: 1, help: "1 rough · 3 okay · 5 great", width: "half" },
  tags: { type: "tags", label: "The day had", options: [...TAGS] },
  note: { type: "text", label: "A short note", placeholder: "Late dinner, woke at four…" },
};

export default defineApp({
  id: "mood-sleep",
  name: "Sleep & Mood",
  icon: "🌙",
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#7c6cf0" },
  nav: "tabs",
  quickActions: [{ id: "log", label: "Log last night", icon: "🌙", entity: "checkin", mode: "form" }],
  entities: {
    checkin: {
      label: "Check-in",
      displayField: "date",
      fields: {
        date: { ...FIELDS.date, default: (ctx: Ctx) => dayKey(ctx.today()) },
        hours: { ...FIELDS.hours, default: 7 },
        mood: { ...FIELDS.mood, default: 3 },
        tags: FIELDS.tags,
        note: FIELDS.note,
      },
      computed: {
        face: (r) => MOOD_FACES[Number(r.mood)] ?? "",
      },
    },
  },
  pages: [
    { id: "patterns", title: "Patterns", icon: "🌙", view: { type: "custom", entity: "checkin", mount: mountPatterns } },
    {
      id: "nights",
      title: "Nights",
      icon: "🛏",
      view: {
        type: "list",
        entity: "checkin",
        sort: (a, b) => (dayKey(b.date as string) < dayKey(a.date as string) ? -1 : 1),
        display: {
          primary: (r) => {
            const d = dayKey(r.date as string);
            return `${shortDay(d).split(" ")[0]} ${monthDay(d)}`;
          },
          secondary: (r) => [`${hoursText(Number(r.hours))} slept`, `${MOOD_FACES[Number(r.mood)] ?? ""} ${MOOD_WORDS[Number(r.mood)] ?? ""}`, r.note].filter(Boolean).join(" · "),
          badges: ["tags"],
        },
        emptyText: "No nights logged yet. Tap “Log last night”.",
        onOpen: { page: "night", param: { checkinId: "id" } },
      },
    },
    { id: "night", title: "Night", hidden: true, view: { type: "detail", entity: "checkin", param: "checkinId" } },
  ],
});
