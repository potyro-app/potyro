import { chromium, firefox, test, expect, type BrowserContext, type Page } from "./console-guard";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installShared } from "./realm.js";

// A MEASUREMENT with a floor under it (docs/31 §10, docs/22 §10.5): does a sealed app's screen make
// the browser look a hostname up? CSP governs what a frame may load, and a name can leave in a DNS
// question without anything being loaded: `<link rel=dns-prefetch>`, `<link rel=preconnect>`, a link
// the browser expects to be followed. Opt-in, because it reads the browser's own network log and
// sends real questions for names under `.test` to this machine's resolver:
//
//   POTYRO_DNS_PROBE=1 pnpm e2e e2e/dns-prefetch-probe-sandbox.spec.ts --project sandbox
//
// The evidence is the browser's record of its resolver (Chromium's net-log, Firefox's nsHostResolver
// log), never the app's word. A CONTROL page with no CSP and the same hints runs in the same browser:
// where the control's names are not in the log, the method cannot see a lookup there and the result
// for that hint is "not measurable", not "no leak".
//
// The app under test is hostile about it: before it writes its hints it removes the frame's
// `x-dns-prefetch-control` and adds its own with "on" (`NO_DNS_PREFETCH` in host/src/realm/frame.ts
// must survive both), and it nests a frame of its own with the same hints, which is a document the
// realm never wrote a line of.
//
// What it ASSERTS is what the realm closes, and that the method could have seen it open (`CLOSED`).
// What it only REPORTS is everything else, including the hints that are still looked up: read the
// table it prints, and keep docs/31 §10 in step with it.

const ON = !!process.env.POTYRO_DNS_PROBE;

const KINDS = ["dns-prefetch", "preconnect", "prefetch", "preload", "anchor", "img", "fetch"] as const;
type Kind = (typeof KINDS)[number];

const zone = (nonce: string) => `potyro-dnsprobe-${nonce}.test`;
type Where = "ctl" | "view" | "nested" | "logic";
const nameOf = (where: Where, kind: Kind, nonce: string) => `${where}-${kind}.${zone(nonce)}`;
/** What the frame the app nests for itself carries. */
const NESTED: readonly Kind[] = ["dns-prefetch", "preconnect", "anchor"];

/** Put every hint for `where` into this document. Serialised into the control page and the app. */
const HINTS = `function hints(where, zone) {
  var h = function (kind) { return where + "-" + kind + "." + zone; };
  var link = function (rel, href, as) {
    var l = document.createElement("link");
    l.rel = rel; l.href = href; if (as) l.as = as;
    document.head.appendChild(l);
  };
  link("dns-prefetch", "//" + h("dns-prefetch"));
  link("preconnect", "https://" + h("preconnect"));
  link("prefetch", "https://" + h("prefetch") + "/x");
  link("preload", "https://" + h("preload") + "/x.png", "image");
  var a = document.createElement("a");
  a.href = "http://" + h("anchor") + "/"; a.textContent = "a link"; a.id = "probe-anchor";
  document.body.appendChild(a);
  var img = document.createElement("img");
  img.src = "https://" + h("img") + "/x.png";
  document.body.appendChild(img);
  try { fetch("https://" + h("fetch") + "/x").catch(function () {}); } catch (e) {}
}`;

const appSource = (z: string) => `
import { defineApp } from "potyro";
${HINTS}
export default defineApp({
  id: "dns-probe",
  name: "DNS probe",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { note: { displayField: "text", fields: { text: { type: "text" } } } },
  pages: [
    {
      id: "screen",
      title: "Screen",
      actions: [{ label: "From the logic", run: async (ctx) => {
        try { await fetch("https://logic-fetch.${z}/x"); } catch (e) {}
        ctx.ui.toast("logic tried");
      } }],
      view: { type: "custom", entity: "note", mount: (el) => {
        // Take the frame's own switch back, as far as a script can.
        document.querySelectorAll('meta[http-equiv="x-dns-prefetch-control" i]').forEach((m) => m.remove());
        const on = document.createElement("meta");
        on.httpEquiv = "x-dns-prefetch-control";
        on.content = "on";
        document.head.appendChild(on);
        hints("view", "${z}");
        // And a document of the app's own making: a nested frame, with the same switch asked for.
        const nested = document.createElement("iframe");
        nested.id = "probe-nested";
        nested.srcdoc = '<meta http-equiv="x-dns-prefetch-control" content="on">'
          + '<link rel="dns-prefetch" href="//nested-dns-prefetch.${z}">'
          + '<link rel="preconnect" href="https://nested-preconnect.${z}">'
          + '<a id="probe-anchor" href="http://nested-anchor.${z}/">a nested link</a>';
        el.appendChild(nested);
        const p = document.createElement("p");
        p.id = "probe-done";
        p.textContent = "hints in: " + document.querySelectorAll("link").length;
        el.appendChild(p);
        return () => {};
      } },
    },
  ],
});
`;

