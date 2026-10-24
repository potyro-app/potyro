// App history — every source an app has ever had, so an AI edit is inspectable and reversible.
//
// Editing an app with the agent applies the model's SEARCH/REPLACE edits to the file (a whole-file
// reply is accepted as a fallback). Without a record of the previous source you cannot see what the
// model changed, and a bad edit is unrecoverable. Every write that changes an app's source appends a
// version here — see `saveUserApp`, the one write path — and the History panel diffs and restores
// them.
//
// Storage: its own durable Store (`app-history` namespace) rather than localStorage. Sources are
// large and there are many versions per app; the localStorage origin budget is already carrying
// every app's *current* source, and history is exactly the thing that shouldn't push it over.
// Versions are `version` records carrying their `appId`, filtered in JS — the same personal-scale
// approach the runtime takes (docs/05).

import type { Store } from "@potyro/store";
import { openStore } from "./open-store.js";

const NAMESPACE = "app-history";
const ENTITY = "version";

/** A ceiling, not a target: keeps one much-edited app from growing without bound. Oldest go first. */
const MAX_VERSIONS = 100;

/**
 * How the source came to be.
 *
 * `edited` and `adjusted` are deliberately distinct. An `edited` version is a WHOLE-FILE rewrite by
 * the agent — reviewing it means reading a diff that could touch anything. An `adjusted` version is a
 * direct structural change the user made themselves (a label, a field's order), which by construction
 * touched only declarative data. They carry very different risk when you are deciding what to roll
 * back to, so History says which is which.
 */
export type VersionOrigin = "created" | "edited" | "adjusted" | "restored" | "imported";

export interface AppVersion {
  /** Store record id. */
  id: string;
  appId: string;
  /** Monotonic per app, starting at 1 — the number shown in the UI. */
  seq: number;
  source: string;
  createdAt: string; // ISO
  origin: VersionOrigin;
  /** What was asked for — the Studio prompt, or the Edit-mode target + instruction. */
  note?: string;
  /**
   * The agent's own account of what it changed and why, as prose.
   *
   * It lives here rather than as comments in the source on purpose: a causal claim baked into the
   * module ("this is what was hiding the pins") is unverifiable, frequently wrong, and becomes the
   * *input* to the next edit, which then reasons from it as established fact. Kept beside the
   * version it explains, it informs the reader without contaminating the next prompt.
   */
  rationale?: string;
  /**
   * `lock.json` as it was for this version: the libraries the source imported and the digests of
   * their bytes (#266). A library upgrade changes no line of the source, so without it an upgrade
   * would be no version at all. Absent for an app with no libraries.
   */
  lock?: string;
  /**
   * The app's own modules as they were for this version (#258, #448), by their path in the package's
   * `src/` ("card.ts" → its text). The device keeps only the CURRENT modules, in `.src/`, overwritten
   * by every update, so without this a restored version would run its old entry file against
   * today's modules. Absent for an app that is one file, and for versions kept before #448.
   */
  modules?: Record<string, string>;
}

/** The modules as stored: one JSON text, so a record holds only plain values. */
function readModules(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string");
    return entries.length ? Object.fromEntries(entries) : undefined;
  } catch {
    return undefined;
  }
}

/** The same modules as text, in path order, so the same set is always the same text. */
function modulesText(modules: Record<string, string> | undefined): string {
  if (!modules) return "";
  const paths = Object.keys(modules).sort();
  return paths.length ? JSON.stringify(Object.fromEntries(paths.map((p) => [p, modules[p]]))) : "";
}

let handle: Promise<Store> | null = null;

function store(): Promise<Store> {
  // Drop a failed handle rather than caching the rejection: a store that was unavailable at boot
  // (OPFS still initialising, quota transiently exceeded) should be retried on the next save, not
  // written off for the rest of the session.
  handle ??= openStore(NAMESPACE).catch((e: unknown) => {
    handle = null;
    throw e;
  });
  return handle;
}

/** Test seam: drop the cached handle so a fresh store is opened next call. */
export function resetHistoryStore(): void {
  handle = null;
}

