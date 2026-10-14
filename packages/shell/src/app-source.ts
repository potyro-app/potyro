// Direct, structural edits to an app's source — renaming a label, hiding a field, reordering fields,
// retitling a page — without a model in the loop.
//
// These are edits to the DECLARATIVE half of a module (CLAUDE.md rule 4): plain data, already
// Zod-validated, so nothing here can grant app code a power it didn't have. That is what makes them
// safe to apply directly, and it is exactly why they should NOT go through the agent: asking a
// language model to rename a string means it rewrites the whole file, including your functions, to
// change six characters.
//
// ## Parse for positions, splice text, never reprint
//
// The obvious implementation — parse, mutate the AST, print it back — reformats the entire file and
// mangles comments. The source here is versioned and diffed, so a label change that reflows 300
// lines makes History useless. Instead the parser is used ONLY to find byte ranges, and the edit is a
// text splice. Everything outside the edited range is byte-identical by construction rather than by
// a printer's best effort.
//
// ## It reports what it cannot do
//
// An app is free to build its entities from a helper, a spread, or computed keys. Then there is no
// literal to edit and `inspect` says so, naming the reason — the UI renders no control and routes
// that change to the agent instead. Guessing here would corrupt someone's app.

import type MagicStringType from "magic-string";
import {
  asArray,
  findDefinition,
  hasOpaqueMembers,
  keyOf,
  literalLanguages,
  literalString,
  literalWords,
  load,
  parseModule,
  prop,
  propValue,
  type JsonLiteral,
  type Node,
  type Tools,
} from "./source-ast.js";
import { setWordsEntry, wordsMapOf } from "./app-source-words.js";

export { resetSourceTools, type JsonLiteral } from "./source-ast.js";
export { declaredEntities, declaredLanguages, type DeclaredEntity } from "./source-declared.js";

/** A property this module knows how to edit. */
export type Edit =
  /** `language`: write that entry of a translated label (#302); without it, the label is replaced. */
  | { kind: "field-label"; entity: string; field: string; value: string; language?: string }
  | { kind: "field-hidden"; entity: string; field: string; value: boolean }
  | { kind: "field-order"; entity: string; order: readonly string[] }
  /** The new field lists of the entity's groups, one per existing group, in order (#100). */
  | { kind: "field-groups"; entity: string; groups: readonly (readonly string[])[] }
  | { kind: "page-title"; page: string; value: string; language?: string }
  /** The pages in their new order — every page id there is now, once (edit mode's tab moves). */
  | { kind: "page-order"; order: readonly string[] }
  /** Replace the text `from` at each of `sites` (edit mode's in-place rename). Every site must still
   *  hold `from` where `textSites` found it, or nothing is changed. */
  | { kind: "text"; from: string; sites: readonly TextSite[]; value: string };

/**
 * A piece of text the app shows, written as a literal we can splice.
 *
 * `start`/`end` cover the whole literal for a string (quotes included) and the text itself for JSX
 * text (the whitespace around it stays). `text` is what renders: for JSX, runs of whitespace
 * collapse to one space, which is also what the DOM ends up holding.
 */
export interface TextSite {
  start: number;
  end: number;
  text: string;
  form: "string" | "template" | "jsx";
}

export type EditResult = { ok: true; source: string; note: string } | { ok: false; reason: string };

/** What is editable about one field, as found in the source. */
export interface FieldShape {
  key: string;
  /** The declared `label`, when there is one. Absent means the app leans on the key. */
  label?: string;
  /** A `label` is written, but not as a plain string — renaming it would overwrite that code. */
  labelOpaque?: boolean;
  /** The label per language, when it is a literal translation map (#302): one input each. */
  labels?: Record<string, string>;
  hidden: boolean;
}

/** One of the entity's `groups`, as written: its title and the keys it lists (fields or computed). */
export interface GroupShape {
  title?: string;
  /** The title per language, when it is a literal translation map (#302). */
  titles?: Record<string, string>;
  fields: string[];
}

export interface EntityShape {
  key: string;
  fields: FieldShape[];
  /** The declared `groups`, when written as literal arrays of field names (#100). */
  groups?: GroupShape[];
  /** Computed keys, so a group listing one can be told apart from a group naming nothing. */
  computed?: string[];
  /** Absent when every field is a literal. Otherwise why this entity can't be reordered/edited. */
  blocked?: string;
}

export interface PageShape {
  id: string;
  title?: string;
  /** A `title` is written, but not as a plain string — renaming it would overwrite that code. */
  titleOpaque?: boolean;
  /** The title per language, when it is a literal translation map (#302). */
  titles?: Record<string, string>;
  /** The entity this page's view reads, when it names one. */
  entity?: string;
  /** Declared `hidden`. Hidden pages are reached by tapping a row, not from the tab bar. */
  hidden: boolean;
  /** The view's `type`, so callers can tell a tab from a per-record detail page. */
  viewType?: string;
}

