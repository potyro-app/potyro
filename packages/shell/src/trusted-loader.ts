// Load a user app's source for TRUSTED (direct) execution — only after the user has explicitly
// promoted it (trust flow). The source is bundled to a self-contained ES module whose `potyro`/`react`
// imports resolve to the SHELL's real modules (stashed on globals), then imported via a blob URL so
// the real `defineApp` runs: it validates the app and returns a branded PotyroApp with live functions.
// A malformed app throws here (defineApp's ValidationError) and the caller falls back to untrusted.
//
// This is the ambient-authority path the isolate exists to avoid — it is reached ONLY for an app the
// user vouched for (CLAUDE.md rule 3: provenance decides execution; trusted = user's own = direct).

import * as potyroReal from "potyro";
import * as reactReal from "react";
import * as reactJsxReal from "react/jsx-runtime";
import type { PotyroApp } from "potyro";
import { bundleTrustedModule } from "./app-bundler.js";

let stashed = false;
function stashRealModules(): void {
  if (stashed) return;
  const g = globalThis as unknown as Record<string, unknown>;
  g.__potyroReal = potyroReal;
  g.__reactReal = reactReal;
  g.__reactJsxReal = reactJsxReal;
  stashed = true;
}

export async function loadTrustedModule(source: string): Promise<PotyroApp> {
  stashRealModules();
  const esm = await bundleTrustedModule(source);
  const url = URL.createObjectURL(new Blob([esm], { type: "text/javascript" }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    const app = mod.default;
    if (!potyroReal.isPotyroApp(app)) throw new Error("module did not default-export a defineApp() app");
    return app;
  } finally {
    URL.revokeObjectURL(url);
  }
}
