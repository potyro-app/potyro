// What an app's live tile returned, checked and made ready to show (docs/04 §Tile).
//
// The tile function is the app's code, so what comes back is anything at all: a sealed app's says
// whatever it likes, and a trusted one can be simply wrong. The launcher keeps only what it can show —
// a count that is a whole number, words that are words, at most three short lines, a picture
// reference — and drops the rest without a word: a live tile that cannot be shown is the plain one.
//
// The result stays serialisable (it is cached beside the tile, and is what a home-screen widget will
// read later); words stay as the app wrote them, so a change of language shows them again in the new
// one without running anything.

import { word, type FileRef, type MediaRef, type Words } from "potyro";

export const TILE_LIMITS = { count: 9_999, title: 60, line: 80, lines: 3 } as const;

/** What the launcher keeps of a tile's answer. Words are still the app's own `Words`. */
export interface CheckedTile {
  count?: number;
  title?: Words;
  lines?: Words[];
  image?: MediaRef | FileRef | string;
}

const isWordsMap = (v: unknown): v is Record<string, string> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0 && Object.values(v as object).every((s) => typeof s === "string");

/** Words cut to `max` characters; `undefined` when there is nothing to say. */
function words(v: unknown, max: number): Words | undefined {
  const cut = (s: string): string => {
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
  };
  if (typeof v === "number" && Number.isFinite(v)) return cut(String(v));
  if (typeof v === "string") return cut(v) || undefined;
  if (isWordsMap(v)) {
    const out: Record<string, string> = {};
    for (const [lang, s] of Object.entries(v)) if (cut(s)) out[lang] = cut(s);
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function image(v: unknown): CheckedTile["image"] | undefined {
  if (typeof v === "string") {
    const path = v.trim();
    // A path in the app's own folder, never an address: a tile does not reach the network.
    return path && !/^[a-z][a-z0-9+.-]*:/i.test(path) && path.length <= 512 ? path : undefined;
  }
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.key === "string" && r.key && typeof r.mime === "string" && r.mime.startsWith("image/")) return { key: r.key, mime: r.mime };
  if (typeof r.id === "string" && r.id) {
    return { id: r.id, ...(typeof r.path === "string" ? { path: r.path } : {}), ...(typeof r.mime === "string" ? { mime: r.mime } : {}) };
  }
  return undefined;
}

/**
 * Keep what can be shown of a tile's answer. `null` when nothing can: then the tile shows its plain
 * face, exactly as if the app declared no tile.
 */
export function checkTileContent(raw: unknown): CheckedTile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: CheckedTile = {};
  if (typeof r.count === "number" && Number.isFinite(r.count) && r.count >= 0) out.count = Math.min(TILE_LIMITS.count, Math.floor(r.count));
  const title = words(r.title, TILE_LIMITS.title);
  if (title !== undefined) out.title = title;
  if (Array.isArray(r.lines)) {
    const lines = r.lines.map((l) => words(l, TILE_LIMITS.line)).filter((l): l is Words => l !== undefined).slice(0, TILE_LIMITS.lines);
    if (lines.length) out.lines = lines;
  }
  const img = image(r.image);
  if (img !== undefined) out.image = img;
  return Object.keys(out).length ? out : null;
}

/** The tile's words in the language the app is shown in. */
export interface ShownTile {
  count?: number;
  title?: string;
  lines: string[];
  /** A picture made small enough to keep beside the tile: a `data:` URL. */
  image?: string;
}

export function showTile(tile: CheckedTile, language: string | undefined, app: { language?: string; languages?: string[] }, image?: string): ShownTile {
  const say = (w: Words): string => word(w, language, app);
  return {
    ...(tile.count !== undefined ? { count: tile.count } : {}),
    ...(tile.title !== undefined && say(tile.title) ? { title: say(tile.title) } : {}),
    lines: (tile.lines ?? []).map(say).filter(Boolean),
    ...(image ? { image } : {}),
  };
}

/** Whether a shown tile has a face worth flipping to: a medium or wide tile shows it in turn with the icon. */
export const hasLiveFace = (t: ShownTile | null | undefined): t is ShownTile => Boolean(t && (t.title || t.lines.length || t.image));
