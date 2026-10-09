// The cases recorded against an app: what someone did, and what they expected.
//
// Storage mirrors app-history.ts exactly — its own durable Store namespace, opened lazily, with a
// failed handle dropped rather than cached so a store that was unavailable at boot is retried on the
// next save. localStorage is already carrying every app's current source and must not carry this
// too: there is one case per bug anyone ever reports.

import { openStore } from "./open-store.js";
import type { Store } from "@potyro/store";
import type { Case, CaseStep } from "@potyro/runtime";

const NAMESPACE = "app-cases";
const ENTITY = "case";

/** A ceiling, not a target — mirrors app-diagnoses.ts's MAX_DIAGNOSES: a case is filed at roughly
 *  the same cadence as a diagnosis (once per report), not the much higher rate app-history sees
 *  from routine edits, so it gets the same cap rather than app-history's larger one. Oldest go
 *  first. */
const MAX_CASES = 50;

let handle: Promise<Store> | null = null;

function store(): Promise<Store> {
  // Drop a failed handle rather than caching the rejection: a store that was unavailable at boot
  // should be retried on the next save, not written off for the rest of the session.
  handle ??= openStore(NAMESPACE).catch((e: unknown) => {
    handle = null;
    throw e;
  });
  return handle;
}

/** Test seam: drop the cached handle so a fresh store is opened next call. */
export function resetCasesStore(): void {
  handle = null;
}

/**
 * Validate that a value is a Record<string, string> with no arrays or nested objects.
 * Used by isStep to check the open variant's params field.
 */
function isParams(v: unknown): v is Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === "string");
}

/**
 * Validate that a value matches the CaseStep union.
 *
 * A half-valid case is worse than no case, because replay will report a corrupt recording
 * as a real failure of the user's app instead of detecting the corruption at load time.
 * Every step must validate strictly: kind must be one of the three variants, and all
 * required fields for that variant must be present and the correct type.
 */
function isStep(v: unknown): v is CaseStep {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  const kind = obj.kind;

  if (kind === "open") {
    return typeof obj.page === "string" && (obj.params === undefined || isParams(obj.params));
  }
  if (kind === "action") {
    return typeof obj.entity === "string" && typeof obj.action === "string" && typeof obj.recordId === "string";
  }
  if (kind === "expect") {
    return typeof obj.note === "string";
  }

  return false;
}

function toCase(record: Record<string, unknown>): Case | null {
  const { id, appId, title, steps, createdAt } = record as Partial<Case>;
  if (typeof id !== "string" || typeof appId !== "string" || !Array.isArray(steps)) return null;

  // Validate every step; reject the entire case if any step is malformed
  if (!steps.every(isStep)) return null;

  return { id, appId, title: title ?? "", steps, createdAt: createdAt ?? new Date(0).toISOString() };
}

/**
 * Whether a case captured anything replay can act on. A case built from nothing but `expect`
 * notes (or with no steps at all) has no `open`/`action` step, so `replayCase` produces an empty
 * outcomes list — and an empty list is vacuously "everything passed" (see replay.ts's
 * `replayPassed`). Saving a case like that would persist a report that reads clean forever despite
 * nothing ever having been recorded. Callers use this to decide whether a stopped recording is
 * worth keeping at all.
 */
export function hasRecordedActivity(c: Case): boolean {
  return c.steps.some((s) => s.kind === "open" || s.kind === "action");
}

/**
 * Save a case. Store record id is the case's own id, so a re-save overwrites rather than
 * duplicates. Never throws — mirrors `recordVersion` (app-history.ts): losing the case must not
 * cost the user the recording they just captured. The report shown right after stopping is built
 * from the in-memory `Case`, not read back from the store, so it is unaffected either way; only
 * the case's presence in History later is at risk, and that is a warning, not a thrown error.
 */
export async function saveCase(c: Case): Promise<void> {
  try {
    const s = await store();
    await s.insert(ENTITY, { ...c });

    const forApp = (await s.all(ENTITY))
      .map((r) => toCase(r as Record<string, unknown>))
      .filter((x): x is Case => x !== null && x.appId === c.appId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
    for (const stale of forApp.slice(MAX_CASES)) await s.delete(ENTITY, stale.id);
  } catch (e) {
    console.warn("[potyro] could not save case:", e);
  }
}

/** Every case recorded against one app, newest first. Empty when the store is unavailable. */
export async function listCases(appId: string): Promise<Case[]> {
  try {
    const rows = await (await store()).all(ENTITY);
    return rows
      .map((r) => {
        const record = r as Record<string, unknown>;
        const c = toCase(record);
        if (c === null && typeof record.id === "string" && record.appId === appId) {
          console.warn("[potyro] discarding a corrupt case:", record.id);
        }
        return c;
      })
      .filter((c): c is Case => c !== null && c.appId === appId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (e) {
    console.warn("[potyro] app cases unavailable:", e);
    return [];
  }
}

export async function deleteCase(appId: string, id: string): Promise<void> {
  const s = await store();
  for (const r of await s.all(ENTITY)) {
    const c = toCase(r as Record<string, unknown>);
    if (c && c.appId === appId && c.id === id) await s.delete(ENTITY, (r as { id: string }).id);
  }
}

/** What a case reads as in one line: its own title, else the note the person wrote when they
 *  stopped recording ("what did you expect?"), else its id as a last resort. This is the ONE
 *  place that fallback order lives — Studio's case list and a version's history `note` (App.tsx's
 *  `applyFix`) both need "the person's own words for this case" and must agree on what that means. */
export function caseLabel(c: Case): string {
  if (c.title) return c.title;
  const note = c.steps.find((s): s is Extract<CaseStep, { kind: "expect" }> => s.kind === "expect")?.note;
  return note ?? c.id;
}

/** Forget an app's cases — called when the app itself is deleted, alongside clearHistory and
 *  clearDiagnoses (user-apps.ts's `removeUserApp`). App ids are name slugs, so a deleted app's id
 *  can be reused by an unrelated app created later; without this, that new app would inherit the
 *  dead app's reported cases. */
export async function clearCases(appId: string): Promise<void> {
  try {
    const s = await store();
    for (const r of await s.all(ENTITY)) {
      const c = toCase(r as Record<string, unknown>);
      if (c && c.appId === appId) await s.delete(ENTITY, (r as { id: string }).id);
    }
  } catch (e) {
    console.warn("[potyro] could not clear app cases:", e);
  }
}
