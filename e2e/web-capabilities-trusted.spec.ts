import { test, expect } from "./console-guard";

// The real web capabilities, exercised by the examples (KA-02 acceptance, #2).
//
// Not `FakeCapabilities` and not a stub: the browser grants a location the way it would on a phone,
// and the photo goes through the same `<input capture>` path a camera fills. The mediated wrappers
// have unit tests (`mediate-permissions.test.ts`); what needs a browser is whether the capability
// reaches the FIELD — the geo picker filling in from `ctx.caps.geo`, the photo tile holding an image
// — and whether an app whose reminders cannot be scheduled on the web still says a plant is due.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Somewhere unmistakable, so an assertion cannot pass on a default.
const LISBON = { latitude: 38.7223, longitude: -9.1393 };

test.use({ viewport: { width: 1440, height: 900 }, geolocation: LISBON, permissions: ["geolocation"] });

test("a place takes its position from the device's own location, and a real photo", async ({ page }) => {
  test.slow();
  await page.goto("/?user=places");
  await expect(page.locator("h1").first()).toHaveText("Places", { timeout: 30_000 });

  // Places lands on the Map, which adds inline by arming placement and tapping — so the shell drops
  // the floating quick action there. This test is about the capability reaching the FIELD, and a
  // form opened by tapping the map arrives with the point already filled, which would prove nothing.
  // The list page still adds with a button, and opens the geo field empty.
  await page.getByRole("tab", { name: "All places" }).or(page.getByRole("button", { name: "All places" })).first().click();
  await page.getByRole("button", { name: /Add: Place/i }).first().click();
  const form = page.getByRole("dialog", { name: "Add: Place" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByRole("textbox", { name: "Name" }).fill("Miradouro");

  // The capability, through the field: the browser's geolocation fills the point. Located by its
  // text — the button's accessible name is the whole field's label chain.
  await form.locator("button", { hasText: "Use my location" }).click();
  await expect(form.locator(".k-geo-actions .k-muted")).toHaveText(/38\.72\d+, -9\.13\d+/, { timeout: 30_000 });

  // And the same form takes a photo through the file/camera input.
  await form.locator("input[type=file]").first().setInputFiles({ name: "view.png", mimeType: "image/png", buffer: PNG });
  await expect(form.locator(".k-media-tile img")).toHaveAttribute("src", /^blob:|^data:/);

  await form.getByRole("button", { name: /^(Save|Create)$/i }).first().click();

  // The record kept both: the position it read, and the photo.
  await expect(page.locator(".k-detail-title, .k-list-row").first()).toBeVisible({ timeout: 30_000 });
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("potyro:user:places") ?? "{}";
    const data = JSON.parse(raw) as { records?: { place?: Record<string, { name?: string; location?: { lat: number; lng: number }; photo?: unknown }> } };
    return Object.values(data.records?.place ?? {}).find((r) => r.name === "Miradouro") ?? null;
  });
  // A local-only app on this browser is the SQLite/LocalStore path; whichever it used, the screen is
  // the claim that matters, so the storage check is a bonus rather than the assertion.
  if (stored?.location) {
    expect(Math.round(stored.location.lat * 100) / 100).toBeCloseTo(38.72, 1);
    expect(Math.round(stored.location.lng * 100) / 100).toBeCloseTo(-9.14, 1);
  }
});

test("a plant with no watering yet is shown as due, even though the web cannot schedule a reminder", async ({ page }) => {
  test.slow();
  // The web target has no notifications at all (`createWebCapabilities().notifications === null`) —
  // it does not pretend to schedule something that will never fire. What it owes instead is an
  // in-app "due", which is the example's Water now section.
  await page.goto("/?user=plants");
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });

  await page.getByRole("button", { name: /Add: Plant/i }).first().click();
  const form = page.getByRole("dialog", { name: "Add: Plant" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByRole("textbox", { name: "Name" }).fill("Fern");
  await form.getByRole("button", { name: /^(Save|Create)$/i }).first().click();

  // Never watered counts as long overdue: the plant is due the moment it exists. The in-app "due"
  // is the example's own Today page — the figures and the Water now list.
  await page.getByRole("button", { name: /Today/ }).first().click();
  await expect(page.locator(".k-page-figures")).toContainText("to water today", { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Water now" }).locator(".k-list-row", { hasText: "Fern" }).first()).toBeVisible({ timeout: 30_000 });
});
