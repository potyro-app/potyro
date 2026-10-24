// What an app declares, as plain data that travels in a package's manifest (#271).
//
// The Add-an-app card and the trust prompt must be able to say what an app is — its name, icon, what
// it keeps, its pages, what it asks this device for — without running a line of it. Running it to
// find out made the card hostage to the code: a top-level `new Intl.DateTimeFormat()`, which the
// sealed box does not have, turned a perfectly good package into "This app does not load".
//
// So whoever writes a package or an export bundle writes the app's declaration beside the source:
// the definition with every function replaced by FN_MARKER, the same shape the isolate hands back
// when a definition crosses out of it. A reader that finds no declaration (an older package, pasted
// source) falls back to reading the app in the sealed box.

import type { Words } from "./types/words.js";

/** Where a function stood in the definition: the isolate's marker, so one validator reads both. */
export const FN_MARKER = "__potyro_fn__";

/** An app's declarative parts, as JSON. Functions are FN_MARKER; everything else is as written. */
export interface AppDeclaration {
  id: string;
  /** One name, or the name per language (#302). */
  name?: Words;
  icon?: string;
  entities: Record<string, unknown>;
  pages: unknown[];
  permissions?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Keys the builder adds that are not the author's: not part of what an app declares. */
const NOT_DECLARED = new Set(["__potyroApp"]);

/**
 * An app definition as a declaration: functions become FN_MARKER, dates their ISO text, and anything
 * JSON cannot hold is left out. Undefined when it is not an app (no id, no entities, no pages).
 */
export function declareApp(definition: unknown): AppDeclaration | undefined {
  return describeApp(definition).declared;
}

/**
 * `declareApp`, and when the definition is not a declaration, why — in words for whoever packs it
 * (`pack:app`), so "it does not export an app" is said only when it does not.
 */
export function describeApp(definition: unknown): { declared?: AppDeclaration; problem?: string } {
  if (definition === undefined || definition === null) return { problem: "it does not export an app (`export default defineApp({ … })`)" };
  const ancestors = new Set<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "function") return FN_MARKER;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
    if (typeof v === "bigint" || typeof v === "symbol") return undefined;
    if (typeof v === "number" && !Number.isFinite(v)) return undefined;
    if (!v || typeof v !== "object") return v;
    // A cycle cannot be written as JSON; the same object reached twice by different paths can.
    if (ancestors.has(v)) return undefined;
    ancestors.add(v);
    try {
      if (Array.isArray(v)) return v.map((item) => walk(item) ?? null);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (NOT_DECLARED.has(k)) continue;
        const w = walk(val);
        if (w !== undefined) out[k] = w;
      }
      return out;
    } finally {
      ancestors.delete(v);
    }
  };
  const raw = walk(definition);
  const problem = declarationProblem(raw);
  return problem ? { problem } : { declared: raw as AppDeclaration };
}

/**
 * A declaration read from a manifest, or undefined when it is not one. Only its outline is checked
 * here — an id, entities, pages; whether it is a VALID app is the shell's question, answered by the
 * same validator that checks a loaded definition.
 */
export function parseDeclaration(raw: unknown): AppDeclaration | undefined {
  return declarationProblem(raw) ? undefined : (raw as AppDeclaration);
}

/** A name as an app may write it (#302): one text, or a text per language. */
const isWords = (v: unknown): boolean =>
  typeof v === "string" ||
  (!!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 && Object.values(v).every((w) => typeof w === "string"));

/** Why `raw` is not a declaration's outline, in words; undefined when it is one. */
export function declarationProblem(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "its default export is not an app definition";
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== "string" || !d.id) return "it has no `id`";
  if (!d.entities || typeof d.entities !== "object" || Array.isArray(d.entities)) return "its `entities` is not an object";
  if (!Array.isArray(d.pages)) return "its `pages` is not a list";
  if (d.name !== undefined && !isWords(d.name)) return "its `name` is neither a text nor a text per language";
  if (d.icon !== undefined && typeof d.icon !== "string") return "its `icon` is not a text";
  if (d.permissions !== undefined && (!d.permissions || typeof d.permissions !== "object" || Array.isArray(d.permissions))) return "its `permissions` is not an object";
  return undefined;
}
