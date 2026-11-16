#!/usr/bin/env node
// `pnpm gallery:publish --site https://potyro.app` — make each ready gallery app's demo link through
// the real share flow, the way a person does, and write the links and screenshots into gallery.json.
//
//   pnpm gallery:publish --site <url> [--data gallery/gallery.json] [--only groceries,plants]
//                        [--refresh] [--shots-only] [--by "Potyro"] [--headed]
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
//   5. that stranger's screen is the picture (412 px wide, the demo bar left out), taken once per
//      language and theme (SHOT_LOCALES × SHOT_THEMES in data.mjs: a new language is one more entry
//      there) and written as AVIF and WebP at 1x and 2x under shots/<language>/ (#33);
//   6. the link and screenshot are written into gallery.json, straight away, so a failure later keeps
//      what was done.
//
// Safe to run again: an app that already has a link on this site keeps it unless `--refresh`.
// `--shots-only` takes every app's pictures again and leaves its link as it is: the link it opens is
// made for the occasion on `--site` and thrown away, so the site can be a build on this machine
// (`pnpm gallery:shoot` builds one, serves it on a port of its own and does exactly that).
// An app's `shot` in gallery.json arranges its screen first (`press` selectors, a longer `settle`).
// `POTYRO_GALLERY_DEBUG=<folder>` keeps the screen at the moment a step failed, as a PNG there.
// Nothing personal is sent: the publishing browser is new and empty, and the link says who made the
// app only when `--by` says so. The share service sees what any shared link carries (docs/24 §4).
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishable, readGallery, remixLink, SETTLE, SHOT_FORMATS, SHOT_LOCALES, SHOT_THEMES, SHOT_WIDTHS, shotPath } from "./data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const GALLERY_DIR = resolve(here, "..");
const ROOT = resolve(GALLERY_DIR, "..");

/** The stranger's screen: a common phone's width. */
export const SHOT_VIEWPORT = { width: 412, height: 860 };
const PUBLISHER_VIEWPORT = { width: 1280, height: 860 };
const LONG = 60_000;
/** The browser's language for each of the gallery's (data.mjs `SHOT_LOCALES`). */
const BROWSER_LOCALE = /** @type {Record<string, string>} */ ({ en: "en-US" });

/**
 * How each format is written. A screen is flat colour and small text: colour at full resolution
 * (4:4:4) keeps coloured text and thin strokes from smearing, which matters more than the bytes it costs.
 * @type {Record<string, (image: import("sharp").Sharp) => import("sharp").Sharp>}
 */
const ENCODE = {
  avif: (image) => image.avif({ quality: 55, effort: 5, chromaSubsampling: "4:4:4" }),
  webp: (image) => image.webp({ quality: 76, effort: 6, smartSubsample: true }),
};

/**
 * One shot, in every format at every width (data.mjs: `shotPath`).
 * @param {Buffer} png the screen, at the widest width
 * @param {string} root the gallery's folder @param {string} id @param {string} locale @param {string} theme
 */
export async function writeShot(png, root, id, locale, theme) {
  // Here, not at the top: reading or building the gallery needs no encoder.
  const { default: sharp } = await import("sharp");
  await Promise.all(
    SHOT_WIDTHS.map(async (width) => {
      const sized = await sharp(png).resize({ width, kernel: "lanczos3" }).png().toBuffer();
      await Promise.all(
        SHOT_FORMATS.map(async (format) => {
          const to = join(root, shotPath(id, { locale, theme, width, format }));
          mkdirSync(dirname(to), { recursive: true });
          writeFileSync(to, await ENCODE[format](sharp(sized)).toBuffer());
        }),
      );
    }),
  );
}

/**
 * @typedef {{
 *   site: string;
 *   data?: string;
 *   shots?: string;
 *   only?: string[];
 *   refresh?: boolean;
 *   shotsOnly?: boolean;
 *   locales?: readonly string[];
 *   themes?: readonly ("light" | "dark")[];
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

/**
 * What was on the screen when a step failed, as PNGs in the folder `POTYRO_GALLERY_DEBUG` names — the
 * quickest way to see a question nobody answered (a screen in another language names its buttons
 * differently). Nothing is kept without it.
 * @param {import("@playwright/test").BrowserContext} context @param {string} name
 */
async function keepFailure(context, name) {
  const dir = process.env.POTYRO_GALLERY_DEBUG;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const [i, page] of context.pages().entries()) await page.screenshot({ path: join(dir, `failed-${name}-${i}.png`) }).catch(() => {});
}

