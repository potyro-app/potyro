// Point at the app (#284): which part of the app the person pointed at — read off the screen, said
// in words, and found in the source.
//
// The screen side reads the same tags edit mode does (inline-targets.ts): `data-k-field` on a field's
// label, `data-k-page` on a page's tab and title, and `data-k-part` on every view (`today`, or a
// layout item's `today#1`, set by the views' ViewHost). A tap gives every part it is inside, the
// narrowest first — a button in a custom view, the view, the page — so the person can widen what
// they meant without having to hit a bigger target.
//
// The model is told in words ("the "Nights" list on the "Patterns" page") and shown the lines that
// declare it. The app itself is already in the conversation, once (the modify loop's rule), so this
// is a slice of it with its line numbers, never a second copy.

import { basePageId, type AppDefinition, type View } from "potyro";
import { humanizeKey } from "@potyro/views";
import type { ModifyContext } from "@potyro/generator/backends";
import { partRange, textSites, type SourcePart } from "./app-source.js";
import { SHELL_PARTS, normalizeText, type InlineTarget } from "./inline-targets.js";

/** A part of the app, by what it is rather than where it was on screen. Plain data: it is kept. */
export type PointRef =
  | { kind: "page"; page: string }
  /** A view: the page's own (`part` = the page id) or one item of its layout (`page#index`). */
  | { kind: "view"; part: string }
  | { kind: "field"; entity: string; field: string; part?: string }
  /** Something inside a custom view — the app's own JSX — by its text and what kind of thing it is. */
  | { kind: "element"; part: string; text: string; tag: string };

/** A part pointed at: what it is, a short label for the chip, and the words the model is told. */
export interface Pointed {
  ref: PointRef;
  label: string;
  words: string;
}

type Def = Pick<AppDefinition, "pages" | "entities">;

// ---- Words ------------------------------------------------------------------------------------

const VIEW_WORDS: Record<View["type"], string> = {
  list: "list",
  gallery: "gallery",
  table: "table",
  detail: "detail view",
  calendar: "calendar",
  map: "map",
  steps: "steps",
  checklist: "checklist",
  board: "board",
  timeline: "timeline",
  stats: "figures",
  chart: "chart",
  aggregate: "summary",
  custom: "custom view",
};
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (i: number): string => ORDINALS[i] ?? `${i + 1}th`;
const article = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

export function pageTitle(def: Def, id: string): string {
  const page = def.pages.find((p) => p.id === id);
  return typeof page?.title === "string" && page.title.trim() ? page.title : humanizeKey(id);
}

/** The view a part names, its title when it has one, and where it is. */
function viewAt(def: Def, part: string): { page: string; index: number | null; view: View | undefined; title?: string } {
  const page = basePageId(part);
  const hash = part.indexOf("#");
  const p = def.pages.find((x) => x.id === page);
  if (hash < 0) return { page, index: null, view: p?.view ?? p?.layout?.items[0]?.view };
  const index = Number(part.slice(hash + 1));
  const item = p?.layout?.items[index];
  return { page, index, view: item?.view, ...(item?.title ? { title: item.title } : {}) };
}

