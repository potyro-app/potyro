import { chromium, firefox, test, expect, type Browser, type Page } from "./console-guard";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installShared } from "./realm.js";

// A MEASUREMENT, not a gate spec (docs/31 §10, docs/22 §10.5): does a sealed app's screen make the
// browser look a hostname up? CSP governs what a frame may load, and a name can leave in a DNS
// question without anything being loaded: `<link rel=dns-prefetch>`, `<link rel=preconnect>` and the
// like. Opt-in, because it reads the browser's own network log and sends real questions for names
// under `.test` to this machine's resolver:
//
//   POTYRO_DNS_PROBE=1 pnpm e2e e2e/dns-prefetch-probe-sandbox.spec.ts --project sandbox
//
// The evidence is the browser's record of its resolver (Chromium's net-log, Firefox's nsHostResolver
// log), never the app's word. A CONTROL page with no CSP and the same hints runs in the same browser:
// where the control's names are not in the log, the method cannot see a lookup there and the result
// for that hint is "not measurable", not "no leak".

const ON = !!process.env.POTYRO_DNS_PROBE;

const KINDS = ["dns-prefetch", "preconnect", "prefetch", "preload", "anchor", "img", "fetch"] as const;
type Kind = (typeof KINDS)[number];

const zone = (nonce: string) => `potyro-dnsprobe-${nonce}.test`;
const nameOf = (where: "ctl" | "view" | "logic", kind: Kind, nonce: string) => `${where}-${kind}.${zone(nonce)}`;

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
        hints("view", "${z}");
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

/** Open the control and the sealed app, let both sit, hover the links. */
async function drive(browser: Browser, baseURL: string, z: string): Promise<void> {
  const control = await controlServer(z);
  const context = await browser.newContext({ baseURL });
  try {
    const ctl = await context.newPage();
    await ctl.goto(control.url);
    await expect(ctl.locator("#probe-done")).toBeVisible();
    await ctl.locator("#probe-anchor").hover();

    const page: Page = await context.newPage();
    await installShared(page, "dns-probe", "DNS probe", appSource(z));
    const el = page.locator(".k-sealed-view iframe");
    await expect(el).toHaveCount(1, { timeout: 30_000 });
    const frame = (await (await el.elementHandle())!.contentFrame())!;
    // The hints are in the sealed frame's own document: four <link>s, counted there.
    await expect(frame.locator("#probe-done")).toHaveText("hints in: 4", { timeout: 30_000 });
    expect(await frame.evaluate(() => self.origin)).toBe("null");
    await frame.locator("#probe-anchor").hover();
    await page.getByRole("button", { name: "From the logic" }).click();
    await expect(page.locator(".k-toast").last()).toHaveText("logic tried");
    // Speculative lookups are scheduled, not immediate.
    await page.waitForTimeout(6000);
  } finally {
    await context.close();
    await control.close();
  }
}

function report(engine: string, log: string, nonce: string): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = (name: string) => log.includes(name);
  for (const kind of KINDS) {
    const ctl = seen(nameOf("ctl", kind, nonce));
    const view = seen(nameOf("view", kind, nonce));
    out[kind] = `control ${ctl ? "LOOKED UP" : "not looked up"} · sealed screen ${view ? "LOOKED UP" : "not looked up"}${ctl ? "" : " (not measurable: the control made no lookup either)"}`;
  }
  out["fetch from the logic's Worker"] = seen(nameOf("logic", "fetch", nonce)) ? "LOOKED UP" : "not looked up";
  console.log(`\n[dns-probe] ${engine}\n${Object.entries(out).map(([k, v]) => `[dns-probe]   ${k}: ${v}`).join("\n")}\n`);
  return out;
}

// Playwright starts Chromium with `--disable-background-networking`, which a person's browser does
// not have; the third run drops it, so the hints that are background work (dns-prefetch, preconnect)
// are measured as that browser would treat them, if the control shows it does them at all.
const CHROMIUMS = [
  { engine: "Chromium (headless shell)", id: "shell", channel: undefined, asAPerson: false },
  { engine: "Chromium (full, new headless)", id: "full", channel: "chromium", asAPerson: false },
  { engine: "Chromium (full, background networking left on)", id: "bg", channel: "chromium", asAPerson: true },
] as const;

for (const { engine, id, channel, asAPerson } of CHROMIUMS) {
  test(`what a sealed screen's hints make ${engine} look up`, async ({}, info) => {
    test.skip(!ON, "a measurement: POTYRO_DNS_PROBE=1");
    test.skip(info.project.name !== "sandbox", "launches its own browsers; once is enough");
    test.setTimeout(120_000);
    const nonce = `${id}${Date.now().toString(36)}`;
    const dir = mkdtempSync(join(tmpdir(), "dns-probe-"));
    const netlog = join(dir, "netlog.json");
    const browser = await chromium.launch({
      channel,
      args: [`--log-net-log=${netlog}`, "--net-log-capture-mode=IncludeSensitive"],
      ...(asAPerson ? { ignoreDefaultArgs: ["--disable-background-networking"] } : {}),
    });
    try {
      await drive(browser, String(info.project.use.baseURL), zone(nonce));
    } finally {
      await browser.close(); // the log is complete once the browser has gone
    }
    const log = readFileSync(netlog, "utf8");
    const result = report(engine, log, nonce);
    info.annotations.push({ type: "dns-probe", description: JSON.stringify(result) });
    // The method must be able to see a lookup at all: the control's own fetch is in the log.
    expect(log).toContain(nameOf("ctl", "fetch", nonce));
  });
}

test("what a sealed screen's hints make Firefox look up", async ({}, info) => {
  test.skip(!ON, "a measurement: POTYRO_DNS_PROBE=1");
  test.skip(info.project.name !== "sandbox", "launches its own browsers; once is enough");
  test.setTimeout(120_000);
  const nonce = `fx${Date.now().toString(36)}`;
  const dir = mkdtempSync(join(tmpdir(), "dns-probe-"));
  const mozlog = join(dir, "moz.log");
  const browser = await firefox.launch({ env: { ...(process.env as Record<string, string>), MOZ_LOG: "nsHostResolver:5,sync", MOZ_LOG_FILE: mozlog } });
  try {
    await drive(browser, String(info.project.use.baseURL), zone(nonce));
  } finally {
    await browser.close();
  }
  // Firefox writes one file per process: moz.log, or moz.log.moz_log, with child suffixes.
  const { readdirSync } = await import("node:fs");
  const log = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const result = report("Firefox", log, nonce);
  info.annotations.push({ type: "dns-probe", description: JSON.stringify(result) });
  expect(log).toContain(nameOf("ctl", "fetch", nonce));
});
