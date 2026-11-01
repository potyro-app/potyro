// The browser half of the realm: opaque-origin sandboxed iframes (docs/22).
//
//   - The LOGIC frame holds the Worker the app's logic runs in. No app code runs on its own thread, so
//     it cannot stall the shell. One per open sealed app, hidden in `#potyro-realms`.
//   - A VIEW frame (phase 3, #267) holds one mounted custom view, on its own main thread, in the place
//     the shell gave the view. One per mounted view, gone when the view goes. Its own frame rather than
//     the logic frame, so a view stuck in a loop is torn down without touching the app's logic, a
//     second view of the same app is not frozen with it, and the frame's document — its DOM, its
//     listeners, whatever the view left behind — goes with it on every unmount.
//
// Both documents are srcdoc: they fetch nothing, and they carry the realm CSP. The Worker is a blob:
// URL created inside the logic frame, so it inherits the frame's opaque origin and its CSP.
//
// What the iframe sandbox and CSP do NOT cover, and is closed here (#14 audit scope):
//   - WebRTC: CSP does not govern ICE, and no engine honours `webrtc 'block'`. Each frame deletes the
//     constructors before anything else runs (`NO_WEBRTC`). Workers never had them.
//   - The frame navigating itself: the iframe sandbox allows it, the frame's own CSP cannot stop it.
//     The SHELL's `frame-src 'none'` does (index.html, deploy/potyro.app.Caddyfile), and the host also
//     treats a second `load` as the frame being gone.

import { REALM_CSP, type ViewInit } from "./protocol.js";
import type { RealmHandle, RealmSpawner } from "./realm-host.js";

/** Deletes the WebRTC constructors. The first script of every realm frame, before any other code. */
export const NO_WEBRTC = `["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection", "RTCDataChannel", "RTCRtpSender", "RTCRtpReceiver", "RTCIceCandidate", "RTCSessionDescription"].forEach(function (name) {
    try { delete window[name]; } catch (e) { /* not configurable: the escape spec would show it */ }
  });`;

/**
 * Runs on the logic frame's main thread. Plain ES2017, inlined into the srcdoc: it is small on
 * purpose, so the audit can read all of it. It is not trusted either — there is just nothing in this
 * realm for it to protect.
 */
export const FRAME_SOURCE = `(function () {
  "use strict";
  ${NO_WEBRTC}
  var started = false;
  window.addEventListener("message", function (e) {
    if (started || e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.t !== "init" || typeof d.workerSource !== "string" || e.ports.length !== 2) return;
    started = true;
    var app = e.ports[0], control = e.ports[1];
    var url = URL.createObjectURL(new Blob([d.workerSource], { type: "text/javascript" }));
    var worker;
    try {
      worker = new Worker(url);
      worker.postMessage({ t: "port", port: app }, [app]);
    } catch (err) {
      app.postMessage({ t: "ready", start: true, error: "could not start the worker: " + (err && err.message ? err.message : String(err)) });
    }
    URL.revokeObjectURL(url);
    control.onmessage = function (m) {
      // The host is about to remove this frame: end the worker now rather than whenever the engine
      // gets round to it (Blink without site isolation keeps a spinning worker's thread up to ~2 s).
      if (m.data && m.data.t === "stop" && worker) worker.terminate();
      // Is this frame's thread free? After a view was stopped, a frame sharing its process answers
      // only once the stopped view's loop has let go of that process (docs/22 §4.2, §11).
      if (m.data && m.data.t === "ping") control.postMessage({ t: "pong" });
    };
  });
})();`;

/** Escape `</script` so a script can sit inline in the srcdoc. */
const inlineScript = (src: string): string => `<script>${src.replace(/<\/script/gi, "<\\/script")}</script>`;

/** The logic realm's document. */
export function realmDocument(): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${REALM_CSP}">` +
    `</head><body>${inlineScript(FRAME_SOURCE)}</body></html>`
  );
}

/**
 * A view frame's own styles: the page's theme arrives as custom properties (`tokens`), and these
 * few rules make a view written against the shell's — its `k-add` buttons, its `k-muted` text — look
 * as it does in an app that runs as yours. The frame is exactly the room the shell gives it; a view
 * taller than that scrolls inside it.
 */
export const VIEW_CSS = [
  "*,*::before,*::after{box-sizing:border-box}",
  // `touch-action:manipulation`: a tap is a click at once. Firefox on Android waits ~300 ms after
  // every tap for a possible double-tap zoom unless told not to, and a frame's document is told on
  // its own (the shell's html rule does not reach into it). Pinch zoom stays.
  "html{overflow:auto;overscroll-behavior:contain;-webkit-text-size-adjust:100%;touch-action:manipulation}",
  "body{margin:0;background:transparent;color:var(--k-view-ink,var(--ink,#2b241e));font-family:var(--k-view-font,var(--font-ui,system-ui,sans-serif));font-size:16px;line-height:1.45}",
  "#root{display:flow-root}",
  "button,input,select,textarea{font:inherit;color:inherit}",
  ".k-add{border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:.5rem .9rem;border-radius:10px;cursor:pointer;transition:transform 150ms var(--ease),box-shadow 150ms var(--ease),border-color 150ms var(--ease)}",
  ".k-add:hover{border-color:var(--accent);box-shadow:var(--shadow);transform:translateY(-1px)}",
  ".k-add:active{transform:translateY(0)}",
  ".k-add:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
  ".k-primary-action{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}",
  ".k-muted{color:var(--ink-soft);padding:.5rem 0}",
].join("");

