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

import { useSyncExternalStore } from "react";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "./engines.js";
import { canGenerate } from "./generate-client.js";

const KEY = "karta:engine-config";

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

function load(): EngineConfig {
  const raw = session()?.getItem(KEY);
  if (!raw) return startingConfig();
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

function emit(): void {
  for (const cb of listeners) cb();
}

/** Read the current config without subscribing to it — for code that isn't a React component
 *  (`startFix` callers building a one-off options object, tests). */
export function getEngineConfig(): EngineConfig {
  return config;
}

/** Replace the config and notify every subscriber. The only place it changes. */
export function setEngineConfig(next: EngineConfig): void {
  config = next;
  try {
    session()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or a locked-down context: keep working from memory for this page's lifetime rather
    // than failing the settings save. The user can still use the engine until they navigate.
  }
  emit();
}

/** Test seam: drop the persisted config and reset to defaults. */
export function resetEngineConfig(): void {
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