export interface AppShape {
  entities: EntityShape[];
  pages: PageShape[];
  /** The app's declared identity, when written literally: what a launcher tile shows without
   *  running the app (#82). */
  name?: string;
  /** The name per language, when it is written as a translation map (#302). */
  names?: Record<string, string>;
  /** The app's own language and every one it carries, when written literally (#302). */
  language?: string;
  languages?: string[];
  icon?: string;
  /** `theme.accent`. */
  accent?: string;
  /** Set when the module itself can't be read structurally at all. */
  blocked?: string;
}


/**
 * Does the app DECLARE that it syncs (`permissions: { sync: true }`)? (KA-23)
 *
 * Read from the source rather than from a loaded definition, because the answer is needed before
 * the app runs: it decides which store to open, and an untrusted app must not be handed a synced
 * one to find out. `null` means the module could not be read structurally — the app said nothing we
 * can trust either way, which the caller must treat as "did not ask", never as "asked".
 */
export async function declaredSync(source: string): Promise<boolean | null> {
  const t = await load();
  if (!t) return null;
  const ast = parseModule(t, source);
  if (!ast) return null;
  const def = findDefinition(ast);
  if (!def) return null;
  const permissions = propValue(def, "permissions");
  if (permissions?.type !== "ObjectExpression") return permissions ? null : false;
  const sync = propValue(permissions, "sync");
  if (!sync) return false;
  return sync.type === "BooleanLiteral" ? Boolean(sync.value) : null;
}

/**
 * The capabilities the app declares (`permissions: { camera: true }`), for the trust dialog when the
 * app is not running — it failed to open sealed, or it is a tile on your apps. `[]` when it declares
 * none; `null` when they are not written literally (a helper, a spread, a value decided at run time)
 * or the module cannot be read, which the dialog says instead of "nothing".
 */
export async function declaredPermissions(source: string): Promise<string[] | null> {
  const t = await load();
  if (!t) return null;
  const ast = parseModule(t, source);
  if (!ast) return null;
  const def = findDefinition(ast);
  if (!def) return null;
  const permissions = propValue(def, "permissions");
  if (!permissions) return prop(def, "permissions") || hasOpaqueMembers(def) ? null : [];
  if (permissions.type !== "ObjectExpression" || hasOpaqueMembers(permissions)) return null;
  const out: string[] = [];
  for (const p of asArray(permissions.properties)) {
    const value = p.value as Node;
    if (value.type !== "BooleanLiteral") return null;
    if (value.value === true) out.push(keyOf(p) ?? "");
  }
  return out.filter(Boolean);
}

/** The entity's `groups` when every group is `{ title?, fields: ["a", "b"] }` written out; `undefined`
 *  when there are none; `"opaque"` when there are groups this cannot read (a helper call, a spread). */
