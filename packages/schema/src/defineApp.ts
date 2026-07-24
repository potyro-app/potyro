import type { ZodIssue } from "zod";
import type { AppDefinition, KartaApp } from "./types/app.js";
import { checkReferences, structureSchema, ValidationError } from "./validate.js";

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

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
export function defineApp(def: AppDefinition): KartaApp {
  const parsed = structureSchema.safeParse(def);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map(formatIssue));
  }

  const definition = def;

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
