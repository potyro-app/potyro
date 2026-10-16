// The untrusted runners' contract (docs/09), run against BOTH while both exist: the browser realm
// (#272, the default for shared apps) and the QuickJS-WASM isolate (the fallback). (a) untrusted
// bundles run and marshal values correctly; (b) an adversarial app cannot reach fetch/globals/host
// (fails closed — QuickJS here; the realm's containment is a browser property, tested in e2e by
// realm-escape-sandbox.spec.ts); (c) limits abort a runaway; (d) mediated caps — ungranted cap is
// absent. Uses hand-written bundles (no esbuild) so the runners are tested apart from the bundler.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { liveThreads, RUNNERS } from "./runners.js";

// A hand-written app bundle (what esbuild would produce for a .app.ts). It sets __potyroApp
// with a computed, a filter, and an action that patches through ctx.
const RECIPE_BUNDLE = `
globalThis.__potyroApp = {
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
        markCooked: async function(r, ctx){ await ctx.patch("recipe", r.id, { timesCooked: (r.timesCooked||0) + 1 }); ctx.ui.toast("cooked"); },
        cookFor: { label: "Cook for", input: { people: { type: "number", required: true } }, run: async function(r, ctx, input){ await ctx.patch("recipe", r.id, { servings: input.people }); } }
      }
    }
  },
  pages: [
    { id: "all", title: "All", view: { type: "list", entity: "recipe", filter: function(r, ctx){ var have = new Set(ctx.params.pantry || []); return r.ingredients.every(function(i){ return true; }) && r.name.length > (ctx.params.min || 0); }, display: { primary: function(r){ return r.name + " (" + Math.round(r.calories) + ")"; } } } }
  ],
  reminders: []
};
`;

