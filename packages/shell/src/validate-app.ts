// Shared structure validation for app sources. The untrusted isolate's `defineApp` does NOT validate
// (it just yields the object), so a malformed app would otherwise run as broken UI. This runs the
// SAME Zod schema + referential checks the trusted path uses, against a source's definition — used by
// the Studio (generate/preview/save) and by in-app Edit-mode (quick modify) so both catch + repair.

import { structureSchema, checkReferences, describeIssue } from "karta";
import type { AppShape } from "@karta/runtime";
import { MemoryStore } from "@karta/store";
import { createWebCapabilities } from "@karta/capabilities";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";

// The isolate serializes the app def with every function replaced by the marker "__karta_fn__"
// (host/isolate). Revive those to no-op functions so structure validation checks the DATA shape
// without tripping the "expected a function" check on legitimate computed/binding fields.
const FN_MARKER = "__karta_fn__";
function reviveFns(v: unknown): unknown {
  if (v === FN_MARKER) return () => undefined;
  if (Array.isArray(v)) return v.map(reviveFns);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = reviveFns(val);
    return out;
  }
  return v;
}

/** Structure issues for a runtime definition (empty = valid). */
export function validateDefinition(def: unknown): string[] {
  const revived = reviveFns(def);
  const parsed = structureSchema.safeParse(revived);
  if (!parsed.success) return parsed.error.issues.map((i) => describeIssue(i, revived));
  return checkReferences(parsed.data as Parameters<typeof checkReferences>[0]);
}

/** Compose a source UNTRUSTED (in the isolate, throwaway store) and return its runtime definition.
 *  Throws if the source fails to compile/bundle. Never runs the source directly: Edit mode edits
 *  imported apps too, and their code must not get ambient authority just to be inspected. */
async function composeUntrusted(source: string): Promise<{ definition: unknown }> {
  const bundle = await createAppBundler();
  const bundleCode = await bundle(source);
  const store = new MemoryStore();
  await store.open("validate");
  const composed = await compose({
    provenance: "untrusted",
    bundleCode,
    store,
    caps: createWebCapabilities(),
    ui: createUiBridge(() => {}),
    nav: createNavBridge(() => {}),
    loadIsolated: await createSandboxLoader(store),
  });
  return { definition: composed.runtime.definition };
}

/** Bundle a source, run it untrusted with a throwaway store, and return its structure issues. Throws
 *  if the source fails to compile/bundle (that surfaces to the caller as a hard error). */
export async function buildAndValidate(source: string): Promise<string[]> {
  return validateDefinition((await composeUntrusted(source)).definition);
}

/** The shape `guardedModify` compares: pages and entities of a source, loaded in the isolate. */
export async function loadDefinition(source: string): Promise<{ pages: AppShape["pages"]; entities: AppShape["entities"] }> {
  const def = (await composeUntrusted(source)).definition as { pages: AppShape["pages"]; entities?: AppShape["entities"] };
  return { pages: def.pages, entities: def.entities };
}