/** A view frame's document: the realm CSP, the WebRTC removal, then the view runtime (`virtual:potyro-realm-view`). */
export function viewDocument(runtimeSource: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${REALM_CSP}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${VIEW_CSS}</style>` +
    `</head><body><div id="root"></div>${inlineScript(`(function(){"use strict";${NO_WEBRTC}})();`)}${inlineScript(runtimeSource)}</body></html>`
  );
}

/** Where the realms' iframes live: one hidden container at the end of the page, outside the app's root. */
function container(doc: Document): HTMLElement {
  const existing = doc.getElementById("potyro-realms");
  if (existing) return existing;
  const el = doc.createElement("div");
  el.id = "potyro-realms";
  el.setAttribute("aria-hidden", "true");
  // Not display:none — an iframe there may not run at all in some engines. Out of sight and layout.
  el.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;contain:strict";
  doc.body.appendChild(el);
  return el;
}

export interface FrameSpawnerOptions {
  /** The document to embed into (default: the page's). */
  document?: Document;
}

/** The sandbox every realm frame has: `allow-scripts` and nothing else. */
function sandboxed(doc: Document, title: string): HTMLIFrameElement {
  const iframe = doc.createElement("iframe");
  // No allow-same-origin (an opaque origin: no storage, no cookies, no parent DOM), no
  // -top-navigation, no -popups, no -forms, no -modals.
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.title = title;
  return iframe;
}

/** Resolves on the frame's first load; a later one is the frame navigating away, which ends it. */
function watchLoads(iframe: HTMLIFrameElement, onLost: (reason: string) => void, gone: () => boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    let first = true;
    iframe.addEventListener("load", () => {
      if (first) {
        first = false;
        resolve();
      } else if (!gone()) onLost("the sandboxed frame navigated away");
    });
  });
}

/**
 * The browser spawner: a sandboxed srcdoc iframe — `allow-scripts` and nothing else, so its origin
 * is opaque (no storage, no cookies, no parent DOM), and it may not navigate the top, open popups,
 * submit forms or show modals — with a Worker inside it.
 */
export function frameSpawner(opts: FrameSpawnerOptions = {}): RealmSpawner {
  return async ({ workerSource, onLost }) => {
    const doc = opts.document ?? document;
    const iframe = sandboxed(doc, "shared app logic");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.cssText = "border:0;width:0;height:0";
    iframe.srcdoc = realmDocument();
    let gone = false;
    const loaded = watchLoads(iframe, onLost, () => gone);
    container(doc).appendChild(iframe);
    await loaded;
    const app = new MessageChannel();
    const control = new MessageChannel();
    // An opaque origin cannot be named, so "*": the ports, not the origin, carry the trust boundary,
    // and nothing else can reach a sandboxed srcdoc frame.
    iframe.contentWindow!.postMessage({ t: "init", workerSource }, "*", [app.port2, control.port2]);
    const handle: RealmHandle = {
      port: app.port1,
      kill() {
        if (gone) return;
        gone = true;
        try {
          control.port1.postMessage({ t: "stop" });
        } catch {
          /* already closed */
        }
        // Removing the frame destroys its document, which ends its Worker everywhere measured. A beat
        // later, so the stop message can be read when the frame's thread is free to read it.
        setTimeout(() => {
          control.port1.close();
          iframe.remove();
        }, 50);
      },
      probe(timeoutMs) {
        if (gone) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            control.port1.onmessage = null;
            resolve(false);
          }, timeoutMs);
          control.port1.onmessage = (m: MessageEvent) => {
            if ((m.data as { t?: string } | null)?.t !== "pong") return;
            clearTimeout(timer);
            control.port1.onmessage = null;
            resolve(true);
          };
          control.port1.postMessage({ t: "ping" });
        });
      },
    };
    return handle;
  };
}

/** One mounted view's frame. */
export interface ViewFrameHandle {
  iframe: HTMLIFrameElement;
  port: MessagePort;
  /** Remove the frame now (after a courtesy `stop`). Idempotent. */
  kill(): void;
}

export interface ViewFrameArgs {
  /** Where the view goes: the frame fills it (the shell sizes it). */
  el: HTMLElement;
  /** The bundled view runtime (`virtual:potyro-realm-view`). */
  runtimeSource: string;
  /** For screen readers and the keyboard: the frame's accessible name. */
  title: string;
  init: Omit<ViewInit, "t">;
  /** The frame ended without being asked to (it navigated). */
  onLost(reason: string): void;
}

/** A view frame in `el`, started with `init`. The port is the view's: everything on it is untrusted. */
export async function spawnViewFrame(args: ViewFrameArgs): Promise<ViewFrameHandle> {
  const doc = args.el.ownerDocument;
  const iframe = sandboxed(doc, args.title);
  iframe.className = "k-sealed-frame";
  // Its own width; the shell sets its height (it reports what it needs, and the page gives at least
  // the room below it). `display:block` so no baseline gap sits under it.
  iframe.style.cssText = "display:block;border:0;width:100%;height:100%;background:transparent";
  iframe.srcdoc = viewDocument(args.runtimeSource);
  let gone = false;
  const loaded = watchLoads(iframe, args.onLost, () => gone);
  args.el.appendChild(iframe);
  await loaded;
  const channel = new MessageChannel();
  const init: ViewInit = { t: "init", ...args.init };
  iframe.contentWindow!.postMessage(init, "*", [channel.port2]);
  return {
    iframe,
    port: channel.port1,
    kill() {
      if (gone) return;
      gone = true;
      try {
        channel.port1.postMessage({ t: "stop" });
      } catch {
        /* already closed */
      }
      // At once: the courtesy `stop` is for a healthy view, which reads it before the frame goes; a
      // stuck one never would, and must not stay on screen a moment longer.
      channel.port1.onmessage = null;
      channel.port1.close();
      iframe.remove();
    },
  };
}
