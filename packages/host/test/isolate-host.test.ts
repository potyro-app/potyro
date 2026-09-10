// IsolateHost tests (docs/09): (a) untrusted bundles run and marshal values correctly;
// (b) an adversarial app cannot reach fetch/globals/host (fails closed); (c) limits abort a
// runaway; (d) mediated caps — ungranted cap is absent. Uses hand-written bundles (no esbuild)
// so the isolate is tested in isolation from the app-bundling pipeline.

import { describe, expect, it, vi } from "vitest";
import { newAsyncContext } from "quickjs-emscripten";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";

function newContext(): Promise<QuickJSAsyncContextLike> {
  return newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>;
}

// A hand-written app bundle (what esbuild would produce for a .app.ts). It sets __kartaApp
// with a computed, a filter, and an action that patches through ctx.
const RECIPE_BUNDLE = `
globalThis.__kartaApp = {
  id: "recipes", name: "Recipes", version: "1.0.0", schemaVersion: 1,
  permissions: { camera: true },
  entities: {
    recipe: {
      fields: { name: { type: "text" }, servings: { type: "number" }, ingredients: { type: "list", of: { cal: { type: "number" }, qty: { type: "number" } } }, timesCooked: { type: "number" } },
      computed: {
        calories: function(r){ return r.ingredients.reduce(function(s,i){ return s + i.cal * i.qty / 100; }, 0); },
        caloriesPerServing: function(r){ return r.calories / Math.max(r.servings, 1); }
      },
      actions: {
        markCooked: async function(r, ctx){ await ctx.patch("recipe", r.id, { timesCooked: (r.timesCooked||0) + 1 }); ctx.ui.toast("cooked"); }
      }
    }
  },
  pages: [
    { id: "all", title: "All", view: { type: "list", entity: "recipe", filter: function(r, ctx){ var have = new Set(ctx.params.pantry || []); return r.ingredients.every(function(i){ return true; }) && r.name.length > (ctx.params.min || 0); }, display: { primary: function(r){ return r.name + " (" + Math.round(r.calories) + ")"; } } } }
  ],
  reminders: []
};
`;