/** "the "Nights" list on the "Patterns" page" — and the short form, for the chip. */
function describeView(def: Def, part: string): { label: string; words: string; within: string } {
  const { page, index, view, title } = viewAt(def, part);
  const word = view ? VIEW_WORDS[view.type] : "view";
  const on = `the "${pageTitle(def, page)}" page`;
  if (index === null) return { label: `${cap(word)} · ${pageTitle(def, page)}`, words: `the ${word} on ${on}`, within: `in the ${word} on ${on}` };
  if (title) return { label: `“${title}” ${word}`, words: `the "${title}" ${word} on ${on}`, within: `in the "${title}" part of ${on}` };
  return {
    label: `${cap(word)} · ${pageTitle(def, page)}`,
    words: `the ${ordinal(index)} part of ${on} (${article(word)})`,
    within: `in the ${ordinal(index)} part of ${on}`,
  };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function describePoint(ref: PointRef, def: Def): Pointed {
  if (ref.kind === "page") {
    const t = pageTitle(def, ref.page);
    return { ref, label: `“${t}” page`, words: `the "${t}" page` };
  }
  if (ref.kind === "view") {
    const { label, words } = describeView(def, ref.part);
    return { ref, label, words };
  }
  if (ref.kind === "field") {
    const entity = def.entities[ref.entity];
    const field = entity?.fields[ref.field] as { label?: string } | undefined;
    const name = field?.label ?? humanizeKey(ref.field);
    const of = entity?.label ?? humanizeKey(ref.entity);
    const where = ref.part ? `, as shown ${describeView(def, ref.part).within}` : "";
    return { ref, label: `“${name}” field`, words: `the "${name}" field of ${of}${where}` };
  }
  const thing = ref.text ? `the "${ref.text}" ${ref.tag}` : `${article(ref.tag)}`;
  const label = ref.text ? `“${ref.text}” ${ref.tag}` : cap(ref.tag);
  return { ref, label, words: `${thing} ${describeView(def, ref.part).within}` };
}

/** The same part, so pointing at it twice is one target, not two. */
export function samePoint(a: PointRef, b: PointRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- The screen -------------------------------------------------------------------------------

/** What, inside a custom view, is a thing a person would name: "the Start button", "the heading". */
const NAMEABLE: ReadonlyArray<[string, string]> = [
  ["button, [role=button]", "button"],
  ["a[href]", "link"],
  ["h1, h2, h3, h4, h5, h6", "heading"],
  ["input, textarea, select", "box"],
  ["img, svg, canvas, video", "picture"],
  ["label", "label"],
  ["li, tr", "row"],
  ["p, td, th, figcaption, blockquote", "text"],
];

const MAX_TEXT = 60;

function nameOf(el: Element): string {
  const own = normalizeText(el.textContent ?? "");
  const named = own || el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title") || "";
  return named.length > MAX_TEXT ? `${named.slice(0, MAX_TEXT - 1).trimEnd()}…` : named;
}

/**
 * The nameable element around `el`, inside the custom view `within`, or null. By kind first, then
 * nearness: the icon inside a button is the button, and a button inside a row is the button.
 */
function nameable(el: Element, within: Element): { el: Element; tag: string } | null {
  for (const [selector, tag] of NAMEABLE) {
    const at = el.closest(selector);
    if (at && at !== within && within.contains(at)) return { el: at, tag };
  }
  return null;
}

/**
 * Every part of the app `el` is in, narrowest first. Empty when `el` is the shell's own, not the
 * app's. `currentPage` is the page on screen, for what belongs to no view (the page's own bar).
 */
export function pointsAt(el: Element, currentPage: string | null): PointRef[] {
  if (el.closest(SHELL_PARTS)) return [];
  const out: PointRef[] = [];
  // A layout item's title is beside its view, not in it: it names that view all the same.
  const partEl = el.closest("[data-k-part]") ?? el.closest(".k-layout-item")?.querySelector("[data-k-part]") ?? null;
  const part = partEl?.getAttribute("data-k-part") ?? null;

  if (partEl && part && partEl.hasAttribute("data-k-custom") && partEl.contains(el)) {
    const found = nameable(el, partEl);
    if (found) out.push({ kind: "element", part, text: nameOf(found.el), tag: found.tag });
  }
  const fieldEl = el.closest("[data-k-field]");
  if (fieldEl) {
    const [entity, field] = (fieldEl.getAttribute("data-k-field") ?? "").split(".");
    if (entity && field) out.push({ kind: "field", entity, field, ...(part ? { part } : {}) });
  }
  if (part) {
    out.push({ kind: "view", part });
    // A layout item is one part of its page, so the page is the next thing out. A page's only view
    // IS the page, as far as the source goes: offering both would be one choice twice.
    if (part.includes("#")) out.push({ kind: "page", page: basePageId(part) });
    return out;
  }
  // A tab or a page title names its own page (its icon too, which carries no tag); anything else in
  // the app's chrome is the page on screen.
  const pageEl = el.closest("[data-k-page]") ?? el.closest(".k-tab, .k-page-head")?.querySelector("[data-k-page]");
  const page = pageEl?.getAttribute("data-k-page") ?? currentPage;
  if (page) out.push({ kind: "page", page: basePageId(page) });
  return out;
}

/** The page on screen in `root`: its title, or the active tab when the title is not shown. */
export function currentPageIn(root: ParentNode): string | null {
  const el = root.querySelector(".k-page-title[data-k-page]") ?? root.querySelector('.k-tab[data-active="true"] [data-k-page]');
  return el?.getAttribute("data-k-page") ?? null;
}

/**
 * The element on screen that stands for a part, for drawing its outline: the narrowest element
 * that holds it. A view's wrapper lays nothing out (`display: contents`), so its box is its
 * contents' — `boxOf` measures that.
 */
export function elementFor(ref: PointRef, from: Element, root: Element): Element | null {
  if (ref.kind === "element") {
    const partEl = from.closest("[data-k-part]");
    return partEl ? (nameable(from, partEl)?.el ?? null) : null;
  }
  if (ref.kind === "field") return from.closest("[data-k-field]");
  if (ref.kind === "view") {
    // A layout item's own frame (its title and its view) reads as the part better than the view alone.
    return from.closest(".k-layout-item") ?? from.closest("[data-k-part]");
  }
  // A page: its tab when that is what was pointed at, otherwise everything the page shows.
  return from.closest(".k-tab") ?? from.closest(".k-page-head") ?? root.querySelector(".k-main") ?? root;
}

/** The box a part takes on screen, `display: contents` included. */
export function boxOf(el: Element): DOMRect {
  const own = el.getBoundingClientRect();
  if (own.width || own.height) return own;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
}

/** Edit mode's target as a part to point at — "More changes…" carries it into the Studio. */
export function pointFromInline(target: InlineTarget): PointRef | null {
  if (target.kind === "page") return { kind: "page", page: target.page.id };
  const part = target.node.parentElement?.closest("[data-k-part]")?.getAttribute("data-k-part") ?? undefined;
  if (target.kind === "field") return { kind: "field", entity: target.entity.key, field: target.field.key, ...(part ? { part } : {}) };
  const el = target.node.parentElement;
  const partEl = el?.closest("[data-k-part][data-k-custom]");
  if (el && partEl && part) return { kind: "element", part, text: target.text, tag: nameable(el, partEl)?.tag ?? "text" };
  return part ? { kind: "view", part } : null;
}

// ---- The source -------------------------------------------------------------------------------

/** More than this many lines of the app is not a slice of it. */
const MAX_LINES = 40;
/** Lines kept either side of the text that was pointed at, when what holds it is longer than that. */
const AROUND = 12;

async function sourcePartOf(source: string, ref: PointRef): Promise<{ part: SourcePart; focus?: number } | null> {
  const viewPart = (part: string): SourcePart => {
    const hash = part.indexOf("#");
    return hash < 0 ? { kind: "page", page: part } : { kind: "item", page: basePageId(part), index: Number(part.slice(hash + 1)) };
  };
  if (ref.kind === "page") return { part: { kind: "page", page: ref.page } };
  if (ref.kind === "view") return { part: viewPart(ref.part) };
  if (ref.kind === "field") return { part: { kind: "field", entity: ref.entity, field: ref.field } };
  // Found by its words, where the app writes them: the component around them is the part.
  const text = ref.text.replace(/…$/, "");
  const site = text ? (await textSites(source)).find((s) => (ref.text.endsWith("…") ? s.text.startsWith(text) : s.text === text)) : undefined;
  if (site) return { part: { kind: "around", offset: site.start }, focus: site.start };
  return { part: viewPart(ref.part) };
}

const lineAt = (source: string, offset: number): number => source.slice(0, offset).split("\n").length;

/** The lines of `source` that declare what was pointed at: 1-based and inclusive, with the text. */
export async function pointSlice(source: string, ref: PointRef): Promise<{ lines: [number, number]; excerpt: string } | null> {
  const found = await sourcePartOf(source, ref);
  const range = found ? await partRange(source, found.part) : null;
  if (!found || !range) return null;
  const all = source.split("\n");
  let first = lineAt(source, range.start);
  let last = lineAt(source, range.end);
  if (last - first + 1 > MAX_LINES) {
    if (found.focus !== undefined) {
      const at = lineAt(source, found.focus);
      first = Math.max(first, at - AROUND);
      last = Math.min(last, at + AROUND);
    } else {
      last = first + MAX_LINES - 1;
    }
  }
  return { lines: [first, last], excerpt: all.slice(first - 1, last).join("\n") };
}

/** What the model is told about the part, beside the request (#284). */
export async function pointContext(source: string | null, pointed: Pointed): Promise<ModifyContext> {
  const slice = source ? await pointSlice(source, pointed.ref) : null;
  return { pointedAt: { words: pointed.words, ...(slice ? { lines: slice.lines, excerpt: slice.excerpt } : {}) } };
}