function literalGroups(node: Node | null): GroupShape[] | undefined | "opaque" {
  if (!node) return undefined;
  if (node.type !== "ArrayExpression") return "opaque";
  const out: GroupShape[] = [];
  for (const el of asArray(node.elements)) {
    if (el?.type !== "ObjectExpression" || hasOpaqueMembers(el)) return "opaque";
    const fieldsNode = propValue(el, "fields");
    if (fieldsNode?.type !== "ArrayExpression") return "opaque";
    const fields: string[] = [];
    for (const f of asArray(fieldsNode.elements)) {
      const key = literalString(f ?? null);
      if (key === undefined) return "opaque";
      fields.push(key);
    }
    const titleNode = propValue(el, "title");
    const title = literalString(titleNode);
    const titles = wordsMapOf(titleNode);
    out.push({ ...(title !== undefined ? { title } : {}), ...(titles ? { titles } : {}), fields });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading

// ---------------------------------------------------------------------------------------------
// Where a part of the app is written (#284)
//
// Point mode tells the model which part of the app the person pointed at, and shows it the lines
// that declare it — a slice of the app already in the conversation, never the app a second time.

/** A part of the app, as point mode names it. */
export type SourcePart =
  | { kind: "page"; page: string }
  /** One item of a page's `layout`. */
  | { kind: "item"; page: string; index: number }
  | { kind: "field"; entity: string; field: string }
  /** What encloses a position: the outermost function around it — a custom view's component. */
  | { kind: "around"; offset: number };

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod"]);

/** The page object literal in `pages` whose `id` is `id`. */
function pageNode(def: Node, id: string): Node | null {
  const pages = propValue(def, "pages");
  if (pages?.type !== "ArrayExpression") return null;
  return asArray(pages.elements).find((el) => el?.type === "ObjectExpression" && literalString(propValue(el, "id")) === id) ?? null;
}

function outermostFunctionAround(ast: Node, offset: number): Node | null {
  let found: Node | null = null;
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    const node = n as Node;
    if (typeof node.type !== "string") return;
    if (typeof node.start === "number" && (offset < node.start || offset >= node.end) && node.type !== "File" && node.type !== "Program") return;
    if (FUNCTIONS.has(node.type)) {
      found = node;
      return;
    }
    for (const [k, value] of Object.entries(node)) {
      if (k === "leadingComments" || k === "trailingComments" || k === "innerComments" || k === "extra" || k === "loc") continue;
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(ast);
  return found;
}

/** Where `part` is written in `source`, as offsets; null when it is not written where it can be found. */
export async function partRange(source: string, part: SourcePart): Promise<{ start: number; end: number } | null> {
  const t = await load();
  const ast = t ? parseModule(t, source) : null;
  if (!ast) return null;
  const at = (node: Node | null | undefined): { start: number; end: number } | null => (node ? { start: node.start, end: node.end } : null);
  if (part.kind === "around") return at(outermostFunctionAround(ast, part.offset));
  const def = findDefinition(ast);
  if (!def) return null;
  if (part.kind === "page") return at(pageNode(def, part.page));
  if (part.kind === "item") {
    const items = propValue(propValue(pageNode(def, part.page), "layout"), "items");
    return items?.type === "ArrayExpression" ? at(asArray(items.elements)[part.index]) : null;
  }
  const entity = propValue(propValue(def, "entities"), part.entity);
  return at(prop(propValue(entity, "fields"), part.field));
}

/**
 * What this module can edit in `source`, and where it can't, with reasons.
 *
 * The UI renders controls from THIS, never from the schema — so a control can only exist when there
 * is a real source position behind it, and the panel cannot offer an edit it is unable to make.
 */
export async function inspect(source: string): Promise<AppShape> {
  const t = await load();
  if (!t) return { entities: [], pages: [], blocked: "the source editor could not be loaded" };
  const ast = parseModule(t, source);
  if (!ast) return { entities: [], pages: [], blocked: "this source could not be parsed" };
  const def = findDefinition(ast);
  if (!def) {
    return { entities: [], pages: [], blocked: "this app doesn't call defineApp with a plain object, so it can't be edited directly" };
  }

  const entities: EntityShape[] = [];
  const entitiesNode = propValue(def, "entities");
  if (entitiesNode?.type === "ObjectExpression") {
    for (const ep of asArray(entitiesNode.properties)) {
      if (ep.type !== "ObjectProperty" || ep.computed === true) continue;
      const name = keyOf(ep);
      if (!name) continue;
      const fieldsNode = propValue(ep.value as Node, "fields");
      if (fieldsNode?.type !== "ObjectExpression") {
        entities.push({ key: name, fields: [], blocked: "this entity's fields aren't written as a plain object" });
        continue;
      }
      if (hasOpaqueMembers(fieldsNode)) {
        entities.push({ key: name, fields: [], blocked: "some of these fields come from a spread or a computed key, not a literal" });
        continue;
      }
      const fields: FieldShape[] = [];
      for (const fp of asArray(fieldsNode.properties)) {
        const key = keyOf(fp);
        if (!key) continue;
        const value = fp.value as Node;
        // A field written as anything but an object literal (a helper call, a shared const) can be
        // listed and reordered, but its own properties aren't ours to touch.
        const labelNode = value.type === "ObjectExpression" ? propValue(value, "label") : null;
        const label = literalString(labelNode);
        const hiddenNode = value.type === "ObjectExpression" ? propValue(value, "hidden") : null;
        const labels = wordsMapOf(labelNode);
        fields.push({
          key,
          hidden: hiddenNode?.type === "BooleanLiteral" && hiddenNode.value === true,
          ...(label ? { label } : {}),
          ...(labels ? { labels } : {}),
          ...(labelNode && label === undefined && !labels ? { labelOpaque: true } : {}),
        });
      }
      const groups = literalGroups(propValue(ep.value as Node, "groups"));
      if (groups === "opaque") {
        entities.push({ key: name, fields, blocked: "this entity's groups aren't written as plain lists of field names" });
        continue;
      }
      const computedNode = propValue(ep.value as Node, "computed");
      const computed =
        computedNode?.type === "ObjectExpression" ? asArray(computedNode.properties).map(keyOf).filter((k): k is string => Boolean(k)) : [];
      entities.push({ key: name, fields, ...(groups ? { groups } : {}), ...(computed.length ? { computed } : {}) });
    }
  }

  const pages: PageShape[] = [];
  const pagesNode = propValue(def, "pages");
  if (pagesNode?.type === "ArrayExpression") {
    for (const el of asArray(pagesNode.elements)) {
      if (el?.type !== "ObjectExpression") continue;
      const id = literalString(propValue(el, "id"));
      if (!id) continue;
      const view = propValue(el, "view");
      const hiddenNode = propValue(el, "hidden");
      const titleNode = propValue(el, "title");
      pages.push({
        id,
        hidden: hiddenNode?.type === "BooleanLiteral" && hiddenNode.value === true,
        ...(literalString(titleNode) !== undefined ? { title: literalString(titleNode)! } : {}),
        ...(wordsMapOf(titleNode) ? { titles: wordsMapOf(titleNode)! } : {}),
        ...(titleNode && literalString(titleNode) === undefined && !wordsMapOf(titleNode) ? { titleOpaque: true } : {}),
        ...(literalString(propValue(view, "entity")) !== undefined ? { entity: literalString(propValue(view, "entity"))! } : {}),
        ...(literalString(propValue(view, "type")) !== undefined ? { viewType: literalString(propValue(view, "type"))! } : {}),
      });
    }
  }

  const words = literalWords(propValue(def, "name"));
  const icon = literalString(propValue(def, "icon"));
  const accent = literalString(propValue(propValue(def, "theme"), "accent"));
  const langs = literalLanguages(def);
  const name = typeof words === "string" ? words : words && langs.language ? words[langs.language] : undefined;
  return {
    entities,
    pages,
    ...(name ? { name } : {}),
    ...(words && typeof words === "object" ? { names: words } : {}),
    ...langs,
    ...(icon ? { icon } : {}),
    ...(accent ? { accent } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Text the app shows

/**
 * Keys whose string value is TEXT ON SCREEN — in the definition (`label`, `title`, `help`…) and as
 * props of an app's own component (`<Step label="…">`).
 *
 * Not `placeholder`, `alt` or `aria-label`: those are never a text node, so pairing them with the
 * text on screen can only ever match something else — a record called "Milk" matched the name
 * field's `placeholder: "Milk"` and was offered for renaming.
 */
const DISPLAY_KEYS = new Set([
  "label", "title", "name", "help", "text", "description", "subtitle", "heading",
  "caption", "hint", "message", "empty", "emptyText", "emptyLabel",
]);

/** Nodes a display string can sit inside and still be what renders: `{done ? "A" : "B"}`. */
const PASS_THROUGH = new Set(["ConditionalExpression", "LogicalExpression", "TSAsExpression", "TSSatisfiesExpression", "ParenthesizedExpression"]);

const attrName = (attr: Node): string | undefined => {
  const name = attr.name as { name?: unknown } | undefined;
  return typeof name?.name === "string" ? name.name : undefined;
};

/** Is the string node at the end of `ancestors` in a display position? */
function inDisplayPosition(node: Node, ancestors: readonly Node[]): boolean {
  let child = node;
  let i = ancestors.length - 1;
  // Climb out of `a ? "x" : "y"` and `ok && "x"` — but only through their result arms, never a test.
  while (i >= 0 && PASS_THROUGH.has(ancestors[i]!.type)) {
    const p = ancestors[i]!;
    if (p.type === "ConditionalExpression" && p.test === child) return false;
    if (p.type === "LogicalExpression" && p.left === child && p.operator !== "??") return false;
    child = p;
    i -= 1;
  }
  const parent = ancestors[i];
  if (!parent) return false;
  if (parent.type === "ObjectProperty") {
    const key = keyOf(parent);
    if (parent.value !== child || parent.computed === true || key === undefined) return false;
    if (DISPLAY_KEYS.has(key)) return true;
    // One language of a translation map (#302): `label: { en: "…", pl: "…" }`, `ctx.t({ en: "…" })`.
    const map = ancestors[i - 1];
    const holder = ancestors[i - 2];
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(key) || map?.type !== "ObjectExpression" || !holder) return false;
    if (holder.type === "ObjectProperty") return holder.value === map && DISPLAY_KEYS.has(keyOf(holder) ?? "");
    return holder.type === "CallExpression" && ((holder.callee as Node | undefined)?.property as Node | undefined)?.name === "t";
  }
  if (parent.type === "JSXAttribute") return renderedProp(parent, ancestors[i - 1]);
  if (parent.type === "JSXExpressionContainer") {
    const holder = ancestors[i - 1];
    if (holder?.type === "JSXAttribute") return renderedProp(holder, ancestors[i - 2]);
    return holder?.type === "JSXElement" || holder?.type === "JSXFragment";
  }
  return false;
}

/**
 * Does this JSX attribute's string end up as text? On an HTML element, never: `<button title="…">`
 * is a tooltip, `<input placeholder="…">` sits inside an empty box. On the app's own component a
 * display-named prop is what that component prints.
 */
function renderedProp(attr: Node, opening: Node | undefined): boolean {
  const tag = (opening?.name as { type?: string; name?: unknown } | undefined) ?? undefined;
  const intrinsic = tag?.type === "JSXIdentifier" && typeof tag.name === "string" && /^[a-z]/.test(tag.name);
  return !intrinsic && DISPLAY_KEYS.has(attrName(attr) ?? "");
}

/**
 * Every piece of text in `source` that edit mode can change in place.
 *
 * Positional, never textual: a string qualifies by WHERE it is written (a display key, JSX text, a
 * display prop), so `status === "done"` and an enum's `options` are never offered however much they
 * look like words. On top of that, a string that is also a key or an id somewhere in the module is
 * left out — `view: { title: "name" }` names a field, and renaming it would break the page.
 * Returns `[]` for source it cannot read; edit mode then has nothing to offer, which it says.
 */
export async function textSites(source: string): Promise<TextSite[]> {
  const t = await load();
  if (!t) return [];
  const ast = parseModule(t, source);
  return ast ? collectSites(source, ast) : [];
}

function collectSites(source: string, ast: Node): TextSite[] {
  const identifiers = new Set<string>();
  const found: { node: Node; ancestors: Node[] }[] = [];
  const walk = (n: unknown, ancestors: Node[]): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (typeof node.type !== "string") return;
    if (node.type === "ObjectProperty" || node.type === "ObjectMethod") {
      const key = keyOf(node);
      if (key) identifiers.add(key);
      const value = node.value as Node | undefined;
      if (key && ["id", "page", "entity", "field"].includes(key) && value?.type === "StringLiteral") identifiers.add(String(value.value));
    }
    if (node.type === "StringLiteral" || node.type === "JSXText" || (node.type === "TemplateLiteral" && asArray(node.expressions).length === 0)) {
      found.push({ node, ancestors });
    }
    const next = [...ancestors, node];
    for (const [k, value] of Object.entries(node)) {
      if (k === "leadingComments" || k === "trailingComments" || k === "innerComments" || k === "extra" || k === "loc") continue;
      if (Array.isArray(value)) for (const v of value) walk(v, next);
      else if (value && typeof value === "object") walk(value, next);
    }
  };
  walk(ast, []);

  const sites: TextSite[] = [];
  for (const { node, ancestors } of found) {
    const site = siteOf(source, node, ancestors);
    if (!site || !/\p{L}/u.test(site.text) || identifiers.has(site.text)) continue;
    sites.push(site);
  }
  return sites;
}

function siteOf(source: string, node: Node, ancestors: readonly Node[]): TextSite | null {
  if (node.type === "JSXText") {
    const raw = source.slice(node.start, node.end);
    // An entity (`&apos;`) renders as a different character than is written, so the DOM text would
    // never match — and splicing around one is easy to get wrong. Left to the Studio.
    if (raw.includes("&")) return null;
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim().replace(/\s+/g, " ");
    if (!text) return null;
    return { start: node.start + lead, end: node.start + lead + raw.trim().length, text, form: "jsx" };
  }
  if (!inDisplayPosition(node, ancestors)) return null;
  if (node.type === "StringLiteral") return { start: node.start, end: node.end, text: String(node.value), form: "string" };
  const quasi = asArray(node.quasis)[0] as { value?: { cooked?: string } } | undefined;
  const cooked = quasi?.value?.cooked;
  return typeof cooked === "string" ? { start: node.start, end: node.end, text: cooked, form: "template" } : null;
}

/** `value` written the way the site was: same quote, or as JSX text (braced when it needs to be). */
function writeText(source: string, site: TextSite, value: string): string {
  if (site.form === "jsx") {
    const flat = value.replace(/\s+/g, " ").trim();
    return /[{}<>&]/.test(flat) ? `{${JSON.stringify(flat)}}` : flat;
  }
  if (site.form === "template") return "`" + value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
  if (source[site.start] === "'") {
    return `'${JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------------------------
// Moving a field one step

/**
 * An entity's fields as the form lays them out: its groups in order, then the fields in no group
 * (#100). A field moves within its group, over a group's edge into the neighbouring one, or out of
 * the last group into the ungrouped run — each step one edit to the source. An entity without
 * groups is one ungrouped run, and moving there is the plain field reorder.
 */
interface Run {
  /** Index into `entity.groups`, or -1 for the ungrouped run. */
  group: number;
  keys: string[];
}

function runsOf(entity: EntityShape): Run[] {
  const groups = entity.groups ?? [];
  const placed = new Set(groups.flatMap((g) => g.fields));
  const runs: Run[] = groups.map((g, i) => ({ group: i, keys: [...g.fields] }));
  const rest = entity.fields.map((f) => f.key).filter((k) => !placed.has(k));
  if (rest.length || runs.length === 0) runs.push({ group: -1, keys: rest });
  return runs;
}

/** Move `from` to `to` in a copy of `keys`. */
function moved(keys: readonly string[], from: number, to: number): string[] {
  const next = [...keys];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** The edit that moves field `key` one step earlier (-1) or later (1), or null at a wall. */
export function fieldStep(entity: EntityShape, key: string, direction: -1 | 1): Edit | null {
  if (entity.blocked) return null;
  const runs = runsOf(entity);
  const r = runs.findIndex((run) => run.keys.includes(key));
  if (r < 0) return null;
  const run = runs[r]!;
  const index = run.keys.indexOf(key);
  const groups = (entity.groups ?? []).map((g) => [...g.fields]);
  const target = index + direction;
  if (target >= 0 && target < run.keys.length) {
    if (run.group < 0) {
      const order = entity.fields.map((f) => f.key);
      return { kind: "field-order", entity: entity.key, order: moved(order, order.indexOf(key), order.indexOf(run.keys[target]!)) };
    }
    groups[run.group] = moved(groups[run.group]!, index, target);
    return { kind: "field-groups", entity: entity.key, groups };
  }
  const neighbour = runs[r + direction];
  if (!neighbour) return null;
  if (run.group >= 0) {
    if (run.keys.length === 1) return null; // would leave the group empty — refused by the source
    groups[run.group] = groups[run.group]!.filter((k) => k !== key);
  }
  if (neighbour.group >= 0) {
    if (direction < 0) groups[neighbour.group] = [...groups[neighbour.group]!, key];
    else groups[neighbour.group] = [key, ...groups[neighbour.group]!];
  }
  // Out of the last group into the ungrouped run — the field simply stops being listed in a group.
  return { kind: "field-groups", entity: entity.key, groups };
}

// ---------------------------------------------------------------------------------------------
// Writing

/** JSON is a subset of TS literal syntax, so this is a safe way to emit a string/boolean. */
const literal = (v: string | boolean): string => JSON.stringify(v);

/** Set a property on an object literal, inserting it if absent. */
function setProperty(ms: MagicStringType, obj: Node, name: string, value: string): void {
  const existing = prop(obj, name);
  if (existing) {
    const v = existing.value as Node;
    ms.overwrite(v.start, v.end, value);
    return;
  }
  const first = asArray(obj.properties)[0];
  if (!first) {
    // `{}` — put the property between the braces.
    ms.appendLeft(obj.start + 1, ` ${name}: ${value} `);
    return;
  }
  ms.appendLeft(first.start, `${name}: ${value}, `);
}

/** Remove a property from an object literal, taking its trailing comma with it. */
function removeProperty(source: string, ms: MagicStringType, obj: Node, name: string): void {
  const existing = prop(obj, name);
  if (!existing) return;
  let end = existing.end;
  if (source[end] === ",") end += 1;
  while (end < source.length && (source[end] === " " || source[end] === "\t")) end += 1;
  ms.remove(existing.start, end);
}

/**
 * The full text of a property, including any comment written above it and its trailing comma.
 *
 * Reordering has to carry a field's comment with it, or the explanation ends up above whatever field
 * happens to land in that slot next — worse than no comment at all.
 *
 * Which comment is whose goes by LINE, not by the parser: Babel hands `{ … }, // the main list` to
 * the NEXT sibling as a leading comment. So a leading comment only counts when it starts its own
 * line, and a comment after the element on its last line is carried as the element's own.
 */
function extentOf(source: string, node: Node): { start: number; end: number; text: string; comment: string } {
  let start = node.start;
  for (const c of asArray(node.leadingComments)) {
    const ownLine = /^[ \t]*$/.test(source.slice(source.lastIndexOf("\n", c.start - 1) + 1, c.start));
    if (ownLine && c.start < start) start = c.start;
  }
  let end = node.end;
  if (source[end] === ",") end += 1;
  const text = source.slice(start, end);
  const trailing = /^[ \t]*(\/\/[^\n]*|\/\*[^\n]*?\*\/)[ \t]*(?=\n|$)/.exec(source.slice(end));
  if (trailing) end += trailing[0].length;
  return { start, end, text, comment: trailing?.[1] ?? "" };
}

/** Elements in their new order, one per line: a comma after each (the last only if `lastComma`),
 *  and each element's same-line comment after its comma, where it was. */
function joinRun(parts: readonly { text: string; comment: string }[], indent: string, lastComma: boolean): string {
  return parts
    .map(({ text, comment }, i) => {
      const body = text.trim().replace(/,$/, "");
      const comma = i < parts.length - 1 || lastComma ? "," : "";
      return `${body}${comma}${comment ? ` ${comment}` : ""}`;
    })
    .join(`\n${indent}`);
}

/** The indentation of the line `index` sits on. */
function indentAt(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, index));
  return match ? match[0] : "";
}

/**
 * Which field an entity falls back to for its human label, mirroring `displayFieldFor` in
 * @potyro/views. Reordering fields would otherwise silently change what every list row and relation
 * picker shows — see `pinDisplayField`.
 */
function effectiveDisplayField(entityNode: Node, order: readonly string[]): string | undefined {
  const declared = literalString(propValue(entityNode, "displayField"));
  if (declared) return declared;
  if (order.includes("name")) return "name";
  return order[0];
}

export async function applyEdit(source: string, edit: Edit): Promise<EditResult> {
  const t = await load();
  if (!t) return { ok: false, reason: "the source editor could not be loaded" };
  const ast = parseModule(t, source);
  if (!ast) return { ok: false, reason: "this source could not be parsed" };
  const def = findDefinition(ast);
  if (!def) return { ok: false, reason: "this app doesn't call defineApp with a plain object" };
  const ms = new t.MagicString(source);

  if (edit.kind === "text") {
    const value = edit.value.trim();
    if (!value) return { ok: false, reason: "the new text is empty" };
    if (edit.sites.length === 0) return { ok: false, reason: "there is nothing to change" };
    // Re-derive the sites from THIS source: offsets from an older read would splice the wrong bytes.
    const current = collectSites(source, ast);
    for (const site of edit.sites) {
      const still = current.find((c) => c.start === site.start && c.end === site.end && c.text === edit.from);
      if (!still) return { ok: false, reason: "the app changed since this text was read — try again" };
      ms.overwrite(still.start, still.end, writeText(source, still, value));
    }
    const where = edit.sites.length > 1 ? ` (${edit.sites.length} places)` : "";
    return finish(t, ms, `changed "${edit.from}" to "${value}"${where}`);
  }

  if (edit.kind === "page-order") {
    const pagesNode = propValue(def, "pages");
    if (pagesNode?.type !== "ArrayExpression") return { ok: false, reason: "this app's pages aren't a plain array" };
    const elements = asArray(pagesNode.elements);
    const ids = elements.map((el) => (el?.type === "ObjectExpression" ? literalString(propValue(el, "id")) : undefined));
    if (ids.length === 0 || ids.some((id) => id === undefined)) return { ok: false, reason: "some pages aren't written as plain objects with an id" };
    if ([...ids].sort().join("\0") !== [...edit.order].sort().join("\0")) {
      return { ok: false, reason: "the new order must contain exactly the pages that are there now" };
    }
    const indent = indentAt(source, elements[0]!.start);
    const byId = new Map(ids.map((id, i) => [id!, extentOf(source, elements[i]!)]));
    const first = byId.get(ids[0]!)!;
    const last = byId.get(ids[ids.length - 1]!)!;
    // Keep the array's own trailing-comma style: only the last page decides whether there is one.
    const trailing = last.text.trimEnd().endsWith(",");
    ms.overwrite(first.start, last.end, joinRun(edit.order.map((id) => byId.get(id)!), indent, trailing));
    return finish(t, ms, "reordered the pages");
  }

  if (edit.kind === "page-title") {
    const pagesNode = propValue(def, "pages");
    if (pagesNode?.type !== "ArrayExpression") return { ok: false, reason: "this app's pages aren't a plain array" };
    for (const el of asArray(pagesNode.elements)) {
      if (el?.type !== "ObjectExpression" || literalString(propValue(el, "id")) !== edit.page) continue;
      if (edit.language) {
        if (!setWordsEntry(ms, propValue(el, "title"), edit.language, edit.value)) return { ok: false, reason: "this page's title is not written as a translation map" };
        return finish(t, ms, `renamed the "${edit.page}" page to "${edit.value}" in ${edit.language}`);
      }
      setProperty(ms, el, "title", literal(edit.value));
      return finish(t, ms, `renamed the "${edit.page}" page to "${edit.value}"`);
    }
    return { ok: false, reason: `no page "${edit.page}" is written literally here` };
  }

  const entityNode = propValue(propValue(def, "entities"), edit.entity);
  if (entityNode?.type !== "ObjectExpression") return { ok: false, reason: `no entity "${edit.entity}" is written literally here` };
  const fieldsNode = propValue(entityNode, "fields");
  if (fieldsNode?.type !== "ObjectExpression") return { ok: false, reason: "this entity's fields aren't a plain object" };
  if (hasOpaqueMembers(fieldsNode)) return { ok: false, reason: "some of these fields come from a spread or a computed key" };

  if (edit.kind === "field-order") {
    const current = asArray(fieldsNode.properties);
    const currentKeys = current.map((p) => keyOf(p) ?? "");
    if ([...currentKeys].sort().join(" ") !== [...edit.order].sort().join(" ")) {
      return { ok: false, reason: "the new order must contain exactly the fields that are there now" };
    }

    // Pin the display field BEFORE reordering when the reorder would change it. Without this,
    // dragging a field to the top silently renames every record in every list and relation picker.
    const before = effectiveDisplayField(entityNode, currentKeys);
    const after = effectiveDisplayField(entityNode, edit.order);
    if (before && before !== after) setProperty(ms, entityNode, "displayField", literal(before));

    const indent = indentAt(source, current[0]!.start);
    const byKey = new Map(currentKeys.map((k, i) => [k, extentOf(source, current[i]!)]));
    // Rewrite the whole run of properties in one splice: piecewise moves would have to reason about
    // overlapping ranges, and this is a handful of lines of text.
    const first = byKey.get(currentKeys[0]!)!;
    const last = byKey.get(currentKeys[currentKeys.length - 1]!)!;
    const lastComma = last.text.trimEnd().endsWith(",");
    ms.overwrite(first.start, last.end, joinRun(edit.order.map((k) => byKey.get(k)!), indent, lastComma));
    return finish(t, ms, `reordered ${edit.entity} fields`);
  }

  if (edit.kind === "field-groups") {
    const groupsNode = propValue(entityNode, "groups");
    const current = literalGroups(groupsNode);
    if (!current || current === "opaque" || groupsNode?.type !== "ArrayExpression") {
      return { ok: false, reason: "this entity's groups aren't written as plain lists of field names" };
    }
    if (edit.groups.length !== current.length) return { ok: false, reason: "the groups must stay the groups that are there now" };
    const computedNode = propValue(entityNode, "computed");
    const known = new Set([
      ...asArray(fieldsNode.properties).map((p) => keyOf(p) ?? ""),
      ...(computedNode?.type === "ObjectExpression" ? asArray(computedNode.properties).map((p) => keyOf(p) ?? "") : []),
    ]);
    const seen = new Set<string>();
    for (const [i, keys] of edit.groups.entries()) {
      if (keys.length === 0) return { ok: false, reason: `"${current[i]!.title ?? Object.values(current[i]!.titles ?? {})[0] ?? `group ${i + 1}`}" would be left with no fields` };
      for (const key of keys) {
        if (!known.has(key)) return { ok: false, reason: `"${key}" isn't a field or computed value of ${edit.entity}` };
        if (seen.has(key)) return { ok: false, reason: `"${key}" can only be in one group` };
        seen.add(key);
      }
    }
    // Each group's `fields: [...]` is rewritten in place, so titles, comments and the fold stay put.
    const elements = asArray(groupsNode.elements);
    for (const [i, keys] of edit.groups.entries()) {
      if (keys.join("\0") === current[i]!.fields.join("\0")) continue;
      const fieldsNode = propValue(elements[i]!, "fields")!;
      ms.overwrite(fieldsNode.start, fieldsNode.end, `[${keys.map((k) => literal(k)).join(", ")}]`);
    }
    return finish(t, ms, `regrouped ${edit.entity} fields`);
  }

  const fieldProp = prop(fieldsNode, edit.field);
  if (!fieldProp) return { ok: false, reason: `no field "${edit.field}" is written literally here` };
  const fieldValue = fieldProp.value as Node;
  if (fieldValue.type !== "ObjectExpression") {
    return { ok: false, reason: `"${edit.field}" isn't written as a plain object, so its properties can't be set here` };
  }

  if (edit.kind === "field-label") {
    const trimmed = edit.value.trim();
    if (edit.language) {
      // One language of a translated label (#302): an empty one is a gap, not "the default".
      if (!trimmed) return { ok: false, reason: "a translated label needs words in every language it has" };
      if (!setWordsEntry(ms, propValue(fieldValue, "label"), edit.language, trimmed)) return { ok: false, reason: "this label is not written as a translation map" };
      return finish(t, ms, `labelled ${edit.entity}.${edit.field} "${trimmed}" in ${edit.language}`);
    }
    // An empty label means "go back to the default", which is the ABSENCE of the property — not an
    // empty string, which would render a blank label.
    if (!trimmed) {
      removeProperty(source, ms, fieldValue, "label");
      return finish(t, ms, `cleared the label on ${edit.entity}.${edit.field}`);
    }
    setProperty(ms, fieldValue, "label", literal(trimmed));
    return finish(t, ms, `labelled ${edit.entity}.${edit.field} "${trimmed}"`);
  }

  // field-hidden. `false` is the default, so clear the property rather than writing it out.
  if (edit.value) setProperty(ms, fieldValue, "hidden", "true");
  else removeProperty(source, ms, fieldValue, "hidden");
  return finish(t, ms, `${edit.value ? "hid" : "un-hid"} ${edit.entity}.${edit.field}`);
}

/** Re-parse what we produced before handing it back. A splice that doesn't parse must never escape. */
function finish(t: Tools, ms: MagicStringType, note: string): EditResult {
  const next = ms.toString();
  if (!parseModule(t, next)) return { ok: false, reason: "that change would have produced source that doesn't parse" };
  return { ok: true, source: next, note };
}