/** A page with no CSP and the same hints: what this browser does when nothing forbids it. */
async function controlServer(z: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><title>control</title></head><body><script>${HINTS}\nhints("ctl", "${z}");</script><p id="probe-done">done</p></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** A hovered link is looked up after the pointer has rested on it, not at once. */
const DWELL_MS = 2500;

/** Open the control and the sealed app, let both sit, hover the links. */
async function drive(context: BrowserContext, z: string): Promise<void> {
  const control = await controlServer(z);
  try {
    const ctl = await context.newPage();
    await ctl.goto(control.url);
    await expect(ctl.locator("#probe-done")).toBeVisible();
    await ctl.locator("#probe-anchor").hover();
    await ctl.waitForTimeout(DWELL_MS);

    const page: Page = await context.newPage();
    await installShared(page, "dns-probe", "DNS probe", appSource(z));
    const el = page.locator(".k-sealed-view iframe");
    await expect(el).toHaveCount(1, { timeout: 30_000 });
    const frame = (await (await el.elementHandle())!.contentFrame())!;
    // The hints are in the sealed frame's own document: four <link>s, counted there.
    await expect(frame.locator("#probe-done")).toHaveText("hints in: 4", { timeout: 30_000 });
    expect(await frame.evaluate(() => self.origin)).toBe("null");
    await frame.locator("#probe-anchor").hover();
    await page.waitForTimeout(DWELL_MS);
    await frame.frameLocator("#probe-nested").locator("#probe-anchor").hover();
    await page.waitForTimeout(DWELL_MS);
    await page.getByRole("button", { name: "From the logic" }).click();
    await expect(page.locator(".k-toast").last()).toHaveText("logic tried");
    // Speculative lookups are scheduled, not immediate.
    await page.waitForTimeout(6000);
  } finally {
    await control.close();
  }
}

interface Seen {
  ctl: Record<Kind, boolean>;
  view: Record<Kind, boolean>;
  nested: Partial<Record<Kind, boolean>>;
  logicFetch: boolean;
}

function read(log: string, nonce: string): Seen {
  const seen = (where: Where, kind: Kind) => log.includes(nameOf(where, kind, nonce));
  const all = (where: Where) => Object.fromEntries(KINDS.map((k) => [k, seen(where, k)])) as Record<Kind, boolean>;
  return { ctl: all("ctl"), view: all("view"), nested: Object.fromEntries(NESTED.map((k) => [k, seen("nested", k)])), logicFetch: seen("logic", "fetch") };
}

function report(engine: string, s: Seen): Record<string, string> {
  const word = (looked: boolean) => (looked ? "LOOKED UP" : "not looked up");
  const out: Record<string, string> = {};
  for (const kind of KINDS) {
    const nested = kind in s.nested ? ` · a frame it nests ${word(!!s.nested[kind])}` : "";
    out[kind] = `control ${word(s.ctl[kind])} · sealed screen ${word(s.view[kind])}${nested}${s.ctl[kind] ? "" : " (not measurable: the control made no lookup either)"}`;
  }
  out["fetch from the logic's Worker"] = word(s.logicFetch);
  console.log(`\n[dns-probe] ${engine}\n${Object.entries(out).map(([k, v]) => `[dns-probe]   ${k}: ${v}`).join("\n")}\n`);
  return out;
}

/** What CSP stops before a name is resolved, in every engine: seen from the control, never from the app. */
const BY_CSP: readonly Kind[] = ["img", "fetch"];

/**
 * The floor: for each of `closed`, the control looked the name up (the method can see it) and the
 * sealed screen did not, although the app asked for its prefetch back.
 */
function expectClosed(s: Seen, closed: readonly Kind[]): void {
  for (const kind of [...BY_CSP, ...closed]) {
    expect(s.ctl[kind], `the control's ${kind} must be looked up, or this run measured nothing`).toBe(true);
    expect(s.view[kind], `a sealed screen's ${kind} must not be looked up`).toBe(false);
  }
  expect(s.logicFetch, "a fetch from the logic's Worker must not be looked up").toBe(false);
}

// A person's Chrome, as near as a test gets: a profile on disk and background networking left on.
// Playwright's default (`browser.newContext()`, an off-the-record profile, and
// `--disable-background-networking`) does none of the speculative lookups, for any page, which is why
// the first measurement (2026-11-16) could not see them: the control made none either.
const CHROMIUMS = [
  { engine: "Chromium (Playwright's build)", id: "cr", channel: "chromium" },
  { engine: "Chrome (the stable channel, if this machine has it)", id: "gc", channel: "chrome" },
] as const;

for (const { engine, id, channel } of CHROMIUMS) {
  test(`what a sealed screen's hints make ${engine} look up`, async ({}, info) => {
    test.skip(!ON, "a measurement: POTYRO_DNS_PROBE=1");
    test.skip(info.project.name !== "sandbox", "launches its own browsers; once is enough");
    test.setTimeout(180_000);
    const nonce = `${id}${Date.now().toString(36)}`;
    const dir = mkdtempSync(join(tmpdir(), "dns-probe-"));
    const netlog = join(dir, "netlog.json");
    const context = await chromium
      .launchPersistentContext(mkdtempSync(join(tmpdir(), "dns-probe-profile-")), {
        channel,
        baseURL: String(info.project.use.baseURL),
        args: [`--log-net-log=${netlog}`, "--net-log-capture-mode=IncludeSensitive"],
        ignoreDefaultArgs: ["--disable-background-networking"],
      })
      .catch((e: unknown) => {
        if (channel === "chrome") return null; // not installed here
        throw e;
      });
    test.skip(!context, "no Chrome on this machine");
    const version = context!.browser()?.version() ?? "";
    try {
      await drive(context!, zone(nonce));
    } finally {
      await context!.close(); // the log is complete once the browser has gone
    }
    const seen = read(readFileSync(netlog, "utf8"), nonce);
    const result = report(`${engine} ${version}`.trim(), seen);
    info.annotations.push({ type: "dns-probe", description: JSON.stringify(result) });
    // A hovered link's host: off in an opaque-origin frame until a document asks, and the frame's
    // own "off" is kept against the app's "on". The <link> hints are not governed by it (reported).
    expectClosed(seen, ["anchor"]);
  });
}

test("what a sealed screen's hints make Firefox look up", async ({}, info) => {
  test.skip(!ON, "a measurement: POTYRO_DNS_PROBE=1");
  test.skip(info.project.name !== "sandbox", "launches its own browsers; once is enough");
  test.setTimeout(180_000);
  const nonce = `fx${Date.now().toString(36)}`;
  const dir = mkdtempSync(join(tmpdir(), "dns-probe-"));
  const mozlog = join(dir, "moz.log");
  const browser = await firefox.launch({ env: { ...(process.env as Record<string, string>), MOZ_LOG: "nsHostResolver:5,sync", MOZ_LOG_FILE: mozlog } });
  const version = browser.version();
  try {
    const context = await browser.newContext({ baseURL: String(info.project.use.baseURL) });
    await drive(context, zone(nonce));
    await context.close();
  } finally {
    await browser.close();
  }
  // Firefox writes one file per process: moz.log, or moz.log.moz_log, with child suffixes.
  const seen = read(readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n"), nonce);
  const result = report(`Firefox ${version}`, seen);
  info.annotations.push({ type: "dns-probe", description: JSON.stringify(result) });
  // Every link's host and <link rel=dns-prefetch>: one switch in Gecko, kept off against the app.
  // <link rel=preconnect> is a different path with no switch a page can reach (reported).
  expectClosed(seen, ["dns-prefetch", "anchor"]);
});