async function setup(bundle: string, params: Record<string, unknown> = {}, extra: Partial<MakeCtxBase> = {}) {
  const store = new MemoryStore();
  await store.open("recipes");
  const toasts: string[] = [];
  const ui: UiBridge = { toast: (m) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const caps = new FakeCapabilities();

  const loadIsolated = createIsolateLoader({ store, newContext });
  const host = createHost({ loadIsolated });
  const loaded = await host.load({ kind: "bundle", code: bundle, provenance: "untrusted" });
  const base: MakeCtxBase = { store, caps, ui, nav, params, ...extra };
  const ctx = host.makeCtx(loaded, base);
  return { store, ui, toasts, host, loaded, ctx };
}

describe("IsolateHost — provenance + declarative definition", () => {
  it("loads an untrusted bundle and extracts the declarative definition", async () => {
    const { loaded } = await setup(RECIPE_BUNDLE);
    expect(loaded.provenance).toBe("untrusted");
    expect(loaded.definition.id).toBe("recipes");
    expect(Object.keys(loaded.definition.entities)).toContain("recipe");
    loaded.dispose();
  });
});

describe("IsolateHost — marshalled function execution", () => {
  it("runs computed macros in the isolate (incl. cross-computed) via the resolve path", async () => {
    const { loaded, ctx, store } = await setup(RECIPE_BUNDLE);
    await store.insert("recipe", { name: "Pancake", servings: 2, ingredients: [{ cal: 364, qty: 200 }, { cal: 155, qty: 100 }], timesCooked: 0 });
    // ctx.query resolves computed in declaration order (host calls into the isolate per key,
    // accumulating), so caloriesPerServing sees calories.
    const [r] = await ctx.query("recipe");
    expect(Math.round(Number(r.calories))).toBe(883);
    expect(Math.round(Number(r.caloriesPerServing))).toBe(442);
    loaded.dispose();
  });

  it("runs a filter using ctx.params in the isolate", async () => {
    const long = await setup(RECIPE_BUNDLE, { min: 3 });
    const record = { id: "r1", createdAt: "", updatedAt: "", name: "Pancake", servings: 2, ingredients: [], timesCooked: 0 } as never;
    expect(await long.loaded.callFilter("all", record, long.ctx)).toBe(true);
    long.loaded.dispose();

    const short = await setup(RECIPE_BUNDLE, { min: 100 });
    expect(await short.loaded.callFilter("all", record, short.ctx)).toBe(false);
    short.loaded.dispose();
  });

  it("runs an action that patches + toasts through the mediated ctx", async () => {
    const { loaded, ctx, store, toasts } = await setup(RECIPE_BUNDLE);
    const seeded = await store.insert("recipe", { name: "Pancake", servings: 2, ingredients: [], timesCooked: 0 });
    const record = { ...seeded } as never;
    await loaded.callAction("recipe", "markCooked", record, ctx);
    const updated = await store.get("recipe", seeded.id);
    expect(updated!.timesCooked).toBe(1);
    expect(toasts).toEqual(["cooked"]);
    loaded.dispose();
  });

  it("resolves a function display binding in the isolate", async () => {
    const { loaded, ctx, store } = await setup(RECIPE_BUNDLE);
    await store.insert("recipe", { name: "Soup", servings: 1, ingredients: [{ cal: 100, qty: 100 }], timesCooked: 0 });
    const [r] = await ctx.query("recipe");
    const primary = await loaded.callBinding({ kind: "view", page: "all", path: "display.primary" }, r, ctx);
    expect(primary).toBe("Soup (100)");
    loaded.dispose();
  });

  // SANDBOX-PARITY DEBT (deliberate, tracked). The direct path now lets a computed query its OWN
  // entity: the re-entered key is replaced by an accessor that throws only if the value is actually
  // read (see `defineCycleTrap` in resolve.ts, and runtime/test/same-entity-computed.test.ts).
  // That accessor cannot survive serialization into QuickJS, so an UNTRUSTED app doing the same
  // thing still fails as it did before — trusted and untrusted diverge here for the first time.
  // Deliberate: the isolate answer is only needed once a B2B integration or an iOS submission makes
  // it real. Do not delete this marker without either implementing parity or recording the decision.
  it.todo("parity: an untrusted computed may query its own entity (see defineCycleTrap)");
});

describe("IsolateHost — containment (must fail closed)", () => {
  it("an adversarial app cannot reach fetch / globals / host internals", async () => {
    const adversary = `
      globalThis.__kartaApp = {
        id: "evil", name: "Evil", version: "1.0.0", schemaVersion: 1, permissions: {},
        entities: { x: { fields: { n: { type: "number" } }, computed: {
          escape: function(r){
            var reached = [];
            if (typeof fetch !== "undefined") reached.push("fetch");
            if (typeof process !== "undefined") reached.push("process");
            if (typeof require !== "undefined") reached.push("require");
            if (typeof globalThis.__host === "undefined") reached.push("no-host");
            return reached.join(",");
          }
        } } },
        pages: [], reminders: []
      };
    `;
    const { loaded, ctx } = await setup(adversary);
    const record = { id: "x1", createdAt: "", updatedAt: "", n: 1 } as never;
    const reached = await loaded.callComputed("x", "escape", record, ctx);
    // No ambient authority: fetch/process/require are all absent. (__host exists but is the
    // only, mediated bridge — the app can't use it to escape its own store.)
    expect(reached).not.toContain("fetch");
    expect(reached).not.toContain("process");
    expect(reached).not.toContain("require");
    loaded.dispose();
  });
});

describe("IsolateHost — resource limits", () => {
  it("aborts a runaway (infinite loop) via the timeout interrupt", async () => {
    const runaway = `
      globalThis.__kartaApp = {
        id: "loop", name: "Loop", version: "1.0.0", schemaVersion: 1, permissions: {},
        entities: { x: { fields: { n: { type: "number" } }, computed: {
          spin: function(r){ while(true){} return 1; }
        } } },
        pages: [], reminders: []
      };
    `;
    const store = new MemoryStore();
    await store.open("loop");
    const loadIsolated = createIsolateLoader({ store, newContext, timeoutMs: 100 });
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: runaway, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, {
      store,
      caps: new FakeCapabilities(),
      ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
      nav: { navigate: () => {} },
    });
    const record = { id: "x1", createdAt: "", updatedAt: "", n: 1 } as never;
    await expect(loaded.callComputed("x", "spin", record, ctx)).rejects.toThrow();
    loaded.dispose();
  }, 10000);

  // Finding 4 (security review, KA-38 follow-on): the ORIGINAL hole this whole suite exists to
  // close was a top-level runaway, not a runaway reached through `invoke()` (the test above). Every
  // other test here loads a bundle whose body returns immediately, so nothing in this file failed
  // when the load-time interrupt handler was missing — only the shell suite noticed, by timing out.
  // This test loads a bundle whose TOP LEVEL never returns, with a small `loadTimeoutMs`, and
  // requires the load itself to reject within a bounded time. Revert the load-time interrupt
  // handler in isolate-host.ts and this hangs instead of failing cleanly.
  it("aborts a bundle whose top-level module body loops forever, via the load-time interrupt", async () => {
    const runaway = `
      while (true) {}
      globalThis.__kartaApp = {
        id: "loop-load", name: "LoopLoad", version: "1.0.0", schemaVersion: 1, permissions: {},
        entities: {}, pages: [], reminders: []
      };
    `;
    const store = new MemoryStore();
    await store.open("loop-load");
    const loadIsolated = createIsolateLoader({ store, newContext, loadTimeoutMs: 100 });
    const start = Date.now();
    await expect(loadIsolated({ code: runaway, provenance: "untrusted" })).rejects.toThrow();
    // Bounded, not merely "eventually resolves" — a hung load would blow past the test's own
    // timeout below and fail as a timeout, not a clean assertion, but this keeps the intent explicit.
    expect(Date.now() - start).toBeLessThan(5000);
  }, 10000);
});

