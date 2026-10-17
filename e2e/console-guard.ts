// The console guard: a test that leaves an error in the browser console fails.
//
// Why: two tabs of apps.vaz.io printed nine `NoModificationAllowedError`s and a `removeVfs() failed`
// on every load, and the suite was green the whole time — no spec asserted on the console, so the
// errors were nobody's (fix/opfs-access-handles). An error in the console is either a bug or noise
// that will hide the next bug; either way somebody should have to decide which.
//
// What it watches: `console.error` and uncaught page errors (`pageerror`) on every page of the test
// — the `page` fixture's, any other page of its context, and pages of contexts the test makes with
// `browser.newContext()`. Messages a dedicated worker logs (the storage worker, a realm's worker)
// reach the page's console in Chromium and Firefox, so they are covered as well. What it cannot see:
// a browser a spec launches by itself (`chromium.launch()`), and a sandboxed realm frame's own
// console when the engine keeps it apart.
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

import { test as base, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";

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

export interface ConsoleGuard {
  /** Expect messages matching `pattern` in this test, for `why`. Say why. */
  allow(pattern: RegExp, why: string): void;
  /** Everything seen so far, allowed or not — for a test that asserts on its own errors. */
  seen(): readonly string[];
}

interface GuardFixtures {
  consoleGuard: ConsoleGuard;
}
interface GuardOptions {
  /** Fail a test on an unexpected console error. Set per project in playwright.config.ts. */
  guardConsole: boolean;
}

export const test = base.extend<GuardFixtures & GuardOptions>({
  guardConsole: [false, { option: true }],
  consoleGuard: [
    async ({ context, browser, guardConsole }, use, testInfo) => {
      const seen: string[] = [];
      const pending: Promise<void>[] = [];
      const allowed: Allowed[] = [];
      const watched = new WeakSet<Page>();
      const watch = (page: Page) => {
        if (watched.has(page)) return;
        watched.add(page);
        sparedSealedFrames(page);
        page.on("console", (m) => {
          // Full Chromium (`channel: "chromium"`, which the sealed-view specs use for out-of-process
          // frames) asks for /favicon.ico by itself, and the dev server has none: the browser's own
          // request, not the page's.
          if (m.type() !== "error" || /\/favicon\.ico$/.test(m.location().url)) return;
          const at = seen.push(m.text()) - 1;
          pending.push(withErrorMessages(m).then((text) => void (seen[at] = text)));
        });
        page.on("pageerror", (e) => seen.push(`${e.name}: ${e.message}`));
      };
      const watchContext = (ctx: BrowserContext) => {
        ctx.pages().forEach(watch);
        ctx.on("page", watch);
        sparedSealedFrames(ctx);
      };
      watchContext(context);

      // Contexts the test makes for itself (two devices, two tabs with their own storage) are the
      // test's pages too. Wrapped for this test only, and put back after it.
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args: Parameters<typeof browser.newContext>) => {
        const ctx = await newContext(...args);
        watchContext(ctx);
        return ctx;
      };

      await use({
        allow: (pattern, why) => {
          if (!why.trim()) throw new Error("consoleGuard.allow needs a reason");
          allowed.push({ pattern, why });
        },
        seen: () => [...seen],
      });

      browser.newContext = newContext;
      if (!guardConsole) return;
      await Promise.all(pending);
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
