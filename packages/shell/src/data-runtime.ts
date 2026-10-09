// A runtime over one app's DATA, built without running the app — what the Data panel reads through.
//
// The panel shows and edits any app's records, including apps that came from someone else. Loading
// the app itself to do that would either run untrusted code with the shell's authority or boot an
// isolate just to read a table. Neither is needed: the fields are plain data (docs/03), so the panel
// reads them from the source (`declaredEntities`) and builds a definition out of nothing else — no
// computed, no actions, no pages, no functions at all. A definition with no code in it is safe to
// load directly whatever the app's provenance.
//
// Going through a runtime rather than the raw store is what lets the panel reuse the views' own
// `FieldValue` and `FieldInput`: a money field shows as money and edits as money, exactly as it does
// in the app, and a write goes through `ctx` like any other edit.

import { defineApp, type Field, type PotyroApp } from "potyro";
import { createHost } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import type { Store } from "@potyro/store";
import type { Capabilities } from "@potyro/capabilities";
import { declaredEntities, type DeclaredEntity } from "./app-source.js";
import { openAppStore, syncAllowedFor } from "./app-store.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { shellDialogs } from "./dialog.js";
import type { UserApp } from "./user-apps.js";

export interface DataEntity {
  key: string;
  label: string;
  /** Declared fields the panel understood, in declared order. */
  fields: string[];
  /** Declared fields it could not read — shown as raw values, never edited. */
  opaque: string[];
}

export interface DataSession {
  runtime: PotyroRuntime;
  store: Store;
  entities: DataEntity[];
  close(): Promise<void>;
}

/**
 * Keep only the fields the schema accepts on their own terms.
 *
 * A field is read literally, so a property written as code is missing from it — an enum whose
 * `options` come from a const has no options here. Rather than let one such field fail the whole app,
 * each field is added only if the definition still validates with it; the rest fall back to raw.
 */
export function dataDefinition(appId: string, declared: Record<string, DeclaredEntity>): { app: PotyroApp; rejected: Record<string, string[]> } {
  const base = (entities: Record<string, { fields: Record<string, Field> }>) =>
    defineApp({ id: "data-panel", name: appId, version: "1.0.0", schemaVersion: 1, entities, pages: [] });

  const kept: Record<string, { fields: Record<string, Field> }> = Object.fromEntries(Object.keys(declared).map((e) => [e, { fields: {} }]));
  const rejected: Record<string, string[]> = {};
  for (const [entity, decl] of Object.entries(declared)) {
    for (const [key, field] of Object.entries(decl.fields)) {
      const next = { ...kept, [entity]: { fields: { ...kept[entity]!.fields, [key]: field as unknown as Field } } };
      try {
        base(next);
        Object.assign(kept, next);
      } catch {
        (rejected[entity] ??= []).push(key);
      }
    }
  }
  // What a relation to this entity shows — its display field, when that field survived.
  const named = Object.fromEntries(
    Object.entries(kept).map(([entity, def]) => {
      const { label, displayField } = declared[entity]!;
      return [entity, { ...def, ...(label ? { label } : {}), ...(displayField && displayField in def.fields ? { displayField } : {}) }];
    }),
  );
  return { app: base(named), rejected };
}

/** Open `app`'s store (the one it really uses — local or synced) with a data-only runtime over it. */
export async function openDataSession(app: UserApp, caps: Capabilities): Promise<DataSession> {
  const declared = (await declaredEntities(app.source)) ?? {};
  const { app: definition, rejected } = dataDefinition(app.id, declared);

  // Opened exactly as the app opens it: the same store, and an example that has never been opened
  // gets its first-run rows here rather than showing an empty table.
  const { ensureIdentity } = await import("@potyro/identity");
  const me = await ensureIdentity();
  const store = await openAppStore(app, { sync: await syncAllowedFor(app), me: me.id });
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: definition, provenance: "trusted" });
  const runtime = createRuntime({
    app: loaded,
    host,
    store,
    caps,
    ui: createUiBridge(() => {}, undefined, shellDialogs),
    nav: createNavBridge(() => {}),
  });

  const entities = Object.entries(declared).map(([key, decl]) => {
    const readable = Object.keys(definition.entities[key]?.fields ?? {});
    return {
      key,
      label: decl.label ?? key,
      fields: readable,
      opaque: [...decl.opaque, ...(rejected[key] ?? [])],
    };
  });
  // An edit saved just before switching app lands before the store is let go.
  const close = async (): Promise<void> => {
    await runtime.settle();
    await store.close();
  };
  return { runtime, store, entities, close };
}