/** The saved apps on this page, as the shell keeps them. @param {import("@playwright/test").Page} page */
async function savedApps(page) {
  return page.evaluate(() => /** @type {Array<{ id: string; name: string }>} */ (JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]")));
}

/**
 * Pack an app under apps/ into a zip, as `pnpm pack:app` does — with the files it ships with and its
 * sample records when it has them: they are what its demo link opens on, and an app without them is
 * an empty screen.
 * @param {{ package: string[]; files?: string; seed?: string }} from @param {string} dir
 */
function pack(from, dir) {
  const [source, ...rest] = from.package.map((f) => resolve(ROOT, f));
  const out = join(dir, "app.potyro-app.zip");
  const shipped = from.files ? ["--files", resolve(ROOT, from.files)] : [];
  const seeded = from.seed ? ["--seed", resolve(ROOT, from.seed)] : [];
  execFileSync(process.execPath, [join(ROOT, "scripts", "pack-app.mjs"), source, ...rest, ...shipped, ...seeded, "-o", out], { cwd: ROOT, stdio: "pipe" });
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
    const zip = pack(from, scratch);
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
 * Potyro's own words in a language, from its catalog (packages/i18n): what a button the script has to
 * press is called on a screen that is not in English. The source text when the catalog has none.
 * @param {string} locale @param {string} words
 */
export function said(locale, words) {
  if (locale === "en") return words;
  const quoted = JSON.stringify(words);
  let po;
  try {
    po = readFileSync(join(ROOT, "packages", "i18n", "locales", locale, "messages.po"), "utf8").split("\n");
  } catch {
    return words;
  }
  const at = po.indexOf(`msgid ${quoted}`);
  const line = at >= 0 ? po[at + 1] : undefined;
  const translated = line?.startsWith("msgstr ") ? JSON.parse(line.slice("msgstr ".length)) : "";
  return translated || words;
}

/**
 * An app that needs a library (Sleep & Mood: chart.js) asks before it opens, as it asks anyone: say
 * yes, the way a visitor does. Returns once either the question was answered or `ready` showed.
 * @param {import("@playwright/test").Page} page @param {import("@playwright/test").Locator} ready
 * @param {string} [locale] the screen's language
 */
async function answerFetch(page, ready, locale = "en") {
  const fetchIt = page.getByRole("button", { name: said(locale, "Fetch and open") });
  await Promise.race([ready.waitFor({ timeout: LONG }), fetchIt.waitFor({ timeout: LONG })]).catch(() => {});
  if (await fetchIt.isVisible()) await fetchIt.click();
}

/**
 * When a page has stopped asking for things: nothing in flight for half a second, or `most` ms at the
 * latest. Counted here rather than left to `waitForLoadState("networkidle")`, which a sealed app's
 * frame resets: it then waited out its whole 30 s on every screen, long after the page was still.
 * @param {import("@playwright/test").Page} page @returns {(most?: number) => Promise<void>}
 */
function watchRequests(page) {
  let flying = 0;
  let last = Date.now();
  const landed = () => {
    flying = Math.max(0, flying - 1);
    last = Date.now();
  };
  page.on("request", () => {
    flying++;
    last = Date.now();
  });
  page.on("requestfinished", landed);
  page.on("requestfailed", landed);
  return async (most = 15_000) => {
    const until = Date.now() + most;
    while (Date.now() < until && (flying > 0 || Date.now() - last < 500)) await page.waitForTimeout(100);
  };
}

/**
 * Press what a selector names, wherever it is: on the page or in one of the app's sealed frames.
 * @param {import("@playwright/test").Page} page @param {string} selector
 */
async function press(page, selector) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    for (const frame of page.frames()) {
      const it = frame.locator(selector).first();
      if (await it.isVisible().catch(() => false)) {
        await it.click();
        return;
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`nothing to press at ${selector}`);
}

/**
 * The link on a stranger's screen, in one language and theme: sealed, named, settled. Returns the page.
 * @param {import("@playwright/test").BrowserContext} context @param {string} link @param {string} locale
 * @param {import("./data.mjs").Staging} [staged] the app's `shot` in gallery.json: what to press first, how long to settle
 */
async function openAsStranger(context, link, locale, staged = {}) {
  const page = await context.newPage();
  const quiet = watchRequests(page);
  await page.goto(link);
  const app = page.locator('.k-app[data-provenance="untrusted"]');
  await answerFetch(page, app, locale);
  await app.waitFor({ timeout: LONG });
  await page.locator("h1").first().waitFor({ state: "visible", timeout: LONG });
  await quiet();
  // The demo bar is the shell's, not the app's: the card shows the app.
  await page.addStyleTag({ content: ".k-demo-bar { display: none !important; } * { caret-color: transparent !important; }" });
  for (const selector of staged.press ?? []) await press(page, selector);
  // A moment for the app to settle — a demo that PLAYS (docs/04 §Demo) is writing its first records
  // now, and Word Watch's first posts took longer than the old 600 ms to land. An app says when it
  // needs longer (`shot.settle`).
  await page.waitForTimeout(staged.settle ?? SETTLE);
  await quiet();
  // Every font and picture on the screen, the sealed frames' too: a shot is never of a half-drawn page.
  for (const frame of page.frames()) {
    await frame
      .evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].filter((i) => i.currentSrc || i.src).map((i) => i.decode().catch(() => undefined))]))
      .catch(() => {});
  }
  return page;
}

