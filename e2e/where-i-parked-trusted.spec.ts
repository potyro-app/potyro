import { test, expect } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { makeDemoLink, stranger } from "./share-demo";

// apps/where-i-parked, packed as its build packs it: one tap keeps the spot where the device says it
// is; back later, the screen says how far and which way; Found it puts it in the history. The
// device's position is the test's to set, and the app reads it only through ctx.caps.geo.

const CAR = { latitude: 52.5163, longitude: 13.3777 };
// ~300 m north-east of the car.
const AWAY = { latitude: 52.5182, longitude: 13.3808 };

test("one tap parks the car where you are; back later it says how far and which way; Found it ends it", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(CAR);
  await addAsMine(page, "where-i-parked.potyro-app.zip", packApp("where-i-parked", "where-i-parked.app.tsx"));

  const main = page.getByRole("main");
  if (process.env.SHOT_EMPTY) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(main.getByRole("button", { name: "I parked here" })).toBeVisible();
    await page.screenshot({ path: process.env.SHOT_EMPTY });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await main.getByRole("button", { name: "I parked here" }).click();
  const card = main.getByRole("region", { name: "Spot" });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Parked (now|this minute|\d+ seconds? ago|in \d+ seconds?)/);

  // Standing by the car: no distance, just "right by it".
  await card.getByRole("button", { name: "Find my car" }).click();
  await expect(card.getByRole("status")).toContainText("You are right by it.");

  // A walk away: how far, and which way, from the device's new position — standing north-east of
  // the car, the car is to the south-west.
  await context.setGeolocation(AWAY);
  await card.getByRole("button", { name: "Where am I now?" }).click();
  await expect(card.getByRole("status")).toContainText(/\d+ m to the south-west/);
  await expect(card.getByRole("link", { name: /Open in a map/ })).toHaveAttribute("href", /openstreetmap\.org\/\?mlat=52\.5163&mlon=13\.3777/);

  // A note, through the shell's own prompt.
  await main.getByRole("button", { name: "Add a note" }).click();
  const prompt = page.locator(".k-dialog", { hasText: "Where exactly?" });
  await prompt.locator("input").fill("Level 3, near the lift");
  await prompt.getByRole("button", { name: "OK" }).click();
  await expect(card).toContainText("Level 3, near the lift");
  await expect(main.getByRole("button", { name: "Change the note" })).toBeVisible();

  await card.getByRole("button", { name: "Found it" }).click();
  await expect(main.getByRole("button", { name: "I parked here" })).toBeVisible();
  await page.getByRole("button", { name: "History" }).first().click();
  await expect(main.locator(".k-list-row").filter({ hasText: "Level 3, near the lift" })).toBeVisible();
});

test("a demo opens on a parked car, sealed, with the spot's card", async ({ page, browser, baseURL }) => {
  await addAsMine(page, "where-i-parked.potyro-app.zip", packApp("where-i-parked", "where-i-parked.app.tsx"));
  const link = await makeDemoLink(page, "Where I parked");
  const { context, page: viewer } = await stranger(browser, baseURL!, { viewport: { width: 390, height: 844 } });
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  const frame = viewer.frameLocator(".k-sealed-view iframe").first();
  const card = frame.getByRole("region", { name: "Spot" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("Level 2, near the stairs");
  await expect(card).toContainText(/Parked \d+ minutes ago/);
  await expect(card).toContainText(/Meter runs out in \d+ minutes/);
  if (process.env.SHOT) await viewer.screenshot({ path: process.env.SHOT });
  await context.close();
});
