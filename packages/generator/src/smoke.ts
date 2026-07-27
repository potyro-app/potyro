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

import type { AppDefinition, Field, Resolved } from "karta";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime } from "@karta/runtime";
import { MemoryStore } from "@karta/store";

const SEED_ROWS = 3;
const DAY_MS = 86_400_000;

/** Every view binding path a `BindingRef` can address (see @karta/host BindingRef). */
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
  /** Counts, so a vacuous pass (nothing to run) is distinguishable from a real one. */
  ran: { entities: number; records: number; pages: number; computed: number; actions: number; reminders: number };
  errors: string[];
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

export async function smokeApp(app: AppDefinition & { id: string }): Promise<SmokeResult> {
  const errors: string[] = [];
  const ran = { entities: 0, records: 0, pages: 0, computed: 0, actions: 0, reminders: 0 };
  let seeded = false;
  let computedOk = true;
  let bindingsOk = true;
  let actionsOk = true;
  let remindersOk = true;

  const store = new MemoryStore();
  await store.open(app.id);
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui: UI, nav: NAV });

  const entities = Object.entries(app.entities ?? {});
  ran.entities = entities.length;

  // ---- pass 1: create records without relations (avoids ordering/cycle problems) ----
  const created: Record<string, string[]> = {};
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
        ran.records++;
      }
    }
    seeded = true;
  } catch (e) {
    errors.push(`seed: ${message(e)}`);
  }

  // ---- pass 2: fill relation fields now that every target exists ----
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
    // A detail page needs its record id, else it legitimately resolves nothing.
    const params: Record<string, unknown> = {};
    if (view?.param && view.entity) {
      const first = created[view.entity]?.[0];
      if (first) params[view.param] = first;
    }
    try {
      const { rows, ctx } = await runtime.queryPage(page.id, params);
      ran.pages++;
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

  // ---- actions: the gate that catches hallucinated ctx methods ----
  for (const [name, entity] of entities) {
    for (const key of Object.keys(entity.actions ?? {})) {
      const id = created[name]?.[0];
      if (!id) continue;
      try {
        await runtime.runAction(name, key, id);
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

  return { seeded, computedOk, bindingsOk, actionsOk, remindersOk, ran, errors };
}

/** True when the app not only validates but actually executed its own logic without throwing. */
export function smokePassed(s: SmokeResult): boolean {
  return s.seeded && s.computedOk && s.bindingsOk && s.actionsOk && s.remindersOk;
}
