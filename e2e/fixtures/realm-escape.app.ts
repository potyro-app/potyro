// An adversarial shared app (#272, docs/22 §3). Its logic — which runs in the browser realm's Worker —
// tries every way out we know of and toasts what happened, as JSON. The spec does not trust the
// report alone: it also counts what reached its probe server and reads the shell's own state.
// `__PROBE__` and `__SHELL__` are replaced with the probe's and the shell's origins before install.

import { defineApp, type Ctx } from "potyro";

const PROBE = "__PROBE__";
const SHELL = "__SHELL__";

type Report = Record<string, string>;

async function attempt(report: Report, name: string, fn: () => unknown): Promise<void> {
  try {
    const v = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 1500)),
    ]);
    report[name] = `ALLOWED: ${typeof v === "string" ? v.slice(0, 80) : String(JSON.stringify(v)).slice(0, 80)}`;
  } catch (e) {
    report[name] = `blocked: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`.slice(0, 160);
  }
}

/** A socket that opens is ALLOWED; an error or a close before open is blocked. */
function socket(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve("open");
    ws.onerror = () => reject(new Error("error event"));
    ws.onclose = () => reject(new Error("closed"));
  });
}

/** Grab the runtime's own port by watching postMessage, then speak the protocol by hand. */
function stealPort(ctx: Ctx): Promise<MessagePort> {
  return new Promise((resolve) => {
    const original = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: unknown[]) {
      MessagePort.prototype.postMessage = original;
      resolve(this);
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof original;
    void ctx.storage.get("anything");
  });
}

function rawOp(port: MessagePort, msg: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    const id = 900000 + Math.floor(Math.random() * 1000);
    const listener = (e: MessageEvent) => {
      if (e.data?.t === "reply" && e.data.id === id) {
        port.removeEventListener("message", listener);
        resolve(e.data.ok ? `ALLOWED: ${JSON.stringify(e.data.value)}` : `blocked: ${e.data.error}`);
      }
    };
    port.addEventListener("message", listener);
    port.postMessage({ t: "op", id, ...msg });
    setTimeout(() => resolve("blocked: no answer"), 1500);
  });
}

async function escapes(ctx: Ctx): Promise<Report> {
  const r: Report = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as Record<string, any>;
  await attempt(r, "origin", () => {
    if (g.origin !== "null") return g.origin;
    throw new Error(`opaque origin ${g.origin}`);
  });
  await attempt(r, "fetch(probe)", () => fetch(`${PROBE}/probe/worker-fetch`).then((x) => x.status));
  await attempt(r, "fetch(shell)", () => fetch(`${SHELL}/__probe/worker-fetch`).then((x) => x.status));
  await attempt(r, "fetch(data:)", () => fetch("data:text/plain,hi").then((x) => x.text()));
  await attempt(r, "WebSocket", () => socket(`${PROBE.replace("http", "ws")}/relay`));
  await attempt(r, "EventSource", () => new Promise((res, rej) => {
    if (typeof g.EventSource !== "function") throw new Error("absent");
    const es = new g.EventSource(`${PROBE}/probe/sse`);
    es.onopen = () => res("open");
    es.onerror = () => rej(new Error("error event"));
  }));
  await attempt(r, "importScripts(url)", () => g.importScripts(`${PROBE}/probe/import.js`));
  // The constructor does not throw for a blocked URL; an error EVENT follows. The probe count decides.
  await attempt(r, "new Worker(url)", () => new Promise((res, rej) => {
    const w = new Worker(`${PROBE}/probe/worker.js`);
    w.onerror = () => rej(new Error("error event"));
    setTimeout(() => res("no error event within 1 s"), 1000);
  }));
  await attempt(r, "indexedDB", () => new Promise((res, rej) => {
    const q = g.indexedDB.open("x");
    q.onsuccess = () => res("opened");
    q.onerror = () => rej(q.error);
  }));
  await attempt(r, "caches", () => g.caches.open("x").then(() => "opened"));
  await attempt(r, "localStorage", () => {
    if (typeof g.localStorage === "undefined") throw new Error("absent");
    return g.localStorage.getItem("potyro-secret");
  });
  await attempt(r, "document", () => {
    if (typeof g.document === "undefined") throw new Error("absent");
    return g.document.cookie;
  });
  await attempt(r, "parent/top", () => {
    if (!g.parent && !g.top) throw new Error("absent in a worker");
    return "present";
  });
  await attempt(r, "RTCPeerConnection", () => {
    if (typeof g.RTCPeerConnection !== "function") throw new Error("absent");
    return "present";
  });
  await attempt(r, "space.invite()", () => {
    const invite = (ctx.space as { invite?: () => Promise<string> } | undefined)?.invite;
    if (typeof invite !== "function") throw new Error("absent");
    return invite();
  });
  await attempt(r, "caps.network.fetch (no permission)", () => ctx.caps.network!.fetch(`${PROBE}/probe/cap-fetch`).then((x) => x.status));
  await attempt(r, "create with forged createdBy", async () => {
    const row = await ctx.create("note", { text: "forged", createdBy: "someone-else" } as never);
    return row.createdBy === ctx.me.id ? `stamped as me (${String(row.createdBy)})` : `FORGED: ${String(row.createdBy)}`;
  });
  const port = await stealPort(ctx);
  r["raw op: relay.connect"] = await rawOp(port, { ctxId: 1, op: "relay.connect", args: [] });
  r["raw op: __proto__"] = await rawOp(port, { ctxId: 1, op: "__proto__", args: [] });
  r["raw op: unknown ctxId"] = await rawOp(port, { ctxId: 424242, op: "query", args: ["note"] });
  return r;
}

export default defineApp({
  id: "realm-escape",
  name: "Escape attempts",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { note: { displayField: "text", fields: { text: { type: "text" } } } },
  pages: [
    {
      id: "notes",
      title: "Notes",
      actions: [
        { label: "Try to escape", run: async (ctx) => ctx.ui.toast(JSON.stringify(await escapes(ctx))) },
        // Logic that never yields: the watchdog stops it, and the shell's own thread never notices.
        { label: "Spin", run: () => { for (;;) { /* forever */ } } },
        // Returns at once, then spins: only the heartbeat can see this one.
        { label: "Return then spin", run: (ctx) => { setTimeout(() => { for (;;) { /* forever */ } }, 50); ctx.ui.toast("returned"); } },
        { label: "Still here?", run: (ctx) => ctx.ui.toast(`still here: ${new Intl.NumberFormat("de-DE").format(1234.5)}`) },
      ],
      view: { type: "list", entity: "note", display: { primary: "text" } },
    },
  ],
});