describe("IsolateHost — mediated caps", () => {
  it("omits an ungranted capability from ctx.caps", async () => {
    // The bundle declares only `camera`; geo is not granted → absent in the untrusted ctx.
    const { ctx } = await setup(RECIPE_BUNDLE);
    expect(ctx.caps.camera).toBeDefined();
    expect(ctx.caps.geo).toBeUndefined();
    expect(ctx.caps.notifications).toBeUndefined();
  });

  it("a granted haptics cap vibrates through the isolate bridge", async () => {
    const bundle = `
      globalThis.__kartaApp = {
        id: "buzz", name: "Buzz", version: "1.0.0", schemaVersion: 1, permissions: { haptics: true },
        entities: { t: { fields: { n: { type: "number" } }, actions: {
          go: async function(r, ctx){ ctx.caps.haptics.vibrate([0, 200, 100, 200]); }
        } } },
        pages: [], reminders: []
      };
    `;
    const store = new MemoryStore();
    await store.open("buzz");
    const caps = new FakeCapabilities();
    const loadIsolated = createIsolateLoader({ store, newContext });
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: bundle, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, {
      store,
      caps,
      ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
      nav: { navigate: () => {} },
    });
    expect(ctx.caps.haptics).toBeDefined();
    const rec = await store.insert("t", { n: 1 });
    await loaded.callAction("t", "go", { ...rec } as never, ctx);
    expect(caps.vibrations).toEqual([[0, 200, 100, 200]]);
    loaded.dispose();
  });
});

