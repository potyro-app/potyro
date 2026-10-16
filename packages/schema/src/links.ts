// What a link may hand a page (docs/24 §11): the page's own declared `link.params`, as text, capped.
//
// One place for the limits, because two sides apply them: the host when an app MAKES a link
// (`ctx.ui.share({ app })` — a mistake there is the app's bug, and says so), and the shell when a
// link ARRIVES (anyone can write a link — what does not fit is dropped, silently).
import type { Page } from "./types/app.js";

export const LINK_LIMITS = {
  /** Params a link carries at most. */
  params: 8,
  /** Characters in one param's value. A code, a name, a record id — never a document. */
  chars: 200,
} as const;

/** A param's name: a plain identifier, so it reads the same in a URL and in `ctx.params`. */
export const LINK_PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

/** The names a page takes from a link (its `link.params`), the ones that are names at all. */
export function linkParamsOf(page: Pick<Page, "link"> | undefined): string[] {
  const declared = page?.link?.params;
  return Array.isArray(declared) ? declared.filter((n) => typeof n === "string" && LINK_PARAM_NAME.test(n)) : [];
}

/**
 * What an arriving link may set on a page: its declared names, with a text value no longer than the
 * cap — and nothing else. Never throws: an unknown name, a value too long or not text, is left out.
 */
export function acceptLinkParams(page: Pick<Page, "link"> | undefined, raw: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Array<[string, string]> = [];
  for (const name of linkParamsOf(page).slice(0, LINK_LIMITS.params)) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const value = raw[name];
    if (typeof value === "string" && value.length <= LINK_LIMITS.chars) out.push([name, value]);
  }
  // Own properties, whatever the names: `__proto__` from a link is a name, never a prototype.
  return Object.fromEntries(out);
}

/**
 * The page and params an app asked a link for, or why not (the maker's side: a mistake is the app's
 * bug, so it is said, not dropped). `pages` are the app's declared pages.
 */
export function checkLinkRequest(
  req: unknown,
  pages: ReadonlyArray<Pick<Page, "id" | "link">>,
): { page: string; params: Record<string, string> } {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("ui.share: `app` must be { page, params? }");
  const { page, params } = req as { page?: unknown; params?: unknown };
  const target = typeof page === "string" ? pages.find((p) => p.id === page) : undefined;
  if (!target) throw new Error(`ui.share: \`app.page\` must be one of this app's pages (${pages.map((p) => p.id).join(", ")})`);
  if (params === undefined || params === null) return { page: target.id, params: {} };
  if (typeof params !== "object" || Array.isArray(params)) throw new Error("ui.share: `app.params` must be { name: text }");
  const declared = linkParamsOf(target);
  const out: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
    if (!declared.includes(name)) {
      throw new Error(`ui.share: the "${target.id}" page does not take \`${name}\` from a link — declare it: link: { params: ["${name}"] }`);
    }
    if (typeof value !== "string") throw new Error(`ui.share: \`app.params.${name}\` must be text`);
    if (value.length > LINK_LIMITS.chars) throw new Error(`ui.share: \`app.params.${name}\` is longer than ${LINK_LIMITS.chars} characters`);
    out.push([name, value]);
  }
  if (out.length > LINK_LIMITS.params) throw new Error(`ui.share: a link carries at most ${LINK_LIMITS.params} params`);
  return { page: target.id, params: Object.fromEntries(out) };
}
