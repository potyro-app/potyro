// Voice input in every runner (docs/29): one app, written once as source, run as a trusted function,
// in the QuickJS isolate and in the browser realm, against the fake microphone. Each listens, writes
// what it hears as records from inside its callbacks (so `ctx` must still work after the call that
// started the listening returned), stops, gets its result, and hears a failure's code.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities, createFakeSpeech } from "@potyro/capabilities";
import { defineApp } from "potyro";
import { createHost, type LoadedApp, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { RUNNERS, liveThreads, type Runner } from "./runners.js";

const PRELUDE = "var heard = null;";
const ACTIONS: Record<string, string> = {
  listen: `async function (r, ctx) {
    heard = await ctx.caps.speech.listen({ language: "pl" });
    await ctx.create("msg", { text: "listening " + heard.language + " " + heard.engine + " " + heard.listening });
    heard.onText(function (t, f) { ctx.create("msg", { text: (f ? "final " : "interim ") + t }); });
    heard.result.then(function (t) { ctx.create("msg", { text: "result " + t + " " + heard.listening }); }, function (e) { ctx.create("msg", { text: "failed " + e.code }); });
  }`,
  stopIt: `async function (r, ctx) { heard.stop(); }`,
  refused: `async function (r, ctx) {
    try { await ctx.caps.speech.listen(); await ctx.create("msg", { text: "started" }); } catch (e) { await ctx.create("msg", { text: "refused " + e.code }); }
  }`,
};

const definition = {
  id: "voice",
  name: "Voice",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { speech: true },
  entities: {
    run: { fields: { out: { type: "text" } } },
    msg: { fields: { text: { type: "text" } } },
  },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "msg", display: { primary: "text" } } }],
};

const nav: NavBridge = { navigate: () => {} };

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

async function until(cond: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function scenario(trust: "trusted" | Runner) {
  const store = new MemoryStore();
  await store.open("voice");
  const fake = createFakeSpeech();
  const asked: string[] = [];
  const ui: UiBridge = { toast: () => {}, confirm: async (m) => (asked.push(m), true), prompt: async () => null, pick: async () => null };
  const caps = new FakeCapabilities({ speech: fake.cap });
  const host = trust === "trusted" ? createHost() : createHost({ loadIsolated: await trust.loader(store) });
  let loaded: LoadedApp;
  if (trust === "trusted") {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const actions = new Function(`${PRELUDE} return { ${Object.entries(ACTIONS).map(([k, v]) => `${k}: ${v}`).join(",")} };`)() as Record<string, unknown>;
    loaded = await host.load({ kind: "module", app: defineApp({ ...definition, entities: { ...definition.entities, run: { ...definition.entities.run, actions } } } as never) });
  } else {
    const actions = `{${Object.entries(ACTIONS).map(([k, v]) => `"${k}":${v}`).join(",")}}`;
    const json = JSON.stringify(definition).replace('"run":{"fields":{"out":{"type":"text"}}}', `"run":{"fields":{"out":{"type":"text"}},"actions":${actions.replace(/\$/g, "$$$$")}}`);
    loaded = await host.load({ kind: "bundle", code: `${PRELUDE} globalThis.__potyroApp = ${json};`, provenance: "untrusted" });
  }
  const row = await store.insert("run", { out: "" });
  const act = (key: string) => loaded.callAction("run", key, { ...row } as never, host.makeCtx(loaded, { store, caps, ui, nav, language: "en" } as MakeCtxBase));
  const texts = async () => (await store.all("msg")).map((m) => String(m.text));
  const has = (t: string) => async () => (await texts()).includes(t);

  await act("listen");
  await until(has("listening pl-PL device true"));
  fake.say("kup", false);
  await until(has("interim kup"));
  fake.say("kup mleko");
  await until(has("final kup mleko"));
  await act("stopIt");
  await until(has("result kup mleko false"));

  // A failure after starting: the result rejects with its code.
  await act("listen");
  await until(async () => fake.active);
  fake.fail("offline", "You're offline");
  await until(has("failed offline"));

  fake.refuse("denied");
  await act("refused");
  await until(has("refused denied"));

  // Leaving the app ends a listening; nothing is kept from it.
  await act("listen");
  await until(async () => fake.active);
  loaded.dispose();
  const last = fake.listenings[fake.listenings.length - 1]!;
  const out = (await texts()).sort();
  return { out, asked, lastEnd: last.ended?.why ?? null };
}

const EXPECTED = ["listening pl-PL device true", "interim kup", "final kup mleko", "result kup mleko false", "failed offline", "refused denied"].sort();

describe("ctx.caps.speech in every runner", () => {
  it("trusted: listens, hears, stops, fails with a code — and is never asked on the device", { timeout: 30_000 }, async () => {
    const { out, asked } = await scenario("trusted");
    expect(out).toEqual(expect.arrayContaining(EXPECTED));
    expect(asked).toEqual([]);
  });

  for (const runner of RUNNERS) {
    it(`${runner.name}: an action that awaits what is said is not stopped by its budget while the person speaks`, async () => {
      const store = new MemoryStore();
      await store.open("voice");
      const fake = createFakeSpeech();
      const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
      const caps = new FakeCapabilities({ speech: fake.cap });
      const host = createHost({ loadIsolated: await runner.loader(store, { timeoutMs: 300 }) });
      const wait = `async function (r, ctx) { var s = await ctx.caps.speech.listen(); var t = await s.result; await ctx.create("msg", { text: "kept " + t }); }`;
      const json = JSON.stringify(definition).replace('"run":{"fields":{"out":{"type":"text"}}}', `"run":{"fields":{"out":{"type":"text"}},"actions":{"wait":${wait}}}`);
      const loaded = await host.load({ kind: "bundle", code: `globalThis.__potyroApp = ${json};`, provenance: "untrusted" });
      const row = await store.insert("run", { out: "" });
      const done = loaded.callAction("run", "wait", { ...row } as never, host.makeCtx(loaded, { store, caps, ui, nav, language: "en" } as MakeCtxBase));
      await until(async () => fake.active);
      await new Promise((r) => setTimeout(r, 900)); // three budgets of speaking
      fake.say("a long sentence");
      fake.finish();
      await done;
      expect((await store.all("msg")).map((m) => String(m.text))).toEqual(["kept a long sentence"]);
      loaded.dispose();
    }, 60_000);

    it(`${runner.name}: the same records as trusted, after asking once; closing the app ends its listening`, async () => {
      const { out, asked, lastEnd } = await scenario(runner);
      expect(out).toEqual(expect.arrayContaining(EXPECTED));
      expect(asked).toEqual(["“Voice” wants to listen to you through the microphone."]);
      expect(lastEnd).toBe("left");
    }, 60_000);
  }
});
