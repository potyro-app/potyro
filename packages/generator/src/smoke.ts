// A deeper gate than `score.ts`.
//
// WHY THIS EXISTS: `scoreSource`'s `renders` check runs `queryPage` against an EMPTY MemoryStore.
// Zero rows come back, so no computed, no display binding, no filter/sort and no action body ever
// executes. An app whose every function calls a `ctx` method that does not exist scores a clean
// ✓ renders. The three gates therefore systematically OVERSTATE quality — they prove the app is
// well-formed, not that it works.
//
// This module seeds synthetic records from the field definitions and then forces the logic to run:
// computed evaluation, every page's filter/sort, display bindings, entity actions, and reminder
// `when`. That is where hallucinated `ctx` APIs and unguarded field access actually surface.

import { actionInfo, type AppDefinition, type EntityDef, type Field, type Id, type Resolved } from "potyro";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime } from "@potyro/runtime";
import { MemoryStore } from "@potyro/store";

const SEED_ROWS = 3;
const DAY_MS = 86_400_000;

/** Every view binding path a `BindingRef` can address (see @potyro/host BindingRef). */
const VIEW_BINDING_PATHS = ["display.primary", "display.secondary", "date", "title", "color", "text", "geo"] as const;

export interface SmokeResult {
  /** Seed records were created for every entity. */
  seeded: boolean;
  /** Every entity's records resolved — i.e. all `computed` ran without throwing. */
  computedOk: boolean;
  /** Every page queried — filters, sorts and display bindings ran without throwing. */
  bindingsOk: boolean;
  /** Every entity action ran without throwing (this is what catches bad `ctx` calls). */
  actionsOk: boolean;
  /** Reminder `when` functions ran without throwing. */
  remindersOk: boolean;
  /** Every custom view rendered (server-side) without throwing. */
  customViewsOk: boolean;
  /** Counts, so a vacuous pass (nothing to run) is distinguishable from a real one. */
  ran: { entities: number; records: number; pages: number; computed: number; actions: number; reminders: number; customViews: number };
  errors: string[];
  /**
   * Pages that filtered EVERY seeded record away.
   *
   * Not errors — a page can legitimately come up empty on synthetic data ("Overdue" when every
   * seeded date is in the future). Warnings, because the far more common cause is a filter that can
   * never match anything, and that failure has no other symptom: the app compiles, validates,
   * renders, and shows a blank list forever.
   *
   * The case that motivated it: asked to group todos into lists, a model wrote
   * `filter: (t) => t.list === ctx.params.listId`. A `relation` resolves to the RELATED RECORD, so
   * that compares an object with a string. Always false. The per-list page showed nothing and the
   * "open/total" counter read 0/0 — with no error, anywhere, for anyone to see. Seeding assigns a
   * relation to every record, so a filter of that shape is visible here as a page that threw
   * everything away.
   */
  emptyPages: string[];
}

const UI: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const NAV: NavBridge = { navigate: () => {} };

function message(e: unknown): string {
  return e instanceof Error ? `${e.message}` : String(e);
}

/** A plausible value for one field, varied by row index so sorts/filters have something to bite on. */
function seedValue(field: Field, i: number, key: string): unknown {
  const f = field as Field & { options?: string[]; min?: number; max?: number; of?: Record<string, Field> };
  switch (field.type) {
    case "text":
    case "richtext":
      return `${key} ${i + 1}`;
    case "url":
      return `https://example.com/${key}/${i + 1}`;
    case "number": {
      const base = i + 1;
      const min = typeof f.min === "number" ? f.min : 0;
      const max = typeof f.max === "number" ? f.max : min + 100;
      return Math.min(Math.max(base, min), max);
    }
    case "duration":
      return (i + 1) * 60;
    case "boolean":
      return i % 2 === 0;
    // Spread across past/today/future so "overdue"/"upcoming" logic hits both branches.
    case "datetime":
      return new Date(Date.now() + (i - 1) * DAY_MS);
    case "enum":
      return f.options?.length ? f.options[i % f.options.length] : undefined;
    case "tags":
      return f.options?.length ? [f.options[i % f.options.length]] : ["sample"];
    case "geo":
      return { lat: 52.37 + i * 0.01, lng: 4.89 + i * 0.01, label: `Place ${i + 1}` };
    case "media":
      return undefined; // needs a real Blob through ctx.media — out of scope for a smoke seed
    case "file":
      return undefined; // a file in the app's folder, not a value to invent
    case "relation":
      return undefined; // filled in the second pass, once targets exist
    case "list":
      return f.of
        ? Array.from({ length: 2 }, (_, r) =>
            Object.fromEntries(
              Object.entries(f.of!)
                .map(([k, sub]) => [k, sub.type === "relation" ? undefined : seedValue(sub, r, k)])
                .filter(([, v]) => v !== undefined),
            ),
          )
        : [];
    default:
      return undefined;
  }
}

