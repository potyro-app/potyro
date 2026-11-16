import { test, expect, type Page } from "./console-guard";
import AxeBuilder from "@axe-core/playwright";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { publish } from "../gallery/src/publish.mjs";
import { SHOT_LOCALES, shotFiles, shotPath } from "../gallery/src/data.mjs";
import { buildGallery } from "../gallery/src/build.mjs";

// The gallery (docs/24 §10). `gallery:publish` makes each ready app's demo link the way a person does,
// against a site — here, this dev server, never potyro.app — and checks each opens for a stranger;
// `gallery:build` turns the data into a static page that asks nothing of anyone else.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif" };

/** The built folder, served as Caddy would: files only, nothing outside it. */
function serve(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dir, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` })));
}

/** A copy of the gallery with only these apps ready, in a folder of its own. */
function scratchGallery(only: string[]): { dir: string; data: string } {
  const dir = mkdtempSync(join(tmpdir(), "potyro-gallery-"));
  const data = join(dir, "gallery.json");
  const g = JSON.parse(readFileSync(join(ROOT, "gallery", "gallery.json"), "utf8"));
  g.apps = g.apps.filter((a: { status: string; id: string }) => a.status !== "ready" || only.includes(a.id));
  writeFileSync(data, JSON.stringify(g, null, 2));
  return { dir, data };
}

const PUBLISHED = mkdtempSync(join(tmpdir(), "potyro-gallery-shown-"));

test.describe.configure({ mode: "serial" });

test("gallery:publish makes each link through the share flow, checks it opens for a stranger, and keeps it when run again", async ({ baseURL, browserName }) => {
  test.skip(browserName !== "chromium", "the script drives its own Chromium; one run proves it");
  // Each app is opened once per language and theme the gallery shows (#33), and each screen encoded.
  test.setTimeout(540_000);
  const { dir, data } = scratchGallery(["groceries", "receipt-split", "markdown-notes"]);
  const lines: string[] = [];
  const first = await publish({ site: baseURL!, data, log: (l: string) => lines.push(l) });
  const g = JSON.parse(readFileSync(data, "utf8"));
  // In the gallery's own order (gallery.json is the page's order, #501), each one made.
  const ready = g.apps.filter((a: { status: string }) => a.status === "ready").map((a: { id: string }) => a.id);
  expect(ready).toHaveLength(3);
  expect(first.map((o: { id: string; outcome: string }) => [o.id, o.outcome]), lines.join("\n")).toEqual(ready.map((id: string) => [id, "made"]));
  // Receipt Split is a package with a seed, Notes one with a seed AND the files it ships with: the
  // publisher packs all of it, so their demos open on a receipt and on four notes (#389).
  for (const id of ["groceries", "receipt-split", "markdown-notes"]) {
    const app = g.apps.find((a: { id: string }) => a.id === id);
    expect(app.link).toMatch(new RegExp(`^${baseURL}/s/[A-Za-z0-9_-]{16,64}#k=[A-Za-z0-9_-]+$`));
    // Its pictures (#33): light and dark, in every language the gallery shoots, AVIF and WebP, 1x and 2x.
    expect(app.screenshot).toBe(shotPath(id));
    expect(readFileSync(join(dir, app.screenshot)).subarray(0, 4).toString("latin1")).toBe("RIFF");
    for (const locale of SHOT_LOCALES) for (const f of shotFiles(id, locale)) expect(existsSync(join(dir, f)), f).toBe(true);
  }
  // Nothing is on the workbench any more (2026-10-20): the publisher names none as left alone.
  expect(lines.join("\n")).not.toMatch(/coming soon, not published/);
  expect(g.apps.filter((a: { status: string; link?: string }) => a.status === "coming-soon" && a.link)).toEqual([]);

  // Again: nothing new is made.
  const again = await publish({ site: baseURL!, data, log: () => {} });
  expect(again.map((o: { outcome: string }) => o.outcome)).toEqual(["kept", "kept", "kept"]);
  expect(JSON.parse(readFileSync(data, "utf8")).apps.find((a: { id: string }) => a.id === "groceries").link).toBe(g.apps.find((a: { id: string }) => a.id === "groceries").link);

  // What the page tests below show.
  buildGallery({ data, out: join(PUBLISHED, "site"), allowLocal: true });
  mkdirSync(join(PUBLISHED, "shots"), { recursive: true });
  copyFileSync(data, join(PUBLISHED, "gallery.json"));
});

/** The built page, served; built from the run above when there was one, else from a fixture with one app. */
async function openGallery(page: Page, opts: { locale?: string } = {}) {
  let site = join(PUBLISHED, "site");
  if (!existsSync(join(site, "index.html"))) {
    // Firefox runs only the page's tests: a gallery with one published app, its link a well-formed demo link.
    const { dir, data } = scratchGallery(["groceries"]);
    const g = JSON.parse(readFileSync(data, "utf8"));
    const groceries = g.apps.find((a: { id: string }) => a.id === "groceries");
    groceries.link = "https://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv#k=Zm9vYmFy";
    groceries.screenshot = "shots/groceries.png";
    mkdirSync(join(dir, "shots"));
    // A real picture, so every engine decodes it: Potyro's own icon stands in for a screenshot.
    copyFileSync(join(ROOT, "packages", "shell", "public", "icon-192.png"), join(dir, "shots", "groceries.png"));
    writeFileSync(data, JSON.stringify(g));
    site = join(dir, "site");
    buildGallery({ data, out: site });
  }
  const { server, url } = await serve(site);
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(url) && !r.url().startsWith("data:")) foreign.push(r.url());
  });
  if (opts.locale) await page.context().setExtraHTTPHeaders({ "accept-language": opts.locale });
  await page.goto(url);
  return { server, url, foreign };
}

