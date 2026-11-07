// The console guard: a test that leaves an error in the browser console fails.
//
// Why: two tabs of apps.vaz.io printed nine `NoModificationAllowedError`s and a `removeVfs() failed`
// on every load, and the suite was green the whole time — no spec asserted on the console, so the
// errors were nobody's (fix/opfs-access-handles). An error in the console is either a bug or noise
// that will hide the next bug; either way somebody should have to decide which.
//
// What it watches: `console.error` and uncaught page errors (`pageerror`) on every page of the test
// — the `page` fixture's, any other page of its context, and pages of contexts the test makes with
// `browser.newContext()`. A context a spec opens in `beforeAll` and shares across its tests is
// watched from the moment it is made: what the page says while it boots is judged by the first test
// that runs on it, and each later test answers for what arrived during its own run. Messages a
// dedicated worker logs (the storage worker, a realm's worker) reach the page's console in Chromium
// and Firefox, so they are covered as well. What it cannot see: a browser a spec launches by itself
// (`chromium.launch()`), and a sandboxed realm frame's own console when the engine keeps it apart.
//
// How to use it: import `test` and `expect` from this file instead of "@playwright/test" (everything
// else is re-exported). It is switched on per project with `use: { guardConsole: true }` — the
// trusted and sandbox projects — and the others carry it inert.
//
// When a test fails ON PURPOSE (a broken app, a refused import), it says what it expects:
//
//   test("a broken app says so", async ({ page, consoleGuard }) => {
//     consoleGuard.allow(/Unexpected token/, "the app under test does not parse, deliberately");
//
// The allow-list below is for noise that is no fault of ours and nothing a test could do about.
// Every entry says why; an entry without a reason is a bug being hidden.