/**
 * The params a page needs before it can show anything.
 *
 * Two ways a page receives them, and only one is declared on the page itself. `view.param` names a
 * record id directly. The other is navigation: a LIST page says
 * `onOpen: { page: "list-items", param: { listId: "id" } }`, and the target reads `ctx.params.listId`
 * without declaring anything at all.
 *
 * Supplying only the first kind made the harness report a correct per-group page as matching
 * nothing — the exact false positive that would train everyone to ignore `emptyPages`. So the
 * `onOpen` mappings are resolved too, taking a real record from the SOURCE page's entity.
 */
export function paramsForPage(
  app: AppDefinition,
  pageId: string,
  created: Record<string, Id[]>,
  rowsOf: (entity: string) => Record<string, unknown> | undefined,
): Record<string, unknown> {
  const page = (app.pages ?? []).find((p) => p.id === pageId);
  const view = page?.view as { param?: string; entity?: string } | undefined;
  const params: Record<string, unknown> = {};
  if (view?.param && view.entity) {
    const first = created[view.entity]?.[0];
    if (first) params[view.param] = first;
  }

  for (const other of app.pages ?? []) {
    const ov = other.view as { entity?: string; onOpen?: { page?: string; param?: Record<string, string> } } | undefined;
    if (ov?.onOpen?.page !== pageId || !ov.onOpen.param || !ov.entity) continue;
    const source = rowsOf(ov.entity);
    if (!source) continue;
    for (const [target, sourceField] of Object.entries(ov.onOpen.param)) {
      const value = source[sourceField];
      if (value !== undefined) params[target] = value;
    }
  }
  return params;
}

export async function smokeApp(app: AppDefinition & { id: string }): Promise<SmokeResult> {
  const errors: string[] = [];
  const ran = { entities: 0, records: 0, pages: 0, computed: 0, actions: 0, reminders: 0, customViews: 0 };
  const emptyPages: string[] = [];
  let seeded = false;
  let computedOk = true;
  let bindingsOk = true;
  let actionsOk = true;
  let remindersOk = true;
  let customViewsOk = true;

  const store = new MemoryStore();
  await store.open(app.id);
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui: UI, nav: NAV });

  const entities = Object.entries(app.entities ?? {});
  ran.entities = entities.length;

  // ---- seed (shared with the concurrency smoke, so both exercise the SAME records) ----
  const seedOut = await seedRecords(app, runtime);
  const created = seedOut.created;
  seeded = seedOut.seeded;
  ran.records = seedOut.records;
  errors.push(...seedOut.errors);

  // ---- computed: resolving a record runs every computed on it ----
  const samples: Record<string, Resolved[]> = {};
  for (const [name, entity] of entities) {
    try {
      const rows = await runtime.ctx.query(name);
      samples[name] = rows;
      ran.computed += Object.keys(entity.computed ?? {}).length * rows.length;
    } catch (e) {
      computedOk = false;
      errors.push(`computed ${name}: ${message(e)}`);
    }
  }

  // ---- pages: filters, sorts, and display bindings ----
  for (const page of app.pages ?? []) {
    const view = page.view as { param?: string; entity?: string } | undefined;
    // A page needs its params before it can resolve anything — both the declared kind and the kind
    // that arrives through navigation. See `paramsForPage`.
    const params = paramsForPage(app, page.id, created, (entity) => samples[entity]?.[0] as Record<string, unknown> | undefined);
    try {
      const { rows, ctx } = await runtime.queryPage(page.id, params);
      ran.pages++;
      // Everything filtered away, on data seeded so that it should not be. See `emptyPages`.
      // Detail pages are excluded: one record is the whole point, and an unresolvable id is
      // already reported elsewhere.
      const seededForEntity = view?.entity ? (created[view.entity]?.length ?? 0) : 0;
      const isDetail = (page.view as { type?: string } | undefined)?.type === "detail";
      if (!isDetail && seededForEntity > 0 && rows.length === 0) emptyPages.push(page.id);
      // Bindings are addressed by REF (kind/page/path), not by value. Paths absent from this view
      // resolve to null rather than throwing, so probing the full set is safe.
      for (const path of VIEW_BINDING_PATHS) {
        for (const row of rows.slice(0, 2)) {
          await runtime.resolveBinding({ kind: "view", page: page.id, path }, row, ctx);
        }
      }
    } catch (e) {
      bindingsOk = false;
      errors.push(`page ${page.id}: ${message(e)}`);
    }
  }

  // ---- custom views: actually execute the component ----
  // Without this the biggest class of generated code is unverified: `render` bodies are arbitrary
  // React, and everything else here only proves the DECLARATIVE parts work. Server-rendering runs
  // the component body, its hooks and its JSX — catching invented UI APIs, bad prop access, and
  // anything thrown on first paint. Effects do NOT run under renderToStaticMarkup, so this proves
  // first paint, not interaction.
  for (const page of app.pages ?? []) {
    const view = page.view as { type?: string; entity?: string; param?: string; render?: unknown } | undefined;
    if (view?.type !== "custom" || typeof view.render !== "function") continue;
    const params: Record<string, string> = {};
    if (view.param && view.entity) {
      const first = created[view.entity]?.[0];
      if (first) params[view.param] = first;
    }
    try {
      const props = {
        runtime,
        entity: view.entity ?? "",
        options: view,
        param: params,
        navigate: () => {},
      };
      // Render `render` AS A COMPONENT (createElement), never by calling it directly: a direct call
      // executes the body as a plain function, so any hook it uses throws "Cannot read properties
      // of null (reading 'useState')" — failing correct apps for the wrong reason.
      const [{ renderToStaticMarkup }, { createElement }] = await Promise.all([
        import("react-dom/server"),
        import("react"),
      ]);
      renderToStaticMarkup(createElement(view.render as never, props as never));
      ran.customViews++;
    } catch (e) {
      customViewsOk = false;
      errors.push(`custom view ${page.id}: ${message(e)}`);
    }
  }

  // ---- actions: the gate that catches hallucinated ctx methods ----
  for (const [name, entity] of entities) {
    for (const key of Object.keys(entity.actions ?? {})) {
      const id = created[name]?.[0];
      if (!id) continue;
      try {
        const input = seededInput(entity, key, created);
        // `core`, not `runtime.runAction`: the latter turns a failure into a toast (right for a button,
        // wrong here) and this bridge drops toasts, so a hallucinated ctx method passed silently.
        await runtime.core.runAction(name, key, id, input);
        ran.actions++;
      } catch (e) {
        actionsOk = false;
        errors.push(`action ${name}.${key}: ${message(e)}`);
      }
    }
  }

  // ---- reminders: `when` runs against seeded records ----
  if ((app.reminders ?? []).length) {
    try {
      await runtime.reconcileReminders();
      ran.reminders = (app.reminders ?? []).length;
    } catch (e) {
      remindersOk = false;
      errors.push(`reminders: ${message(e)}`);
    }
  }

  return { seeded, computedOk, bindingsOk, actionsOk, remindersOk, customViewsOk, ran, errors, emptyPages };
}

