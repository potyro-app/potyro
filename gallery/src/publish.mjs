#!/usr/bin/env node
// `pnpm gallery:publish --site https://potyro.app` — make each ready gallery app's demo link through
// the real share flow, the way a person does, and write the links and screenshots into gallery.json.
//
//   pnpm gallery:publish --site <url> [--data gallery/gallery.json] [--only groceries,plants]
//                        [--refresh] [--by "Potyro"] [--headed]
//
// For each app whose status is "ready":
//   1. a browser with nothing in it — no apps of anyone's, no identity, no storage — opens the site;
//   2. the app gets there as it would for anyone: an example is already on the launcher; an app under
//      apps/ is packed (scripts/pack-app.mjs) and added through Add an app → From this device;
//   3. its demo link is made from its tile: ⋯ → Share → A link anyone can try (e2e/share-demo.ts does
//      the same);
//   4. a SECOND empty browser opens the link, as a stranger: the app must open sealed with its name in
//      a heading and no error in the console, and the link with the remix intent must open the
//      Make it mine card;
//   5. that stranger's screen is the screenshot (412 px wide, the demo bar left out);
//   6. the link and screenshot are written into gallery.json, straight away, so a failure later keeps
//      what was done.
//
// Safe to run again: an app that already has a link on this site keeps it unless `--refresh`.
// Nothing personal is sent: the publishing browser is new and empty, and the link says who made the
// app only when `--by` says so. The share service sees what any shared link carries (docs/24 §4).
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishable, readGallery, remixLink } from "./data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const GALLERY_DIR = resolve(here, "..");
const ROOT = resolve(GALLERY_DIR, "..");

/** The stranger's screen: a common phone's width. */
export const SHOT_VIEWPORT = { width: 412, height: 860 };
const PUBLISHER_VIEWPORT = { width: 1280, height: 860 };
const LONG = 60_000;

/**
 * @typedef {{
 *   site: string;
 *   data?: string;
 *   shots?: string;
 *   only?: string[];
 *   refresh?: boolean;
 *   by?: string;
 *   headed?: boolean;
 *   log?: (line: string) => void;
 * }} PublishOptions
 * @typedef {{ id: string; outcome: "made" | "kept" | "failed"; link?: string; why?: string }} Outcome
 */

/**
 * Noise that is no fault of the app's, the same list as the e2e console guard's (e2e/console-guard.ts):
 * the sealed frame's CSP asks for CSP3's `webrtc 'block'` on purpose, and Chromium says it does not know it.
 */
const EXPECTED = [/^Unrecognized Content-Security-Policy directive 'webrtc'\.$/];

/** Console errors and uncaught errors on every page of a context. @param {import("@playwright/test").BrowserContext} context */
function watchErrors(context) {
  /** @type {string[]} */
  const errors = [];
  const watch = (/** @type {import("@playwright/test").Page} */ page) => {
    page.on("console", (m) => {
      if (m.type() === "error" && !EXPECTED.some((re) => re.test(m.text()))) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
  };
  context.on("page", watch);
  return errors;
}

/** The saved apps on this page, as the shell keeps them. @param {import("@playwright/test").Page} page */
async function savedApps(page) {
  return page.evaluate(() => /** @type {Array<{ id: string; name: string }>} */ (JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]")));
}

/** Pack an app under apps/ into a zip, as `pnpm pack:app` does. @param {string[]} files @param {string} dir */
function pack(files, dir) {
  const [source, ...rest] = files.map((f) => resolve(ROOT, f));
  const out = join(dir, "app.potyro-app.zip");
  execFileSync(process.execPath, [join(ROOT, "scripts", "pack-app.mjs"), source, ...rest, "-o", out], { cwd: ROOT, stdio: "pipe" });
  return out;
}

/**
 * Bring the app onto the publisher's launcher; return the name its tile shows.
 * @param {import("@playwright/test").Page} page @param {import("./data.mjs").GalleryApp} app @param {string} scratch
 */
async function bringApp(page, app, scratch) {
  await page.goto("/");
  const from = /** @type {import("./data.mjs").From} */ (app.from);
  if ("package" in from) {
    const zip = pack(from.package, scratch);
    await page.getByRole("button", { name: "Add an app" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add an app" });
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: /From this device/ }).click();
    await (await chooser).setFiles(zip);
    await dialog.getByRole("region", { name: /^About / }).waitFor({ timeout: LONG });
    await dialog.getByRole("button", { name: /^(Add app|Update app)$/ }).click();
    // Added: it opens, or says first what it will miss in the sealed box — then Open is the way on.
    const opened = page.locator(".k-app");
    const open = dialog.getByRole("button", { name: /^Open / });
    await Promise.race([opened.waitFor({ timeout: LONG }), open.waitFor({ timeout: LONG })]);
    if (await open.isVisible()) await open.click();
    await opened.waitFor({ timeout: LONG });
    await page.goto("/");
  }
  const id = "example" in from ? from.example : app.id;
  let saved;
  // The examples are seeded as the shell boots; a slow first boot gets one more page load.
  for (let i = 0; i < 80 && !saved; i++) {
    saved = (await savedApps(page)).find((a) => a.id === id);
    if (saved) break;
    if (i === 40) await page.reload();
    await page.waitForTimeout(500);
  }
  if (!saved) throw new Error(`“${id}” is not among the apps on ${page.url()}`);
  await page.getByRole("button", { name: `Actions for ${saved.name}` }).waitFor({ timeout: LONG });
  return saved.name;
}

/** Its demo link, from its tile, as a person makes one. @param {import("@playwright/test").Page} page @param {string} name */
async function makeLink(page, name) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menu").locator('[data-action="share"]').click();
  const sheet = page.locator(".k-share-sheet");
  await sheet.locator('[data-share="demo"]').click();
  const field = sheet.getByRole("textbox", { name: "Share link" });
  await field.waitFor({ timeout: LONG });
  const link = await field.inputValue();
  if (!link) throw new Error("the share sheet made no link");
  return link;
}

/**
 * Open the link as a stranger: it must open sealed, named, without errors; the remix intent must open
 * the Make it mine card. Returns the screenshot's bytes.
 * @param {import("@playwright/test").Browser} browser @param {string} link
 */
async function verify(browser, link) {
  const context = await browser.newContext({ locale: "en-US", viewport: SHOT_VIEWPORT, deviceScaleFactor: 2, colorScheme: "light" });
  const errors = watchErrors(context);
  try {
    const page = await context.newPage();
    await page.goto(link);
    const app = page.locator('.k-app[data-provenance="untrusted"]');
    await app.waitFor({ timeout: LONG });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: LONG });
    await page.waitForLoadState("networkidle").catch(() => {});
    // The demo bar is the shell's, not the app's: the card shows the app.
    await page.addStyleTag({ content: ".k-demo-bar { display: none !important; } * { caret-color: transparent !important; }" });
    await page.waitForTimeout(600);
    const shot = await page.screenshot({ type: "jpeg", quality: 72 });

    const mine = await context.newPage();
    await mine.goto(remixLink(link));
    await mine.getByRole("dialog", { name: "Make it mine" }).getByRole("region", { name: /^About / }).waitFor({ timeout: LONG });
    if (errors.length) throw new Error(`the console said:\n  ${errors.join("\n  ")}`);
    return shot;
  } finally {
    await context.close();
  }
}

