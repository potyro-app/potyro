// Every fact Ask proposes carries its evidence, and the evidence is checked (#213).
//
// The failure this exists for: a search returned a stale directory page ("Alter ego … menù vegano …
// Via Santa Croce 20 Cuneo" — a bar in another town, not vegetarian), and the model copied it into the
// person's app with nothing between the page and the record. Nothing about that is specific to
// restaurants: a book with the wrong author, a concert on the wrong date, a price not on the page
// are the same failure in other apps. So the check is about text, not about any app:
//
//   - a proposed record names its evidence — a URL and a quote from it — or says it is general
//     knowledge (a recipe, an exercise);
//   - a quote counts only if it is IN the text that was actually retrieved for that request, and the
//     record's name is in a counted quote: a quote the model wrote itself counts for nothing;
//   - independent sites are counted: one site is labelled as one site.
//
// This is mechanical on purpose — no model judges here, so none can talk its way past it. Whether the
// quoted text actually says what the record says ("a bar", not "a vegetarian restaurant") is the
// second model's job (verify-claims.ts), reading only this same retrieved text.

import type { AppDefinition } from "karta";

export interface Evidence {
  url: string;
  quote: string;
}

/**
 * Whether the THING exists, by what was read: corroborated — two or more sites name it; single — one
 * site does (and, with web search on, a search for it found no other); general — general knowledge,
 * no source; unsupported — nothing read supports it; contradicted — a source says it is something
 * else. Its details are judged separately, field by field (`fieldIssues`).
 */
export type TrustStatus = "corroborated" | "single" | "general" | "unsupported" | "contradicted";

/** A detail its sources dispute (dropped unless the person keeps it) or do not state (kept, noted). */
export interface FieldIssue {
  kind: "contradicted" | "unsupported";
  why: string;
}

export interface Trust {
  status: TrustStatus;
  /** The quotes that were found in retrieved text, one per site at most. */
  sources: Array<{ url: string; host: string; quote: string }>;
  /** Why it is not trusted, in words for the person. */
  issues: string[];
  /** Per field: what its sources dispute, or do not state. */
  fieldIssues?: Record<string, FieldIssue>;
}

/** Below this, a "quote" is a word or two, which proves nothing. */
const MIN_QUOTE = 12;

/** Case, accents and punctuation out; words separated by single spaces. */
export function normText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^(www|amp|m)\./, "");
    const path = u.pathname.replace(/\/amp\/?$/, "").replace(/\/+$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^(www|amp|m)\./, "");
  } catch {
    return url;
  }
}

/** Everything the model was shown during one request: search results and fetched pages, by address. */
export class Retrieved {
  private readonly byUrl = new Map<string, { url: string; text: string }>();

  add(url: string, text: string | undefined): void {
    if (!url || !text) return;
    const key = urlKey(url);
    const had = this.byUrl.get(key);
    // A page can come back from several searches, each with its own excerpts: keep them all.
    this.byUrl.set(key, { url, text: had && !had.text.includes(text) ? `${had.text}\n${text}` : text });
  }

  get size(): number {
    return this.byUrl.size;
  }

  /** The retrieved text for this address, or null when the model cites a page it was never shown. */
  textOf(url: string): { url: string; text: string } | null {
    return this.byUrl.get(urlKey(url)) ?? null;
  }

  /** Where this quote actually is, if anywhere: its own page first, then anything retrieved. */
  locate(url: string, quote: string): { url: string; text: string } | null {
    const q = normText(quote);
    if (q.length < MIN_QUOTE) return null;
    const own = this.textOf(url);
    if (own && normText(own.text).includes(q)) return own;
    for (const page of this.byUrl.values()) if (normText(page.text).includes(q)) return page;
    return null;
  }

  pages(): Array<{ url: string; text: string }> {
    return [...this.byUrl.values()];
  }
}

/** What a record is called: its display field, else its first text value. */
export function nameOfRow(def: AppDefinition, entity: string, values: Record<string, unknown>): string | null {
  const e = def.entities[entity];
  const by = e?.displayField;
  const v = by ? values[by] : Object.entries(e?.fields ?? {}).find(([k, f]) => f.type === "text" && typeof values[k] === "string")?.[0];
  const value = by ? v : typeof v === "string" ? values[v] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Around a name in a page: the sentence-ish window a person (and the checking model) reads. */
function around(text: string, name: string): string {
  const at = text.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  const start = Math.max(0, at - 120);
  const end = Math.min(text.length, at + name.length + 180);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Shorter than this, a name matches pages that are about something else ("It", "Bar"). */
const MIN_NAME = 4;

/**
 * Check one proposed record against what was retrieved. The device looks for the record's name in
 * every page itself; quotes the model sent count as well when they are found. `general` only labels a
 * record no page names — it does not exempt one.
 */
export function verifyRow(
  def: AppDefinition,
  row: { entity: string; values: Record<string, unknown>; evidence?: unknown; general?: unknown },
  retrieved: Retrieved,
): Trust {
  const issues: string[] = [];
  const found: Array<{ url: string; host: string; quote: string }> = [];
  const name = nameOfRow(def, row.entity, row.values);
  const key = name ? normText(name) : "";

  if (key.length >= MIN_NAME) {
    for (const page of retrieved.pages()) {
      if (` ${normText(page.text)} `.includes(` ${key} `)) found.push({ url: page.url, host: hostOf(page.url), quote: around(page.text, name!) });
    }
  }

  const evidence = (Array.isArray(row.evidence) ? row.evidence : []).filter(
    (e): e is Evidence => typeof e === "object" && e !== null && typeof (e as Evidence).url === "string" && typeof (e as Evidence).quote === "string",
  );
  for (const e of evidence) {
    const page = retrieved.locate(e.url, e.quote);
    if (!page) {
      issues.push(`“${e.quote.slice(0, 80)}” is not in the text retrieved from ${hostOf(e.url)}.`);
      continue;
    }
    // A quote that names the record, or a record too short to search for by name.
    if (key.length < MIN_NAME || normText(e.quote).includes(key)) found.push({ url: page.url, host: hostOf(page.url), quote: e.quote });
  }

  // One per site: two pages of the same site are not two sources.
  const perSite = [...new Map(found.map((f) => [f.host, f])).values()];
  if (perSite.length) return { status: perSite.length >= 2 ? "corroborated" : "single", sources: perSite, issues };
  if (row.general === true) return { status: "general", sources: [], issues: [] };
  return { status: "unsupported", sources: [], issues: [name ? `No page that was read mentions “${name}”.` : "Nothing that was read supports it.", ...issues] };
}