// ── ctx.ui.pick across the isolate ───────────────────────────────────────────────────────────
//
// generator/src/prompt.ts:232 tells every generated app it can `await ctx.ui.pick(items, opts)`.
// harness.ts bridges it (`{op:"ui.pick", items, opts:{multi}}`), but until now `handleOp` had no
// `case "ui.pick"`, so the op fell through to the unknown-op path and rejected for every untrusted
// app that used the picker the contract promised it — provenance is not an edge case here (CLAUDE.md
// rule 3: a shared/imported app ALWAYS runs here), so this was a real break, not a theoretical one.
const PICK_BUNDLE = `
globalThis.__kartaApp = {
  id: "picker-app", name: "PickerApp", version: "1.0.0", schemaVersion: 1, permissions: {},
  entities: { t: { fields: { n: { type: "number" } }, actions: {
    choose: async function(r, ctx){
      var chosen = await ctx.ui.pick(["a", "b", "c"], { multi: false });
      ctx.ui.toast("picked:" + JSON.stringify(chosen));
    }
  } } },
  pages: [], reminders: []
};
`;

describe("IsolateHost — ctx.ui.pick", () => {
  it("returns the host's selection to an untrusted app", async () => {
    const toasts: string[] = [];
    const ui: UiBridge = {
      toast: (m) => void toasts.push(m),
      confirm: async () => true,
      prompt: async () => null,
      pick: async <T>(items: T[]) => items[1] ?? null,
    };
    const { loaded, ctx, store } = await setup(PICK_BUNDLE, {}, { ui });
    const rec = await store.insert("t", { n: 1 });
    await loaded.callAction("t", "choose", { ...rec } as never, ctx);
    expect(toasts).toEqual(['picked:"b"']);
    loaded.dispose();
  });

  it("returns null to an untrusted app when the pick is cancelled", async () => {
    const toasts: string[] = [];
    const ui: UiBridge = {
      toast: (m) => void toasts.push(m),
      confirm: async () => true,
      prompt: async () => null,
      pick: async () => null,
    };
    const { loaded, ctx, store } = await setup(PICK_BUNDLE, {}, { ui });
    const rec = await store.insert("t", { n: 1 });
    await loaded.callAction("t", "choose", { ...rec } as never, ctx);
    expect(toasts).toEqual(["picked:null"]);
    loaded.dispose();
  });
});

// ── Page summary aggregates across the isolate (KA-24) ──────────────────────────────────────
//
// `computed` is per-record, so an aggregate over the WHOLE set lives in `page.summary`. For an
// untrusted app that function never leaves the VM: the extracted definition carries the
// `__karta_fn__` sentinel string where the function was. Before `callSummary` existed the shell
// called that string, threw, and every function-form figure silently rendered a dash — i.e. the
// one shape built-in views cannot express was exactly the shape untrusted apps could not compute.
const SUMMARY_BUNDLE = `
globalThis.__kartaApp = {
  id: "expenses", name: "Expenses", version: "1.0.0", schemaVersion: 1,
  entities: {
    expense: { fields: { amount: { type: "number" }, month: { type: "number" } } }
  },
  pages: [
    { id: "all", title: "All",
      summary: [
        { label: "This month", value: function(rows, ctx){
            var m = ctx.today().getMonth();
            return rows.filter(function(r){ return r.month === m; })
                       .reduce(function(n, r){ return n + r.amount; }, 0);
          } },
        { label: "Count", op: "count" }
      ],
      view: { type: "list", entity: "expense" } }
  ],
  reminders: []
};
`;

describe("IsolateHost — page summary aggregates", () => {
  const rows = [
    { id: "a", createdAt: "", updatedAt: "", amount: 10, month: new Date().getMonth() },
    { id: "b", createdAt: "", updatedAt: "", amount: 99, month: (new Date().getMonth() + 11) % 12 },
    { id: "c", createdAt: "", updatedAt: "", amount: 5, month: new Date().getMonth() },
  ] as unknown as Parameters<Awaited<ReturnType<typeof setup>>["loaded"]["callSummary"]>[2];

  it("runs a summary `value` function inside the VM over the whole row set", async () => {
    const { loaded, ctx } = await setup(SUMMARY_BUNDLE);
    // The definition proves the function did NOT cross the boundary...
    const spec = (loaded.definition.pages[0] as { summary: { value?: unknown }[] }).summary[0];
    expect(spec.value).toBe("__karta_fn__");
    // ...and the host call is what makes it computable anyway.
    expect(await loaded.callSummary("all", 0, rows, ctx)).toBe(15);
  });

  it("reports a missing value function instead of returning a wrong number", async () => {
    const { loaded, ctx } = await setup(SUMMARY_BUNDLE);
    // Index 1 is the declarative `count` form — it has no function to call, and saying so is the
    // only safe answer. A silent 0 here would read as "nothing spent".
    await expect(loaded.callSummary("all", 1, rows, ctx)).rejects.toThrow(/no value function/);
  });
});

