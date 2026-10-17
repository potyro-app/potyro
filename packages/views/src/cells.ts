// Resolve display bindings (which may be functions → async host calls) for a batch of rows,
// outside of render. Keeps the view components synchronous.

import { useEffect, useRef, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import { computedInfo, type EntityDef, type Resolved } from "potyro";
import type { DisplayCell } from "./types.js";
import { formatDateValue, getView, toBadges } from "./format.js";
import { releaseMediaUrl } from "./media-input.js";
import { optionLabel } from "./shown.js";
import { firstPhotoField } from "./lead.js";
import { pictureOf, pictureUrl } from "./picture.js";

function str(v: unknown): string {
  if (v == null) return "";
  // A row that shows a date shows it as a person would say it, not as a JS Date prints (#103).
  return v instanceof Date ? formatDateValue(v) : String(v);
}

export function useDisplayCells(runtime: PotyroRuntime, pageId: string, rows: Resolved[]): DisplayCell[] {
  const [shown, setShown] = useState<{ cells: DisplayCell[]; minted: string[] }>({ cells: [], minted: [] });
  // The photo URLs the cells ON SCREEN point at. They are freed only once other cells have replaced
  // them (or the view has gone) — never when the rows merely change. Freed on a change, every picture
  // on screen pointed at a dead URL until the new batch arrived, and a lazy one that had not loaded
  // yet never did: a gallery showed blank cards and the console "ERR_FILE_NOT_FOUND".
  const onScreen = useRef<string[]>([]);
  useEffect(() => {
    const before = onScreen.current;
    onScreen.current = shown.minted;
    const keep = new Set(shown.minted);
    before.filter((u) => !keep.has(u)).forEach(releaseMediaUrl);
  }, [shown]);
  useEffect(() => () => onScreen.current.forEach(releaseMediaUrl), []);

  useEffect(() => {
    let alive = true;
    const minted: string[] = [];
    const ctx = runtime.ctx;
    const view = getView(runtime, pageId) as { display?: Record<string, unknown>; entity?: string };
    const display = view.display;
    const entityDef = runtime.definition.entities[view.entity ?? ""];
    // The record's photo leads its row even when the page did not name one: a list of plants with
    // their pictures is the list, and one without is a list of words about plants.
    const media = typeof display?.media === "string" ? display.media : firstPhotoField(entityDef);

    void Promise.all(
      rows.map(async (row): Promise<DisplayCell> => {
        const cell: DisplayCell = {};
        if (media) {
          const picture = pictureOf(row[media]);
          // A photo's URL is minted for this list, which frees it when the rows change — a long
          // scroll otherwise holds every thumbnail it ever drew. A file's belongs to the app's folder.
          const got = picture ? await pictureUrl(ctx, picture) : null;
          if (got) cell.mediaUrl = got.url;
          if (got?.owned) minted.push(got.url);
        }
        if (!display) return cell;
        if (display.primary !== undefined) {
          cell.primary = str(await runtime.resolveBinding({ kind: "view", page: pageId, path: "display.primary" }, row, ctx));
        }
        if (display.icon !== undefined) {
          const icon = str(await runtime.resolveBinding({ kind: "view", page: pageId, path: "display.icon" }, row, ctx)).trim();
          if (icon) cell.icon = icon;
        }
        if (display.secondary !== undefined) {
          cell.secondary = str(
            await runtime.resolveBinding({ kind: "view", page: pageId, path: "display.secondary" }, row, ctx),
          );
        }
        if (Array.isArray(display.badges)) {
          // An enum badge keeps its field, so the row shows the value in the colour it wears in the
          // form and on the record page (#98).
          const entity = runtime.definition.entities[(view as { entity?: string }).entity ?? ""];
          cell.badges = (display.badges as string[]).flatMap((key) => {
            const f = entity?.fields[key];
            const field = f?.type === "enum" ? { colors: f.colors } : undefined;
            // A computed badge (recipes' diet) reads as its own `labels`.
            const labels = f?.type === "enum" || f?.type === "tags" ? f : f ? undefined : { labels: computedInfo(entity as EntityDef | undefined, key)?.labels };
            return toBadges(row[key]).map((text) => ({ text, field, label: optionLabel(labels, text) }));
          });
        }
        return cell;
      }),
    )
      .then((cs) => {
        // Overtaken by newer rows: these cells will never be shown, so their URLs are freed now.
        if (alive) setShown({ cells: cs, minted });
        else minted.forEach(releaseMediaUrl);
      })
      .catch((e: unknown) => {
        // A display function that failed, or a sealed app put away while its rows were being read
        // ("this app was closed", switching apps in place): the rows keep what they showed. It
        // used to be an uncaught rejection — in Firefox, on every switch back to a shared app.
        minted.forEach(releaseMediaUrl);
        if (alive) console.warn("[potyro] could not work out what the rows show:", e);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, pageId, rows]);

  return shown.cells;
}
