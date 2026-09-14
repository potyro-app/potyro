import type { AppDefinition, AppInput, KartaApp, Page } from "./types/app.js";
import { checkReferences, describeIssue, structureSchema, ValidationError } from "./validate.js";

/**
 * The typed builder (docs/03, docs/04). It:
 *   (a) types logic functions with a permissive `Resolved` record + a fully-typed `ctx`,
 *   (b) validates the declarative parts (Zod structure + referential integrity), and
 *   (c) normalizes optional arrays and brands the result.
 *
 * On the record type: precise per-field inference from a single `defineApp({...})` literal is
 * not expressible in TypeScript — you can infer the concrete entities map OR impose contextual
 * param types on inline logic functions, never both. So the record handed to logic is the
 * permissive `Resolved` (the "no ceiling" record from docs/04). This is consistent with
 * CLAUDE.md rule #4: *structure* is declarative and validated; *logic* is typed, not
 * validated. Authors who want precise field types can opt in via the exported inference
 * helpers ({@link ResolvedFields}/{@link LogicRecord}) with an explicit entity type.
 *
 * It does NOT constrain function bodies — logic is unrestricted TypeScript.
 *
 * Throws {@link ValidationError} if the declarative parts are invalid.
 */
export function defineApp(def: AppInput): KartaApp {
  const parsed = structureSchema.safeParse(def);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => describeIssue(i, def)));
  }

  // A page written with a `layout` gets its first item as its `view` (#105), so everything that
  // reads a page's view — the tab bar, the summary strip, the quick action — sees the primary one
  // and never has to know about layouts. The page object is copied, not mutated: the author's
  // literal stays theirs.
  const pages: Page[] = def.pages.map((p) => (p.view ? (p as Page) : { ...p, view: p.layout!.items[0]!.view }));
  const definition: AppDefinition = { ...def, pages };

  const refIssues = checkReferences(definition);
  if (refIssues.length > 0) {
    throw new ValidationError(refIssues);
  }

  const normalized: KartaApp = {
    ...definition,
    reminders: definition.reminders ?? [],
    migrations: definition.migrations ?? [],
    __kartaApp: true,
  };
  return normalized;
}

/** Type guard: did this object come from `defineApp`? */
export function isKartaApp(value: unknown): value is KartaApp {
  return typeof value === "object" && value !== null && (value as { __kartaApp?: unknown }).__kartaApp === true;
}

export type { AppDefinition };
