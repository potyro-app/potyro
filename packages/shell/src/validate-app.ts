// Shared structure validation for app sources. The untrusted isolate's `defineApp` does NOT validate
// (it just yields the object), so a malformed app would otherwise run as broken UI. This runs the
// SAME Zod schema + referential checks the trusted path uses, against a source's definition — used by
// the Studio (generate/preview/save) and by in-app Edit-mode (quick modify) so both catch + repair.

import { structureSchema, checkReferences, describeIssue } from "potyro";
import type { AppShape } from "@potyro/runtime";
import { MemoryStore } from "@potyro/store";
import { createWebCapabilities } from "@potyro/capabilities";
import { createAppBundler } from "./app-bundler.js";
import { createSandboxLoader } from "./isolate-bridge.js";
import { compose } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";

// The isolate serializes the app def with every function replaced by the marker "__potyro_fn__"
// (host/isolate). Revive those to no-op functions so structure validation checks the DATA shape
// without tripping the "expected a function" check on legitimate computed/binding fields.
const FN_MARKER = "__potyro_fn__";
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

/**
 * A LOADED definition back in the shape its author wrote.
 *
 * `defineApp` copies a layout page's first item into `view`, so everything that reads a page's view
 * — the tab bar, the summary strip, the quick action — sees the primary one and never has to know
 * about layouts (#105). The schema, though, states the AUTHORING rule: a page declares either `view`
 * or `layout`, never both. Validating the loaded object against it therefore failed every app with a
 * layout — Studio opened Recipes, Plants or Workout and said "Invalid app structure: pages.2.view: a
 * page declares either `view` or `layout`" about an app that is perfectly valid and was running in
 * the preview beside the message.
 *
 * So the synthesised view is dropped before checking. A page carrying a layout cannot have authored
 * a view as well — that is exactly the rule being enforced — so there is nothing here to lose.
 */
function asAuthored(def: unknown): unknown {
  const app = def as { pages?: Array<Record<string, unknown>> };
  if (!Array.isArray(app?.pages)) return def;
  return {
    ...(def as Record<string, unknown>),
    pages: app.pages.map((page) => {
      if (!page || !page.layout || !("view" in page)) return page;
      const { view: _synthesised, ...authored } = page;
      return authored;
    }),
  };
}

/** Structure issues for a runtime definition (empty = valid). */
export function validateDefinition(def: unknown): string[] {
  const revived = reviveFns(asAuthored(def));
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
