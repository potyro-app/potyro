import { test } from "@playwright/test";
const OUT = process.env.SHOTS_OUT!;
const P = process.env.SHOTS_PREFIX ?? "";
for (const [vp, size] of [["phone", { width: 390, height: 844 }], ["wide", { width: 1280, height: 860 }]] as const) {
  test(`places ${vp}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: size, colorScheme: "light", geolocation: { latitude: 38.7139, longitude: -9.1394 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`/?app=places`);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/${P}1-map-${vp}.png` });
    const pin = page.locator(".maplibregl-marker, .k-map-pin").first();
    if (await pin.count()) { await pin.click({ force: true }); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/${P}2-pin-${vp}.png` }); }
    await page.goto(`/?app=places`);
    await page.waitForTimeout(3000);
    await page.getByRole("tab", { name: /All places/ }).or(page.getByRole("button", { name: /All places/ })).last().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${P}3-list-${vp}.png` });
    await page.locator(".k-list-row .k-list-text").first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${P}4-detail-${vp}.png` });
    console.log("errors", JSON.stringify(errors));
    await context.close();
  });
}
