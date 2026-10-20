import { expect, type Page } from "./console-guard";
import { addPackage } from "./live-apps";
import { skipWithoutMaps } from "./engines";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The map's taps as the app's own (docs/04): shared by the trusted and the sealed spec, because the
// point is that the SAME app source behaves the same either way — a sealed app's `onSelect` runs in
// its box and reaches the map through `ctx.views`.

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

export function packMapSelect(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "map-select-"));
  copyFileSync(join(FIXTURES, "map-select.app.ts"), join(dir, "map-select.app.ts"));
  const out = join(dir, "map-select.potyro-app.zip");
  execFileSync("node", [join(process.cwd(), "scripts/pack-app.mjs"), "map-select.app.ts", "-o", out], { cwd: dir, env: { ...process.env, INIT_CWD: dir } });
  return readFileSync(out);
}

/** The fixture added as `mine` or sealed, with its three spots made by its own page action. */
export async function openMapSelect(page: Page, mine: boolean): Promise<void> {
  await skipWithoutMaps(page);
  await addPackage(page, "map-select", packMapSelect(), mine);
  await page.getByRole("button", { name: "Add three spots" }).click();
}

export async function mapSelectClaims(page: Page): Promise<void> {
  const cards = page.locator(".k-map-strip > li");
  await expect(cards).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator(".k-map-strip > li[data-selected]")).toHaveCount(0);

  // A card tapped: the app's onSelect — its pin comes to the front and the map goes to it, and NO
  // record opens (the view's default would have opened it).
  const second = cards.nth(1);
  const name = ((await second.locator(".k-map-card-title").textContent()) ?? "").trim();
  await second.locator(".k-map-card").click();
  await expect(page.getByRole("dialog", { name: "Spot" })).toHaveCount(0);
  const chosen = page.locator(".k-map-strip > li[data-selected]");
  await expect(chosen).toHaveCount(1);
  await expect(chosen.locator(".k-map-card-title")).toHaveText(name);
  await expect(page.locator(".maplibregl-marker[data-selected]")).toHaveCount(1);

  // The one in front, tapped again: the app opens it through ctx.views.map().open.
  await chosen.locator(".k-map-card").click();
  const sheet = page.getByRole("dialog", { name: "Spot" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".k-detail-title")).toHaveText(name);
  await page.locator(".k-map-sheet-close").click();
  await expect(sheet).toHaveCount(0);

  // A page action reaching the map: select by id.
  await page.getByRole("button", { name: "Pick Bar B" }).click();
  await expect(page.locator(".k-map-strip > li[data-selected] .k-map-card-title")).toHaveText("Bar B");
}
