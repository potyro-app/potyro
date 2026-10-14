// What only the realm runner has (#272, docs/22): the watchdog's heartbeat, the op allow-list, the
// flood guard, and the ctx members QuickJS could not carry (a fetch through mediated caps, Blobs,
// a browser's built-ins). The shared contract is untrusted-host.test.ts, run against both runners.
//
// The realm's worker runtime runs in a Node worker thread here (runners.ts): the host side, the
// protocol and the kills are the product's; containment is the browser's, asserted in e2e.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type UiBridge } from "../src/index.js";
import { liveThreads, realm, type RunnerOptions } from "./runners.js";

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

const app = (body: string, extra = "") => `globalThis.__potyroApp = {
  id: "r", name: "R", version: "1.0.0", schemaVersion: 1, ${extra}
  entities: { n: { fields: { t: { type: "text" } }, computed: { ${body} } } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }]
};`;

async function setup(code: string, opts: RunnerOptions = {}, extra: Partial<MakeCtxBase> = {}) {
  const store = new MemoryStore();
  await store.open("r");
  const kills: string[] = [];
  const confirms: string[] = [];
  const ui: UiBridge = { toast: () => {}, confirm: async (m) => (confirms.push(m), true), prompt: async () => null, pick: async () => null };
  const host = createHost({ loadIsolated: await realm.loader(store, { ...opts, onKill: (r) => kills.push(r) }) });
  const loaded = await host.load({ kind: "bundle", code, provenance: "untrusted" });
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} }, ...extra });
  const row = { id: "x", createdAt: "", updatedAt: "", t: "hi" } as never;
  return { store, loaded, ctx, kills, confirms, row };
}

describe("the realm has a browser's built-ins (what QuickJS lacked, #262)", () => {
  it("Intl, URL, TextEncoder, structuredClone and timers work in app logic", async () => {
    const { loaded, ctx, row } = await setup(
      app(`
        price: function(){ return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(1234.5); },
        host: function(){ return new URL("https://example.org/a?b=1").hostname; },
        bytes: function(r){ return new TextEncoder().encode(r.t + "ł").length; },
        copy: function(){ return structuredClone({ a: [1, 2] }).a.length; },
        later: function(){ return new Promise(function(res){ setTimeout(function(){ res("waited"); }, 20); }); }
      `),
    );
    expect(await loaded.callComputed("n", "price", row, ctx)).toBe("1.234,50 €");
    expect(await loaded.callComputed("n", "host", row, ctx)).toBe("example.org");
    expect(await loaded.callComputed("n", "bytes", row, ctx)).toBe(4);
    expect(await loaded.callComputed("n", "copy", row, ctx)).toBe(2);
    expect(await loaded.callComputed("n", "later", row, ctx)).toBe("waited");
    loaded.dispose();
  });
});

describe("the watchdog", () => {
  it("stops logic that returns and THEN spins, by its silence", async () => {
    const before = new Set(liveThreads);
    const { loaded, ctx, row, kills } = await setup(app(`spinLater: function(){ setTimeout(function(){ for(;;){} }, 0); return "returned"; }`), { heartbeatTimeoutMs: 300 });
    const [spun] = [...liveThreads].filter((w) => !before.has(w));
    expect(await loaded.callComputed("n", "spinLater", row, ctx)).toBe("returned");
    await expect.poll(() => kills.length, { timeout: 3000 }).toBe(1);
    expect(kills[0]).toMatch(/stopped answering/);
    // The thread that spun is gone; the next call gets a fresh realm, and the app answers again.
    await expect.poll(() => liveThreads.has(spun!), { timeout: 2000 }).toBe(false);
    expect(await loaded.callComputed("n", "spinLater", row, ctx)).toBe("returned");
    loaded.dispose();
  }, 15000);

  it("does not hold a question for the person against the call's budget", async () => {
    let answer!: (v: boolean) => void;
    const code = `globalThis.__potyroApp = { id: "q", name: "Q", version: "1.0.0", schemaVersion: 1,
      entities: { n: { fields: { t: { type: "text" } }, actions: { ask: async function(r, ctx){ var ok = await ctx.ui.confirm("Sure?"); await ctx.patch("n", r.id, { t: ok ? "yes" : "no" }); } } } },
      pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }] };`;
    const { loaded, ctx, store, kills } = await setup(code, { timeoutMs: 200 }, {
      ui: { toast: () => {}, confirm: () => new Promise<boolean>((r) => (answer = r)), prompt: async () => null, pick: async () => null },
    });
    const rec = await store.insert("n", { t: "" });
    const asking = loaded.callAction("n", "ask", { ...rec } as never, ctx);
    await new Promise((r) => setTimeout(r, 600)); // three budgets
    answer(true);
    await asking;
    expect((await store.get("n", rec.id))?.t).toBe("yes");
    expect(kills).toEqual([]);
    loaded.dispose();
  });

  it("stops a realm that floods the host with messages, though it keeps beating", async () => {
    const { loaded, ctx, row, kills } = await setup(
      app(`flood: function(){ var MP = MessagePort.prototype.postMessage; var port;
        MessagePort.prototype.postMessage = function(m){ port = this; MessagePort.prototype.postMessage = MP; return MP.apply(this, arguments); };
        return new Promise(function(res){ setTimeout(function(){ res("armed"); setTimeout(function(){ for(;;){ port.postMessage({ t: "hb", at: 0 }); } }, 10); }, 150); }); }`),
    );
    expect(await loaded.callComputed("n", "flood", row, ctx)).toBe("armed");
    await expect.poll(() => kills.length, { timeout: 3000 }).toBe(1);
    expect(kills[0]).toMatch(/more than \d+ messages/);
    loaded.dispose();
  }, 15000);
});

