// Resolve display bindings (which may be functions → async host calls) for a batch of rows,
// outside of render. Keeps the view components synchronous.

import { useEffect, useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { MediaRef, Resolved } from "karta";
import type { DisplayCell } from "./types.js";
import { formatDateValue, getView, toBadges } from "./format.js";

function str(v: unknown): string {
  if (v == null) return "";
  // A row that shows a date shows it as a person would say it, not as a JS Date prints (#103).
  return v instanceof Date ? formatDateValue(v) : String(v);
}

export function useDisplayCells(runtime: KartaRuntime, pageId: string, rows: Resolved[]): DisplayCell[] {
  const [cells, setCells] = useState<DisplayCell[]>([]);

  useEffect(() => {
    let alive = true;
    const ctx = runtime.ctx;
    const view = getView(runtime, pageId) as { display?: Record<string, unknown>; entity?: string };
    const display = view.display;

    void Promise.all(
      rows.map(async (row): Promise<DisplayCell> => {
        const cell: DisplayCell = {};
        if (!display) return cell;
        if (display.primary !== undefined) {
          cell.primary = str(await runtime.resolveBinding({ kind: "view", page: pageId, path: "display.primary" }, row, ctx));
        }
        if (display.secondary !== undefined) {
          cell.secondary = str(
            await runtime.resolveBinding({ kind: "view", page: pageId, path: "display.secondary" }, row, ctx),
          );
        }
        if (typeof display.media === "string") {
          const ref = row[display.media] as MediaRef | MediaRef[] | undefined;
          const one = Array.isArray(ref) ? ref[0] : ref;
          if (one) cell.mediaUrl = await ctx.media.url(one);
        }
        if (Array.isArray(display.badges)) {
          // An enum badge keeps its field, so the row shows the value in the colour it wears in the
          // form and on the record page (#98).
          const entity = runtime.definition.entities[(view as { entity?: string }).entity ?? ""];
          cell.badges = (display.badges as string[]).flatMap((key) => {
            const f = entity?.fields[key];
            const field = f?.type === "enum" ? { colors: f.colors } : undefined;
            return toBadges(row[key]).map((text) => ({ text, field }));
          });
        }
        return cell;
      }),
    ).then((cs) => {
      if (alive) setCells(cs);
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, pageId, rows]);

  return cells;
}
