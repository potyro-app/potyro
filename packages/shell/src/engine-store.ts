// Which model answers, held ONE place the whole shell can see.
//
// `EngineConfig` used to live in Studio's own `useState` — so App.tsx, where the case report lives
// and where "Fix this" belongs, had no way to even ask which engine was chosen, let alone gate on
// `canInvestigate`. The fix is not a second picker in App.tsx (two sources of truth for "which model
// am I using" is worse than the coupling it would remove); it's lifting the one piece of state both
// need to read to a place both can reach. This module — and only this module — creates and changes
// it; `Studio` and `App` both read it live through `useEngineConfig`.

import { useSyncExternalStore } from "react";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "./engines.js";

let config: EngineConfig = DEFAULT_ENGINE_CONFIG;
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
