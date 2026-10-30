import { test, expect, type Page } from "./console-guard";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_RELAY } from "./ports";
import { freePort } from "./live-servers";
import { tileAction } from "./launcher-actions";
import { studioOf } from "./studio-helpers";

// The privacy page and the terms of use (#117). docs/legal still has the owner's placeholders, so the
// suite's own dev server must have no pages and no links: that is the gate, and what potyro.app gets
// today. A second dev server, started here on copies of the texts with every placeholder filled in,
// is what the site gets once the owner has filled them: /privacy and /terms are real pages, styled,
// with no script, and the app links them where people decide something about their data.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WINDOWS = process.platform === "win32";
const PNPM = WINDOWS ? "pnpm.cmd" : "pnpm";

/** The texts as the owner will leave them: the placeholders filled, the draft note gone. */
function finishedTexts(): string {
  const dir = mkdtempSync(join(tmpdir(), "potyro-legal-e2e-"));
  for (const page of ["privacy", "terms"]) {
    const md = readFileSync(join(ROOT, "docs", "legal", `${page}.md`), "utf8")
      .replace(/^> \*\*Draft\.\*\*[^\n]*\n(?:>[^\n]*\n)*/m, "")
      .replace(/<CONTACT EMAIL>/g, "privacy@example.org")
      .replace(/<ABUSE EMAIL>/g, "abuse@example.org")
      .replace(/<DATE>/g, "1 November 2026")
      .replace(/<[A-Z][^<>\n]*>/g, "a year");
    writeFileSync(join(dir, `${page}.md`), md);
  }
  return dir;
}

async function openYou(page: Page) {
  await page.goto("/");
  await expect(page.locator(".k-launcher")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "You and your devices" }).click();
  const panel = page.getByRole("dialog", { name: "You and your devices" });
  await expect(panel.getByRole("heading", { name: "Your devices" })).toBeVisible();
  return panel;
}

test.describe.configure({ mode: "serial" });

test("while the texts wait for the owner: no pages, and no link to one anywhere", async ({ page, request }) => {
  // The path falls through to the app, as on potyro.app today (docs/legal/facts.md F-65).
  for (const path of ["/privacy", "/terms"]) expect(await (await request.get(path)).text()).not.toContain("data-legal=");
  const panel = await openYou(page);
  await expect(panel.locator(".k-legal-link")).toHaveCount(0);
  await panel.getByRole("button", { name: "Close" }).click();
  await tileAction(page, "Groceries", "share-sheet");
  const sheet = page.locator(".k-share-sheet");
  await expect(sheet.getByRole("heading", { name: "A link anyone can try" })).toBeVisible();
  await expect(sheet.locator(".k-legal-link")).toHaveCount(0);
});

test.describe("once the texts are finished", () => {
  let server: ChildProcess | null = null;
  let origin = "";

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const port = await freePort();
    origin = `http://localhost:${port}`;
    const env = {
      ...process.env,
      POTYRO_LEGAL_DIR: finishedTexts(),
      VITE_POTYRO_DEV_RELAY: E2E_RELAY,
      POTYRO_VITE_CACHE_DIR: `${process.env.POTYRO_VITE_CACHE_DIR || "node_modules/.vite-e2e/local"}-legal`,
    };
    const args = ["--filter", "@potyro/shell", "exec", "vite", "--port", String(port), "--strictPort"];
    server = WINDOWS ? spawn(`${PNPM} ${args.join(" ")}`, { cwd: ROOT, env, stdio: "ignore", shell: true }) : spawn(PNPM, args, { cwd: ROOT, env, stdio: "ignore", detached: true });
    const deadline = Date.now() + 150_000;
    for (;;) {
      const up = await fetch(origin).then((r) => r.ok, () => false);
      if (up) break;
      if (Date.now() > deadline) throw new Error(`the dev server with the finished texts did not start on ${port}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test.afterAll(() => {
    if (!server?.pid) return;
    // The whole tree: pnpm runs Vite as a child, and killing the shim leaves the port held.
    if (WINDOWS) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        server.kill("SIGKILL");
      }
    }
    server = null;
  });

  test("/privacy and /terms are the texts, on the design system, with no script", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, javaScriptEnabled: false });
    const page = await context.newPage();
    for (const path of ["/privacy", "/privacy/"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
      await expect(page.getByRole("heading", { name: "Who runs Potyro" })).toBeVisible();
      await expect(page.getByText("privacy@example.org").first()).toBeVisible();
      await expect(page.locator("script")).toHaveCount(0);
      // The design system's fonts and colours, from the page's own stylesheets.
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Figtree/);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector("h1")!).fontFamily)).toMatch(/^"?Quicksand/);
      // The review notes are not on the page.
      await expect(page.locator("body")).not.toContainText("facts.md F-");
    }
    // From one text to the other, and to the section the terms point at.
    await page.getByRole("navigation", { name: "Potyro's terms" }).getByRole("link", { name: "Terms of use" }).click();
    await expect(page).toHaveURL(`${origin}/terms`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of use");
    await page.getByRole("link", { name: "privacy page" }).last().click();
    await expect(page).toHaveURL(`${origin}/privacy#your-rights`);
    await expect(page.getByRole("heading", { name: "Your rights" })).toBeVisible();
    // On a phone, nothing scrolls sideways: the tables scroll inside themselves.
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await context.close();
  });

  test("the app links them: You, the share sheet, Model settings", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();

    const panel = await openYou(page);
    const links = panel.getByRole("navigation", { name: "Privacy and terms" });
    await expect(links.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", `${origin}/privacy`);
    await expect(links.getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", `${origin}/terms`);
    await expect(panel.getByRole("link", { name: "What backup keeps on Potyro’s server" })).toHaveAttribute("href", `${origin}/privacy#sync-sharing-with-people-and-backup`);
    // It opens beside Potyro, and is the page, not the app.
    const [opened] = await Promise.all([context.waitForEvent("page"), links.getByRole("link", { name: "Privacy" }).click()]);
    await expect(opened.getByRole("heading", { level: 1 })).toHaveText("Privacy");
    await opened.close();
    await panel.getByRole("button", { name: "Close" }).click();

    await tileAction(page, "Groceries", "share-sheet");
    const sheet = page.locator(".k-share-sheet");
    await expect(sheet.getByRole("link", { name: "What a link makes public, and for how long" })).toHaveAttribute("href", `${origin}/privacy#links-anyone-can-try`);
    await expect(sheet.getByRole("link", { name: "What sharing keeps on Potyro’s server" })).toHaveAttribute("href", `${origin}/privacy#sync-sharing-with-people-and-backup`);
    await page.locator(".k-modal-scrim").click({ position: { x: 4, y: 4 } });
    await expect(sheet).toHaveCount(0);

    await page.getByRole("button", { name: /New app/ }).first().click();
    const studio = studioOf(page);
    await studio.getByRole("button", { name: "Model settings" }).click();
    const settings = page.getByRole("dialog", { name: "Model settings" });
    await expect(settings.getByRole("link", { name: "What leaves your device with each choice" })).toHaveAttribute("href", `${origin}/privacy#building-apps-in-the-studio-and-ask`);
    await context.close();
  });
});