/** True when the app not only validates but actually executed its own logic without throwing. */
export function smokePassed(s: SmokeResult): boolean {
  return s.seeded && s.computedOk && s.bindingsOk && s.actionsOk && s.remindersOk && s.customViewsOk;
}

/**
 * What to run a declared action (#213) with: seeded values for its input. With none it would ask with
 * a form, which nobody answers in a harness, and its code would never run — the thing a gate exists
 * to run. Undefined for an action that declares no input.
 */
export function seededInput(entity: EntityDef | undefined, key: string, created: Record<string, Id[]>): Record<string, unknown> | undefined {
  const declared = actionInfo(entity, key)?.input;
  if (!declared) return undefined;
  return Object.fromEntries(
    Object.entries(declared)
      .map(([k, f]) => [k, f.type === "relation" ? created[f.to]?.[0] : seedValue(f, 0, k)])
      .filter(([, v]) => v !== undefined),
  );
}

/**
 * Create sample records for every entity, in two passes.
 *
 * Extracted from `smokeApp` so the concurrency smoke exercises exactly the same records rather than
 * inventing a second, differently-wrong seeding. Pass 1 creates without relations (which sidesteps
 * ordering and cycles); pass 2 fills them once every target exists.
 */
export async function seedRecords(
  app: AppDefinition & { id: string },
  runtime: { create(e: string, d: Record<string, unknown>): Promise<{ id: string }>; patch(e: string, id: string, d: Record<string, unknown>): Promise<void> },
): Promise<{ created: Record<string, string[]>; seeded: boolean; records: number; errors: string[] }> {
  const entities = Object.entries(app.entities ?? {});
  const created: Record<string, string[]> = {};
  const errors: string[] = [];
  let records = 0;
  let seeded = false;

  try {
    for (const [name, entity] of entities) {
      created[name] = [];
      for (let i = 0; i < SEED_ROWS; i++) {
        const data: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(entity.fields ?? {})) {
          const v = seedValue(field as Field, i, key);
          if (v !== undefined) data[key] = v;
        }
        const rec = await runtime.create(name, data);
        created[name]!.push(rec.id);
        records++;
      }
    }
    seeded = true;
  } catch (e) {
    errors.push(`seed: ${message(e)}`);
  }

  if (seeded) {
    for (const [name, entity] of entities) {
      for (const [key, field] of Object.entries(entity.fields ?? {})) {
        const f = field as Field & { to?: string; many?: boolean };
        if (f.type !== "relation" || !f.to) continue;
        const targets = created[f.to];
        if (!targets?.length) continue;
        for (const [i, id] of (created[name] ?? []).entries()) {
          const pick = targets[i % targets.length]!;
          try {
            await runtime.patch(name, id, { [key]: f.many ? [pick] : pick });
          } catch (e) {
            errors.push(`relation ${name}.${key}: ${message(e)}`);
          }
        }
      }
    }
  }

  return { created, seeded, records, errors };
}