describe.each(RUNNERS)("untrusted runner: $name", (runner) => {
  /** A top level that never returns: QuickJS interrupts in 100 ms; the realm's budget also covers starting a thread. */
  const LOAD_RUNAWAY_MS = runner.name === "quickjs" ? 100 : 2000;

  async function setup(bundle: string, params: Record<string, unknown> = {}, extra: Partial<MakeCtxBase> = {}) {
    const store = new MemoryStore();
    await store.open("recipes");
    const toasts: string[] = [];
    const ui: UiBridge = { toast: (m) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null };
    const nav: NavBridge = { navigate: () => {} };
    const caps = new FakeCapabilities();

    const loadIsolated = await runner.loader(store);
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: bundle, provenance: "untrusted" });
    const base: MakeCtxBase = { store, caps, ui, nav, params, ...extra };
    const ctx = host.makeCtx(loaded, base);
    return { store, ui, toasts, host, loaded, ctx };
  }

  describe("provenance + declarative definition", () => {
    it("loads an untrusted bundle and extracts the declarative definition", async () => {
      const { loaded } = await setup(RECIPE_BUNDLE);
      expect(loaded.provenance).toBe("untrusted");
      expect(loaded.definition.id).toBe("recipes");
      expect(Object.keys(loaded.definition.entities)).toContain("recipe");
      loaded.dispose();
    });
  });

  describe("marshalled function execution", () => {
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

    it("runs a declared action ({ run, input }) with its input, and reads its label and input as data", async () => {
      const { loaded, ctx, store } = await setup(RECIPE_BUNDLE);
      const action = loaded.definition.entities.recipe!.actions!.cookFor as unknown as Record<string, unknown>;
      expect(action.label).toBe("Cook for");
      expect(action.input).toEqual({ people: { type: "number", required: true } });
      const seeded = await store.insert("recipe", { name: "Pancake", servings: 2, ingredients: [], timesCooked: 0 });
      await loaded.callAction("recipe", "cookFor", { ...seeded } as never, ctx, { people: 6 });
      expect((await store.get("recipe", seeded.id))!.servings).toBe(6);
      loaded.dispose();
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

  describe("containment (must fail closed)", () => {
    // The realm's containment is the browser's (opaque origin, CSP, no DOM in a Worker): a Node
    // thread has `fetch` and `process`, so this is asserted for the realm in e2e instead.
    it.skipIf(runner.name === "realm")("an adversarial app cannot reach fetch / globals / host internals", async () => {
      const adversary = `
        globalThis.__potyroApp = {
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

  describe("resource limits", () => {
    it("aborts a runaway (infinite loop) via the timeout interrupt", async () => {
      const runaway = `
        globalThis.__potyroApp = {
          id: "loop", name: "Loop", version: "1.0.0", schemaVersion: 1, permissions: {},
          entities: { x: { fields: { n: { type: "number" } }, computed: {
            spin: function(r){ while(true){} return 1; }
          } } },
          pages: [], reminders: []
        };
      `;
      const store = new MemoryStore();
      await store.open("loop");
      const loadIsolated = await runner.loader(store, { timeoutMs: 100 });
      const host = createHost({ loadIsolated });
      const before = new Set(liveThreads);
      const loaded = await host.load({ kind: "bundle", code: runaway, provenance: "untrusted" });
      const mine = [...liveThreads].filter((w) => !before.has(w));
      const ctx = host.makeCtx(loaded, {
        store,
        caps: new FakeCapabilities(),
        ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
        nav: { navigate: () => {} },
      });
      const record = { id: "x1", createdAt: "", updatedAt: "", n: 1 } as never;
      await expect(loaded.callComputed("x", "spin", record, ctx)).rejects.toThrow();
      if (runner.name === "realm") {
        // The spinning thread is really gone: the realm was killed, not just abandoned…
        expect(mine).toHaveLength(1);
        await expect.poll(() => mine.filter((w) => liveThreads.has(w)).length, { timeout: 2000 }).toBe(0);
        // …and the next call starts a fresh realm with the app loaded again.
        await expect(loaded.callComputed("x", "spin", record, ctx)).rejects.toThrow(/stopped/);
      }
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
        globalThis.__potyroApp = {
          id: "loop-load", name: "LoopLoad", version: "1.0.0", schemaVersion: 1, permissions: {},
          entities: {}, pages: [], reminders: []
        };
      `;
      const store = new MemoryStore();
      await store.open("loop-load");
      const loadIsolated = await runner.loader(store, { loadTimeoutMs: LOAD_RUNAWAY_MS });
      const start = Date.now();
      await expect(loadIsolated({ code: runaway, provenance: "untrusted" })).rejects.toThrow();
      // Bounded, not merely "eventually resolves" — a hung load would blow past the test's own
      // timeout below and fail as a timeout, not a clean assertion, but this keeps the intent explicit.
      expect(Date.now() - start).toBeLessThan(5000);
    }, 10000);
  });

  describe("mediated caps", () => {
    it("omits an ungranted capability from ctx.caps", async () => {
      // The bundle declares only `camera`; geo is not granted → absent in the untrusted ctx.
      const { ctx } = await setup(RECIPE_BUNDLE);
      expect(ctx.caps.camera).toBeDefined();
      expect(ctx.caps.geo).toBeUndefined();
      expect(ctx.caps.notifications).toBeUndefined();
    });

    it("a granted haptics cap vibrates through the isolate bridge", async () => {
      const bundle = `
        globalThis.__potyroApp = {
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
      const loadIsolated = await runner.loader(store);
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
  globalThis.__potyroApp = {
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

  describe("ctx.ui.pick", () => {
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
  // `__potyro_fn__` sentinel string where the function was. Before `callSummary` existed the shell
  // called that string, threw, and every function-form figure silently rendered a dash — i.e. the
  // one shape built-in views cannot express was exactly the shape untrusted apps could not compute.
  const SUMMARY_BUNDLE = `
  globalThis.__potyroApp = {
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

  describe("page summary aggregates", () => {
    const rows = [
      { id: "a", createdAt: "", updatedAt: "", amount: 10, month: new Date().getMonth() },
      { id: "b", createdAt: "", updatedAt: "", amount: 99, month: (new Date().getMonth() + 11) % 12 },
      { id: "c", createdAt: "", updatedAt: "", amount: 5, month: new Date().getMonth() },
    ] as unknown as Parameters<Awaited<ReturnType<typeof setup>>["loaded"]["callSummary"]>[2];

    it("runs a summary `value` function inside the VM over the whole row set", async () => {
      const { loaded, ctx } = await setup(SUMMARY_BUNDLE);
      // The definition proves the function did NOT cross the boundary...
      const spec = (loaded.definition.pages[0] as { summary: { value?: unknown }[] }).summary[0];
      expect(spec.value).toBe("__potyro_fn__");
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

  // ── Folds inside a view (#109) ──────────────────────────────────────────────────────────────
  // A stats tile's `value`, its `compare.value` and a chart's `series` stay in the VM; `callFold`
  // names them by path from the view — including a view inside a page layout.
  const FOLD_BUNDLE = `
  globalThis.__potyroApp = {
    id: "fold", name: "Fold", version: "1.0.0", schemaVersion: 1,
    entities: { run: { fields: { km: { type: "number" } } } },
    pages: [
      { id: "p", title: "P", layout: { type: "stack", items: [
        { view: { type: "stats", entity: "run", items: [
          { label: "Total", value: function(rows){ return rows.reduce(function(n, r){ return n + r.km; }, 0); },
            compare: { label: "before", value: function(rows){ return rows.length; } } } ] } },
        { view: { type: "chart", entity: "run", series: function(rows){ return rows.map(function(r){ return { label: r.id, value: r.km }; }); } } }
      ] } }
    ],
    reminders: []
  };
  `;

  describe("callFold", () => {
    const rows = [
      { id: "a", createdAt: "", updatedAt: "", km: 5 },
      { id: "b", createdAt: "", updatedAt: "", km: 7 },
    ] as unknown as Parameters<Awaited<ReturnType<typeof setup>>["loaded"]["callFold"]>[2];

    it("calls a function named by its path in a layout item's view", async () => {
      const { loaded, ctx } = await setup(FOLD_BUNDLE);
      expect(await loaded.callFold("p#0", "items.0.value", rows, ctx)).toBe(12);
      expect(await loaded.callFold("p#0", "items.0.compare.value", rows, ctx)).toBe(2);
      expect(await loaded.callFold("p#1", "series", rows, ctx)).toEqual([
        { label: "a", value: 5 },
        { label: "b", value: 7 },
      ]);
    });

    it("refuses a path that names nothing callable, or reaches outside the view", async () => {
      const { loaded, ctx } = await setup(FOLD_BUNDLE);
      await expect(loaded.callFold("p#0", "items.0.label", rows, ctx)).rejects.toThrow(/no function at items.0.label/);
      await expect(loaded.callFold("p#0", "constructor", rows, ctx)).rejects.toThrow(/no function/);
      await expect(loaded.callFold("p#0", "items[0].value", rows, ctx)).rejects.toThrow(/no function/);
    });
  });

  // ── Host calls never suspend the VM (#112) ─────────────────────────────────────────────────
  // QuickJS's asyncify build allows one suspended call per WebAssembly module, and cannot resume one
  // from a pending job. The bridge used to suspend the VM for every host call, so an action awaiting
  // two in a row aborted QuickJS (`p->ref_count == 0`), and one waiting on a person while other calls
  // ran crashed the tab. Revert the promise bridge in harness.ts / isolate-host.ts and both fail.
  const SEQUENCE_BUNDLE = `globalThis.__potyroApp = { id: "x", name: "X", version: "1.0.0", schemaVersion: 1,
    entities: { n: { fields: { t: { type: "text" }, k: { type: "number" } }, actions: {
      two: async function(r, ctx){ var a = await ctx.get("n", r.id); var b = await ctx.patch("n", r.id, { k: 1 }); var c = await ctx.patch("n", r.id, { k: 2 }); ctx.ui.toast("k=" + c.k); },
      askThenWrite: async function(r, ctx){ var v = await ctx.ui.menu({ items: [{ id: "a", label: "A" }] }); var c = await ctx.patch("n", r.id, { t: v }); ctx.ui.toast("t=" + c.t); },
      shareIt: async function(r, ctx){ var ok = await ctx.ui.share({ title: { en: "Send it" }, text: { en: "Daily #3 4/6" }, url: "https://example.org/x" }); ctx.ui.toast("shared=" + ok); },
      shareFiles: async function(r, ctx){ var f = await ctx.files.write("cards/card.png", new Uint8Array([137, 80, 78, 71]), { mime: "image/png" }); var ok = await ctx.ui.share({ files: [f, new Uint8Array([1, 2, 3])] }); ctx.ui.toast("shared=" + ok); }
    } } }, pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }], reminders: [] };`;

  describe("host calls as promises", () => {
    async function sequence(ui: Partial<UiBridge>) {
      const store = new MemoryStore();
      await store.open("x");
      const toasts: string[] = [];
      const bridge = { toast: (m: string) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null, ...ui } as UiBridge;
      const host = createHost({ loadIsolated: await runner.loader(store) });
      const loaded = await host.load({ kind: "bundle", code: SEQUENCE_BUNDLE, provenance: "untrusted" });
      const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui: bridge, nav: { navigate: () => {} } });
      const rec = await store.insert("n", { t: "x", k: 0 });
      return { loaded, ctx, toasts, rec };
    }

    it("an action awaits several host calls in a row", async () => {
      const { loaded, ctx, toasts, rec } = await sequence({});
      await loaded.callAction("n", "two", { ...rec } as never, ctx);
      expect(toasts).toEqual(["k=2"]);
      loaded.dispose();
    });

    it("ctx.ui.share crosses as plain words, and answers what the shell answered", async () => {
      const seen: unknown[] = [];
      const { loaded, ctx, toasts, rec } = await sequence({ share: async (o) => (seen.push(o), true) });
      await loaded.callAction("n", "shareIt", { ...rec } as never, ctx);
      expect(seen).toEqual([{ title: "Send it", text: "Daily #3 4/6", url: "https://example.org/x" }]);
      expect(toasts).toEqual(["shared=true"]);
      // Headless (no share in the bridge): nothing was sent.
      const headless = await sequence({});
      await headless.loaded.callAction("n", "shareIt", { ...headless.rec } as never, headless.ctx);
      expect(headless.toasts).toEqual(["shared=false"]);
      loaded.dispose();
      headless.loaded.dispose();
    });

    it("ctx.ui.share's files cross the isolate as data: a file of its folder by reference, bytes as bytes", async () => {
      const seen: Array<{ files?: File[] }> = [];
      const { loaded, ctx, toasts, rec } = await sequence({ share: async (o) => (seen.push(o), true) });
      await loaded.callAction("n", "shareFiles", { ...rec } as never, ctx);
      expect(toasts).toEqual(["shared=true"]);
      const files = seen[0]!.files!;
      expect(files.map((f) => f.name)).toEqual(["card.png", "file-2"]);
      expect(new Uint8Array(await files[0]!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
      expect(new Uint8Array(await files[1]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      loaded.dispose();
    });

    it("an action waits on a person past its budget while other calls run, then writes", async () => {
      let release!: (v: string) => void;
      const { loaded, ctx, toasts, rec } = await sequence({ menu: (() => new Promise((r) => (release = r as never))) as never });
      const waiting = loaded.callAction("n", "askThenWrite", { ...rec } as never, ctx);
      await new Promise((r) => setTimeout(r, 1500)); // longer than the 1000 ms call budget
      await loaded.callAction("n", "two", { ...rec } as never, ctx);
      release("a");
      await waiting;
      expect(toasts).toEqual(["k=2", "t=a"]);
      loaded.dispose();
    }, 10000);
  });

  // KA-18: identity has to survive the isolate boundary, or one app source behaves differently
  // depending on how it was installed — which is exactly what provenance is supposed NOT to change.
  const IDENTITY_BUNDLE = `
  globalThis.__potyroApp = {
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

  describe("identity across the boundary (KA-18)", () => {
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

  // KA-18 across the isolate: `createdBy` was stamped and protected only on the DIRECT ctx. The bridge's
  // data.create / data.patch wrote the app's data as given, so an untrusted app — the one this rule
  // exists for — could forge a record's author or rewrite an existing one's.
  const FORGE_BUNDLE = `
  globalThis.__potyroApp = {
    id: "ledger", name: "Ledger", version: "1.0.0", schemaVersion: 1,
    entities: { expense: { fields: { description: { type: "text" }, n: { type: "number" } }, actions: {
      forgeCreate: async function(r, ctx){ await ctx.create("expense", { description: "forged", createdBy: "co_zMallory" }); },
      forgePatch: async function(r, ctx){ await ctx.patch("expense", r.id, { description: "edited", createdBy: "co_zMallory" }); },
      forgeCount: async function(r, ctx){ await ctx.increment("expense", r.id, "createdBy", 1); }
    } } },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "expense" } }],
    reminders: []
  };
  `;

  describe("authorship cannot be forged from the isolate (KA-18)", () => {
    const ana = { id: "co_zAna", name: "Ana" };

    it("stamps a created record with this device, whatever the app sent", async () => {
      const { loaded, ctx, store } = await setup(FORGE_BUNDLE, {}, { me: ana });
      await loaded.callAction("expense", "forgeCreate", { id: "x" } as never, ctx);
      const rows = await store.all("expense");
      expect(rows.map((r) => [r.description, r.createdBy])).toEqual([["forged", "co_zAna"]]);
      loaded.dispose();
    });

    it("drops createdBy from a patch but applies the rest, and refuses to count on it", async () => {
      const { loaded, ctx, store } = await setup(FORGE_BUNDLE, {}, { me: ana });
      const row = await store.insert("expense", { description: "dinner", createdBy: "co_zBruno" } as never);
      await loaded.callAction("expense", "forgePatch", { ...row } as never, ctx);
      const after = await store.get("expense", row.id);
      expect(after?.createdBy).toBe("co_zBruno");
      expect(after?.description).toBe("edited");
      await expect(loaded.callAction("expense", "forgeCount", { ...row } as never, ctx)).rejects.toThrow(/createdBy/);
      expect((await store.get("expense", row.id))?.createdBy).toBe("co_zBruno");
      loaded.dispose();
    });
  });

  // KA-25 across the isolate: a function default lives in the VM; the definition out here holds only
  // the sentinel string. `callFieldDefault` is what lets a form or a quick action start from it.
  const DEFAULTS_BUNDLE = `
  globalThis.__potyroApp = {
    id: "log", name: "Log", version: "1.0.0", schemaVersion: 1,
    entities: { entry: { fields: {
      at: { type: "datetime", default: function(ctx){ return ctx.now(); } },
      who: { type: "text", default: function(ctx){ return ctx.me.name; } },
      n: { type: "number", default: 3 }
    } } },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "entry" } }],
    reminders: []
  };
  `;

  describe("function field defaults (KA-25)", () => {
    it("evaluates a default inside the VM with the real ctx, and returns a static one as it is", async () => {
      const now = new Date("2026-09-09T10:00:00Z");
      const { loaded, ctx } = await setup(DEFAULTS_BUNDLE, {}, { me: { id: "co_zAna", name: "Ana" }, now });
      const fields = (loaded.definition.entities as Record<string, { fields: Record<string, { default?: unknown }> }>).entry!.fields;
      expect(fields.at!.default).toBe("__potyro_fn__");
      const at = await loaded.callFieldDefault("entry", "at", ctx);
      expect(at instanceof Date ? at.toISOString() : at).toBe(now.toISOString());
      expect(await loaded.callFieldDefault("entry", "who", ctx)).toBe("Ana");
      expect(await loaded.callFieldDefault("entry", "n", ctx)).toBe(3);
      loaded.dispose();
    });
  });

  // The launcher's live tile (docs/04 §Tile): it reads the app's data through ctx inside the box,
  // and only the data it returns comes out.
  const TILE_BUNDLE = `
  globalThis.__potyroApp = {
    id: "plants", name: "Plants", version: "1.0.0", schemaVersion: 1,
    entities: { plant: { fields: { name: { type: "text" } } } },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "plant" } }],
    tile: async function(ctx){ var rows = await ctx.query("plant"); return { count: rows.length, title: rows.length + " to water", lines: rows.map(function(r){ return r.name; }) }; },
    reminders: []
  };
  `;

  describe("the live tile", () => {
    it("runs the tile in the box over the app's own data and returns plain data", async () => {
      const { loaded, ctx, store } = await setup(TILE_BUNDLE, {});
      await store.insert("plant", { name: "Fern" });
      await store.insert("plant", { name: "Basil" });
      expect((loaded.definition as unknown as { tile?: unknown }).tile).toBe("__potyro_fn__");
      const tile = (await loaded.callTile(ctx)) as { count: number; title: string; lines: string[] };
      expect(tile.count).toBe(2);
      expect(tile.title).toBe("2 to water");
      expect([...tile.lines].sort()).toEqual(["Basil", "Fern"]);
      loaded.dispose();
    });

    it("answers null for an app without a tile", async () => {
      const { loaded, ctx } = await setup(DEFAULTS_BUNDLE, {});
      expect(await loaded.callTile(ctx)).toBeNull();
      loaded.dispose();
    });
  });
});

afterAll(async () => {
  // Tests that never dispose leave their realm's thread up; end them so the file can exit.
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});
