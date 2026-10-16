// How did you sleep? — a morning check-in (hours slept, mood 1–5, what the day had, a note) and a
// Patterns screen that charts it with chart.js, imported by URL (#266). The shell fetches chart.js
// once, when the app is added, and runs it from the copy it keeps: no network after that.
//
// The chart screen draws on a <canvas> with a library that needs a real web page, so this app runs
// as your own (trusted) app only. The numbers and the sentence on top are worked out in insights.ts,
// in plain functions the tests run without a browser.
//
// In six languages (#303); every language but English is a model's draft (#297). The charts say
// their words through `ctx.t` and write dates and numbers through `ctx.format`. A check-in's note is
// a record. A tag is stored as its option ("late screen"), so a chart chip, a scatter group and
// the dataset behind it all key on that, and only what is shown is translated.
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
    const label = say.t({ en: "{h}h goal", "pt-BR": "meta: {h} h", de: "Ziel: {h} Std.", es: "objetivo: {h} h", pl: "cel: {h} godz.", it: "obiettivo: {h} h" }, { h: LONG });
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
                return say.t({ en: "Slept {h}", "pt-BR": "Dormiu {h}", de: "Geschlafen: {h}", es: "Dormiste {h}", pl: "Sen: {h}", it: "Sonno: {h}" }, { h: hoursText(v, say) });
              }
              return say.t(
                { en: "Mood {v} · {word} {face}", "pt-BR": "Humor {v} · {word} {face}", de: "Stimmung {v} · {word} {face}", es: "Ánimo {v} · {word} {face}", pl: "Nastrój {v} · {word} {face}", it: "Umore {v} · {word} {face}" },
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
            text: say.t({ en: "hours slept", "pt-BR": "horas dormidas", de: "Stunden Schlaf", es: "horas de sueño", pl: "godziny snu", it: "ore di sonno" }),
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
            text: say.t({ en: "mood", "pt-BR": "humor", de: "Stimmung", es: "ánimo", pl: "nastrój", it: "umore" }),
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
                {
                  en: "{h} · mood {m} {face}",
                  "pt-BR": "{h} · humor {m} {face}",
                  de: "{h} · Stimmung {m} {face}",
                  es: "{h} · ánimo {m} {face}",
                  pl: "{h} · nastrój {m} {face}",
                  it: "{h} · umore {m} {face}",
                },
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
    title: ctx.t({ en: "How did you sleep?", "pt-BR": "Como você dormiu?", de: "Wie hast du geschlafen?", es: "¿Qué tal has dormido?", pl: "Jak ci się spało?", it: "Come hai dormito?" }),
    fields,
    initial: { date: dayKey(ctx.today()), hours: 7, mood: 3 },
    submit: ctx.t({ en: "Save", "pt-BR": "Salvar", de: "Speichern", es: "Guardar", pl: "Zapisz", it: "Salva" }),
  });
  if (!answer) return;
  await ctx.create("checkin", answer);
  ctx.ui.toast(
    ctx.t(
      { en: "Logged {h} · {face}", "pt-BR": "Registrado: {h} · {face}", de: "Eingetragen: {h} · {face}", es: "Anotado: {h} · {face}", pl: "Zapisano: {h} · {face}", it: "Segnato: {h} · {face}" },
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
    ctx.t({
      en: "🌙  Log last night",
      "pt-BR": "🌙  Registrar a última noite",
      de: "🌙  Letzte Nacht eintragen",
      es: "🌙  Anotar anoche",
      pl: "🌙  Zapisz ostatnią noc",
      it: "🌙  Segna la notte scorsa",
    }),
  );
  log.addEventListener("click", () => void logNight(ctx, props.runtime.definition.entities.checkin!.fields as Record<string, Field>));
  root.append(h("header", { class: "ms-hero" }, h("div", { class: "ms-moon", "aria-hidden": "true" }), kicker, insight, also, statsEl, log));

  // Night by night
  const sleepWord = ctx.t({ en: "Sleep", "pt-BR": "Sono", de: "Schlaf", es: "Sueño", pl: "Sen", it: "Sonno" });
  const moodWordTitle = ctx.t({ en: "Mood", "pt-BR": "Humor", de: "Stimmung", es: "Ánimo", pl: "Nastrój", it: "Umore" });
  const lineCanvas = h("canvas", {
    role: "img",
    "aria-label": ctx.t({
      en: "Hours slept and mood for each day, up to the last 30",
      "pt-BR": "Horas dormidas e humor de cada dia, até os últimos 30",
      de: "Schlafstunden und Stimmung pro Tag, bis zu den letzten 30",
      es: "Horas de sueño y ánimo de cada día, hasta los últimos 30",
      pl: "Godziny snu i nastrój z każdego dnia, do 30 ostatnich",
      it: "Ore di sonno e umore di ogni giorno, fino agli ultimi 30",
    }),
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
        h("h3", { id: "ms-line-title" }, ctx.t({ en: "Night by night", "pt-BR": "Noite a noite", de: "Nacht für Nacht", es: "Noche a noche", pl: "Noc po nocy", it: "Notte per notte" })),
        h(
          "p",
          { class: "ms-sub" },
          ctx.t({
            en: "Sleep on the left, mood on the right",
            "pt-BR": "Sono à esquerda, humor à direita",
            de: "Links Schlaf, rechts Stimmung",
            es: "Sueño a la izquierda, ánimo a la derecha",
            pl: "Sen po lewej, nastrój po prawej",
            it: "Sonno a sinistra, umore a destra",
          }),
        ),
      ),
      h("ul", { class: "ms-legend" }, h("li", {}, h("i", { class: "sleep" }), sleepWord), h("li", {}, h("i", { class: "mood" }), moodWordTitle)),
    ),
    h("div", { class: "ms-plot" }, lineCanvas),
  );

  // Sleep vs mood
  const scatterCanvas = h("canvas", {
    role: "img",
    "aria-label": ctx.t({
      en: "Each night as a dot: hours slept across, mood up, coloured by what the day had",
      "pt-BR": "Cada noite é um ponto: horas dormidas na horizontal, humor na vertical, com a cor do que o dia teve",
      de: "Jede Nacht ein Punkt: Schlafstunden nach rechts, Stimmung nach oben, gefärbt nach dem, was der Tag hatte",
      es: "Cada noche es un punto: horas de sueño en horizontal, ánimo en vertical, con el color de lo que tuvo el día",
      pl: "Każda noc to kropka: godziny snu w poziomie, nastrój w pionie, kolor według tego, co przyniósł dzień",
      it: "Ogni notte è un punto: ore di sonno in orizzontale, umore in verticale, colorato secondo cosa ha avuto la giornata",
    }),
  });
  const chips = h("div", {
    class: "ms-chips",
    role: "group",
    "aria-label": ctx.t({ en: "Show nights by tag", "pt-BR": "Mostrar noites por etiqueta", de: "Nächte nach Schlagwort zeigen", es: "Mostrar noches por etiqueta", pl: "Pokaż noce według tagu", it: "Mostra le notti per tag" }),
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
          ctx.t({
            en: "Does a long night lift the day?",
            "pt-BR": "Uma noite longa melhora o dia?",
            de: "Hebt eine lange Nacht den Tag?",
            es: "¿Una noche larga mejora el día?",
            pl: "Czy długa noc poprawia dzień?",
            it: "Una notte lunga migliora la giornata?",
          }),
        ),
        h(
          "p",
          { class: "ms-sub" },
          ctx.t({
            en: "Every dot is a night, coloured by what the day had",
            "pt-BR": "Cada ponto é uma noite, com a cor do que o dia teve",
            de: "Jeder Punkt ist eine Nacht, gefärbt nach dem, was der Tag hatte",
            es: "Cada punto es una noche, con el color de lo que tuvo el día",
            pl: "Każda kropka to noc, w kolorze tego, co przyniósł dzień",
            it: "Ogni punto è una notte, colorato secondo cosa ha avuto la giornata",
          }),
        ),
      ),
    ),
    chips,
    h("div", { class: "ms-plot" }, scatterCanvas),
    h(
      "p",
      { class: "ms-foot" },
      ctx.t({
        en: "The dashed line is the trend: the steeper it climbs, the more sleep shows in your mood.",
        "pt-BR": "A linha tracejada é a tendência: quanto mais ela sobe, mais o sono aparece no seu humor.",
        de: "Die gestrichelte Linie ist der Trend: Je steiler sie steigt, desto mehr zeigt sich der Schlaf in deiner Stimmung.",
        es: "La línea discontinua es la tendencia: cuanto más sube, más se nota el sueño en tu ánimo.",
        pl: "Linia przerywana to trend: im bardziej stromo rośnie, tym bardziej sen widać w twoim nastroju.",
        it: "La linea tratteggiata è la tendenza: più sale ripida, più il sonno si vede nel tuo umore.",
      }),
    ),
  );
  root.append(lineCard, scatterCard);

  let lineChart: Chart<"line"> | null = null;
  let scatterChart: Chart<"scatter", Pt[]> | null = null;
  let all: Night[] = [];
  const hidden = new Set<string>();

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
            {
              en: "{n, plural, one {# check-in} other {# check-ins}} · {range}",
              "pt-BR": "{n, plural, one {# registro} other {# registros}} · {range}",
              de: "{n, plural, one {# Eintrag} other {# Einträge}} · {range}",
              es: "{n, plural, one {# registro} other {# registros}} · {range}",
              pl: "{n, plural, one {# wpis} few {# wpisy} many {# wpisów} other {# wpisu}} · {range}",
              it: "{n, plural, one {# registrazione} other {# registrazioni}} · {range}",
            },
            { n: w.nights.length, range },
          )
        : ctx.t({ en: "Your nights", "pt-BR": "Suas noites", de: "Deine Nächte", es: "Tus noches", pl: "Twoje noce", it: "Le tue notti" });
    const s = stats(w.nights);
    const stat = (label: string, value: string, unit = "") => h("div", {}, h("dt", {}, label), h("dd", {}, value, ...(unit ? [h("small", {}, unit)] : [])));
    statsEl.replaceChildren(
      stat(ctx.t({ en: "Average sleep", "pt-BR": "Sono médio", de: "Ø Schlaf", es: "Sueño medio", pl: "Średni sen", it: "Sonno medio" }), s.avgHours == null ? "–" : one(s.avgHours, ctx), "h"),
      stat(
        ctx.t({ en: "Average mood", "pt-BR": "Humor médio", de: "Ø Stimmung", es: "Ánimo medio", pl: "Średni nastrój", it: "Umore medio" }),
        s.avgMood == null ? "–" : one(s.avgMood, ctx),
        s.avgMood == null ? "" : (MOOD_FACES[Math.round(s.avgMood)] ?? ""),
      ),
      stat(
        ctx.t({ en: "Nights ≥ {h}h", "pt-BR": "Noites ≥ {h} h", de: "Nächte ≥ {h} Std.", es: "Noches ≥ {h} h", pl: "Noce ≥ {h} godz.", it: "Notti ≥ {h} h" }, { h: LONG }),
        s.longShare == null ? "–" : String(Math.round(s.longShare * 100)),
        "%",
      ),
    );
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
  name: { en: "Sleep & Mood", "pt-BR": "Sono e humor", de: "Schlaf & Stimmung", es: "Sueño y ánimo", pl: "Sen i nastrój", it: "Sonno e umore" },
  icon: "🌙",
  version: "1.2.0",
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
        ctx.t({ en: "Last night", "pt-BR": "Última noite", de: "Letzte Nacht", es: "Anoche", pl: "Ostatnia noc", it: "La notte scorsa" }),
        ...(week.length > 1
          ? [ctx.t({ en: "Week: {avg} a night", "pt-BR": "Semana: {avg} por noite", de: "Woche: {avg} pro Nacht", es: "Semana: {avg} por noche", pl: "Tydzień: {avg} na noc", it: "Settimana: {avg} a notte" }, { avg: hours(average) })]
          : []),
      ],
    };
  },
  nav: "tabs",
  quickActions: [
    {
      id: "log",
      label: { en: "Log last night", "pt-BR": "Registrar a última noite", de: "Letzte Nacht eintragen", es: "Anotar anoche", pl: "Zapisz ostatnią noc", it: "Segna la notte scorsa" },
      icon: "🌙",
      entity: "checkin",
      mode: "form",
    },
  ],
  entities: {
    checkin: {
      label: { en: "Check-in", "pt-BR": "Registro", de: "Eintrag", es: "Registro", pl: "Wpis", it: "Registrazione" },
      displayField: "date",
      // The Patterns screen's "Log last night" asks with these same fields, as the runtime shows them.
      fields: {
        date: {
          type: "datetime",
          required: true,
          default: (ctx: Ctx) => dayKey(ctx.today()),
          label: { en: "Date", "pt-BR": "Data", de: "Datum", es: "Fecha", pl: "Data", it: "Data" },
          help: {
            en: "The morning you are checking in",
            "pt-BR": "A manhã em que você faz o registro",
            de: "Der Morgen, an dem du einträgst",
            es: "La mañana en que haces el registro",
            pl: "Poranek, którego dotyczy wpis",
            it: "La mattina in cui registri",
          },
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
          label: { en: "Hours slept", "pt-BR": "Horas dormidas", de: "Stunden geschlafen", es: "Horas dormidas", pl: "Godziny snu", it: "Ore dormite" },
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
          label: { en: "Mood", "pt-BR": "Humor", de: "Stimmung", es: "Ánimo", pl: "Nastrój", it: "Umore" },
          help: {
            en: "1 rough · 3 okay · 5 great",
            "pt-BR": "1 péssimo · 3 ok · 5 ótimo",
            de: "1 mies · 3 okay · 5 super",
            es: "1 fatal · 3 normal · 5 genial",
            pl: "1 fatalnie · 3 w porządku · 5 świetnie",
            it: "1 malissimo · 3 così così · 5 benissimo",
          },
        },
        tags: {
          type: "tags",
          options: [...TAGS],
          label: { en: "The day had", "pt-BR": "O dia teve", de: "Der Tag hatte", es: "El día tuvo", pl: "W ciągu dnia", it: "La giornata ha avuto" },
          // Records keep "late screen"; these are what each option reads as.
          labels: {
            exercise: { en: "exercise", "pt-BR": "exercício", de: "Sport", es: "ejercicio", pl: "ćwiczenia", it: "sport" },
            coffee: { en: "coffee", "pt-BR": "café", de: "Kaffee", es: "café", pl: "kawa", it: "caffè" },
            alcohol: { en: "alcohol", "pt-BR": "álcool", de: "Alkohol", es: "alcohol", pl: "alkohol", it: "alcol" },
            "late screen": { en: "late screen", "pt-BR": "tela até tarde", de: "spät am Bildschirm", es: "pantalla hasta tarde", pl: "ekran do późna", it: "schermi fino a tardi" },
            nap: { en: "nap", "pt-BR": "cochilo", de: "Mittagsschlaf", es: "siesta", pl: "drzemka", it: "pisolino" },
            stressed: { en: "stressed", "pt-BR": "estresse", de: "gestresst", es: "estrés", pl: "stres", it: "stress" },
          },
        },
        note: {
          type: "text",
          label: { en: "A short note", "pt-BR": "Uma nota curta", de: "Eine kurze Notiz", es: "Una nota breve", pl: "Krótka notatka", it: "Una breve nota" },
          placeholder: {
            en: "Late dinner, woke at four…",
            "pt-BR": "Jantei tarde, acordei às quatro…",
            de: "Spät gegessen, um vier aufgewacht…",
            es: "Cena tarde, me desperté a las cuatro…",
            pl: "Późna kolacja, pobudka o czwartej…",
            it: "Cena tardi, sveglia alle quattro…",
          },
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
      title: { en: "Patterns", "pt-BR": "Padrões", de: "Muster", es: "Patrones", pl: "Wzorce", it: "Andamento" },
      icon: "🌙",
      view: { type: "custom", entity: "checkin", mount: mountPatterns },
    },
    {
      id: "nights",
      title: { en: "Nights", "pt-BR": "Noites", de: "Nächte", es: "Noches", pl: "Noce", it: "Notti" },
      icon: "🛏",
      view: {
        type: "list",
        entity: "checkin",
        sort: (a, b) => (dayKey(b.date as string) < dayKey(a.date as string) ? -1 : 1),
        display: {
          primary: (r, ctx) => nightDate(dayKey(r.date as string), ctx),
          secondary: (r, ctx) => {
            const slept = ctx.t(
              { en: "{h} slept", "pt-BR": "{h} de sono", de: "{h} geschlafen", es: "{h} de sueño", pl: "{h} snu", it: "{h} di sonno" },
              { h: hoursText(Number(r.hours), ctx) },
            );
            const mood = `${MOOD_FACES[Number(r.mood)] ?? ""} ${moodWord(Number(r.mood), ctx)}`;
            return [slept, mood, r.note].filter(Boolean).join(" · ");
          },
          badges: ["tags"],
        },
        emptyText: {
          en: "No nights logged yet. Tap “Log last night”.",
          "pt-BR": "Nenhuma noite registrada ainda. Toque em “Registrar a última noite”.",
          de: "Noch keine Nächte eingetragen. Tippe auf „Letzte Nacht eintragen“.",
          es: "Aún no has anotado ninguna noche. Toca «Anotar anoche».",
          pl: "Brak zapisanych nocy. Stuknij „Zapisz ostatnią noc”.",
          it: "Ancora nessuna notte segnata. Tocca “Segna la notte scorsa”.",
        },
        onOpen: { page: "night", param: { checkinId: "id" } },
      },
    },
    {
      id: "night",
      title: { en: "Night", "pt-BR": "Noite", de: "Nacht", es: "Noche", pl: "Noc", it: "Notte" },
      hidden: true,
      view: { type: "detail", entity: "checkin", param: "checkinId" },
    },
  ],
});
