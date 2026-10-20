import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { packApp } from "./library-demos";
import { action, addPackage, allowLive, allowNetwork, connected, createFake, routeTo, setHidden, tab, type FakeService } from "./live-apps";
import { expectMapPage } from "./engines";
import { makeDemoLink, stranger } from "./share-demo";

// apps/earthquakes, packed as its build packs it, against a local fake of EMSC that speaks its real
// format: the live feed's `{ action, data: Feature }` messages (captured from
// wss://www.seismicportal.eu/standing_order/websocket into apps/earthquakes/fixtures) and the
// catalogue's FeatureCollection for the last day. The page connects to EMSC's real address; Playwright
// hands that connection to the fake, so nothing leaves this machine.
//
// SHARED (sealed, in the browser realm): asked before the network and before the live connection,
// naming the host; quakes arrive, are revised, survive a dropped connection; Potyro's 30 s in the
// background closes the feed and it picks up again by itself on return; leaving the app ends it for
// good. YOURS (trusted): the same feed with no questions, and the plain message when EMSC is down.
// The demo: real earlier quakes replayed with no connection and no request at all.

const EMSC_WS = "wss://www.seismicportal.eu/standing_order/websocket";
const SAMPLES = JSON.parse(readFileSync(new URL("../apps/earthquakes/fixtures/emsc-socket.json", import.meta.url), "utf8")) as string[];
const CATALOGUE = JSON.parse(readFileSync(new URL("../apps/earthquakes/fixtures/fdsn-recent.json", import.meta.url), "utf8")) as {
  features: Array<{ properties: Record<string, unknown> }>;
};

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw", viewport: { width: 420, height: 900 } });

/** A real message from the feed, its time moved to `minutesAgo`. */
function message(i: number, minutesAgo: number, patch: Record<string, unknown> = {}): string {
  const m = JSON.parse(SAMPLES[i]!) as { data: { properties: Record<string, unknown> } };
  Object.assign(m.data.properties, { time: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...patch });
  return JSON.stringify(m);
}

