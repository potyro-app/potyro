import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { packApp } from "./library-demos";
import { action, addPackage, allowLive, allowNetwork, connected, createFake, routeTo, tab, type FakeService } from "./live-apps";

// apps/word-watch, packed as its build packs it, against a local fake of Bluesky's Jetstream that
// sends messages in its real format (apps/word-watch/fixtures: the structure captured from
// jetstream2.us-east.bsky.network, the people and their words replaced by invented ones) and a fake
// of the AppView's getProfiles for handles. The page connects to Bluesky's real addresses; Playwright
// answers as Bluesky would, so nothing leaves this machine.
//
// SHARED (sealed): a word added, asked before the stream and before the handles, the matches listed
// with handle, text and a link to the post on bsky.app; a firehose of posts that mention nothing adds
// nothing; a dropped connection comes back by itself; leaving ends it. YOURS: the demo, with
// nothing sent anywhere, and its counts per minute.

const JETSTREAM = /^wss:\/\/jetstream\d\.us-(east|west)\.bsky\.network\/subscribe/;
const SAMPLES = JSON.parse(readFileSync(new URL("../apps/word-watch/fixtures/jetstream-sample.json", import.meta.url), "utf8")) as string[];

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw", viewport: { width: 420, height: 900 } });

/** Bluesky's public AppView: a handle for every DID asked about. */
async function routeProfiles(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles**", async (route) => {
    asked.push(route.request().url());
    const dids = new URL(route.request().url()).searchParams.getAll("actors");
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ profiles: dids.map((did) => ({ did, handle: `${did.slice(8, 19)}.bsky.social` })) }) });
  });
  return asked;
}

/** The fixtures again, as new posts (Jetstream never sends one twice). */
const fresh = (round: number) => SAMPLES.map((m) => m.replace('"rkey": "', `"rkey": "r${round}`));

const status = (page: Page) => page.locator(".k-aggregate-row").first();
const posts = (page: Page) => page.getByRole("main").locator(".k-list-row");

let bluesky: FakeService;
test.beforeEach(() => {
  bluesky = createFake();
});

test("a shared copy watches a word on Bluesky: asked first, matches with who and a link, the firehose dropped, a drop recovered", async ({ page }) => {
  const asked = await routeProfiles(page);
  await routeTo(page, JETSTREAM, bluesky);
  await addPackage(page, "word-watch", packApp("word-watch", "word-watch.app.ts"), false);

  // No word yet: it says so and goes to Words.
  await action(page, "Watch live").click();
  await expect(page.getByText("Add a word to watch first, under Words.")).toBeVisible();
  await action(page, "Add a word").click();
  const prompt = page.getByRole("dialog", { name: "A word or a phrase to watch" });
  await prompt.getByRole("textbox").fill("coffee");
  await prompt.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("main").locator(".k-list-row", { hasText: "“coffee”" })).toBeVisible();

  await tab(page, "Live").click();
  await action(page, "Watch live").click();
  await allowLive(page, "“Word Watch” wants a live connection to jetstream2.us-east.bsky.network.");
  await connected(bluesky);
  expect(bluesky.urls[0]).toBe("wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post");
  await expect(status(page)).toContainText("● Live");

  // Posts stream by; the ones with "coffee" stay — and the handles are asked for once.
  for (const m of fresh(1)) bluesky.push(m);
  await allowNetwork(page, "Word Watch");
  // Four of the posts mention coffee; an edit of one that does is not a new post, and is left out.
  await expect(posts(page)).toHaveCount(4, { timeout: 15_000 });
  await expect(posts(page).filter({ hasText: "Morning coffee on the balcony" })).toContainText("@fixture0000.bsky.social");
  await expect(posts(page).filter({ hasText: "edited post" })).toHaveCount(0);
  const kept = 4;
  expect(asked.length).toBeGreaterThan(0);

  // A firehose that mentions nothing watched: nothing more is written.
  const quiet = SAMPLES.filter((m) => !/coffee/i.test(m));
  for (let i = 0; i < 2000; i++) bluesky.push(quiet[i % quiet.length]!.replace('"rkey": "', `"rkey": "q${i}`));
  await page.waitForTimeout(3000);
  await expect(posts(page)).toHaveCount(kept);
  await expect(status(page)).toContainText("● Live");

  // A post opens with its whole text and the way to it on Bluesky.
  await posts(page).filter({ hasText: "Morning coffee on the balcony" }).click();
  await expect(page.getByRole("link", { name: /bsky\.app\/profile\/did:plc:fixture0000aaaaaaaaaaaaa\/post\/r13mxwu3ud26r2q/ })).toBeVisible();
  await tab(page, "Live").click();

  // Bluesky's server goes: it comes back by itself, with no second question.
  bluesky.drop();
  await expect.poll(() => bluesky.connections(), { timeout: 20_000 }).toBe(2);
  expect(bluesky.urls[1]).toBe(bluesky.urls[0]);
  await expect(status(page)).toContainText("● Live");
  await expect(page.locator(".k-dialog")).toHaveCount(0);

  await page.goBack();
  await expect.poll(() => bluesky.open(), { timeout: 10_000 }).toBe(0);
});

test("the demo plays invented posts through the same matcher, with nothing sent, and counts them per minute", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("bsky")) outside.push(r.url());
  });
  page.on("websocket", (ws) => {
    if (!ws.url().startsWith("ws://localhost")) outside.push(ws.url());
  });
  await addPackage(page, "word-watch", packApp("word-watch", "word-watch.app.ts"), true);
  await action(page, "Demo").click();
  await expect(status(page)).toContainText("Demo — made-up posts");
  await expect(posts(page).first()).toContainText(".demo", { timeout: 15_000 });
  await expect(posts(page).filter({ hasText: "brain" })).toHaveCount(0);
  await tab(page, "Per minute").click();
  await expect(page.locator(".k-aggregate-row", { hasText: "“coffee”" })).toContainText("a minute");
  await expect(page.locator(".k-aggregate-row", { hasText: "“rain”" })).toContainText("in the last hour");
  await expect(page.getByRole("main").getByText("Mentions per minute").first()).toBeVisible();
  await tab(page, "Words").click();
  await expect(page.getByRole("main").locator(".k-list-row")).toHaveCount(2);
  expect(outside).toEqual([]);
});
