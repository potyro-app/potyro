import { test, expect, type Page } from "./console-guard";
import AxeBuilder from "@axe-core/playwright";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { publish } from "../gallery/src/publish.mjs";
import { buildGallery } from "../gallery/src/build.mjs";

// The gallery (docs/24 §10). `gallery:publish` makes each ready app's demo link the way a person does,
// against a site — here, this dev server, never potyro.app — and checks each opens for a stranger;
// `gallery:build` turns the data into a static page that asks nothing of anyone else.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };

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
  test.setTimeout(300_000);
  const { dir, data } = scratchGallery(["groceries", "receipt-split", "markdown-notes"]);
  const lines: string[] = [];
  const first = await publish({ site: baseURL!, data, log: (l: string) => lines.push(l) });
  expect(first.map((o: { id: string; outcome: string }) => [o.id, o.outcome])).toEqual([
    ["groceries", "made"],
    ["receipt-split", "made"],
    ["markdown-notes", "made"],
  ]);
  const g = JSON.parse(readFileSync(data, "utf8"));
  // Receipt Split is a package with a seed, Notes one with a seed AND the files it ships with: the
  // publisher packs all of it, so their demos open on a receipt and on four notes (#389).
  for (const id of ["groceries", "receipt-split", "markdown-notes"]) {
    const app = g.apps.find((a: { id: string }) => a.id === id);
    expect(app.link).toMatch(new RegExp(`^${baseURL}/s/[A-Za-z0-9_-]{16,64}#k=[A-Za-z0-9_-]+$`));
    expect(app.screenshot).toBe(`shots/${id}.jpg`);
    expect(readFileSync(join(dir, app.screenshot)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Apps to try, and to make your own.");
    await expect(page.locator("header")).toContainText("Potyro — make the app you need");
    const card = page.locator(".card").first();
    const tryIt = card.getByRole("link", { name: /^Try / });
    const mine = card.getByRole("link", { name: / mine$/ });
    const link = await tryIt.getAttribute("href");
    expect(link).toMatch(/\/s\/[A-Za-z0-9_-]+#k=[A-Za-z0-9_-]+$/);
    expect(await mine.getAttribute("href")).toBe(`${link}&remix=1`);
    await expect(page.getByRole("link", { name: "Report a link" })).toHaveAttribute("href", /^mailto:contact@potyro\.com\?subject=/);
    await expect(page.getByRole("link", { name: "Open Potyro" })).toHaveAttribute("href", "https://potyro.app/");
    await expect(page.getByRole("heading", { name: "On the workbench" })).toBeVisible();

    // Measure colours once the cards have finished rising in: mid-animation text is half transparent,
    // and on a busy CI machine axe caught it there as low contrast.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.getByRole("button", { name: "Switch to dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aplikacje do wypróbowania i do przerobienia na swoje.");
    await expect(page.locator(".card").first().getByRole("link", { name: /^Przerób na swoją: / })).toBeVisible();
    await expect(page.locator("[data-app-name='groceries']").first()).toHaveText("Zakupy");
    await page.getByRole("combobox", { name: "Język" }).selectOption("pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Apps para testar, e para tornar seus.");
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
