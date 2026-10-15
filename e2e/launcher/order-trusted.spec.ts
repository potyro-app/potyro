import { test, expect, type Locator, type Page } from "../console-guard";
import { openHome, seed } from "./fixture.js";

// Arranging the Start screen (#96, which replaced #84's pinned row and sort switch): hold a tile and
// the wall is yours to arrange — sizes, order, groups — by finger, by mouse and by keyboard, kept on
// this device across reloads. A scroll is still a scroll.

const keys = (page: Page): Promise<string[]> => page.locator(".k-metro-wall .k-metro-cell[data-key]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key!));
const cell = (page: Page, key: string): Locator => page.locator(`.k-metro-wall .k-metro-cell[data-key="${key}"]`);
const tile = (page: Page, key: string): Locator => cell(page, key).locator(".k-metro-tile");
const editing = (page: Page): Locator => page.locator(".k-metro-wall[data-editing]");
/** The wall as stored, so a claim about persistence is about storage and not about the screen. */
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("potyro:launcher:wall") ?? "{}") as { items: { kind: string; key?: string; size?: string; id?: string; name?: string; tiles?: { key: string }[] }[] });

async function cdpTouch(page: Page) {
  return page.context().newCDPSession(page);
}

/** A finger: hold for `holdMs`, then move to `to`'s point, then let go. */
async function touchDrag(page: Page, from: Locator, dest: { x: number; y: number } | (() => Promise<{ x: number; y: number }>), holdMs = 650): Promise<void> {
  // To the middle of the screen: the bars at the bottom are fixed, and a finger cannot reach under them.
  await from.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const a = (await from.boundingBox())!;
  const to = typeof dest === "function" ? await dest() : dest;
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cdp = await cdpTouch(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  await page.waitForTimeout(holdMs);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + ((to.x - start.x) * i) / steps, y: start.y + ((to.y - start.y) * i) / steps }] });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("a hold is edit mode; a size and a move by finger survive a reload; a flick only scrolls", async ({ page }) => {
    await openHome(page);
    await expect(tile(page, "user:trips")).toBeVisible({ timeout: 30_000 });
    const before = await keys(page);

    // A flick without the hold: nothing is picked up, nothing moves, no edit mode.
    const box = (await tile(page, "user:trips").boundingBox())!;
    const cdp = await cdpTouch(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 20, y: box.y + 20 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 20, y: box.y - 150 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    expect(await keys(page)).toEqual(before);
    await expect(editing(page)).toHaveCount(0);

    // Hold Trips: edit mode, Trips chosen, the edit bar in the app bar's place.
    await touchDrag(page, tile(page, "user:trips"), { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 700);
    await expect(editing(page)).toBeVisible();
    await expect(tile(page, "user:trips")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("radio", { name: /wide/i }).tap();
    await expect(cell(page, "user:trips")).toHaveAttribute("data-size", "wide");

    // Carry Trips to the left edge of the tile before it: it goes before that one.
    const was = (await keys(page)).indexOf("user:trips");
    const neighbourKey = (await keys(page))[was - 1]!;
    await touchDrag(
      page,
      tile(page, "user:trips"),
      async () => {
        const target = (await tile(page, neighbourKey).boundingBox())!;
        return { x: target.x + 3, y: target.y + target.height / 2 };
      },
      300,
    );
    await expect.poll(async () => (await keys(page)).indexOf("user:trips")).toBe(was - 1);
    await page.getByRole("button", { name: /^done$/i }).tap();
    await expect(editing(page)).toHaveCount(0);

    const after = await keys(page);
    await page.reload();
    await expect(tile(page, "user:trips")).toBeVisible({ timeout: 30_000 });
    expect(await keys(page)).toEqual(after);
    await expect(cell(page, "user:trips")).toHaveAttribute("data-size", "wide");
  });
});

test.describe("with a mouse and a keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("drop a tile on another to make a group; rename it; take one out; all of it kept", async ({ page }) => {
    await openHome(page);
    await expect(tile(page, "user:books")).toBeVisible({ timeout: 30_000 });
    // A right click is the hold.
    await tile(page, "user:books").click({ button: "right" });
    await expect(editing(page)).toBeVisible();
    // Carry Books onto the middle of Trips.
    const from = (await tile(page, "user:books").boundingBox())!;
    const to = (await tile(page, "user:trips").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(cell(page, "user:trips")).toHaveAttribute("data-drop", "onto");
    await page.mouse.up();
    const group = page.locator(".k-metro-group", { has: page.locator(`.k-metro-cell[data-key="user:trips"]`) });
    await expect(group.locator(".k-metro-cell")).toHaveCount(2);
    await expect(group.locator('[data-key="user:books"]')).toHaveCount(1);

    // Name it: choose the group by its header, then Rename.
    await group.locator(".k-metro-group-name").click();
    await page.getByRole("button", { name: /^rename$/i }).click();
    const dialog = page.locator(".k-dialog", { hasText: "Name this group" });
    await dialog.locator("input").fill("Reading");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(page.getByRole("region", { name: "Reading" })).toBeVisible();
    await page.getByRole("button", { name: /^done$/i }).click();

    await page.reload();
    const reading = page.getByRole("region", { name: "Reading" });
    await expect(reading).toBeVisible({ timeout: 30_000 });
    await expect(reading.locator(".k-metro-cell")).toHaveCount(2);
    const saved = (await stored(page)).items.find((i) => i.kind === "group" && i.name === "Reading");
    expect(saved?.tiles?.map((t) => t.key).sort()).toEqual(["user:books", "user:trips"]);

    // Take Books out again.
    await tile(page, "user:books").click({ button: "right" });
    await page.getByRole("button", { name: /^ungroup$/i }).click();
    await page.getByRole("button", { name: /^done$/i }).click();
    await page.reload();
    await expect(tile(page, "user:books")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Reading" }).locator('[data-key="user:books"]')).toHaveCount(0);
  });

  test("the keyboard path: arrows walk the wall, Shift+F10 arranges, Alt+arrows move, sizes and groups from the bar", async ({ page }) => {
    await openHome(page);
    await expect(tile(page, "user:books")).toBeVisible({ timeout: 30_000 });
    // The wall is one stop for Tab; arrows walk it.
    const first = (await keys(page))[0]!;
    await tile(page, first).focus();
    await expect(tile(page, first)).toBeFocused();
    await expect(page.locator(".k-metro-wall .k-metro-tile[tabindex='0']")).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(tile(page, first)).not.toBeFocused();

    await tile(page, "user:books").focus();
    await page.keyboard.press("Shift+F10");
    await expect(editing(page)).toBeVisible();
    await expect(tile(page, "user:books")).toHaveAttribute("aria-pressed", "true");
    const at = async () => (await keys(page)).indexOf("user:books");
    const was = await at();
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(at).toBe(was + 1);
    await expect(page.locator(".k-metro-wall ~ [aria-live]")).toContainText(/Moved Books to position/);
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(at).toBe(was);

    // The edit bar: Medium, then Group (with the next tile).
    await page.getByRole("radio", { name: /medium/i }).focus();
    await page.keyboard.press("Enter");
    await expect(cell(page, "user:books")).toHaveAttribute("data-size", "medium");
    await page.getByRole("button", { name: /^group$/i }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".k-metro-group", { has: page.locator(`.k-metro-cell[data-key="user:books"]`) })).toHaveCount(1);

    // Escape is done; Delete would have unpinned. All of it was written as it happened.
    await tile(page, "user:books").focus();
    await page.keyboard.press("Escape");
    await expect(editing(page)).toHaveCount(0);
    const wall = await stored(page);
    expect(wall.items.some((i) => i.kind === "group" && i.tiles?.some((t) => t.key === "user:books"))).toBe(true);
  });

  test("unpin takes a tile off Start, All apps keeps it, and Pin to Start brings it back", async ({ page }) => {
    await openHome(page);
    await expect(tile(page, "user:budget")).toBeVisible({ timeout: 30_000 });
    await tile(page, "user:budget").focus();
    await page.keyboard.press("Shift+F10");
    await page.keyboard.press("Delete");
    await expect(cell(page, "user:budget")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(tile(page, "user:books")).toBeVisible({ timeout: 30_000 });
    await expect(cell(page, "user:budget")).toHaveCount(0);
    await page.getByRole("tab", { name: "All apps" }).click();
    await page.getByRole("button", { name: "Pin Budget to Start" }).click();
    await page.getByRole("tab", { name: "Start" }).click();
    await expect(cell(page, "user:budget")).toBeVisible();
  });

  test("an app that says what kind it is lands in that group — made for the first one, joined by the next", async ({ page }) => {
    const game = (id: string, name: string) => ({
      id,
      name,
      source:
        `import { defineApp } from "potyro";\nexport default defineApp({ id: "${id}", name: "${name}", version: "1.0.0", schemaVersion: 1, category: "games",\n` +
        `  entities: { item: { fields: { title: { type: "text" } } } },\n  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item" } }] });\n`,
      updatedAt: new Date(0).toISOString(),
      trusted: true,
    });
    await page.addInitScript(
      ([list]) => {
        const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string }[];
        if (!apps.some((a) => a.id === "snake")) localStorage.setItem("potyro:user-apps", JSON.stringify([...apps, ...list]));
      },
      [[game("snake", "Snake"), game("chess", "Chess")]] as const,
    );
    await openHome(page);
    const games = page.getByRole("region", { name: "Games" });
    await expect(games).toBeVisible({ timeout: 30_000 });
    await expect(games.locator(".k-metro-cell")).toHaveCount(2);
    // The others stay where they were: loose, or in Everyday.
    await expect(games.locator('[data-key="user:books"]')).toHaveCount(0);
  });
});
