// The cases recorded against an app: what someone did, and what they expected.
//
// Storage mirrors app-history.ts exactly — its own durable Store namespace, opened lazily, with a
// failed handle dropped rather than cached so a store that was unavailable at boot is retried on the
// next save. localStorage is already carrying every app's current source and must not carry this
// too: there is one case per bug anyone ever reports, kept forever.

import { openStore } from "./open-store.js";
import type { Store } from "@karta/store";
import type { Case, CaseStep } from "@karta/runtime";

const NAMESPACE = "app-cases";
const ENTITY = "case";

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
    return typeof obj.page === "string" && (obj.params === undefined || (typeof obj.params === "object" && obj.params !== null));
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

/** Save a case. Store record id is the case's own id, so a re-save overwrites rather than duplicates. */
export async function saveCase(c: Case): Promise<void> {
  await (await store()).insert(ENTITY, { ...c });
}

/** Every case recorded against one app, newest first. Empty when the store is unavailable. */
export async function listCases(appId: string): Promise<Case[]> {
  try {
    const rows = await (await store()).all(ENTITY);
    return rows
      .map((r) => toCase(r as Record<string, unknown>))
      .filter((c): c is Case => c !== null && c.appId === appId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (e) {
    console.warn("[karta] app cases unavailable:", e);
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
