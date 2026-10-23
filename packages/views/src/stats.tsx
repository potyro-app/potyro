// Stats tiles (#109): the summary strip promoted to a view — a big number, what it is, and how it
// compares with the same figure for an earlier period.
//
// Every figure is folded out of the page's rows, and a `value` function runs through the host
// (`callFold`), so the tiles render untrusted exactly as they do trusted. The comparison is carried
// by an arrow AND words ("▲ 1 more than last week"), never by colour alone.

import { fmt } from "@potyro/i18n";
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import type { Resolved } from "potyro";
import type { ShownField as Field, ShownStatItem as StatItem } from "./shown.js";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";
import { figureValue } from "./summary.js";

interface StatsDef {
  entity: string;
  items: StatItem[];
}

interface Tile {
  label: string;
  text: string;
  error?: string;
  compare?: { dir: "up" | "down" | "same"; text: string };
}

const numberText = (v: number, unit?: string): string => {
  const n = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
};

/** "1 more than last week", "6% less than last week", "same as last week". */
export function compareText(now: number, before: number, label: string, as: "difference" | "percent" = "difference", unit?: string): Tile["compare"] {
  const diff = now - before;
  const percent = as === "percent" && before !== 0;
  const amount = percent ? Math.round((Math.abs(diff) / Math.abs(before)) * 100) : Math.round(Math.abs(diff) * 100) / 100;
  if (amount === 0) return { dir: "same", text: t({ message: `same as ${label}`, comment: "A figure compared with an earlier one; label is e.g. “last week”" }) };
  const dir = diff > 0 ? "up" : "down";
  const size = percent ? fmt.number(amount / 100, { style: "percent" }) : numberText(amount, unit);
  return {
    dir,
    text:
      dir === "up"
        ? t({ message: `${size} more than ${label}`, comment: "A figure compared with an earlier one; label is e.g. “last week”" })
        : t({ message: `${size} less than ${label}`, comment: "A figure compared with an earlier one; label is e.g. “last week”" }),
  };
}

export function StatsView({ runtime, pageId, params }: BuiltinViewProps) {
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const view = getView(runtime, pageId) as unknown as StatsDef;
  const fields = runtime.definition.entities[view.entity]?.fields ?? {};
  const [tiles, setTiles] = useState<Tile[] | null>(null);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    const fold = (path: string) => (rs: readonly Resolved[]) => runtime.core.app.callFold(pageId, path, [...rs], runtime.ctx);
    void Promise.all(
      view.items.map(async (item, i): Promise<Tile> => {
        const unit = item.unit ?? (item.field ? (fields[item.field] as (Field & { unit?: string }) | undefined)?.unit : undefined);
        try {
          const value = await figureValue(item, rows, runtime.ctx, item.value != null ? fold(`items.${i}.value`) : undefined);
          const tile: Tile = { label: item.label, text: typeof value === "number" && Number.isFinite(value) ? numberText(value, unit) : value == null ? "–" : String(value) };
          if (item.compare && typeof value === "number") {
            const before = await fold(`items.${i}.compare.value`)(rows);
            if (typeof before === "number" && Number.isFinite(before)) tile.compare = compareText(value, before, item.compare.label, item.compare.as, unit);
          }
          return tile;
        } catch (e) {
          // One bad figure shows a dash and says why on hover; it does not blank its neighbours.
          console.warn(`[potyro] stat "${item.label}" failed:`, e);
          return { label: item.label, text: "–", error: e instanceof Error ? e.message : String(e) };
        }
      }),
    ).then((next) => {
      if (alive) setTiles(next);
    });
    return () => {
      alive = false;
    };
    // `rows` identity changes per query pass, which is exactly when the figures must re-run.
  }, [runtime, pageId, rows, loading, view, fields]);

  if (loading || tiles === null) return <p className="k-muted">{t`Loading`}</p>;

  return (
    <ul className="k-stats">
      {tiles.map((t, i) => (
        <li key={i} className="k-stat">
          <span className="k-stat-label" data-k-wording>{t.label}</span>
          <span className="k-stat-value" title={t.error}>
            {t.text}
          </span>
          {t.compare ? (
            <span className="k-stat-compare" data-dir={t.compare.dir}>
              {t.compare.dir === "same" ? null : <span aria-hidden>{t.compare.dir === "up" ? "▲ " : "▼ "}</span>}
              {t.compare.text}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
