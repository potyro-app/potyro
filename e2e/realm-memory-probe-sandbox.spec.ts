import { chromium, firefox, expect, test, type Browser, type BrowserType, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REALM_CSP } from "../packages/host/src/realm/protocol.js";

// A MEASUREMENT, not a regression test (#90, docs/22 §7.1): what each engine does when a sealed app's
// code — in the realm's Worker, or on a view frame's own thread — keeps memory without end.
//
// OPT-IN: `POTYRO_REALM_MEMORY=1 pnpm e2e e2e/realm-memory-probe-sandbox.spec.ts --project=sandbox`.
// It launches its own browsers, because the answer is a property of how each is started: full
// Chromium (site isolation: the sandboxed frame has a process of its own), the headless shell (no
// site isolation: the frame shares the page's), Firefox.
//
// BOUNDED, twice over, because the machine is shared:
//   - every run stops at a ceiling of its own, at its first refused allocation, or at a time limit;
//   - a run that is meant to reach the end of memory does so inside a cgroup of its own
//     (`systemd-run --user --scope -p MemoryMax=…`, swap off): the kernel ends a process of THAT
//     browser at the cgroup's limit, which is what a phone or a full laptop does to a tab, without
//     the machine itself ever being short (`OOMPolicy=continue`: systemd would otherwise end the
//     whole browser for the one process the kernel chose). Where systemd-run is not there, those skip.
//   - the engines' own heap limits are reached cheaply by lowering them (`--max-old-space-size`,
//     `javascript.options.mem.max`): who dies and what the page hears is the same at 256 MB as at 4 GB.
//
// Each run prints one `REALM_MEM {json}` line; docs/22 §7.1 is written from those.

const ON = Boolean(process.env.POTYRO_REALM_MEMORY);
/** `POTYRO_REALM_MEMORY=1` runs every one; any other value is a pattern for the runs' names (`cgroup|frame`). */
const ONLY = ON && process.env.POTYRO_REALM_MEMORY !== "1" ? new RegExp(String(process.env.POTYRO_REALM_MEMORY), "i") : null;
const MB = 1024 * 1024;
const GB = 1024 * MB;

type Kind = "buffers" | "objects" | "strings";
interface Run {
  kind: Kind;
  /** The realm's Worker (an app's logic), or the frame's own thread (a sealed view). */
  where: "worker" | "frame";
  /** Stop here if nothing refused first (bytes, estimated for objects). */
  ceiling: number;
  timeLimitMs: number;
  /**
   * How long without a beat ends the run as "silent" (default 3 s). A heap of gigabytes near its limit
   * stops the world for seconds at a time to collect: that is silence too, and the product's own
   * watchdog ends a realm after one second of it — but it is not yet the engine's answer.
   */
  silenceMs?: number;
}

/** Runs in the Worker, or — evaluated as is — on a frame's main thread. Plain script. */
const GROW_SOURCE = `
function __grow(port, cfg) {
  var held = [], bytes = 0, n = 0, over = false;
  var heap = function () { try { return performance.memory ? performance.memory.usedJSHeapSize : null; } catch (e) { return null; } };
  var facts = {};
  try {
    facts.performanceMemory = typeof performance.memory;
    facts.jsHeapSizeLimit = performance.memory ? performance.memory.jsHeapSizeLimit : null;
    facts.measureUserAgentSpecificMemory = typeof performance.measureUserAgentSpecificMemory;
    facts.crossOriginIsolated = self.crossOriginIsolated;
    facts.deviceMemory = navigator.deviceMemory === undefined ? null : navigator.deviceMemory;
  } catch (e) { facts.error = String(e); }
  port.postMessage({ t: "up", facts: facts });
  setInterval(function () { port.postMessage({ t: "hb", bytes: bytes, heap: heap(), over: over }); }, 100);
  var step = function () {
    try {
      if (cfg.kind === "buffers") {
        var b = new Uint8Array(16 * 1048576);
        for (var i = 0; i < b.length; i += 4096) b[i] = 1; // touched: really the process's
        held.push(b); bytes += b.length;
      } else if (cfg.kind === "objects") {
        var a = new Array(100000);
        for (var j = 0; j < a.length; j++) a[j] = { i: n++, p: [j] };
        held.push(a); bytes += 100000 * 64; // an estimate: the engines differ
      } else {
        held.push(new TextDecoder().decode(new Uint8Array(8 * 1048576).fill(97 + (n++ % 26)))); bytes += 8 * 1048576;
      }
    } catch (e) {
      over = true;
      port.postMessage({ t: "done", why: "caught", name: e && e.name, error: String(e && e.message || e).slice(0, 200), bytes: bytes, heap: heap() });
      return;
    }
    if (bytes >= cfg.ceiling) { over = true; port.postMessage({ t: "done", why: "ceiling", bytes: bytes, heap: heap() }); return; }
    setTimeout(step, 0);
  };
  step();
}
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = function (e) { if (e.data && e.data.t === "port") { self.onmessage = null; __grow(e.data.port, e.data.cfg); } };
}
`;

