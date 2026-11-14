// What an app's failed action is once it has left the app (#76).
//
// A person was shown "realm app error: Grape must be one of: …": the box's name, then the
// validator's English. So the same three failures are run here every way an app runs — directly,
// in the QuickJS isolate, in the browser realm — and each must arrive sorted the same: a refused
// write as data (entity, field, rule), the app's own words as its words, anything else as broken,
// and never a word about the box.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { defineApp, FieldValueError, type Resolved } from "potyro";
import { actionFailure, AppCodeError, createHost, HostFault, type LoadedApp, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { liveThreads, RUNNERS, type RunnerOptions } from "./runners.js";

/** The app, as source: evaluated here for the direct runner, loaded as a bundle by the sealed ones. */
const WINE = `
globalThis.__potyroApp = {
  id: "cellar", name: "Cellar", version: "1.0.0", schemaVersion: 1,
  entities: {
    wine: {
      label: "Wine",
      fields: {
        name: { type: "text" },
        grape: { type: "enum", label: "Grape", options: ["malbec", "merlot", "syrah"] },
        tastings: { type: "list", of: { score: { type: "number", label: "Score", max: 100 } } }
      },
      actions: {
        identify: async function(r, ctx){ await ctx.patch("wine", r.id, { grape: "Cabernet Sauvignon" }); },
        copy: async function(r, ctx){ await ctx.create("wine", { name: "Copy", grape: 7 }); },
        score: async function(r, ctx){ await ctx.patch("wine", r.id, { tastings: [{ score: 140 }] }); },
        caught: async function(r, ctx){
          try { await ctx.patch("wine", r.id, { grape: "Cabernet Sauvignon" }); }
          catch (e) { await ctx.patch("wine", r.id, { name: e.name + "|" + e.message + "|" + (e.refusal ? e.refusal.field : "no refusal") }); }
        },
        refuse: async function(){ throw new Error("Pick a bottle first"); },
        bug: async function(r){ return r.cellar.shelf; },
        spin: async function(){ for (;;) {} }
      }
    }
  },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "wine", display: { primary: "name" } } }]
};
`;

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

type Load = (host: ReturnType<typeof createHost>) => Promise<LoadedApp>;

async function setup(loadWith: (store: MemoryStore) => Promise<{ host: ReturnType<typeof createHost>; load: Load }>) {
  const store = new MemoryStore();
  await store.open("cellar");
  const { host, load } = await loadWith(store);
  const loaded = await load(host);
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav } as MakeCtxBase);
  const row = await store.insert("wine", { name: "Bottle" });
  const record = (await ctx.get("wine", row.id)) as Resolved;
  const fail = (action: string): Promise<unknown> => loaded.callAction("wine", action, record, ctx).then(
    () => { throw new Error(`${action} did not fail`); },
    (e: unknown) => e,
  );
  return { store, loaded, ctx, record, fail };
}

const direct = { name: "direct", sealed: false, start: (_opts?: RunnerOptions) => async (_store: MemoryStore) => {
  const scope: { __potyroApp?: Parameters<typeof defineApp>[0] } = {};
  new Function("globalThis", WINE)(scope);
  return { host: createHost(), load: (host: ReturnType<typeof createHost>) => host.load({ kind: "module", app: defineApp(scope.__potyroApp!) }) };
} };

const sealed = RUNNERS.map((runner) => ({ name: runner.name as string, sealed: true, start: (opts?: RunnerOptions) => async (store: MemoryStore) => ({
  host: createHost({ loadIsolated: await runner.loader(store, opts) }),
  load: (host: ReturnType<typeof createHost>) => host.load({ kind: "bundle", code: WINE, provenance: "untrusted" }),
}) }));

afterAll(() => {
  for (const t of liveThreads) void t.terminate();
});

const INTERNAL = /realm|isolate|sandbox|sealed|worker|\bat .*:\d+/i;

