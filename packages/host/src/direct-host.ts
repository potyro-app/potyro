// DirectHost runner (docs/05, docs/07): trusted apps run in-process — real imports, native
// speed, full authority. `call*` invoke the app's actual function closures; `customView`
// returns the real React component. No isolate, no marshalling. This is the runner for the
// user's own apps and for tests.

import type { AppDefinition, CustomViewComponent, CustomViewMount, Resolved, Value } from "karta";
import type { Binding, ReminderWhen } from "karta";
import type { BindingRef, LoadedApp, Provenance } from "./types.js";

type Fn = (...args: unknown[]) => unknown;

function pageView(def: AppDefinition, pageId: string) {
  return def.pages.find((p) => p.id === pageId)?.view;
}

/** Locate a *function* binding by ref; throws if it is a field-key string or missing. */
function bindingFn(def: AppDefinition, ref: BindingRef): Binding {
  if (ref.kind === "reminder") {
    const rem = (def.reminders ?? []).find((r) => r.id === ref.id);
    const b = rem?.[ref.path];
    if (b == null) throw new Error(`binding ${ref.id}.${ref.path} not found`);
    return b;
  }
  const view = pageView(def, ref.page) as Record<string, unknown> | undefined;
  if (!view) throw new Error(`view for page ${ref.page} not found`);
  if (ref.path.startsWith("display.")) {
    const key = ref.path.slice("display.".length);
    const display = view.display as Record<string, unknown> | undefined;
    return display?.[key] as Binding;
  }
  return view[ref.path] as Binding;
}

export class DirectLoadedApp implements LoadedApp {
  readonly definition: AppDefinition;
  readonly provenance: Provenance;
  readonly permissions: AppDefinition["permissions"] & object;

  constructor(definition: AppDefinition, provenance: Provenance) {
    this.definition = definition;
    this.provenance = provenance;
    this.permissions = definition.permissions ?? {};
  }

  async callComputed(entity: string, key: string, record: Resolved, ctx: unknown): Promise<Value> {
    const fn = this.definition.entities[entity]?.computed?.[key];
    if (!fn) throw new Error(`computed ${entity}.${key} not found`);
    return (await fn(record, ctx as never)) as Value;
  }

  async callAction(entity: string, key: string, record: Resolved, ctx: unknown, input?: unknown): Promise<void> {
    const fn = this.definition.entities[entity]?.actions?.[key];
    if (!fn) throw new Error(`action ${entity}.${key} not found`);
    await fn(record, ctx as never, input);
  }

  async callFilter(pageId: string, record: Resolved, ctx: unknown): Promise<boolean> {
    const view = pageView(this.definition, pageId);
    const filter = (view as { filter?: Fn } | undefined)?.filter;
    if (!filter) return true;
    return Boolean(filter(record, ctx));
  }

  async callSort(pageId: string, a: Resolved, b: Resolved): Promise<number> {
    const view = pageView(this.definition, pageId);
    const sort = (view as { sort?: Fn } | undefined)?.sort;
    if (!sort) return 0;
    return Number(sort(a, b));
  }

  async callViewOption(pageId: string, key: string, ctx: unknown): Promise<Value> {
    const view = pageView(this.definition, pageId) as Record<string, unknown> | undefined;
    const option = view?.[key];
    if (option === undefined) return null;
    return (typeof option === "function" ? await (option as (c: unknown) => unknown)(ctx) : option) as Value;
  }

  async callBinding(ref: BindingRef, record: Resolved, ctx: unknown): Promise<Value> {
    const b = bindingFn(this.definition, ref);
    if (typeof b !== "function") {
      throw new Error(`binding ${JSON.stringify(ref)} is a field key, not a function`);
    }
    return (await (b as Fn)(record, ctx)) as Value;
  }

  async callSummary(pageId: string, index: number, rows: Resolved[], ctx: unknown): Promise<Value> {
    const page = this.definition.pages.find((p) => p.id === pageId);
    const spec = page?.summary?.[index];
    if (!spec) throw new Error(`summary ${pageId}[${index}] not found`);
    if (typeof spec.value !== "function") {
      throw new Error(`summary ${pageId}[${index}] declares no value function`);
    }
    return (await spec.value(rows, ctx as never)) as Value;
  }

  async callAggregate(pageId: string, rows: Resolved[], ctx: unknown): Promise<Value> {
    const page = this.definition.pages.find((p) => p.id === pageId);
    const view = page?.view;
    if (!view || view.type !== "aggregate") throw new Error(`page ${pageId} is not an aggregate view`);
    if (typeof view.rows !== "function") throw new Error(`aggregate ${pageId} declares no rows function`);
    return (await view.rows(rows, ctx as never)) as unknown as Value;
  }

  async reminderWhen(id: string, record: Resolved, ctx: unknown): Promise<Date | null> {
    const rem = (this.definition.reminders ?? []).find((r) => r.id === id);
    if (!rem) throw new Error(`reminder ${id} not found`);
    return (rem.when as ReminderWhen)(record, ctx as never);
  }

  customView(pageId: string): CustomViewComponent | null {
    if (this.provenance !== "trusted") return null; // docs/05 policy
    const view = pageView(this.definition, pageId);
    if (view?.type !== "custom") return null;
    return (view.render ?? null) as CustomViewComponent | null;
  }

  customViewMount(pageId: string): CustomViewMount | null {
    if (this.provenance !== "trusted") return null; // same policy as `customView`
    const view = pageView(this.definition, pageId);
    if (view?.type !== "custom") return null;
    return (view.mount ?? null) as CustomViewMount | null;
  }

  dispose(): void {
    // Nothing to release for the direct runner.
  }
}