/** The logic frame's own script (frame.ts FRAME_SOURCE), plus what the probe wants to hear. */
const FRAME_SOURCE = `(function () {
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.t !== "init" || e.ports.length !== 2) return;
    var app = e.ports[0], control = e.ports[1];
    control.onmessage = function (m) { if (m.data && m.data.t === "ping") control.postMessage({ t: "pong" }); };
    if (d.cfg.where === "worker") {
      var url = URL.createObjectURL(new Blob([d.source], { type: "text/javascript" }));
      var worker = new Worker(url);
      worker.onerror = function (ev) { control.postMessage({ t: "workerError", message: String(ev && ev.message).slice(0, 200) }); };
      worker.postMessage({ t: "port", port: app, cfg: d.cfg }, [app]);
    } else {
      (0, eval)(d.source);
      __grow(app, d.cfg);
    }
  });
})();`;

interface Outcome {
  /** How the run ended, as the page saw it. */
  end: "done" | "silent" | "time-limit";
  done?: { why: string; name?: string; error?: string; bytes: number; heap: number | null };
  facts?: Record<string, unknown>;
  /** The last the worker said it held (bytes; estimated for objects) and its `performance.memory`. */
  lastBytes: number;
  lastHeap: number | null;
  /** The frame's `worker.onerror`, if it fired. */
  workerError?: string;
  /** Beats kept coming for a second after the end. */
  beatsAfter: boolean;
  /** The frame's own thread answered a ping after the end. */
  frameAnswers: boolean;
  /** The page's largest event-loop gap during the run (ms). */
  shellGapMs: number;
  /** The longest the realm went without a beat (ms): the product's watchdog ends a realm at 1000. */
  longestSilenceMs: number;
  ms: number;
}

