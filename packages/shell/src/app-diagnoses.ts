// Host-side diagnoses — the record of edits that were correctly NOT made.
//
// Edit mode can only rewrite the app module. When a complaint is actually about how a built-in view
// behaves, the honest answer is "this isn't in your app", and the agent is required to say so rather
// than invent a change to whatever function looked closest (see `buildModifyMessage`). That answer
// has to land somewhere: shown once in a panel and dropped, it teaches nobody, and the next edit
// re-derives the same wrong fix from scratch.
//
// So a diagnosis is stored, fed back into later edit prompts for the same app, and shown in History
// alongside the versions — because "we looked at this and the app was not the problem" is part of
// the app's history even though it changed no source.
//
// A diagnosis is also the highest-signal backlog entry there is: it names a thing an app wanted to
// express and could not. Per CLAUDE.md, the answer to a real gap is a cleaner `ctx` / a wider
// declarative surface, not a permanent "no".
//
// Storage mirrors app-history.ts: its own durable Store namespace, records filtered in JS.

import type { Store } from "@karta/store";
import { openStore } from "./open-store.js";

const NAMESPACE = "app-diagnoses";
const ENTITY = "diagnosis";

/** A ceiling, not a target. Oldest go first. */
const MAX_DIAGNOSES = 50;

export interface AppDiagnosis {
  /** Store record id. */
  id: string;
  appId: string;
  createdAt: string; // ISO
  /** The UI element the user pointed at, as Edit mode labelled it. */
  target?: string;
  /** What the user asked for. */
  complaint: string;
  /** The agent's account of which host behaviour is responsible and what would have to change. */
  text: string;
}

let handle: Promise<Store> | null = null;

function store(): Promise<Store> {
  // Same reasoning as app-history: never cache a rejection, so a store that was briefly unavailable
  // is retried rather than written off for the session.
  handle ??= openStore(NAMESPACE).catch((e: unknown) => {
    handle = null;
    throw e;
  });
  return handle;
}

/** Test seam: drop the cached handle so a fresh store is opened next call. */
export function resetDiagnosisStore(): void {
  handle = null;
}

function toDiagnosis(record: Record<string, unknown>): AppDiagnosis | null {
  const { id, appId, createdAt, target, complaint, text } = record as Partial<AppDiagnosis>;
  if (typeof id !== "string" || typeof appId !== "string" || typeof text !== "string") return null;
  return {
    id,
    appId,
    createdAt: createdAt ?? new Date(0).toISOString(),
    complaint: complaint ?? "",
    text,
    ...(target ? { target } : {}),
  };
}

/** Every diagnosis recorded for an app, newest first. Empty when the store is unavailable. */
export async function listDiagnoses(appId: string): Promise<AppDiagnosis[]> {
  try {
    const rows = await (await store()).all(ENTITY);
    return rows
      .map((r) => toDiagnosis(r as Record<string, unknown>))
      .filter((d): d is AppDiagnosis => d !== null && d.appId === appId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (e) {
    console.warn("[karta] app diagnoses unavailable:", e);
    return [];
  }
}

/**
 * Record a diagnosis. Never throws: failing to file one must not cost the user the explanation they
 * are about to read.
 */
export async function recordDiagnosis(
  appId: string,
  input: { complaint: string; text: string; target?: string },
  now: string,
): Promise<AppDiagnosis | undefined> {
  try {
    const s = await store();
    const existing = await listDiagnoses(appId);
    const written = await s.insert(ENTITY, {
      appId,
      createdAt: now,
      complaint: input.complaint,
      text: input.text,
      ...(input.target ? { target: input.target } : {}),
    });
    for (const old of existing.slice(MAX_DIAGNOSES - 1)) await s.delete(ENTITY, old.id);
    return toDiagnosis(written as Record<string, unknown>) ?? undefined;
  } catch (e) {
    console.warn("[karta] could not record diagnosis:", e);
    return undefined;
  }
}

/** Forget an app's diagnoses — called when the app itself is deleted. */
export async function clearDiagnoses(appId: string): Promise<void> {
  try {
    const s = await store();
    for (const d of await listDiagnoses(appId)) await s.delete(ENTITY, d.id);
  } catch (e) {
    console.warn("[karta] could not clear app diagnoses:", e);
  }
}
