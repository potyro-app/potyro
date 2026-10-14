// A bar chart (#109): the points `series` folds out of the page's rows, drawn as plain SVG.
//
// No charting library — the bundle budget, offline, and a view that renders untrusted all want a
// few dozen lines of SVG over a dependency. The fold runs through the host (`callFold`), so the
// chart behaves the same trusted and in the isolate.
//
// It follows the dataviz rules: one series, so the title names it and there is no legend; thin bars
// with 4px rounded data-ends on a flat baseline; a recessive grid; the latest bar labelled and the
// rest answering on hover, tap or the arrow keys; a visually hidden table with the same numbers for
// a screen reader. The series colour is a token validated against both themes' surfaces.

import { fmt } from "@potyro/i18n";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ChartPoint, Resolved } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { useDynamicText } from "./dynamic.js";
import { usePhone } from "./media.js";

/** Coerce what the app returned into points, dropping anything that cannot be drawn. */
function toPoints(value: unknown): ChartPoint[] {
  if (!Array.isArray(value)) return [];
  const out: ChartPoint[] = [];
  for (const raw of value) {
    if (raw == null || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.label !== "string" || typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
    out.push({ label: p.label, value: p.value, text: typeof p.text === "string" ? p.text : undefined });
  }
  return out;
}

/** The axis top and gridline step: 1, 2, 2.5 or 5 × a power of ten, three or four lines high. */
export function niceMax(max: number, integers = false): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 };
  const mag = 10 ** Math.floor(Math.log10(max / 3));
  for (const m of integers ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]) {
    const step = Math.max(m * mag, integers ? 1 : 0);
    if (step * 3 >= max) return { top: Math.ceil(max / step) * step, step };
  }
  return { top: max, step: max };
}

const num = (v: number): string => fmt.number(v, { maximumFractionDigits: 2 });

export function ChartView({ runtime, pageId, params }: BuiltinViewProps) {
  const { t } = useLingui();
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const title = useDynamicText(runtime, pageId, "title", "view", "");
  const subtitle = useDynamicText(runtime, pageId, "subtitle", "view", "");
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", t`Nothing to chart yet.`);
  const phone = usePhone();

  const [points, setPoints] = useState<ChartPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    runtime.core.app.callFold(pageId, "series", [...rows] as Resolved[], runtime.ctx).then(
      (v) => {
        if (!alive) return;
        setPoints(toPoints(v));
        setError(null);
      },
      (e: unknown) => {
        if (!alive) return;
        setPoints([]);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [runtime, pageId, rows, loading]);

  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 600);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, [points === null]);

  const head = (
    <figcaption className="k-chart-head">
      {title ? <span className="k-chart-title" data-k-wording>{title}</span> : null}
      {subtitle ? <span className="k-chart-sub">{subtitle}</span> : null}
    </figcaption>
  );

  if (loading || points === null) return <p className="k-muted">{t`Loading…`}</p>;
  if (error || points.length === 0) {
    return (
      <figure className="k-chart">
        {head}
        <p className={error ? "k-aggregate-error" : "k-muted"} role={error ? "status" : undefined}>
          {error ? t`This chart could not be worked out: ${error}` : emptyText}
        </p>
      </figure>
    );
  }

  const n = points.length;
  const { top, step } = niceMax(Math.max(...points.map((p) => p.value)), points.every((p) => Number.isInteger(p.value)));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const H = phone ? 190 : 220;
  const padL = Math.max(...ticks.map((t) => num(t).length)) * 7 + 10;
  const padR = 6;
  const padT = 20;
  const padB = 24;
  const iw = Math.max(40, width - padL - padR);
  const ih = H - padT - padB;
  const slot = iw / n;
  const bw = Math.max(3, Math.min(28, slot * 0.55));
  const y = (v: number): number => padT + ih - (ih * Math.max(0, v)) / top;
  const cx = (i: number): number => padL + slot * i + slot / 2;
  // Label every k-th bar, counted back from the latest, so the labels never collide and the latest
  // always has one.
  const labelEvery = Math.max(1, Math.ceil((Math.max(...points.map((p) => p.label.length)) * 6.5 + 10) / slot));

  const bar = (p: ChartPoint, i: number): string => {
    const x = cx(i) - bw / 2;
    const base = padT + ih;
    const h = base - y(p.value);
    if (h <= 0) return "";
    const r = Math.min(4, bw / 2, h);
    const t = base - h;
    return `M${x} ${base}V${t + r}Q${x} ${t} ${x + r} ${t}H${x + bw - r}Q${x + bw} ${t} ${x + bw} ${t + r}V${base}Z`;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const from = active ?? (e.key === "ArrowRight" ? -1 : n);
      setActive(Math.min(n - 1, Math.max(0, from + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Escape") setActive(null);
  };

  const tip = active !== null ? points[active] : undefined;
  const chartName = title || t({ message: "Chart", comment: "A bar chart with no title of its own" });
  const tipLeft = active !== null ? Math.min(Math.max(cx(active), 70), width - 70) : 0;

  return (
    <figure className="k-chart">
      {head}
      <div
        ref={plotRef}
        className="k-chart-plot"
        tabIndex={0}
        role="img"
        aria-label={plural(n, { one: `${chartName}: # bar. The values are in the table that follows.`, other: `${chartName}: # bars. The values are in the table that follows.` })}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
      >
        <svg width={width} height={H} aria-hidden="true" focusable="false">
          {ticks.map((t) => (
            <g key={t}>
              <line className="k-chart-grid" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
              <text className="k-chart-tick" x={padL - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {num(t)}
              </text>
            </g>
          ))}
          {active !== null ? <rect className="k-chart-band" x={padL + slot * active} y={padT} width={slot} height={ih} /> : null}
          {points.map((p, i) => (
            <g key={i}>
              <path className="k-chart-bar" d={bar(p, i)} data-active={active === i || undefined} />
              {(n - 1 - i) % labelEvery === 0 ? (
                <text className="k-chart-tick" x={cx(i)} y={H - 6} textAnchor="middle">
                  {p.label}
                </text>
              ) : null}
              <rect
                className="k-chart-hit"
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={ih}
                data-bar={i}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setActive(i);
                }}
                onClick={() => setActive((a) => (a === i ? null : i))}
              />
            </g>
          ))}
          <text className="k-chart-latest" x={cx(n - 1)} y={y(points[n - 1]!.value) - 6} textAnchor="middle">
            {num(points[n - 1]!.value)}
          </text>
        </svg>
        {tip ? (
          <div className="k-chart-tip" style={{ left: tipLeft, top: y(tip.value) - 10 }}>
            {tip.label} · <b>{tip.text ?? num(tip.value)}</b>
          </div>
        ) : null}
      </div>
      <table className="k-visually-hidden">
        {title ? <caption>{title}</caption> : null}
        <thead>
          <tr>
            <th scope="col">
              <Trans comment="Chart data table: the bar's label">Label</Trans>
            </th>
            <th scope="col">
              <Trans comment="Chart data table: the bar's value">Value</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.label}</th>
              <td>{p.text ?? num(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