describe.each([direct, ...sealed])("an action that fails, run by: $name", (how) => {
  it("a patch its field refuses arrives as the entity, the field and the rule", async () => {
    const { fail, store, record } = await setup(how.start());
    const failure = actionFailure(await fail("identify"));
    expect(failure).toEqual({
      kind: "refused",
      refusal: { entity: "wine", field: "grape", issue: { rule: "options", options: ["malbec", "merlot", "syrah"] } },
      detail: "FieldValueError: Grape must be one of: malbec, merlot, syrah.",
    });
    expect((await store.get("wine", String(record.id)))?.grape).toBeUndefined();
  });

  it("so does a create, and a row of a list", async () => {
    const { fail } = await setup(how.start());
    expect(actionFailure(await fail("copy"))).toMatchObject({ kind: "refused", refusal: { entity: "wine", field: "grape", issue: { rule: "options" } } });
    expect(actionFailure(await fail("score"))).toEqual({
      kind: "refused",
      refusal: { entity: "wine", field: "tastings", issue: { rule: "row", key: "score", issue: { rule: "max", bound: 100 } } },
      detail: "FieldValueError: Tastings › Score must be at most 100.",
    });
  });

  it("the message carries no word about how the app is run", async () => {
    const { fail } = await setup(how.start());
    for (const action of ["identify", "refuse", "bug"]) {
      const e = (await fail(action)) as Error;
      expect(e.message, action).not.toMatch(INTERNAL);
    }
    expect(((await fail("identify")) as Error).message).toBe("Grape must be one of: malbec, merlot, syrah.");
  });

  it("the app's own code catches the refusal as a trusted app would: its name, its sentence, its data", async () => {
    const { loaded, ctx, record, store } = await setup(how.start());
    await loaded.callAction("wine", "caught", record, ctx);
    expect((await store.get("wine", String(record.id)))?.name).toBe("FieldValueError|Grape must be one of: malbec, merlot, syrah.|grape");
  });

  it("words the app threw are its words", async () => {
    const { fail } = await setup(how.start());
    expect(actionFailure(await fail("refuse"))).toEqual({ kind: "said", message: "Pick a bottle first", detail: "Pick a bottle first" });
  });

  it("a bug is broken, with the engine's line kept as the detail only", async () => {
    const { fail } = await setup(how.start());
    const failure = actionFailure(await fail("bug"));
    expect(failure.kind).toBe("broke");
    expect(failure.detail).toMatch(/^TypeError: /);
  });

  it("is the right class: the thrown error itself directly, an AppCodeError out of a box", async () => {
    const { fail } = await setup(how.start());
    const e = await fail("identify");
    if (how.sealed) expect(e).toBeInstanceOf(AppCodeError);
    else expect(e).toBeInstanceOf(FieldValueError);
  });
});

describe.each(sealed)("the box's own trouble, in: $name", (how) => {
  it("a call that runs out of time is the runner's fault, never the app's words", async () => {
    const { fail } = await setup(how.start({ timeoutMs: 200, heartbeatTimeoutMs: 400 }));
    const e = await fail("spin");
    // The realm's watchdog stops the box (a HostFault); QuickJS interrupts the call with its own InternalError.
    if (how.name === "realm") expect(e).toBeInstanceOf(HostFault);
    expect(actionFailure(e).kind).toBe("broke");
  }, 20_000);
});

describe("what a box sends back is not trusted to be well-formed", () => {
  it("a refusal that is not one is dropped, and the rest is cut to size", () => {
    const e = new AppCodeError({ name: "Error", message: "x" });
    expect(actionFailure(e)).toEqual({ kind: "said", message: "x", detail: "x" });
    const forged = Object.assign(new Error("boom"), { refusal: { entity: "wine", field: 3, issue: { rule: "options" } } });
    expect(actionFailure(forged).kind).toBe("said");
    const unknownRule = Object.assign(new Error("boom"), { refusal: { entity: "wine", field: "grape", issue: { rule: "<script>" } } });
    expect(actionFailure(unknownRule).kind).toBe("said");
  });

  it("something thrown that is not an error is broken unless it has words", () => {
    expect(actionFailure(undefined).kind).toBe("said"); // "undefined" — a thrown non-error is still words
    expect(actionFailure(new Error("")).kind).toBe("broke");
    expect(actionFailure(new RangeError("Maximum call stack size exceeded")).kind).toBe("broke");
  });
});