/** In the page: one realm frame as frame.ts makes it, growing as `cfg` says; what was seen. */
async function probe(page: Page, cfg: Run): Promise<Outcome> {
  return page.evaluate(
    async ({ cfg, csp, frameSource, growSource }) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.cssText = "border:0;width:0;height:0";
      const inline = frameSource.replace(/<\/script/gi, "<\\/script");
      iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script>${inline}</script></body></html>`;
      await new Promise<void>((resolve) => {
        iframe.addEventListener("load", () => resolve(), { once: true });
        document.body.appendChild(iframe);
      });
      const app = new MessageChannel();
      const control = new MessageChannel();
      const started = performance.now();
      let lastBeat = started;
      let longestSilence = 0;
      let lastBytes = 0;
      let lastHeap: number | null = null;
      let done: Outcome["done"];
      let facts: Record<string, unknown> | undefined;
      let workerError: string | undefined;
      let pong: (() => void) | null = null;
      let gap = 0;
      let lastTick = started;
      const meter = setInterval(() => {
        const t = performance.now();
        gap = Math.max(gap, t - lastTick);
        lastTick = t;
      }, 10);
      app.port1.onmessage = (e) => {
        const m = e.data as { t: string; bytes?: number; heap?: number | null; facts?: Record<string, unknown> };
        longestSilence = Math.max(longestSilence, performance.now() - lastBeat);
        lastBeat = performance.now();
        if (m.t === "up") facts = m.facts;
        if (m.t === "hb") {
          lastBytes = Number(m.bytes);
          lastHeap = m.heap ?? null;
        }
        if (m.t === "done") done = e.data as Outcome["done"];
      };
      control.port1.onmessage = (e) => {
        const m = e.data as { t: string; message?: string };
        if (m.t === "workerError") workerError = m.message;
        if (m.t === "pong") pong?.();
      };
      iframe.contentWindow!.postMessage({ t: "init", source: growSource, cfg }, "*", [app.port2, control.port2]);
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      let end: Outcome["end"];
      for (;;) {
        await sleep(100);
        const t = performance.now();
        if (done) {
          end = "done";
          break;
        }
        if (t - lastBeat > (cfg.silenceMs ?? 3000)) {
          longestSilence = Math.max(longestSilence, t - lastBeat);
          end = "silent";
          break;
        }
        if (t - started > cfg.timeLimitMs) {
          end = "time-limit";
          break;
        }
      }
      const ms = Math.round(performance.now() - started);
      const beatAtEnd = lastBeat;
      await sleep(1000);
      const beatsAfter = lastBeat > beatAtEnd;
      const frameAnswers = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2000);
        pong = () => {
          clearTimeout(timer);
          resolve(true);
        };
        control.port1.postMessage({ t: "ping" });
      });
      clearInterval(meter);
      iframe.remove();
      return { end, done, facts, lastBytes, lastHeap, workerError, beatsAfter, frameAnswers, shellGapMs: Math.round(gap), longestSilenceMs: Math.round(longestSilence), ms };
    },
    { cfg, csp: REALM_CSP, frameSource: FRAME_SOURCE, growSource: GROW_SOURCE },
  );
}

/** A launcher that puts the browser in a memory cgroup of its own, or null where that cannot be done. */
function boxed(real: string, maxBytes: number): string | null {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
  try {
    execFileSync("systemd-run", ["--user", "--scope", "-q", "-p", "MemoryMax=64M", "true"], { env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir }, stdio: "ignore" });
  } catch {
    return null;
  }
  if (!existsSync(real)) return null;
  const dir = mkdtempSync(join(tmpdir(), "potyro-realm-mem-"));
  const script = join(dir, "browser.sh");
  writeFileSync(script, `#!/bin/sh\nexport XDG_RUNTIME_DIR=${runtimeDir}\nexec systemd-run --user --scope -q -p MemoryMax=${maxBytes} -p MemorySwapMax=0 -p OOMPolicy=continue ${JSON.stringify(real)} "$@"\n`);
  chmodSync(script, 0o755);
  return script;
}

interface Config {
  name: string;
  engine: BrowserType;
  /** Launch options; null skips the configuration (no cgroup on this machine). */
  launch: () => Parameters<BrowserType["launch"]>[0] | null;
  runs: Run[];
}

const LOW_HEAP_MB = 256;
const lowRuns: Run[] = [
  { kind: "objects", where: "worker", ceiling: 2 * GB, timeLimitMs: 90_000 },
  { kind: "strings", where: "worker", ceiling: 2 * GB, timeLimitMs: 90_000 },
  { kind: "objects", where: "frame", ceiling: 2 * GB, timeLimitMs: 90_000 },
];
/** In a 3 GB cgroup: buffers until the kernel ends a process of the browser's (the ceiling is past the cgroup's). */
const endOfMemory: Run[] = [
  { kind: "buffers", where: "worker", ceiling: 6 * GB, timeLimitMs: 120_000 },
  { kind: "buffers", where: "frame", ceiling: 6 * GB, timeLimitMs: 120_000 },
];
/** In a 6 GB cgroup, the engine's own heap limit as shipped: objects until it refuses or the cgroup does. */
const ownLimit: Run[] = [{ kind: "objects", where: "worker", ceiling: 8 * GB, timeLimitMs: 150_000, silenceMs: 60_000 }];

const firefoxLow = { "javascript.options.mem.max": LOW_HEAP_MB, "dom.workers.options.mem.max": LOW_HEAP_MB };

const CONFIGS: Config[] = [
  { name: "chromium, site isolation, heap lowered to 256 MB", engine: chromium, launch: () => ({ channel: "chromium", args: [`--js-flags=--max-old-space-size=${LOW_HEAP_MB}`] }), runs: lowRuns },
  { name: "chromium headless shell (no site isolation), heap lowered to 256 MB", engine: chromium, launch: () => ({ args: [`--js-flags=--max-old-space-size=${LOW_HEAP_MB}`] }), runs: lowRuns },
  {
    name: "chromium, site isolation, 3 GB cgroup",
    engine: chromium,
    launch: () => {
      const exe = boxed(chromium.executablePath(), 3 * GB);
      return exe ? { executablePath: exe } : null;
    },
    runs: endOfMemory,
  },
  {
    name: "chromium, site isolation, own heap limit, 6 GB cgroup",
    engine: chromium,
    launch: () => {
      const exe = boxed(chromium.executablePath(), 6 * GB);
      return exe ? { executablePath: exe } : null;
    },
    runs: ownLimit,
  },
  { name: "firefox, heap lowered to 256 MB", engine: firefox, launch: () => ({ firefoxUserPrefs: firefoxLow }), runs: lowRuns },
  {
    name: "firefox, 3 GB cgroup",
    engine: firefox,
    launch: () => {
      const exe = boxed(firefox.executablePath(), 3 * GB);
      return exe ? { executablePath: exe } : null;
    },
    runs: endOfMemory,
  },
  {
    name: "firefox, own heap limit, 6 GB cgroup",
    engine: firefox,
    launch: () => {
      const exe = boxed(firefox.executablePath(), 6 * GB);
      return exe ? { executablePath: exe } : null;
    },
    runs: ownLimit,
  },
];

/** Frames of the page that Chromium runs in a process of their own (its DevTools lists each as a target). */
async function outOfProcessFrames(browser: Browser): Promise<number | null> {
  try {
    const cdp = await browser.newBrowserCDPSession();
    const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: Array<{ type: string }> };
    await cdp.detach();
    return targetInfos.filter((t) => t.type === "iframe").length;
  } catch {
    return null; // not Chromium
  }
}