import { test as base, type Browser, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";

export * from "@playwright/test";

interface Allowed {
  pattern: RegExp;
  why: string;
}

/**
 * Expected noise, everywhere. Keep it short, keep it specific, and say why: anything matched here is
 * invisible to the whole suite.
 */
const ALLOWED: readonly Allowed[] = [
  // The browser realm's CSP asks for CSP3's `webrtc 'block'` on purpose (host/src/realm/protocol.ts):
  // no engine honours it yet, the frame deletes the WebRTC constructors anyway, and the directive is
  // there for the engine that one day does. Chromium says it does not know it, once per realm frame.
  { pattern: /^Unrecognized Content-Security-Policy directive 'webrtc'\.?\s*$/, why: "a CSP3 directive kept for the engines that will honour it" },
  // Playwright's Firefox (Juggler) loads its own instrumentation into every worker the page starts
  // (`loadSubScript` of chrome://juggler/…/Runtime.js and SimpleChannel.js, WorkerMain.js lines 6–7).
  // A page that is left while one of its workers is still starting — the launcher's storage worker,
  // when a test goes straight on to an app — tears that worker down mid-load, and Juggler's own load
  // reports the abort as an error of the page. Only Juggler's file: the page's own aborts still count.
  { pattern: /^\[JavaScript Error: "NS_BINDING_ABORTED: " \{file: "chrome:\/\/juggler\/content\/content\/WorkerMain\.js" line: \d+\}\]$/, why: "Playwright's Firefox instrumentation, interrupted in a worker the page's navigation ended" },
];

/**
 * A spec's init script, kept out of the frames it was never written for.
 *
 * `addInitScript` runs in EVERY frame, and the shell's sealed frames (the browser realm, #272) are
 * opaque-origin sandboxes with no storage: a spec's `localStorage.setItem(…)` seeding threw
 * `SecurityError` there, as an uncaught page error, on every sealed app the spec opened — dozens of
 * failures under the guard that were the harness's own. The script still runs in every frame; only
 * a `SecurityError` thrown inside an opaque-origin frame is set aside, so a script that fails for any
 * other reason, or anywhere else, still fails loudly.
 */
function sparedSealedFrames(target: BrowserContext | Page): void {
  type Adds = Pick<BrowserContext, "addInitScript"> & { __sealedFramesSpared?: true };
  const marked = target as unknown as Adds;
  if (marked.__sealedFramesSpared) return;
  marked.__sealedFramesSpared = true;
  const add = marked.addInitScript.bind(target);
  marked.addInitScript = (script: Parameters<BrowserContext["addInitScript"]>[0], arg?: unknown) => {
    if (typeof script !== "function") return add(script, arg);
    const call = `(${script.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`;
    return add({
      content: `(() => { try { ${call}; } catch (e) { if (self.origin === "null" && e && e.name === "SecurityError") return; throw e; } })();`,
    });
  };
}

/**
 * A console message's text, with the message of every Error it was handed.
 *
 * `console.error("[potyro] view crashed:", error)` reads "…crashed: Error: page nowhere not found"
 * in Chromium's text and "…crashed: Error" in Firefox's — Playwright's Firefox renders an Error
 * argument by its class alone. Without the message an `allow` for it could never match there, and an
 * unexpected one would say nothing about itself. The arguments are read back from the page; one that
 * cannot be (its page has gone) leaves the text as it was.
 */
async function withErrorMessages(m: ConsoleMessage): Promise<string> {
  const text = m.text();
  const said = await Promise.all(
    m.args().map((h) =>
      Promise.race([
        h.evaluate((v) => (v instanceof Error ? `${v.name}: ${v.message}` : null)).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
      ]),
    ),
  );
  const missing = said.filter((s): s is string => !!s && !text.includes(s));
  return missing.length ? `${text} (${missing.join("; ")})` : text;
}

/**
 * What one page has said, from the moment the guard first saw it. `judged` is how far some test has
 * already answered for: a page shared by several tests (opened in `beforeAll`) hands each test the
 * errors that arrived since the one before, and the first of them everything from the boot.
 */
interface PageLog {
  entries: string[];
  pending: Promise<void>[];
  judged: number;
}

const logs = new WeakMap<Page, PageLog>();
const watchedContexts = new WeakSet<BrowserContext>();

function watchPage(page: Page): PageLog {
  const known = logs.get(page);
  if (known) return known;
  const log: PageLog = { entries: [], pending: [], judged: 0 };
  logs.set(page, log);
  sparedSealedFrames(page);
  page.on("console", (m) => {
    // Full Chromium (`channel: "chromium"`, which the sealed-view specs use for out-of-process
    // frames) asks for /favicon.ico by itself, and the dev server has none: the browser's own
    // request, not the page's.
    if (m.type() !== "error" || /\/favicon\.ico$/.test(m.location().url)) return;
    const at = log.entries.push(m.text()) - 1;
    log.pending.push(withErrorMessages(m).then((text) => void (log.entries[at] = text)));
  });
  page.on("pageerror", (e) => log.entries.push(`${e.name}: ${e.message}`));
  // The machine's network changed under the page (a container or a VPN coming and going adds and
  // removes an interface): Chromium aborts every request in flight, and an app caught mid-boot is left
  // blank. Its test would then wait out its whole timeout — up to 180 s — for something that can never
  // appear. Say why and end the page now; the retry starts clean.
  page.on("requestfailed", (r) => {
    if (!/ERR_NETWORK_CHANGED/.test(r.failure()?.errorText ?? "") || !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(r.url())) return;
    void page.close({ reason: `the machine's network changed while the page loaded (${r.url()} was aborted), so its app never started — not a fault of the code under test` }).catch(() => {});
  });
  return log;
}

function watchContext(ctx: BrowserContext): void {
  if (watchedContexts.has(ctx)) return;
  watchedContexts.add(ctx);
  ctx.pages().forEach(watchPage);
  ctx.on("page", watchPage);
  sparedSealedFrames(ctx);
}

/**
 * Every context this browser makes is watched from its first page: the `context` fixture's, the ones
 * a test makes for itself (two devices, two tabs with their own storage), and the one a spec opens in
 * `beforeAll` to boot an app once for a run of read-only tests. Wrapped once per browser, for the
 * worker's life.
 */
function watchBrowser(browser: Browser): void {
  type Marked = Browser & { __consoleGuarded?: true };
  if ((browser as Marked).__consoleGuarded) return;
  (browser as Marked).__consoleGuarded = true;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args: Parameters<typeof browser.newContext>) => {
    const ctx = await newContext(...args);
    watchContext(ctx);
    return ctx;
  };
}

export interface ConsoleGuard {
  /** Expect messages matching `pattern` in this test, for `why`. Say why. */
  allow(pattern: RegExp, why: string): void;
  /** Everything seen so far, allowed or not — for a test that asserts on its own errors. */
  seen(): readonly string[];
}

