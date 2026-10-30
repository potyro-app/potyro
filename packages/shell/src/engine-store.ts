// Which model answers, held ONE place the whole shell can see — and surviving navigation.
//
// `EngineConfig` used to live in Studio's own `useState` — so App.tsx, where the case report lives
// and where "Fix this" belongs, had no way to even ask which engine was chosen, let alone gate on
// `canInvestigate`. The fix is not a second picker in App.tsx (two sources of truth for "which model
// am I using" is worse than the coupling it would remove); it's lifting the one piece of state both
// need to read to a place both can reach. This module — and only this module — creates and changes
// it; `Studio` and `App` both read it live through `useEngineConfig`.
//
// WHY IT PERSISTS, and why to sessionStorage specifically: module state alone made the feature
// impossible to use, not merely awkward. Opening an app is a FULL PAGE NAVIGATION
// (`launcher.tsx`'s `location.search = "?user=…"`), and applying a fix reloads too — so the
// obvious path (open Studio, set your key, go to your app, press "Fix this") wiped the key on the
// way and refused for want of one. Every surface that sets the key is separated from every surface
// that needs it by at least one reload.
//
// sessionStorage rather than localStorage is the deliberate middle: the key survives reloads and
// navigation within this tab, and dies when the tab closes. It is never written anywhere that
// outlives the session, so a shared or forgotten machine does not keep it — which was the whole
// point of holding keys in memory before, and is preserved here. If that guarantee ever needs to
// be stronger, tighten it HERE; do not reintroduce per-surface copies.

//
// THE STARTING ENGINE (#121, #455). A deployed build has no `claude -p`, so it starts on OpenRouter,
// which needs a key. When the relay's free chat route serves, it starts on "Potyro" instead (free-ai.ts)
// — but only for a person who has not chosen: nothing set in this tab, and no key remembered on this
// device (a remembered key's engine is where they start). `checkFreeEngine` decides, at Studio open.
//
// REMEMBERED KEYS (#455): a key the person asked to remember is in the device's vault
// (remembered-keys.ts), loaded at start (`loadRememberedKeys`, from main.tsx once the vault is
// registered) and kept up to date here as the key changes. Everything else above still holds: the
// vault is the only place a key outlives the tab.

import { useSyncExternalStore } from "react";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig, type EndpointSetting } from "./engines.js";
import { canGenerate } from "./generate-client.js";
import { checkFreeAi, freeOffered } from "./free-ai.js";
import { forgetKey, isRemembered, KEY_KINDS, loadRemembered, rememberKey, type KeyKind } from "./remembered-keys.js";
import { countOnce } from "./demand-counts.js";

const KEY = "potyro:engine-config";

/** sessionStorage throws in some embedded/private contexts — a missing store must degrade to
 *  in-memory-only, never take the shell down on boot. */
