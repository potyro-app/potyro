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

// The privacy page and the terms of use (#117). Two dev servers, started here on copies of the texts:
// one unfinished (a placeholder left, the Draft note on), which must have no pages and no links —
// the gate, and what a site gets while the owner has not finished them; and one with every
// placeholder filled in, which is what the site gets once they are: /privacy and /terms are real
// pages, styled, with no script, and the app links them where people decide something about their
// data. Neither depends on the state of docs/legal itself, so finishing the texts changes no test.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WINDOWS = process.platform === "win32";
const PNPM = WINDOWS ? "pnpm.cmd" : "pnpm";

/** The texts as the owner will leave them: the placeholders filled, the draft note gone, the date set. */
function finished(page: string): string {
  return readFileSync(join(ROOT, "docs", "legal", `${page}.md`), "utf8")
    .replace(/^> \*\*Draft\.\*\*[^\n]*\n(?:>[^\n]*\n)*/m, "")
    // The real addresses (filled in on 2026-11-01) become example ones, so the fixtures do not depend on them.
    .replace(/<CONTACT EMAIL>|contact@potyro\.com/g, "privacy@example.org")
    .replace(/<ABUSE EMAIL>|abuse@potyro\.com/g, "abuse@example.org")
    .replace(/<DATE>/g, "2026-11-01")
    .replace(/<[A-Z][^<>\n]*>/g, "a year");
}

/** A folder of copies: finished, or (`unfinished`) with a placeholder left and the Draft note, as the texts are before the owner is done. */
function texts(kind: "finished" | "unfinished"): string {
  const dir = mkdtempSync(join(tmpdir(), `potyro-legal-e2e-${kind}-`));
  for (const page of ["privacy", "terms"]) {
    const md = finished(page);
    writeFileSync(join(dir, `${page}.md`), kind === "finished" ? md : `> **Draft.** Not in force yet.\n\n${md.replace("privacy@example.org", "<CONTACT EMAIL>")}`);
  }
  return dir;
}

/** A dev server of the shell on its own port, reading the texts in `legalDir`. */
async function startShell(legalDir: string, name: string): Promise<{ origin: string; stop: () => void }> {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const env = {
    ...process.env,
    POTYRO_LEGAL_DIR: legalDir,
    VITE_POTYRO_DEV_RELAY: E2E_RELAY,
    POTYRO_VITE_CACHE_DIR: `${process.env.POTYRO_VITE_CACHE_DIR || "node_modules/.vite-e2e/local"}-legal-${name}`,
  };
  const args = ["--filter", "@potyro/shell", "exec", "vite", "--port", String(port), "--strictPort"];
  const server: ChildProcess = WINDOWS ? spawn(`${PNPM} ${args.join(" ")}`, { cwd: ROOT, env, stdio: "ignore", shell: true }) : spawn(PNPM, args, { cwd: ROOT, env, stdio: "ignore", detached: true });
  const stop = () => {
    if (!server.pid) return;
    // The whole tree: pnpm runs Vite as a child, and killing the shim leaves the port held.
    if (WINDOWS) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        server.kill("SIGKILL");
      }
    }
  };
  const deadline = Date.now() + 150_000;
  for (;;) {
    const up = await fetch(origin).then((r) => r.ok, () => false);
    if (up) return { origin, stop };
    if (Date.now() > deadline) {
      stop();
      throw new Error(`the dev server with the ${name} texts did not start on ${port}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Every element's laid-out height, so a tap target under 44px names itself. The layout box, not the
 * bounding box: a panel still easing in is scaled, and its links would measure a fraction short.
 */
async function heights(locator: import("@playwright/test").Locator): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const el of await locator.all()) out[(await el.textContent())?.trim() ?? "?"] = await el.evaluate((e) => (e as HTMLElement).offsetHeight);
  return out;
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

test.describe("while the texts wait for the owner", () => {
  let shell: Awaited<ReturnType<typeof startShell>> | null = null;
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    shell = await startShell(texts("unfinished"), "unfinished");
  });
  test.afterAll(() => shell?.stop());

  test("no pages, and no link to one anywhere", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: shell!.origin });
    const page = await context.newPage();
    // The path falls through to the app, as on potyro.app today (docs/legal/facts.md F-65).
    for (const path of ["/privacy", "/terms"]) expect(await (await context.request.get(path)).text()).not.toContain("data-legal=");
    const panel = await openYou(page);
    await expect(panel.locator(".k-legal-link")).toHaveCount(0);
    await panel.getByRole("button", { name: "Close" }).click();
    await tileAction(page, "Groceries", "share-sheet");
    const sheet = page.locator(".k-share-sheet");
    await expect(sheet.getByRole("heading", { name: "A link anyone can try" })).toBeVisible();
    await expect(sheet.locator(".k-legal-link")).toHaveCount(0);
    await context.close();
  });
});

test.describe("once the texts are finished", () => {
  let shell: Awaited<ReturnType<typeof startShell>> | null = null;
  let origin = "";

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    shell = await startShell(texts("finished"), "finished");
    origin = shell.origin;
  });

  test.afterAll(() => shell?.stop());

  test("/privacy and /terms are the texts, on the design system, with no script", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, javaScriptEnabled: false });
    const page = await context.newPage();
    // Every file a page loads (its stylesheets, fonts and logos, by their hashed names) is there.
    const missing: string[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname.startsWith("/legal/") && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
    });
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
    // Every control on the page is a 44px target, and "Open Potyro" is the app. Measured once the
    // page's stylesheets are in: the click above resolves when the URL changes, before they load.
    await page.waitForLoadState("load");
    for (const [label, h] of Object.entries(await heights(page.locator(".pages a, .foot a")))) expect(h, label).toBeGreaterThanOrEqual(44);
    await expect(page.locator(".foot").getByRole("link", { name: "Open Potyro" })).toHaveAttribute("href", "../");
    // On a phone, nothing scrolls sideways: the tables scroll inside themselves.
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    // The fonts came from their hashed names in tokens.css, and none failed.
    // Asked again until it is so, never awaited inside the page: scripts are off in this context, and
    // with them off Firefox never settles a promise the page made (`document.fonts.ready`), so an
    // evaluate that waits on one hangs until the test's own timeout.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const all = [...document.fonts];
          return { figtree: all.some((f) => f.family.replace(/"/g, "") === "Figtree" && f.status === "loaded"), failed: all.filter((f) => f.status === "error").length };
        }),
      )
      .toEqual({ figtree: true, failed: 0 });
    expect(missing).toEqual([]);
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
    // Quiet links, but each a 44px target.
    for (const [label, h] of Object.entries(await heights(panel.locator(".k-legal-link")))) expect(h, label).toBeGreaterThanOrEqual(44);
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