function toVersion(record: Record<string, unknown>): AppVersion | null {
  const { id, appId, seq, source, createdAt, origin, note, rationale, lock } = record as Partial<AppVersion>;
  const modules = readModules((record as { modules?: unknown }).modules);
  if (typeof id !== "string" || typeof appId !== "string" || typeof seq !== "number" || typeof source !== "string") {
    return null;
  }
  return {
    id,
    appId,
    seq,
    source,
    createdAt: createdAt ?? new Date(0).toISOString(),
    origin: origin ?? "edited",
    note,
    rationale,
    ...(typeof lock === "string" && lock ? { lock } : {}),
    ...(modules ? { modules } : {}),
  };
}

async function readAll(appId: string): Promise<AppVersion[]> {
  const rows = await (await store()).all(ENTITY);
  return rows
    .map((r) => toVersion(r as Record<string, unknown>))
    .filter((v): v is AppVersion => v !== null && v.appId === appId)
    .sort((a, b) => b.seq - a.seq);
}

/** Every stored version of an app, newest first. Empty when history is unavailable. */
export async function listVersions(appId: string): Promise<AppVersion[]> {
  try {
    return await readAll(appId);
  } catch (e) {
    console.warn("[potyro] app history unavailable:", e);
    return [];
  }
}

/**
 * Append a version. Resolves to the stored record, or `undefined` when nothing was recorded — the
 * source and its `lock.json` are unchanged from the newest version (a re-save that only touched the name shouldn't add
 * noise), or history itself failed. A failure here is reported but never thrown: losing the audit
 * trail must not cost the user their edit.
 *
 * `baseline` is the source the app held BEFORE this change. When history is empty it is recorded
 * first, so apps that predate history still get a "before" to diff against on their next edit.
 * `baselineLock` is its `lock.json` then, and `baselineModules` its own modules.
 *
 * `modules` are the app's own modules for this version (`AppVersion.modules`), absent for an app
 * that is one file. A change to a module alone is a version, as a library upgrade is.
 */
export async function recordVersion(
  appId: string,
  input: {
    source: string;
    origin: VersionOrigin;
    note?: string;
    rationale?: string;
    baseline?: string;
    lock?: string;
    baselineLock?: string;
    modules?: Record<string, string>;
    baselineModules?: Record<string, string>;
  },
  now: string,
): Promise<AppVersion | undefined> {
  try {
    const s = await store();
    const versions = await readAll(appId);
    const newest = versions[0];
    const modules = input.modules;
    if (newest && newest.source === input.source && (newest.lock ?? "") === (input.lock ?? "") && modulesText(newest.modules) === modulesText(modules)) return undefined;

    let seq = (newest?.seq ?? 0) + 1;
    if (
      !newest &&
      input.baseline !== undefined &&
      (input.baseline !== input.source || (input.baselineLock ?? "") !== (input.lock ?? "") || modulesText(input.baselineModules) !== modulesText(modules))
    ) {
      await s.insert(ENTITY, {
        appId,
        seq,
        source: input.baseline,
        ...(input.baselineLock ? { lock: input.baselineLock } : {}),
        ...(modulesText(input.baselineModules) ? { modules: modulesText(input.baselineModules) } : {}),
        createdAt: now,
        origin: "created",
        note: "the source before history was kept",
      });
      seq += 1;
    }

    const written = await s.insert(ENTITY, {
      appId,
      seq,
      source: input.source,
      createdAt: now,
      origin: input.origin,
      ...(input.note ? { note: input.note } : {}),
      ...(input.rationale ? { rationale: input.rationale } : {}),
      ...(input.lock ? { lock: input.lock } : {}),
      ...(modulesText(modules) ? { modules: modulesText(modules) } : {}),
    });

    const stale = [...versions].slice(MAX_VERSIONS - 1);
    for (const old of stale) await s.delete(ENTITY, old.id);

    return toVersion(written as Record<string, unknown>) ?? undefined;
  } catch (e) {
    console.warn("[potyro] could not record app version:", e);
    return undefined;
  }
}

/** Forget an app's history — called when the app itself is deleted. */
export async function clearHistory(appId: string): Promise<void> {
  try {
    const s = await store();
    for (const v of await readAll(appId)) await s.delete(ENTITY, v.id);
  } catch (e) {
    console.warn("[potyro] could not clear app history:", e);
  }
}
