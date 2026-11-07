// The Android realm probe, in the app (#267, docs/22 §5): does a busy loop in a sandboxed frame —
// a sealed app's own screen — freeze Potyro on this device? Run from the APK with no USB and no
// DevTools: `#probe=realm` on the URL, or tap "You" seven times in the You panel. Inert unless asked.
//
// It builds the same kind of frame a sealed view gets (sandbox="allow-scripts", srcdoc, the realm
// CSP, a blob: Worker inside), runs three busy loops — the shell itself as calibration, the Worker,
// and the frame's own main thread (the view case) — and measures how late the shell's own timer runs
// during each. The same measurement as the standalone probe.js of the browser-realm spike (docs/22,
// in the repository's history since 2026-11-07); this one shows the verdict on the phone's screen
// and copies the numbers.

import { REALM_CSP } from "@potyro/host/realm";

export interface ProbeResult {
  userAgent: string;
  spinMs: number;
  hello: { origin: string; worker: boolean; workerError: string | null; webrtc: string; segmenter: string } | null;
  shellSpinMaxGapMs: number;
  workerSpinMaxGapMs: number;
  frameSpinMaxGapMs: number;
  /** The view case: the frame shares the shell's thread on this device. */
  viewFreezesShell: boolean;
  workerFreezesShell: boolean;
  at: string;
}

// Runs inside the sandboxed frame: answers commands over a MessagePort.
const FRAME = `
  var workerSrc = "onmessage = function (e) { if (e.data.spin) { var end = Date.now() + e.data.spin; while (Date.now() < end) {} } postMessage({ done: e.data.id }); };";
  addEventListener("message", function (e) {
    if (e.source !== parent || !e.ports[0]) return;
    var port = e.ports[0], worker = null, workerError = null, pending = {};
    try { worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" }))); } catch (err) { workerError = String(err); }
    if (worker) worker.onmessage = function (m) { var r = pending[m.data.done]; delete pending[m.data.done]; if (r) r(); };
    port.onmessage = function (m) {
      var id = m.data.id, cmd = m.data.cmd, ms = m.data.ms;
      if (cmd === "hello") return port.postMessage({ id: id, origin: String(self.origin), worker: !!worker, workerError: workerError, webrtc: typeof RTCPeerConnection, segmenter: typeof Intl.Segmenter });
      if (cmd === "spinFrame") { var end = Date.now() + ms; while (Date.now() < end) {} return port.postMessage({ id: id }); }
      if (cmd === "spinWorker") { if (!worker) return port.postMessage({ id: id }); pending[id] = function () { port.postMessage({ id: id }); }; worker.postMessage({ id: id, spin: ms }); }
    };
  });`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The largest gap between the shell's own 10 ms ticks, from now until the returned function is called. */
function lagProbe(): () => number {
  let last = performance.now();
  let max = 0;
  const t = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
  }, 10);
  return () => {
    clearInterval(t);
    return Math.round(Math.max(max, performance.now() - last));
  };
}

export async function runRealmProbe(opts: { spinMs?: number; say?: (line: string) => void } = {}): Promise<ProbeResult> {
  const spinMs = opts.spinMs ?? 3000;
  const say = opts.say ?? (() => {});
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;border:0;bottom:0;left:0";
  iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${REALM_CSP}"><script>${FRAME}<\/script>`;
  const loaded = new Promise((r) => iframe.addEventListener("load", r, { once: true }));
  document.body.appendChild(iframe);
  try {
    await loaded;
    const ch = new MessageChannel();
    iframe.contentWindow!.postMessage("init", "*", [ch.port2]);
    let seq = 0;
    const waiting = new Map<number, (v: Record<string, unknown>) => void>();
    ch.port1.onmessage = (m: MessageEvent) => {
      const d = m.data as Record<string, unknown>;
      const r = waiting.get(Number(d.id));
      waiting.delete(Number(d.id));
      r?.(d);
    };
    const ask = (cmd: string, ms?: number) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const id = ++seq;
        waiting.set(id, resolve);
        ch.port1.postMessage({ id, cmd, ms });
      });

    const hello = (await Promise.race([ask("hello"), sleep(5000).then(() => null)])) as ProbeResult["hello"];
    say(`sandbox: ${JSON.stringify(hello)}`);

    await sleep(300);
    let stop = lagProbe();
    await sleep(50);
    const end = Date.now() + spinMs;
    while (Date.now() < end) {
      /* the shell itself, as calibration */
    }
    await sleep(300);
    const shellSpinMaxGapMs = stop();
    say(`shell spins ${spinMs} ms: gap ${shellSpinMaxGapMs} ms`);

    await sleep(300);
    stop = lagProbe();
    await ask("spinWorker", spinMs);
    const workerSpinMaxGapMs = stop();
    say(`worker spins ${spinMs} ms: gap ${workerSpinMaxGapMs} ms`);

    await sleep(300);
    stop = lagProbe();
    await ask("spinFrame", spinMs);
    await sleep(100);
    const frameSpinMaxGapMs = stop();
    say(`frame (a screen) spins ${spinMs} ms: gap ${frameSpinMaxGapMs} ms`);

    return {
      userAgent: navigator.userAgent,
      spinMs,
      hello,
      shellSpinMaxGapMs,
      workerSpinMaxGapMs,
      frameSpinMaxGapMs,
      viewFreezesShell: frameSpinMaxGapMs > spinMs / 2,
      workerFreezesShell: workerSpinMaxGapMs > spinMs / 2,
      at: new Date().toISOString(),
    };
  } finally {
    iframe.remove();
  }
}