/** @param {PublishOptions} opts @returns {Promise<Outcome[]>} */
export async function publish(opts) {
  const log = opts.log ?? ((line) => console.log(line));
  const site = new URL(opts.site);
  const local = site.hostname === "localhost" || site.hostname === "127.0.0.1";
  if (site.protocol !== "https:" && !local) throw new Error("--site must be https (http only for this machine)");
  const dataPath = resolve(opts.data ?? join(GALLERY_DIR, "gallery.json"));
  const shotsRoot = resolve(opts.shots ?? dirname(dataPath));
  const gallery = readGallery(JSON.parse(readFileSync(dataPath, "utf8")), { allowLocal: local });
  const write = () => writeFileSync(dataPath, `${JSON.stringify(gallery, null, 2)}\n`);
  mkdirSync(join(shotsRoot, "shots"), { recursive: true });

  const browser = await chromium.launch({ headless: !opts.headed });
  const scratch = mkdtempSync(join(tmpdir(), "potyro-gallery-"));
  /** @type {Outcome[]} */
  const outcomes = [];
  try {
    for (const app of publishable(gallery, opts.only)) {
      if (app.link && !opts.refresh && new URL(app.link).origin === site.origin) {
        log(`${app.id}: kept ${app.link}`);
        outcomes.push({ id: app.id, outcome: "kept", link: app.link });
        continue;
      }
      const context = await browser.newContext({ baseURL: site.origin + site.pathname.replace(/\/?$/, "/"), locale: "en-US", viewport: PUBLISHER_VIEWPORT });
      const errors = watchErrors(context);
      try {
        const page = await context.newPage();
        await page.goto("/");
        if (opts.by) {
          await page.evaluate((by) => localStorage.setItem("potyro:identity:name", by), opts.by);
          await page.reload();
        }
        const name = await bringApp(page, app, scratch);
        const link = await makeLink(page, name);
        if (errors.length) throw new Error(`the console said, while sharing:\n  ${errors.join("\n  ")}`);
        const shot = await verify(browser, link);
        const screenshot = `shots/${app.id}.jpg`;
        writeFileSync(join(shotsRoot, screenshot), shot);
        Object.assign(app, { link, screenshot, publishedAt: new Date().toISOString() });
        write();
        log(`${app.id}: ${link}`);
        outcomes.push({ id: app.id, outcome: "made", link });
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        log(`${app.id}: FAILED — ${why}`);
        outcomes.push({ id: app.id, outcome: "failed", why });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  const skipped = gallery.apps.filter((a) => a.status !== "ready").map((a) => a.id);
  if (skipped.length) log(`coming soon, not published: ${skipped.join(", ")}`);
  return outcomes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (/** @type {string} */ flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const site = take("--site");
  if (!site) {
    console.error('usage: pnpm gallery:publish --site https://potyro.app [--data gallery/gallery.json] [--only a,b] [--refresh] [--by "Name"] [--headed]');
    process.exit(2);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const data = take("--data");
  const shots = take("--shots");
  publish({
    site,
    data: data ? resolve(cwd, data) : undefined,
    shots: shots ? resolve(cwd, shots) : undefined,
    only: take("--only")?.split(",").filter(Boolean),
    refresh: args.includes("--refresh"),
    by: take("--by"),
    headed: args.includes("--headed"),
  }).then(
    (outcomes) => {
      const failed = outcomes.filter((o) => o.outcome === "failed");
      console.log(`published ${outcomes.filter((o) => o.outcome === "made").length}, kept ${outcomes.filter((o) => o.outcome === "kept").length}, failed ${failed.length}`);
      process.exit(failed.length ? 1 : 0);
    },
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
