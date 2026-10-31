// How did you sleep? — a morning check-in (hours slept, mood 1–5, what the day had, a note) and a
// Patterns screen that charts it with chart.js, imported by URL (#266). The shell fetches chart.js
// once, when the app is added, and runs it from the copy it keeps: no network after that.
//
// The chart screen draws on a <canvas> with a library that needs a real web page, so this app runs
// as your own (trusted) app only. The numbers and the sentence on top are worked out in insights.ts,
// in plain functions the tests run without a browser. Share draws the hero as a 1080×1350 picture on
// the night palette (card.ts) and hands it to ctx.files.export: the save dialog on a computer, the
// share sheet on a phone.
//
// In six languages (#303); every language but English is a model's draft (#297). The charts say
// their words through `ctx.t` and write dates and numbers through `ctx.format`. A check-in's note is
// a record. A tag is stored as its option ("late screen"), so a chart chip, a scatter group and
// the dataset behind it all key on that, and only what is shown is translated.
import { defineApp } from "potyro";
import type { Ctx, Field, FileInfo, Resolved, ViewProps } from "potyro";
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
  moodWord,
  MOOD_FACES,
  nightDate,
  one,
  scatterGroups,
  shortDay,
  stats,
  tagName,
  TAGS,
  toNights,
  trend,
  type CheckinRow,
  type Insight,
  type Night,
  type Say,
} from "./insights.js";
import { STYLES } from "./styles.js";
import { drawCard, type CardData } from "./card.js";

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

/** Mood's series colour, light and dark. Sleep's is the app's own colour. */
const MOOD_LIGHT = "#e8833a";
const MOOD_DARK = "#ffa25c";

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
    mood: rgba(dark ? MOOD_DARK : MOOD_LIGHT, MOOD_LIGHT),
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
const goalLine = (pal: () => Palette, say: Say): Plugin<"line"> => ({
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
    const label = say.t("{h}h goal", { h: LONG });
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

/** "7h" on an axis: the same unit as `hoursText`, for a whole number. */
const axisHours = (v: unknown, say: Say): string => hoursText(Number(v), say);

function lineConfig(w: { days: string[] }, series: ReturnType<typeof dailySeries>, notes: Map<string, Night>, pal: () => Palette, say: Say): ChartConfiguration<"line"> {
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
          ticks: { color: p.faint, font: { family: p.font, size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, callback: (_v, i) => (w.days[i] ? shortDay(w.days[i]!, say) : "") },
        },
        yS: {
          position: "left",
          min: 3,
          max: 10,
          grid: { color: p.line, drawTicks: false },
          border: { display: false },
          ticks: { color: css(p.sleep), font: { family: p.font, size: 11, weight: 600 }, stepSize: 1, padding: 6, callback: (v) => axisHours(v, say) },
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
              const d = w.days[items[0]?.dataIndex ?? 0];
              return d ? nightDate(d, say) : "";
            },
            label: (it: TooltipItem<"line">) => {
              const v = it.parsed.y;
              if (v == null) return "";
              // The dataset's own axis says which line it is; its label is only a name.
              if (it.dataset.yAxisID === "yS") {
                return say.t("Slept {h}", { h: hoursText(v, say) });
              }
              return say.t(
                "Mood {v} · {word} {face}",
                { v, word: moodWord(v, say), face: MOOD_FACES[v] ?? "" },
              );
            },
            footer: (items: TooltipItem<"line">[]) => notes.get(w.days[items[0]?.dataIndex ?? 0] ?? "")?.note || "",
          },
        },
      },
    },
    plugins: [goalLine(pal, say)],
  };
}

type Pt = ScatterDataPoint & { day?: string; note?: string };

