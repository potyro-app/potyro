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

/** A property this module knows how to edit. */
export type Edit =
  | { kind: "field-label"; entity: string; field: string; value: string }
  | { kind: "field-hidden"; entity: string; field: string; value: boolean }
  | { kind: "field-order"; entity: string; order: readonly string[] }
  /** The new field lists of the entity's groups, one per existing group, in order (#100). */
  | { kind: "field-groups"; entity: string; groups: readonly (readonly string[])[] }
  | { kind: "page-title"; page: string; value: string };

export type EditResult = { ok: true; source: string; note: string } | { ok: false; reason: string };

/** What is editable about one field, as found in the source. */
export interface FieldShape {
  key: string;
  /** The declared `label`, when there is one. Absent means the app leans on the key. */
  label?: string;
  hidden: boolean;
}

/** One of the entity's `groups`, as written: its title and the keys it lists (fields or computed). */
export interface GroupShape {
  title?: string;
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
  icon?: string;
  /** `theme.accent`. */
  accent?: string;
  /** Set when the module itself can't be read structurally at all. */
  blocked?: string;
}

// ---------------------------------------------------------------------------------------------
// Lazy toolchain. Both are only needed once someone actually opens the editor, and together they
// are ~85 kB gzipped — the same lazy treatment MapLibre gets.

interface Node {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}
interface Tools {
  parse: (code: string, opts: object) => Node;
  MagicString: new (s: string) => MagicStringType;
}
let tools: Promise<Tools | null> | null = null;

/** Test seam: drop the cached toolchain so the next call re-imports. */
export function resetSourceTools(): void {
  tools = null;
}

async function load(): Promise<Tools | null> {
  tools ??= (async () => {
    try {
      const [babel, magic] = await Promise.all([import("@babel/parser"), import("magic-string")]);
      return {
        parse: babel.parse as unknown as Tools["parse"],
        MagicString: (magic.default ?? magic) as unknown as Tools["MagicString"],
      };
    } catch (e) {
      console.warn("[karta] structural editing unavailable:", e);
      tools = null; // a transient chunk failure shouldn't disable it for the session
      return null;
    }
  })();
  return tools;
}

function parseModule(t: Tools, source: string): Node | null {
  try {
    // TSX, because a custom view is a React component in the same file.
    return t.parse(source, { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: false });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Locating things

const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
const keyOf = (prop: Node): string | undefined => {
  const key = prop.key as { name?: string; value?: unknown } | undefined;
  if (typeof key?.name === "string") return key.name;
  return typeof key?.value === "string" ? key.value : undefined;
};

/** The object literal handed to `defineApp(...)`, or null if the call isn't shaped that way. */
function findDefinition(ast: Node): Node | null {
  let found: Node | null = null;
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === "CallExpression" && (node.callee as Node | undefined)?.name === "defineApp") {
      const arg = asArray(node.arguments)[0];
      found = arg?.type === "ObjectExpression" ? arg : null;
      if (found) return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object" && (value as Node).type) walk(value);
    }
  };
  walk(ast);
  return found;
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

/** A named property of an object literal, if it is written literally (not spread, not computed). */
function prop(obj: Node | null, name: string): Node | null {
  if (obj?.type !== "ObjectExpression") return null;
  for (const p of asArray(obj.properties)) {
    if (p.type === "ObjectProperty" && p.computed !== true && keyOf(p) === name) return p;
  }
  return null;
}
const propValue = (obj: Node | null, name: string): Node | null => (prop(obj, name)?.value as Node | undefined) ?? null;

/** True when an object literal has anything we can't address by key. */
const hasOpaqueMembers = (obj: Node): boolean =>
  asArray(obj.properties).some((p) => p.type !== "ObjectProperty" || p.computed === true);

function literalString(node: Node | null): string | undefined {
  return node?.type === "StringLiteral" && typeof node.value === "string" ? node.value : undefined;
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
    const title = literalString(propValue(el, "title"));
    out.push({ ...(title !== undefined ? { title } : {}), fields });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading

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
        const label = value.type === "ObjectExpression" ? literalString(propValue(value, "label")) : undefined;
        const hiddenNode = value.type === "ObjectExpression" ? propValue(value, "hidden") : null;
        fields.push({ key, hidden: hiddenNode?.type === "BooleanLiteral" && hiddenNode.value === true, ...(label ? { label } : {}) });
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
      pages.push({
        id,
        hidden: hiddenNode?.type === "BooleanLiteral" && hiddenNode.value === true,
        ...(literalString(propValue(el, "title")) !== undefined ? { title: literalString(propValue(el, "title"))! } : {}),
        ...(literalString(propValue(view, "entity")) !== undefined ? { entity: literalString(propValue(view, "entity"))! } : {}),
        ...(literalString(propValue(view, "type")) !== undefined ? { viewType: literalString(propValue(view, "type"))! } : {}),
      });
    }
  }

  const name = literalString(propValue(def, "name"));
  const icon = literalString(propValue(def, "icon"));
  const accent = literalString(propValue(propValue(def, "theme"), "accent"));
  return { entities, pages, ...(name ? { name } : {}), ...(icon ? { icon } : {}), ...(accent ? { accent } : {}) };
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
 */
function extentOf(source: string, node: Node): { start: number; end: number; text: string } {
  let start = node.start;
  for (const c of asArray(node.leadingComments)) if (c.start < start) start = c.start;
  let end = node.end;
  if (source[end] === ",") end += 1;
  return { start, end, text: source.slice(start, end) };
}

/** The indentation of the line `index` sits on. */
function indentAt(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, index));
  return match ? match[0] : "";
}

/**
 * Which field an entity falls back to for its human label, mirroring `displayFieldFor` in
 * @karta/views. Reordering fields would otherwise silently change what every list row and relation
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

  if (edit.kind === "page-title") {
    const pagesNode = propValue(def, "pages");
    if (pagesNode?.type !== "ArrayExpression") return { ok: false, reason: "this app's pages aren't a plain array" };
    for (const el of asArray(pagesNode.elements)) {
      if (el?.type !== "ObjectExpression" || literalString(propValue(el, "id")) !== edit.page) continue;
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
    const rewritten = edit.order
      .map((k) => byKey.get(k)!.text.trim())
      .map((text, i) => (text.endsWith(",") || i === edit.order.length - 1 ? text : `${text},`))
      .join(`\n${indent}`);
    ms.overwrite(first.start, last.end, rewritten);
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
      if (keys.length === 0) return { ok: false, reason: `"${current[i]!.title ?? `group ${i + 1}`}" would be left with no fields` };
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
