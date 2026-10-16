// A shared app whose first page is its own screen (#267): a React custom view that reads and writes
// records through `props.runtime`, draws on a canvas, takes keys and pointer input, navigates, reads
// the page's theme — and, on demand, spins for 3 s, spins forever, or tries every way out of its
// sandboxed frame. The specs open it sealed (installShared) and read what happened from the frame's
// DOM, the shell's store and the probe server — never from the app's word alone.
//
// `__PROBE__` is replaced with the probe server's origin before install.

import { defineApp } from "potyro";
import type { ViewProps } from "potyro";
import { useEffect, useRef, useState } from "react";

const PROBE = "__PROBE__";

type Report = Record<string, string>;

async function attempt(report: Report, name: string, fn: () => unknown): Promise<void> {
  try {
    const v = await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 1500))]);
    report[name] = `ALLOWED: ${String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 80)}`;
  } catch (e) {
    report[name] = `blocked: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`.slice(0, 160);
  }
}

/** Grab the view's own port by watching postMessage, then speak the protocol by hand. */
function stealPort(props: ViewProps): Promise<MessagePort> {
  return new Promise((resolve) => {
    const original = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: unknown[]) {
      MessagePort.prototype.postMessage = original;
      resolve(this);
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof original;
    void props.runtime.ctx.storage.get("anything");
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

async function escapes(props: ViewProps): Promise<Report> {
  const r: Report = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as Record<string, any>;
  await attempt(r, "origin", () => {
    if (g.origin !== "null") return g.origin;
    throw new Error(`opaque origin ${g.origin}`);
  });
  await attempt(r, "localStorage", () => g.localStorage.getItem("potyro-secret"));
  await attempt(r, "sessionStorage", () => g.sessionStorage.getItem("x"));
  await attempt(r, "document.cookie", () => document.cookie);
  await attempt(r, "indexedDB", () => new Promise((res, rej) => {
    const q = g.indexedDB.open("x");
    q.onsuccess = () => res("opened");
    q.onerror = () => rej(q.error);
  }));
  await attempt(r, "parent.document", () => (window.parent as Window).document.title);
  await attempt(r, "parent.localStorage", () => (window.parent as Window).localStorage.getItem("potyro-secret"));
  await attempt(r, "top.location.href", () => String((window.top as Window).location.href));
  await attempt(r, "fetch(probe)", () => fetch(`${PROBE}/probe/view-fetch`).then((x) => x.status));
  await attempt(r, "WebSocket(relay)", () => new Promise((res, rej) => {
    const ws = new WebSocket(`${PROBE.replace("http", "ws")}/relay`);
    ws.onopen = () => res("open");
    ws.onerror = () => rej(new Error("error event"));
    ws.onclose = () => rej(new Error("closed"));
  }));
  await attempt(r, "EventSource", () => new Promise((res, rej) => {
    const es = new g.EventSource(`${PROBE}/probe/view-sse`);
    es.onopen = () => res("open");
    es.onerror = () => rej(new Error("error event"));
  }));
  await attempt(r, "sendBeacon", () => {
    if (!navigator.sendBeacon(`${PROBE}/probe/view-beacon`, "x")) throw new Error("refused");
    return "queued";
  });
  await attempt(r, "<img src>", () => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res("loaded");
    img.onerror = () => rej(new Error("error event"));
    img.src = `${PROBE}/probe/view-img.png`;
  }));
  await attempt(r, "<iframe src>", () => new Promise((res) => {
    const f = document.createElement("iframe");
    f.src = `${PROBE}/probe/view-frame`;
    document.body.appendChild(f);
    setTimeout(() => res("appended (the probe count decides)"), 800);
  }));
  await attempt(r, "form submit", () => {
    const form = document.createElement("form");
    form.action = `${PROBE}/probe/view-form`;
    form.method = "post";
    document.body.appendChild(form);
    form.submit();
    return "submitted (the probe count decides)";
  });
  await attempt(r, "window.open", () => {
    const w = window.open(`${PROBE}/probe/view-popup`);
    if (!w) throw new Error("no window");
    return "opened";
  });
  await attempt(r, "top navigation", () => {
    (window.top as Window).location.href = `${PROBE}/probe/view-top`;
    return "assigned";
  });
  await attempt(r, "RTCPeerConnection", () => {
    if (typeof g.RTCPeerConnection !== "function") throw new Error("absent");
    return "present";
  });
  await attempt(r, "parent.postMessage", () => {
    window.parent.postMessage({ t: "potyro:trust-request" }, "*");
    window.parent.postMessage({ t: "op", id: 1, ctxId: 1, op: "create", args: ["note", { text: "via parent" }] }, "*");
    return "sent";
  });
  const port = await stealPort(props);
  r["raw op: relay.connect"] = await rawOp(port, { ctxId: props.runtime.ctx ? 999999 : 0, op: "relay.connect", args: [] });
  r["raw op: unknown ctxId"] = await rawOp(port, { ctxId: 424242, op: "query", args: ["note"] });
  r["raw op: space.invite"] = await rawOp(port, { ctxId: 424242, op: "space.invite", args: [] });
  return r;
}

function Board(props: ViewProps) {
  const { rows } = props.runtime.useQuery("note");
  const [key, setKey] = useState("none");
  const [clicks, setClicks] = useState(0);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setKey(e.key);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const g = canvas.current?.getContext("2d");
    if (!g) return;
    g.fillStyle = "rgb(200, 30, 90)";
    g.fillRect(0, 0, 40 + clicks * 20, 40);
  }, [clicks]);

  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
  return (
    <section className="sv-board">
      <h2 id="sv-title">Sealed board</h2>
      <p id="sv-count">{rows.length} notes</p>
      <p id="sv-key">key: {key}</p>
      <p id="sv-ink">{ink}</p>
      <canvas id="sv-canvas" width={200} height={40} onPointerDown={() => setClicks((c) => c + 1)} />
      <p>
        <button id="sv-add" type="button" className="k-add k-primary-action" onClick={() => void props.runtime.ctx.create("note", { text: `from the screen ${rows.length + 1}` })}>
          Add a note
        </button>{" "}
        <button id="sv-go" type="button" className="k-add" onClick={() => props.navigate("notes")}>
          All notes
        </button>
      </p>
      <p>
        <button id="sv-spin" type="button" className="k-add" onClick={() => { const end = Date.now() + 3000; while (Date.now() < end) { /* spin */ } }}>
          Spin 3 s
        </button>{" "}
        <button id="sv-forever" type="button" className="k-add" onClick={() => { for (;;) { /* forever */ } }}>
          Spin forever
        </button>{" "}
        <button id="sv-escape" type="button" className="k-add" onClick={async () => props.runtime.ctx.ui.toast(JSON.stringify(await escapes(props)))}>
          Try to escape
        </button>
      </p>
    </section>
  );
}

export default defineApp({
  id: "sealed-views",
  name: "Sealed views",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { note: { displayField: "text", fields: { text: { type: "text" } } } },
  pages: [
    { id: "board", title: "Board", view: { type: "custom", entity: "note", render: (props) => <Board {...props} /> } },
    {
      id: "notes",
      title: "Notes",
      actions: [{ label: "Still here?", run: (ctx) => ctx.ui.toast(`still here: ${new Intl.NumberFormat("de-DE").format(1234.5)}`) }],
      view: { type: "list", entity: "note", display: { primary: "text" } },
    },
  ],
});