describe("speaking the protocol by hand", () => {
  // The app steals the runtime's port by wrapping postMessage, then sends ops ctx would never send.
  const RAW = `raw: async function(r, ctx){
    var MP = MessagePort.prototype.postMessage, port;
    MessagePort.prototype.postMessage = function(){ port = this; MessagePort.prototype.postMessage = MP; return MP.apply(this, arguments); };
    await ctx.storage.get("anything");
    function send(msg){ return new Promise(function(res){
      var id = 900000 + Math.floor(Math.random() * 1000);
      port.addEventListener("message", function on(e){ if (e.data && e.data.t === "reply" && e.data.id === id) { port.removeEventListener("message", on); res(e.data.ok ? "ALLOWED " + JSON.stringify(e.data.value) : e.data.error); } });
      MP.call(port, Object.assign({ t: "op", id: id }, msg));
    }); }
    return [
      await send({ ctxId: 1, op: "relay.connect", args: [] }),
      await send({ ctxId: 1, op: "__proto__", args: [] }),
      await send({ ctxId: 1, op: "constructor", args: [] }),
      await send({ ctxId: 424242, op: "query", args: ["n"] }),
      await send({ ctxId: 1, op: "caps.network.fetch", args: ["https://example.org/"] })
    ].join(" | ");
  }`;

  it("refuses ops off the list, ctxs it never issued, and caps the manifest did not ask for", async () => {
    const { loaded, ctx, row } = await setup(app(RAW));
    const answers = String(await loaded.callComputed("n", "raw", row, ctx)).split(" | ");
    expect(answers[0]).toBe("op not allowed: relay.connect");
    expect(answers[1]).toBe("op not allowed: __proto__");
    expect(answers[2]).toBe("op not allowed: constructor");
    expect(answers[3]).toBe("no such ctx");
    // A ctx it was issued, an op on the list: still `mediateCaps`'s answer, the same a trusted ctx method gives.
    expect(answers[4]).toMatch(/Permission denied: R → network/);
    loaded.dispose();
  });
});

describe("ctx members that cross as themselves", () => {
  it("caps.network.fetch goes through mediateCaps: the allow-list, then the person's consent", async () => {
    const code = `globalThis.__potyroApp = { id: "net", name: "Net", version: "1.0.0", schemaVersion: 1,
      permissions: { network: { hosts: ["api.example.org"] } },
      entities: { n: { fields: { t: { type: "text" } }, computed: {
        ok: async function(r, ctx){ var res = await ctx.caps.network.fetch("https://api.example.org/v1?q=1", { method: "POST", body: "x" }); return res.status + " " + res.headers.get("x-test") + " " + (await res.text()); },
        off: async function(r, ctx){ try { await ctx.caps.network.fetch("https://evil.example/"); return "ALLOWED"; } catch (e) { return e.message; } }
      } } },
      pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }] };`;
    const store = new MemoryStore();
    await store.open("net");
    const seen: string[] = [];
    const caps = new FakeCapabilities();
    caps.network = {
      fetch: async (input: string, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${input} ${String(init?.body ?? "")}`);
        return new Response("hello", { status: 201, headers: { "x-test": "yes" } });
      },
    };
    const confirms: string[] = [];
    const host = createHost({ loadIsolated: await realm.loader(store) });
    const loaded = await host.load({ kind: "bundle", code, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, { store, caps, ui: { toast: () => {}, confirm: async (m) => (confirms.push(m), true), prompt: async () => null, pick: async () => null }, nav: { navigate: () => {} } });
    const row = { id: "x", createdAt: "", updatedAt: "", t: "" } as never;
    expect(await loaded.callComputed("n", "ok", row, ctx)).toBe("201 yes hello");
    expect(await loaded.callComputed("n", "off", row, ctx)).toMatch(/Permission denied: Net → network \(https:\/\/evil\.example\/\)/);
    expect(seen).toEqual(["POST https://api.example.org/v1?q=1 x"]);
    expect(confirms).toHaveLength(1);
    loaded.dispose();
  });

  it("a Blob crosses into ctx.media.put and back out of ctx.files.bytes", async () => {
    const code = `globalThis.__potyroApp = { id: "m", name: "M", version: "1.0.0", schemaVersion: 1,
      entities: { n: { fields: { t: { type: "text" } }, computed: {
        put: async function(r, ctx){ var ref = await ctx.media.put(new Blob(["abc"], { type: "text/plain" })); return ref.mime + " " + typeof ref.key; },
        bytes: async function(r, ctx){ await ctx.files.write("b.bin", new Blob([new Uint8Array([1, 2, 3])])); return Array.prototype.join.call(await ctx.files.bytes("b.bin"), ","); }
      } } },
      pages: [{ id: "p", title: "P", view: { type: "list", entity: "n" } }] };`;
    const { loaded, ctx, row } = await setup(code);
    expect(await loaded.callComputed("n", "put", row, ctx)).toBe("text/plain string");
    expect(await loaded.callComputed("n", "bytes", row, ctx)).toBe("1,2,3");
    loaded.dispose();
  });

  it("a value that cannot be copied fails that call, in words, and the realm carries on", async () => {
    const { loaded, ctx, row } = await setup(app(`fn: function(){ return function(){}; }, plain: function(){ return 1; }`));
    await expect(loaded.callComputed("n", "fn", row, ctx)).rejects.toThrow(/cannot leave it/);
    expect(await loaded.callComputed("n", "plain", row, ctx)).toBe(1);
    loaded.dispose();
  });
});