test("the gallery page: accessible, asks nothing of anyone else, Try it and Make it mine on every card", async ({ page }) => {
  const { server, foreign } = await openGallery(page);
  try {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Describe it. Done, it's an app.");
    // The header is the wordmark (the logo file, named for readers) and the one rosa call to action.
    await expect(page.locator("header").getByRole("img", { name: "Potyro" })).toBeVisible();
    await expect(page.locator("header").getByRole("link", { name: "Create my app" })).toHaveAttribute("href", "https://potyro.app/");
    const card = page.locator(".card").first();
    const tryIt = card.getByRole("link", { name: /^Try / });
    const mine = card.getByRole("link", { name: / mine$/ });
    const link = await tryIt.getAttribute("href");
    expect(link).toMatch(/\/s\/[A-Za-z0-9_-]+#k=[A-Za-z0-9_-]+$/);
    expect(await mine.getAttribute("href")).toBe(`${link}&remix=1`);
    // The report address of the terms (`abuse` in packages/shell/src/contacts.json), filled in on 2026-11-01.
    await expect(page.getByRole("link", { name: "Report a link" })).toHaveAttribute("href", /^mailto:abuse@potyro\.com\?subject=/);
    await expect(page.getByRole("link", { name: "Open Potyro" })).toHaveAttribute("href", "https://potyro.app/");
    // The workbench is empty since 2026-10-20: the page leaves the section out, heading and all.
    await expect(page.getByRole("heading", { name: "On the workbench" })).toHaveCount(0);

    // Measure colours once the cards have finished rising in: mid-animation text is half transparent,
    // and on a busy CI machine axe caught it there as low contrast.
    // Only the ones that end: the closing's clock (the "y" taking the next hour) runs for ever.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    // The card's picture is the light one on a light device, and its size is in the markup (#33).
    const shot = card.locator("img");
    const shown = () => shot.evaluate((img: HTMLImageElement) => img.currentSrc);
    const isSet = (await card.locator("picture").count()) > 0;
    if (isSet) {
      await expect.poll(shown).toMatch(/shots\/en\/[\w-]+-light-(412|824)\.(avif|webp)$/);
      await expect(shot).toHaveAttribute("width", "412");
      await expect(shot).toHaveAttribute("height", "860");
    }
    await page.getByRole("button", { name: "Switch to dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // The theme chosen on the page beats the device's: the picture is the dark one.
    if (isSet) await expect.poll(shown).toMatch(/shots\/en\/[\w-]+-dark-(412|824)\.(avif|webp)$/);
    // Only the ones that end: the closing's clock (the "y" taking the next hour) runs for ever.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    const dark = await new AxeBuilder({ page }).analyze();
    expect(dark.violations.map((v) => v.id)).toEqual([]);
    expect(foreign).toEqual([]);
  } finally {
    server.close();
  }
});

test("the gallery speaks the browser's language, and another when asked", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["pl-PL", "pl"] }));
  const { server } = await openGallery(page);
  try {
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Opisz. Gotowe, masz aplikację.");
    await expect(page.locator(".card").first().getByRole("link", { name: /^Przerób na swoją: / })).toBeVisible();
    await expect(page.locator("[data-app-name='groceries']").first()).toHaveText("Zakupy");
    // Polish has no pictures of its own: the card shows the first language's.
    const shot = page.locator(".card").first().locator("img");
    const isSet = (await page.locator(".card").first().locator("picture").count()) > 0;
    if (isSet) await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/\/shots\/en\//);
    await page.getByRole("combobox", { name: "Język" }).selectOption("pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Descreva. Pronto, é um app.");
    // Portuguese was shot: the picture is the app in Portuguese.
    if (isSet) await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/\/shots\/pt-BR\//);
    // Remembered on this browser only.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  } finally {
    server.close();
  }
});

test("screenshots of the gallery for the PR", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium" || !process.env.POTYRO_GALLERY_SHOTS, "only when asked, into POTYRO_GALLERY_SHOTS");
  const out = process.env.POTYRO_GALLERY_SHOTS!;
  const site = process.env.POTYRO_GALLERY_SITE;
  const { server, url } = site ? await serve(site) : await openGallery(page);
  try {
    for (const [name, viewport, scheme] of [
      ["gallery-412-light", { width: 412, height: 915 }, "light"],
      ["gallery-412-dark", { width: 412, height: 915 }, "dark"],
      ["gallery-1440-light", { width: 1440, height: 900 }, "light"],
      ["gallery-1440-dark", { width: 1440, height: 900 }, "dark"],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      // Every screenshot in the picture, not only the ones above the fold.
      await page.evaluate(() => document.querySelectorAll("img").forEach((i) => (i.loading = "eager")));
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))));
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
    }
  } finally {
    server.close();
  }
});
