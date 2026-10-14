// The browser half of the realm: an opaque-origin sandboxed iframe whose only job is to hold the
// Worker the app's logic runs in (docs/22). No app code runs on the frame's own thread in phase 1 —
// custom views of shared apps stay off — so the frame cannot stall the shell.
//
// The frame document is a srcdoc: it fetches nothing, and it carries the realm CSP. The Worker is a
// blob: URL created inside it, so the Worker inherits the frame's opaque origin and its CSP.
//
// What the iframe sandbox and CSP do NOT cover, and is closed here (#14 audit scope):
//   - WebRTC: CSP does not govern ICE, and no engine honours `webrtc 'block'`. The frame deletes the
//     constructors before anything else runs. Workers never had them; the deletion is for the frame
//     itself, which views will use (phase 3).
//   - The frame navigating itself: the iframe sandbox allows it, the frame's own CSP cannot stop it.
//     The SHELL's `frame-src 'none'` does (index.html, deploy/apps.vaz.io.conf), and the host also
//     treats a second `load` as the realm being gone.

import { REALM_CSP } from "./protocol.js";
import type { RealmHandle, RealmSpawner } from "./realm-host.js";

/**
 * Runs on the frame's main thread. Plain ES2017, inlined into the srcdoc: it is small on purpose, so
 * the audit can read all of it. It is not trusted either — there is just nothing in this realm for
 * it to protect.
 */
export const FRAME_SOURCE = `(function () {
  "use strict";
  ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection", "RTCDataChannel", "RTCRtpSender", "RTCRtpReceiver", "RTCIceCandidate", "RTCSessionDescription"].forEach(function (name) {
    try { delete window[name]; } catch (e) { /* not configurable: the escape spec would show it */ }
  });
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
      app.postMessage({ t: "ready", error: "could not start the worker: " + (err && err.message ? err.message : String(err)) });
    }
    URL.revokeObjectURL(url);
    // The host is about to remove this frame: end the worker now rather than whenever the engine gets
    // round to it (Blink without site isolation keeps a spinning worker's thread up to ~2 s).
    control.onmessage = function (m) { if (m.data && m.data.t === "stop" && worker) worker.terminate(); };
  });
})();`;

/** Escape `</script` so a script can sit inline in the srcdoc. */
const inlineScript = (src: string): string => `<script>${src.replace(/<\/script/gi, "<\\/script")}</script>`;

/** The realm's document. */
export function realmDocument(): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${REALM_CSP}">` +
    `</head><body>${inlineScript(FRAME_SOURCE)}</body></html>`
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

/**
 * The browser spawner: a sandboxed srcdoc iframe — `allow-scripts` and nothing else, so its origin
 * is opaque (no storage, no cookies, no parent DOM), and it may not navigate the top, open popups,
 * submit forms or show modals — with a Worker inside it.
 */
export function frameSpawner(opts: FrameSpawnerOptions = {}): RealmSpawner {
  return async ({ workerSource, onLost }) => {
    const doc = opts.document ?? document;
    const iframe = doc.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("tabindex", "-1");
    iframe.title = "shared app logic";
    iframe.style.cssText = "border:0;width:0;height:0";
    iframe.srcdoc = realmDocument();
    const loaded = new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
    container(doc).appendChild(iframe);
    await loaded;
    let gone = false;
    // A second load is the frame navigating itself somewhere: that realm is not ours any more.
    iframe.addEventListener("load", () => {
      if (!gone) onLost("the sandboxed frame navigated away");
    });
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
    };
    return handle;
  };
}