function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** `claude -p` is the dev server's route. A build without it starts on a cloud engine, which asks for a key. */
function startingConfig(): EngineConfig {
  return canGenerate() ? DEFAULT_ENGINE_CONFIG : { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter" };
}

/** Did the person choose this config — in this tab, before a reload or now? Until then the shell may pick. */
let chosen = false;
/** The engine of the key the vault gave back at start, if any: the person's own choice from before. */
let rememberedEngine: KeyKind | null = null;

function load(): EngineConfig {
  const raw = session()?.getItem(KEY);
  if (!raw) return startingConfig();
  chosen = true;
  try {
    // Spread over the default so a config written by an older build (missing a field added since)
    // loads with that field defaulted rather than arriving as `undefined` at a call site.
    const loaded = { ...startingConfig(), ...(JSON.parse(raw) as Partial<EngineConfig>) };
    return loaded.engine === "cli" && !canGenerate() ? { ...loaded, engine: startingConfig().engine } : loaded;
  } catch {
    return startingConfig();
  }
}

let config: EngineConfig = load();
const listeners = new Set<() => void>();
// Chosen before a reload: what the free route says is asked now, so the engine can run.
if (config.engine === "potyro") void checkFreeAi().catch(() => {});

function emit(): void {
  for (const cb of listeners) cb();
}

/** Read the current config without subscribing to it — for code that isn't a React component
 *  (`startFix` callers building a one-off options object, tests). */
export function getEngineConfig(): EngineConfig {
  return config;
}

/** What is kept of each kind of key: the key, or an endpoint whole. */
function keptOf(cfg: EngineConfig, kind: KeyKind): string {
  if (kind === "openrouter") return cfg.openrouterKey.trim();
  if (kind === "anthropic") return cfg.anthropicKey.trim();
  return cfg.endpoint.baseUrl.trim() ? JSON.stringify(cfg.endpoint) : "";
}

/** A key typed where there was none: an engine of their own (#118 counts it, once a month). */
function typedAKey(before: EngineConfig, next: EngineConfig): boolean {
  const pairs: Array<[string, string]> = [
    [before.openrouterKey, next.openrouterKey],
    [before.anthropicKey, next.anthropicKey],
    [before.endpoint.key, next.endpoint.key],
  ];
  return pairs.some(([a, b]) => !a.trim() && b.trim().length > 0);
}

/** Replace the config and notify every subscriber. The only place it changes. */
export function setEngineConfig(next: EngineConfig): void {
  const before = config;
  config = next;
  chosen = true;
  if (typedAKey(before, next)) void countOnce("own-key").catch(() => {});
  // A remembered key follows the field: changed, it is kept as it is now; emptied, it is forgotten.
  for (const kind of KEY_KINDS) {
    if (!isRemembered(kind) || keptOf(before, kind) === keptOf(next, kind)) continue;
    const kept = keptOf(next, kind);
    void (kept ? rememberKey(kind, kept) : forgetKey(kind));
  }
  try {
    session()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or a locked-down context: keep working from memory for this page's lifetime rather
    // than failing the settings save. The user can still use the engine until they navigate.
  }
  emit();
}

/** Changed by the shell, not the person: in memory, never counted, and the starting choice stays open. */
function adopt(next: EngineConfig): void {
  config = next;
  emit();
}

/**
 * Remember this kind of key on this device, or stop. On: the key as it is in the field now goes into
 * the vault (false when there is none to keep, or no vault). Off: it comes out; the field keeps it for
 * this tab.
 */
export async function setKeyRemembered(kind: KeyKind, on: boolean): Promise<boolean> {
  if (!on) {
    await forgetKey(kind);
    return true;
  }
  const kept = keptOf(config, kind);
  return kept ? rememberKey(kind, kept) : false;
}

/** Forget: out of the vault, and out of the field. */
export async function forgetRememberedKey(kind: KeyKind): Promise<void> {
  await forgetKey(kind);
  const cleared: Partial<EngineConfig> =
    kind === "openrouter" ? { openrouterKey: "" } : kind === "anthropic" ? { anthropicKey: "" } : { endpoint: { ...config.endpoint, key: "" } };
  setEngineConfig({ ...config, ...cleared });
}

function endpointFrom(raw: string): EndpointSetting | null {
  try {
    const v = JSON.parse(raw) as Partial<EndpointSetting>;
    return typeof v.baseUrl === "string" ? { baseUrl: v.baseUrl, key: typeof v.key === "string" ? v.key : "", model: typeof v.model === "string" ? v.model : "" } : null;
  } catch {
    return null;
  }
}

let remembering: Promise<void> = Promise.resolve();

/**
 * The keys the person asked this device to remember, into the config — under a key typed in this tab,
 * never over it. A person who has not chosen in this tab starts on the first one's engine.
 */
export function loadRememberedKeys(): Promise<void> {
  remembering = (async () => {
    const found = await loadRemembered();
    let next = config;
    if (found.openrouter && !next.openrouterKey) next = { ...next, openrouterKey: found.openrouter };
    if (found.anthropic && !next.anthropicKey) next = { ...next, anthropicKey: found.anthropic };
    const endpoint = found.endpoint ? endpointFrom(found.endpoint) : null;
    if (endpoint && !next.endpoint.baseUrl.trim()) next = { ...next, endpoint };
    const first = KEY_KINDS.find((k) => (k === "endpoint" ? endpoint : found[k]));
    rememberedEngine = first ?? null;
    if (first && !chosen) next = { ...next, engine: first };
    if (next !== config) adopt(next);
  })().catch(() => {});
  return remembering;
}

/**
 * At Studio open: does the relay's free chat route serve? Then a deployed build whose person has not
 * chosen starts on it. A config left on it when it no longer serves goes back to the build's start.
 */
export async function checkFreeEngine(): Promise<void> {
  await remembering;
  const offered = freeOffered(await checkFreeAi());
  if (offered && !chosen && !rememberedEngine && !canGenerate() && config.engine !== "potyro") adopt({ ...config, engine: "potyro" });
  if (!offered && config.engine === "potyro") adopt({ ...config, engine: canGenerate() ? "cli" : "openrouter" });
}

/** Test seam: drop the persisted config and reset to defaults. */
export function resetEngineConfig(): void {
  chosen = false;
  rememberedEngine = null;
  remembering = Promise.resolve();
  try {
    session()?.removeItem(KEY);
  } catch {
    // nothing to clean up
  }
  config = startingConfig();
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The live config plus its setter — re-renders the caller whenever ANYONE changes it, not just
 *  itself. `Studio`'s settings modal and `App`'s "Fix this" gate both call this and see one truth. */
export function useEngineConfig(): [EngineConfig, (next: EngineConfig) => void] {
  const cfg = useSyncExternalStore(subscribe, getEngineConfig, getEngineConfig);
  return [cfg, setEngineConfig];
}