interface GuardFixtures {
  consoleGuard: ConsoleGuard;
}
interface GuardWorkerFixtures {
  guardedBrowser: void;
}
interface GuardOptions {
  /** Fail a test on an unexpected console error. Set per project in playwright.config.ts. */
  guardConsole: boolean;
}

export const test = base.extend<GuardFixtures & GuardOptions, GuardWorkerFixtures>({
  guardConsole: [false, { option: true }],
  // Worker-scoped and automatic, so it is in place before a spec's `beforeAll` runs.
  guardedBrowser: [
    async ({ browser }, use) => {
      watchBrowser(browser);
      await use();
    },
    { scope: "worker", auto: true },
  ],
  consoleGuard: [
    async ({ context, browser, guardConsole }, use, testInfo) => {
      const allowed: Allowed[] = [];
      // This test's pages, each from where its log was last judged. A page already open when the test
      // starts (the `context` fixture's, a shared one from `beforeAll`) is taken on from there; a page
      // that appears during the test, from its first word.
      const mine = new Map<Page, number>();
      const adopt = (page: Page) => {
        if (mine.has(page)) return;
        mine.set(page, watchPage(page).judged);
      };
      const adoptContext = (ctx: BrowserContext) => {
        watchContext(ctx);
        ctx.pages().forEach(adopt);
        ctx.on("page", adopt);
      };
      watchContext(context);
      const contexts = new Set<BrowserContext>([context, ...browser.contexts()]);
      contexts.forEach(adoptContext);
      // Contexts the test makes for itself are the test's pages too. Wrapped for this test only, on
      // top of the worker's wrap, and put back after it.
      const newContext = browser.newContext;
      // And they die with the test (`madeHere`, below): a context a test leaves open keeps its pages,
      // and those pages keep talking — to a rooms relay the spec's `afterAll` has since stopped, say
      // — so their errors landed on whatever test ran next in the worker (ask-review was failed by
      // Draw & Guess's sockets, 2026-11-07). A context a spec opens in `beforeAll` is not made during
      // a test, so it is not touched here.
      const madeHere = new Set<BrowserContext>();
      browser.newContext = async (...args: Parameters<typeof browser.newContext>) => {
        const ctx = await newContext.call(browser, ...args);
        contexts.add(ctx);
        madeHere.add(ctx);
        adoptContext(ctx);
        return ctx;
      };

      const since = () => [...mine].flatMap(([page, from]) => logs.get(page)?.entries.slice(from) ?? []);

      await use({
        allow: (pattern, why) => {
          if (!why.trim()) throw new Error("consoleGuard.allow needs a reason");
          allowed.push({ pattern, why });
        },
        seen: since,
      });

      browser.newContext = newContext;
      contexts.forEach((ctx) => ctx.off("page", adopt));
      const judge = guardConsole
        ? async () => {
            await Promise.all([...mine.keys()].flatMap((page) => logs.get(page)?.pending ?? []));
            return since();
          }
        : null;
      const seen = judge ? await judge() : [];
      // Judged first, so a last word a page says as it closes is not counted — then the test's own
      // contexts are closed, so nothing of this test speaks into the next one.
      const open = new Set(browser.contexts());
      await Promise.all([...madeHere].filter((ctx) => open.has(ctx)).map((ctx) => ctx.close().catch(() => undefined)));
      if (!guardConsole) return;
      // Answered for: the next test on a shared page starts after these.
      for (const page of mine.keys()) {
        const log = logs.get(page);
        if (log) log.judged = log.entries.length;
      }
      // A test that already failed has said what is wrong; piling the console on top would bury it.
      if (testInfo.status !== testInfo.expectedStatus) return;
      const unexpected = seen.filter((text) => ![...ALLOWED, ...allowed].some((a) => a.pattern.test(text)));
      if (unexpected.length === 0) return;
      const list = [...new Set(unexpected)].map((t) => `  - ${t.length > 400 ? `${t.slice(0, 400)}…` : t}`).join("\n");
      throw new Error(
        `The browser console had ${unexpected.length} unexpected error(s):\n${list}\n` +
          `Fix the cause, or — when the test fails on purpose — consoleGuard.allow(/…/, "why") in the test (e2e/console-guard.ts).`,
      );
    },
    { auto: true },
  ],
});