/**
 * Open the link as a stranger: it must open sealed, named, without errors, in every language and
 * theme the gallery shows; the remix intent must open the Make it mine card. Returns the screens,
 * as PNG, by language and theme.
 * @param {import("@playwright/test").Browser} browser @param {string} link
 * @param {{ id?: string; shot?: import("./data.mjs").Staging; locales?: readonly string[]; themes?: readonly ("light" | "dark")[] }} [of]
 */
async function verify(browser, link, of = {}) {
  /** @type {{ locale: string; theme: string; png: Buffer }[]} */
  const shots = [];
  let first = true;
  for (const locale of of.locales ?? SHOT_LOCALES) {
    for (const theme of of.themes ?? SHOT_THEMES) {
      const context = await browser.newContext({ locale: BROWSER_LOCALE[locale] ?? locale, viewport: SHOT_VIEWPORT, deviceScaleFactor: SHOT_WIDTHS[SHOT_WIDTHS.length - 1] / SHOT_VIEWPORT.width, colorScheme: theme });
      const errors = watchErrors(context);
      try {
        const page = await openAsStranger(context, link, locale, of.shot);
        shots.push({ locale, theme, png: await page.screenshot({ type: "png" }) });
        if (first) {
          const mine = await context.newPage();
          await mine.goto(remixLink(link));
          // Named in the browser's language; the card is the only dialog a remix link opens.
          const about = mine.getByRole("dialog", { name: "Make it mine" }).getByRole("region", { name: /^About / });
          await answerFetch(mine, about);
          await about.waitFor({ timeout: LONG });
          first = false;
        }
        if (errors.length) throw new Error(`the console said (${locale}, ${theme}):\n  ${errors.join("\n  ")}`);
      } catch (e) {
        await keepFailure(context, `${of.id ?? "app"}-${locale}-${theme}`);
        // What the console said goes with whatever failed: a screen that never drew usually said why.
        if (errors.length && e instanceof Error && !e.message.startsWith("the console said")) e.message += `\n(${locale}, ${theme}) the console said:\n  ${errors.join("\n  ")}`;
        throw e;
      } finally {
        await context.close();
      }
    }
  }
  return shots;
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
  // Pictures only: every link stays, so a link on another site is not a problem — but an app that was
  // never published has no card to put a picture on.
  const apps = publishable(gallery, opts.only).filter((a) => !opts.shotsOnly || a.link);

  const browser = await chromium.launch({ headless: !opts.headed });
  const scratch = mkdtempSync(join(tmpdir(), "potyro-gallery-"));
  /** @type {Outcome[]} */
  const outcomes = [];
  try {
    for (const app of apps) {
      if (!opts.shotsOnly && app.link && !opts.refresh && new URL(app.link).origin === site.origin) {
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
        const shots = await verify(browser, link, { id: app.id, shot: app.shot, locales: opts.locales, themes: opts.themes });
        for (const shot of shots) await writeShot(shot.png, shotsRoot, app.id, shot.locale, shot.theme);
        const screenshot = shotPath(app.id);
        // Pictures only: the link made here was for the occasion; the app keeps the one it has.
        Object.assign(app, opts.shotsOnly ? { screenshot } : { link, screenshot, publishedAt: new Date().toISOString() });
        write();
        log(`${app.id}: ${opts.shotsOnly ? `${shots.length} pictures` : link}`);
        outcomes.push({ id: app.id, outcome: "made", link: app.link });
      } catch (e) {
        await keepFailure(context, `${app.id}-sharing`);
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
    console.error('usage: pnpm gallery:publish --site https://potyro.app [--data gallery/gallery.json] [--only a,b] [--refresh] [--shots-only] [--by "Name"] [--headed]');
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
    shotsOnly: args.includes("--shots-only"),
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
