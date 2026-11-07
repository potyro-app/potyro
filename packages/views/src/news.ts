// "Changed by someone else since you last looked" — the mark a row carries (KA-36).
//
// The shell knows the watermark (its own, local, per app); the views know the rows. This context
// is the seam: the shell says WHEN the person last looked, a row answers whether it moved after
// that by a hand other than theirs, off the `updatedAt`/`updatedBy` the store stamps. Absent (no
// provider, or a store that keeps no log) nothing is marked — a local-only app has no "someone else".

import { createContext, useContext } from "react";
import type { PotyroRuntime } from "@potyro/runtime";

export interface News {
  /** When the person last looked, as epoch ms; 0 = never, so everything by others is news. */
  since: number;
}

export const NewsContext = createContext<News | null>(null);

/** Whether `row` changed after the person last looked, by someone else. */
export function isNews(news: News | null, me: string | undefined, row: { updatedAt?: unknown; updatedBy?: unknown }): boolean {
  if (!news) return false;
  const by = typeof row.updatedBy === "string" ? row.updatedBy : "";
  if (!by || by === me) return false;
  const at = Date.parse(String(row.updatedAt ?? ""));
  return Number.isFinite(at) && at > news.since;
}

/** A predicate for the rows a view renders, bound to the person and the watermark. */
export function useNews(runtime: PotyroRuntime): (row: { updatedAt?: unknown; updatedBy?: unknown }) => boolean {
  const news = useContext(NewsContext);
  const me = runtime.ctx.me?.id;
  return (row) => isNews(news, me, row);
}