function scatterConfig(nights: Night[], pal: () => Palette, say: Say): ChartConfiguration<"scatter", Pt[]> {
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
            // The tag as stored ("" for none): the chips and the hidden set key on it.
            label: g.tag,
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
          title: {
            display: true,
            text: say.t("hours slept"),
            color: css(p.sleep),
            font: { family: p.font, size: 11, weight: 600 },
          },
          grid: { color: p.line, drawTicks: false },
          border: { display: false },
          afterBuildTicks: wholeTicks,
          ticks: { color: p.faint, font: { family: p.font, size: 11 }, padding: 6, callback: (v) => axisHours(v, say) },
        },
        y: {
          min: 0.5,
          max: 5.5,
          title: {
            display: true,
            text: say.t("mood"),
            color: css(p.mood),
            font: { family: p.font, size: 11, weight: 600 },
          },
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
              return d ? nightDate(d, say) : "";
            },
            label: (it) => {
              const pt = it.raw as Pt;
              const mood = Math.round(Number(pt.y));
              return say.t(
                "{h} · mood {m} {face}",
                { h: hoursText(Number(pt.x), say), m: mood, face: MOOD_FACES[mood] ?? "" },
              );
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

/** The check-in form, with the entity's own fields — already in the person's language. */
async function logNight(ctx: Ctx, fields: Record<string, Field>): Promise<void> {
  const answer = await ctx.ui.form<{ date: string; hours: number; mood: number; tags?: string[]; note?: string }>({
    title: ctx.t("How did you sleep?"),
    fields,
    initial: { date: dayKey(ctx.today()), hours: 7, mood: 3 },
    submit: ctx.t("Save"),
  });
  if (!answer) return;
  await ctx.create("checkin", answer);
  ctx.ui.toast(
    ctx.t(
      "Logged {h} · {face}",
      { h: hoursText(answer.hours, ctx), face: MOOD_FACES[answer.mood] ?? "" },
    ),
  );
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
  const log = h(
    "button",
    { class: "ms-log", type: "button" },
    ctx.t("🌙  Log last night"),
  );
  log.addEventListener("click", () => void logNight(ctx, props.runtime.definition.entities.checkin!.fields as Record<string, Field>));
  // Share: the hero as a picture — the sentence, the stats and the nights — for a message or a story.
  const share = h("button", { class: "ms-share", type: "button" }, ctx.t("Share"));
  share.addEventListener("click", () => void shareCard());
  root.append(h("header", { class: "ms-hero" }, h("div", { class: "ms-moon", "aria-hidden": "true" }), kicker, insight, also, statsEl, h("div", { class: "ms-actions" }, log, share)));

  // Night by night
  const sleepWord = ctx.t("Sleep");
  const moodWordTitle = ctx.t("Mood");
  const lineCanvas = h("canvas", {
    role: "img",
    "aria-label": ctx.t("Hours slept and mood for each day, up to the last 30"),
  });
  const lineCard = h(
    "section",
    { class: "ms-card ms-line", "aria-labelledby": "ms-line-title" },
    h(
      "div",
      { class: "ms-card-head" },
      h(
        "div",
        {},
        h("h3", { id: "ms-line-title" }, ctx.t("Night by night")),
        h(
          "p",
          { class: "ms-sub" },
          ctx.t("Sleep on the left, mood on the right"),
        ),
      ),
      h("ul", { class: "ms-legend" }, h("li", {}, h("i", { class: "sleep" }), sleepWord), h("li", {}, h("i", { class: "mood" }), moodWordTitle)),
    ),
    h("div", { class: "ms-plot" }, lineCanvas),
  );

  // Sleep vs mood
  const scatterCanvas = h("canvas", {
    role: "img",
    "aria-label": ctx.t("Each night as a dot: hours slept across, mood up, coloured by what the day had"),
  });
  const chips = h("div", {
    class: "ms-chips",
    role: "group",
    "aria-label": ctx.t("Show nights by tag"),
  });
  const scatterCard = h(
    "section",
    { class: "ms-card ms-scatter", "aria-labelledby": "ms-scatter-title" },
    h(
      "div",
      { class: "ms-card-head" },
      h(
        "div",
        {},
        h(
          "h3",
          { id: "ms-scatter-title" },
          ctx.t("Does a long night lift the day?"),
        ),
        h(
          "p",
          { class: "ms-sub" },
          ctx.t("Every dot is a night, coloured by what the day had"),
        ),
      ),
    ),
    chips,
    h("div", { class: "ms-plot" }, scatterCanvas),
    h(
      "p",
      { class: "ms-foot" },
      ctx.t("The dashed line is the trend: the steeper it climbs, the more sleep shows in your mood."),
    ),
  );
  root.append(lineCard, scatterCard);

  let lineChart: Chart<"line"> | null = null;
  let scatterChart: Chart<"scatter", Pt[]> | null = null;
  let all: Night[] = [];
  const hidden = new Set<string>();

  let card: CardData | null = null;
  const renderText = (w: { nights: Night[]; days: string[] }) => {
    const said = insights(w.nights, ctx);
    insight.replaceChildren(...sentence(said[0]!));
    also.hidden = !said[1];
    also.replaceChildren(...(said[1] ? sentence(said[1]) : []));
    const last = w.days[w.days.length - 1];
    const first = w.days[0];
    const range = last && first ? (first === last ? monthDay(last, ctx) : `${monthDay(first, ctx)} – ${monthDay(last, ctx)}`) : "";
    kicker.textContent =
      last && first
        ? ctx.t(
            "{n, plural, one {# check-in} other {# check-ins}} · {range}",
            { n: w.nights.length, range },
          )
        : ctx.t("Your nights");
    const s = stats(w.nights);
    const three = [
      { label: ctx.t("Average sleep"), value: s.avgHours == null ? "–" : one(s.avgHours, ctx), unit: "h" },
      {
        label: ctx.t("Average mood"),
        value: s.avgMood == null ? "–" : one(s.avgMood, ctx),
        unit: s.avgMood == null ? "" : (MOOD_FACES[Math.round(s.avgMood)] ?? ""),
      },
      {
        label: ctx.t("Nights ≥ {h}h", { h: LONG }),
        value: s.longShare == null ? "–" : String(Math.round(s.longShare * 100)),
        unit: "%",
      },
    ];
    statsEl.replaceChildren(...three.map((x) => h("div", {}, h("dt", {}, x.label), h("dd", {}, x.value, ...(x.unit ? [h("small", {}, x.unit)] : [])))));
    share.hidden = w.nights.length === 0;
    const series = dailySeries(w);
    card =
      first && last
        ? {
            kicker: kicker.textContent ?? "",
            sentence: said[0]!,
            stats: three,
            title: ctx.t("Night by night"),
            legend: { sleep: sleepWord, mood: moodWordTitle },
            goal: { hours: LONG, label: ctx.t("{h}h goal", { h: LONG }) },
            hours: series.hours,
            mood: series.mood,
            from: shortDay(first, ctx),
            to: shortDay(last, ctx),
            name: props.runtime.definition.name,
          }
        : null;
  };

  // The card is drawn on the night palette whatever the screen's theme: the app's colour at the dark
  // theme's text level (DESIGN.md §3.1), and mood's dark colour.
  const shareCard = async () => {
    if (!card || share.disabled) return;
    share.disabled = true;
    const s = getComputedStyle(el);
    const sleep = css(rgba(s.getPropertyValue("--tinta-d").trim(), css(pal.sleep)));
    const day = dayKey(ctx.today());
    let file: FileInfo | null = null;
    try {
      const png = await drawCard(card, { sleep, mood: MOOD_DARK, display: pal.display, body: pal.font });
      file = await ctx.files.write(`share/sleep-${day}.png`, png, { mime: "image/png" });
      // The save dialog on a computer, the share sheet on a phone.
      await ctx.files.export(file);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) ctx.ui.toast(ctx.t("It could not be shared."));
    } finally {
      // The picture was for sending: it does not stay in the app's folder.
      if (file) await ctx.files.remove(file).catch(() => undefined);
      share.disabled = false;
    }
  };

  const renderChips = () => {
    const groups = scatterChart ? scatterChart.data.datasets.filter((d) => d.label !== "trend") : [];
    chips.replaceChildren(
      ...groups.map((d) => {
        // The tag as stored is the key; the chip shows it in the person's words.
        const label = d.label ?? "";
        const b = h("button", { class: "ms-chip", type: "button", "aria-pressed": String(!hidden.has(label)) }, tagName(label, ctx));
        b.style.setProperty("--chip", label === "" ? pal.faint : pal.tag(label));
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
    lineChart = new Chart(lineCanvas, lineConfig(w, dailySeries(w), byDay, current, ctx));
    scatterChart = new Chart(scatterCanvas, scatterConfig(w.nights, current, ctx));
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

export default defineApp({
  id: "mood-sleep",
  name: "Sleep & Mood",
  icon: "moon",
  version: "1.3.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#7c6cf0" },
  category: "health",
  // The launcher tile (docs/04 §Tile): last night, and the week's average.
  tile: async (ctx) => {
    const nights = (await ctx.query("checkin")).sort((a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime());
    const last = nights[0];
    if (!last) return {};
    const face = ["", "😣", "😕", "😐", "🙂", "😄"][Number(last.mood)] ?? "";
    const hours = (h: number): string => ctx.format.number(h, { style: "unit", unit: "hour", maximumFractionDigits: 1 });
    const week = nights.filter((n) => ctx.now().getTime() - new Date(String(n.date)).getTime() < 7 * 86_400_000);
    const average = week.length ? week.reduce((sum, n) => sum + Number(n.hours ?? 0), 0) / week.length : 0;
    return {
      title: `${hours(Number(last.hours ?? 0))} ${face}`.trim(),
      lines: [
        ctx.t("Last night"),
        ...(week.length > 1
          ? [ctx.t("Week: {avg} a night", { avg: hours(average) })]
          : []),
      ],
    };
  },
  nav: "tabs",
  quickActions: [
    {
      id: "log",
      label: "Log last night",
      icon: "moon",
      entity: "checkin",
      mode: "form",
    },
  ],
  entities: {
    checkin: {
      label: "Check-in",
      displayField: "date",
      // The Patterns screen's "Log last night" asks with these same fields, as the runtime shows them.
      fields: {
        date: {
          type: "datetime",
          required: true,
          default: (ctx: Ctx) => dayKey(ctx.today()),
          label: "Date",
          help: "The morning you are checking in",
        },
        hours: {
          type: "number",
          required: true,
          min: 0,
          max: 14,
          step: 0.25,
          unit: "h",
          width: "half",
          default: 7,
          label: "Hours slept",
        },
        mood: {
          type: "number",
          required: true,
          integer: true,
          min: 1,
          max: 5,
          step: 1,
          width: "half",
          default: 3,
          label: "Mood",
          help: "1 rough · 3 okay · 5 great",
        },
        tags: {
          type: "tags",
          options: [...TAGS],
          label: "The day had",
          // Records keep "late screen"; these are what each option reads as.
          labels: {
            exercise: "exercise",
            coffee: "coffee",
            alcohol: "alcohol",
            "late screen": "late screen",
            nap: "nap",
            stressed: "stressed",
          },
        },
        note: {
          type: "text",
          label: "A short note",
          placeholder: "Late dinner, woke at four…",
        },
      },
      computed: {
        face: (r) => MOOD_FACES[Number(r.mood)] ?? "",
      },
    },
  },
  pages: [
    {
      id: "patterns",
      title: "Patterns",
      icon: "moon",
      view: { type: "custom", entity: "checkin", mount: mountPatterns },
    },
    {
      id: "nights",
      title: "Nights",
      icon: "bed",
      view: {
        type: "list",
        entity: "checkin",
        sort: (a, b) => (dayKey(b.date as string) < dayKey(a.date as string) ? -1 : 1),
        display: {
          primary: (r, ctx) => nightDate(dayKey(r.date as string), ctx),
          secondary: (r, ctx) => {
            const slept = ctx.t(
              "{h} slept",
              { h: hoursText(Number(r.hours), ctx) },
            );
            const mood = `${MOOD_FACES[Number(r.mood)] ?? ""} ${moodWord(Number(r.mood), ctx)}`;
            return [slept, mood, r.note].filter(Boolean).join(" · ");
          },
          badges: ["tags"],
        },
        emptyText: "No nights logged yet. Tap “Log last night”.",
        onOpen: { page: "night", param: { checkinId: "id" } },
      },
    },
    {
      id: "night",
      title: "Night",
      hidden: true,
      view: { type: "detail", entity: "checkin", param: "checkinId" },
    },
  ],
});