// KA-18: identity has to survive the isolate boundary, or one app source behaves differently
// depending on how it was installed — which is exactly what provenance is supposed NOT to change.
const IDENTITY_BUNDLE = `
globalThis.__kartaApp = {
  id: "ledger", name: "Ledger", version: "1.0.0", schemaVersion: 1,
  entities: {
    expense: {
      label: "Expense", displayField: "description",
      fields: { description: { type: "text" }, paidBy: { type: "member" } },
      computed: {
        mine: function(r, ctx){ return r.paidBy === ctx.me.id; },
        whoAmI: function(r, ctx){ return ctx.me.name; },
        crowd: function(r, ctx){ return (ctx.space ? ctx.space.members.length : 1); }
      }
    }
  },
  pages: [
    { id: "all", title: "All", view: { type: "list", entity: "expense", display: { primary: function(r){ return r.description; } } } }
  ],
  reminders: []
};
`;

describe("IsolateHost — identity across the boundary (KA-18)", () => {
  const ana = { id: "co_zAna", name: "Ana" };

  it("gives untrusted code ctx.me", async () => {
    const { store, loaded, ctx } = await setup(IDENTITY_BUNDLE, {}, { me: ana });
    const row = await store.insert("expense", { description: "Dinner", paidBy: "co_zAna" });

    expect(await loaded.callComputed("expense", "whoAmI", row as never, ctx)).toBe("Ana");
    expect(await loaded.callComputed("expense", "mine", row as never, ctx)).toBe(true);
  });

  it("reports a solo app as having no space, not as an error", async () => {
    const { store, loaded, ctx } = await setup(IDENTITY_BUNDLE, {}, { me: ana });
    const row = await store.insert("expense", { description: "Dinner" });
    expect(await loaded.callComputed("expense", "crowd", row as never, ctx)).toBe(1);
  });

  it("passes the space's members through", async () => {
    const { store, loaded, ctx } = await setup(IDENTITY_BUNDLE, {}, {
      me: ana,
      space: {
        id: "co_zSpace",
        role: "writer",
        members: [
          { id: "co_zAna", name: "Ana", role: "admin" },
          { id: "co_zBruno", name: "Bruno", role: "writer" },
        ],
        invite: async () => "https://example.test/#join=…",
      },
    });
    const row = await store.insert("expense", { description: "Dinner" });
    expect(await loaded.callComputed("expense", "crowd", row as never, ctx)).toBe(2);
  });

  it("does NOT hand the isolate a way to mint invites", async () => {
    // `space.invite()` is host-mediated UI. Untrusted code able to call it could hand the space to a
    // stranger with no prompt, so it is left behind at the boundary rather than marshalled.
    const probe = IDENTITY_BUNDLE.replace(
      'return (ctx.space ? ctx.space.members.length : 1);',
      'return typeof (ctx.space && ctx.space.invite);',
    );
    const { store, loaded, ctx } = await setup(probe, {}, {
      me: ana,
      space: {
        id: "co_zSpace",
        role: "admin",
        members: [{ id: "co_zAna", name: "Ana", role: "admin" }],
        invite: async () => "https://example.test/#join=…",
      },
    });
    const row = await store.insert("expense", { description: "Dinner" });
    expect(await loaded.callComputed("expense", "crowd", row as never, ctx)).toBe("undefined");
  });
});