test.describe("what an engine does when a sealed app keeps memory without end (#90)", () => {
  test.skip(!ON, "a measurement: POTYRO_REALM_MEMORY=1 runs it (docs/22 §7.1)");

  for (const config of CONFIGS) {
    for (const run of config.runs) {
      const title = `${config.name}: ${run.kind} in the ${run.where}`;
      test(title, async ({ baseURL }, testInfo) => {
        test.skip(ONLY !== null && !ONLY.test(title), "not asked for this time");
        test.setTimeout(run.timeLimitMs + (run.silenceMs ?? 3000) + 90_000);
        const options = config.launch();
        test.skip(options === null, "no memory cgroup can be made here (systemd-run --user --scope)");
        const browser = await config.engine.launch(options ?? undefined);
        const seen: Record<string, unknown> = { config: config.name, version: browser.version(), kind: run.kind, where: run.where };
        try {
          const page = await browser.newPage();
          let crashed = false;
          let gone = false;
          page.on("crash", () => (crashed = true));
          browser.on("disconnected", () => (gone = true));
          // An http page of the shell's origin, as a realm's parent is; not the shell itself, whose own
          // work would be in the measurement.
          await page.route("**/realm-memory-probe", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>probe</title>" }));
          await page.goto(`${baseURL}/realm-memory-probe`);
          // The page may never answer again (a frame that shares its thread and its heap): that is a
          // result, not a hung test.
          const patience = run.timeLimitMs + (run.silenceMs ?? 3000) + 20_000;
          const running = Promise.race([
            probe(page, run).then(
              (outcome) => ({ outcome }),
              (error: unknown) => ({ error: String(error instanceof Error ? error.message : error).split("\n")[0] }),
            ),
            new Promise<{ pageHung: true }>((r) => setTimeout(() => r({ pageHung: true }), patience)),
          ]);
          const early = await Promise.race([running, new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
          if (!early && !crashed && !gone) seen.outOfProcessFrames = await outOfProcessFrames(browser);
          const result = await running;
          Object.assign(seen, result, { pageCrashed: crashed, browserGone: gone });
          // The page itself: does it still run script?
          if (!gone && !("pageHung" in result)) seen.pageAnswersAfter = await Promise.race([page.evaluate(() => 1 + 1).then((v) => v === 2, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))]);
        } finally {
          console.log(`REALM_MEM ${JSON.stringify(seen)}`);
          await testInfo.attach("realm-memory", { body: JSON.stringify(seen, null, 2), contentType: "application/json" });
          await browser.close().catch(() => {});
        }
        // Nothing is asserted about the engine: this records. Only that the run ended.
        expect(seen.config).toBe(config.name);
      });
    }
  }
});