/** EMSC's catalogue, its 46 real events moved so the newest was 40 minutes ago. */
async function routeCatalogue(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route("https://www.seismicportal.eu/fdsnws/**", async (route) => {
    asked.push(route.request().url());
    const body = structuredClone(CATALOGUE);
    const newest = Date.parse(String(body.features[0]!.properties.time));
    for (const f of body.features) f.properties.time = new Date(Date.parse(String(f.properties.time)) - newest + Date.now() - 40 * 60_000).toISOString();
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  return asked;
}

const status = (page: Page) => page.locator(".k-aggregate-row").first();
const rows = (page: Page) => page.getByRole("main").locator(".k-list-row");

let emsc: FakeService;
test.beforeEach(() => {
  emsc = createFake();
});

test("a shared copy asks first, then follows EMSC live: new quakes, revisions, a dropped connection, the background, leaving", async ({ page }) => {
  test.setTimeout(150_000);
  const asked = await routeCatalogue(page);
  await routeTo(page, EMSC_WS, emsc);
  await addPackage(page, "earthquakes", packApp("earthquakes", "earthquakes.app.ts"), false);
  await expect(status(page)).toContainText("Not live");

  await action(page, "Watch live").click();
  await allowNetwork(page, "Earthquakes");
  await allowLive(page, "“Earthquakes” wants a live connection to www.seismicportal.eu.");
  await connected(emsc);
  await expect(status(page)).toContainText("● Live");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/format=json&orderby=time&limit=300&minmag=3&start=/);

  // The last day was filled in; a new quake arrives and leads the list.
  await tab(page, "Latest").click();
  await expect(rows(page)).toHaveCount(46);
  emsc.push(message(0, 1));
  await expect(rows(page).first()).toContainText("M4.5 · South Sandwich Islands Region");
  await expect(rows(page).first()).toContainText("1 min ago · 155 km deep");
  await expect(rows(page)).toHaveCount(47);
  await expect(status(page)).toContainText("1 new");
  await expect(page.locator(".k-aggregate-row", { hasText: "Latest: South Sandwich Islands Region" })).toContainText("M4.5");
  // EMSC revises it: the same row, the new magnitude.
  emsc.push(message(0, 1, { mag: 5.1 }));
  await expect(rows(page).first()).toContainText("M5.1 · South Sandwich Islands Region");
  await expect(rows(page)).toHaveCount(47);
  await expect(rows(page).first()).toContainText("Moderate");
  // The chips above the list narrow it: magnitude 5 and up.
  await page.getByRole("spinbutton", { name: "From magnitude" }).fill("5");
  await expect(rows(page)).toHaveCount(11);
  await page.getByRole("spinbutton", { name: "From magnitude" }).fill("");
  await expect(rows(page)).toHaveCount(47);

  // The connection drops: it says so, and comes back by itself.
  emsc.drop();
  await expect.poll(() => emsc.connections(), { timeout: 20_000 }).toBe(2);
  await expect(status(page)).toContainText("● Live");

  // Potyro in the background for 30 s: the feed closes and nothing reopens while hidden…
  await setHidden(page, true);
  await expect.poll(() => emsc.open(), { timeout: 40_000 }).toBe(0);
  await expect(status(page)).toContainText("Paused while you were away");
  await page.waitForTimeout(7_000);
  expect(emsc.open()).toBe(0);
  expect(emsc.connections()).toBe(2);
  // …and it picks up again by itself when the person is back.
  await setHidden(page, false);
  await connected(emsc);
  await expect(status(page)).toContainText("● Live");

  // Leaving the app ends it, and nothing reconnects afterwards.
  await page.goBack();
  await expect.poll(() => emsc.open(), { timeout: 10_000 }).toBe(0);
  const after = emsc.connections();
  await page.waitForTimeout(5_000);
  expect(emsc.connections()).toBe(after);
});

test("your own copy goes live without a question, says plainly when EMSC is down, and carries on when it is back", async ({ page }) => {
  await routeCatalogue(page);
  await routeTo(page, EMSC_WS, emsc);
  emsc.refuse(true);
  await addPackage(page, "earthquakes", packApp("earthquakes", "earthquakes.app.ts"), true);
  await action(page, "Watch live").click();
  await expect(status(page)).toContainText(/Connection lost — trying again|Can't reach EMSC right now/, { timeout: 20_000 });
  await expect(page.locator(".k-dialog")).toHaveCount(0);
  emsc.refuse(false);
  await connected(emsc);
  await expect(status(page)).toContainText("● Live", { timeout: 20_000 });
  emsc.push(message(1, 3));
  await tab(page, "Strongest").click();
  await expect(page.getByRole("main").locator(".k-list-row", { hasText: "Andaman Islands, India Region" })).toContainText("M4.6");
  await tab(page, "Map").click();
  await action(page, "Stop").click();
  await expect.poll(() => emsc.open()).toBe(0);
  await expect(status(page)).toContainText("Not live");
});

test("your own copy, left while it waits to try again, opens nothing for an app nobody has open", async ({ page }) => {
  await routeCatalogue(page);
  await routeTo(page, EMSC_WS, emsc);
  emsc.refuse(true);
  await addPackage(page, "earthquakes", packApp("earthquakes", "earthquakes.app.ts"), true);
  await action(page, "Watch live").click();
  await expect.poll(() => emsc.connections(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  // Refused: the app waits a moment and tries again — and the person leaves in that moment.
  await page.goBack();
  const tries = emsc.connections();
  emsc.refuse(false);
  await page.waitForTimeout(6_000);
  // Its module lives on in the page with a timer set; Potyro opens nothing for it.
  expect(emsc.connections()).toBe(tries);
  expect(emsc.open()).toBe(0);
});

for (const mine of [false, true]) {
  test(`the demo replays real quakes with nothing sent — no connection, no request (${mine ? "yours" : "shared"})`, async ({ page }) => {
    const outside: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("seismicportal")) outside.push(r.url());
    });
    page.on("websocket", (ws) => outside.push(ws.url()));
    await addPackage(page, "earthquakes", packApp("earthquakes", "earthquakes.app.ts"), mine);
    await action(page, "Demo").click();
    await expect(status(page)).toContainText("Demo — a replay");
    // Every quake comes from the feed: the map offers no place to add one by hand.
    await expectMapPage(page);
    await expect(page.locator(".k-map-add")).toHaveCount(0);
    await tab(page, "Latest").click();
    await expect(rows(page).first()).toBeVisible();
    const before = await rows(page).count();
    await expect.poll(() => rows(page).count(), { timeout: 10_000 }).toBeGreaterThan(before);
    await expect(page.locator(".k-dialog")).toHaveCount(0);
    // Every quake comes from the feed: nothing offers to add one (or a "feed") by hand.
    await expect(page.getByRole("button", { name: /^\+?\s*Add: / })).toHaveCount(0);
    // A row opens the quake: its strength, its depth, and a link to it on EMSC.
    await rows(page).first().click();
    await expect(page.locator(".k-field", { hasText: "Strength" })).toBeVisible();
    await expect(page.getByRole("link", { name: /seismicportal\.eu\/eventdetails/ })).toBeVisible();
    // The feed's record is the feed's (`editableBy: "app"`): nothing on its page edits or deletes it.
    await expect(page.locator(".k-detail").getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.locator(".k-detail").getByRole("button", { name: "More actions" })).toHaveCount(0);
    expect(outside.filter((u) => !u.startsWith("ws://localhost"))).toEqual([]);
  });
}

test("a demo link opens with the replay already playing (docs/04 §Demo): a stranger sees quakes at once, and nothing is sent", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await addPackage(page, "earthquakes", packApp("earthquakes", "earthquakes.app.ts"), true);
  const link = await makeDemoLink(page, "Earthquakes");

  const { context, page: viewer } = await stranger(browser, baseURL!, { viewport: { width: 420, height: 900 } });
  const outside: string[] = [];
  viewer.on("request", (r) => {
    if (r.url().includes("seismicportal")) outside.push(r.url());
  });
  viewer.on("websocket", (ws) => {
    if (!ws.url().startsWith("ws://localhost")) outside.push(ws.url());
  });
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  // Nobody tapped Demo: the app's `demo` ran as the link opened, on the viewer's device.
  await expect(status(viewer)).toContainText("Demo — a replay", { timeout: 30_000 });
  await tab(viewer, "Latest").click();
  await expect(rows(viewer).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => rows(viewer).count()).toBeGreaterThan(10);
  expect(outside).toEqual([]);
  await context.close();
});
