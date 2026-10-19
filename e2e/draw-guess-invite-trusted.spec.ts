import { test, expect, type Browser, type FrameLocator, type Page } from "./console-guard";
import { packApp } from "./library-demos";
import { addPackage, allowLive, setHidden } from "./live-apps";
import { routeRooms, startRoomsRelay, type RoomsRelay } from "./live-servers.js";
import { stranger } from "./share-demo";

// The way Draw & Guess spreads: one person starts a game and sends the link, a friend taps it and is
// playing. Walked as the owner walked it on 2026-10-19, in Firefox as well as Chromium:
//   - the host has the game as a kept copy (sealed, as anything from someone else), starts a game,
//     taps Invite friends and goes to another app to send the link — longer than half a minute;
//   - back, the game is still open, waiting for the friend (not "You stepped out");
//   - the friend has never used Potyro: the link opens on joining THIS game — their name and Join —
//     with nothing to decide first (no "Make it mine" / "Keep this app", no "New game" up front);
//   - they play a turn, and both screens keep running: none falls back to its "plain version".

let relay: RoomsRelay;
let zip: Buffer;

test.beforeAll(async ({ baseURL }) => {
  relay = await startRoomsRelay(new URL(baseURL!).origin);
  zip = packApp("draw-guess", "draw-guess.app.ts");
});
test.afterAll(async () => {
  await relay?.stop();
});

const board = (p: Page): FrameLocator => p.frameLocator(".k-sealed-view iframe");
const plainVersion = (p: Page) => p.getByText(/stopped responding/);

/** The host: Draw & Guess kept as a copy from someone else (sealed), on its start screen. */
async function host(browser: Browser, baseURL: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1180, height: 900 } });
  const page = await context.newPage();
  await routeRooms(page, relay);
  await addPackage(page, "draw-guess", zip, false);
  await expect(board(page).getByRole("heading", { name: "Draw it. Guess it!" })).toBeVisible({ timeout: 30_000 });
  return page;
}

test("a friend taps the invite and plays: the host can step away to send it, the guest goes straight to joining, both screens keep running", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const ana = await host(browser, baseURL!);
  await board(ana).getByLabel("Your name").fill("Ana");
  await board(ana).getByRole("button", { name: "New game" }).click();
  await allowLive(ana, "wants a live connection to Potyro’s rooms");
  await expect(board(ana).getByRole("heading", { name: "Waiting for players" })).toBeVisible({ timeout: 30_000 });

  // Invite friends: the link, then away to Signal to send it — Potyro hidden for longer than 30 s.
  await board(ana).getByRole("button", { name: "Invite friends" }).click();
  const sent = ana.getByRole("textbox", { name: "What will be sent" });
  await expect(sent).toHaveValue(/\/s\/[^\s#]+#k=[^\s]+&to=play&p\.code=/, { timeout: 30_000 });
  const link = (await sent.inputValue()).split("\n").pop()!;
  await ana.getByRole("button", { name: "Done" }).click();
  await setHidden(ana, true);
  await ana.waitForTimeout(40_000);
  await setHidden(ana, false);
  // Back: still in the game, waiting for the friend.
  await expect(board(ana).getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  await expect(board(ana).getByText("You stepped out of the game")).toHaveCount(0);

  // The friend: never used Potyro. The link opens on joining this game, nothing to decide first.
  const { context, page: bo } = await stranger(browser, baseURL!, { viewport: { width: 1180, height: 900 } });
  await routeRooms(bo, relay);
  await bo.goto(link);
  await expect(board(bo).getByLabel("Your name")).toBeVisible({ timeout: 30_000 });
  await expect(bo.getByRole("button", { name: "Make it mine" })).toHaveCount(0);
  await expect(bo.getByRole("button", { name: "Keep this app" })).toHaveCount(0);
  await expect(board(bo).getByRole("button", { name: "New game" })).toHaveCount(0);
  await board(bo).getByLabel("Your name").fill("Bo");
  await board(bo).getByRole("button", { name: "Join the game" }).click();
  await allowLive(bo, "wants a live connection to Potyro’s rooms");
  await expect(board(bo).getByRole("heading", { name: "Waiting for players" })).toBeVisible({ timeout: 30_000 });
  await expect(board(ana).getByText("Bo", { exact: true })).toBeVisible({ timeout: 20_000 });

  // A turn: Ana picks a word, Bo guesses it — typed and sent with Enter, as on a phone — and scores.
  await board(ana).getByRole("button", { name: "Start the game" }).click();
  const choice = board(ana).locator(".dg-choice").first();
  await expect(choice).toBeVisible({ timeout: 20_000 });
  const word = (await choice.innerText()).trim();
  await choice.click();
  await expect(board(bo).getByTestId("mask")).toBeVisible({ timeout: 20_000 });
  await board(bo).getByPlaceholder("Type your guess…").fill(word);
  await board(bo).getByPlaceholder("Type your guess…").press("Enter");
  await expect(board(bo).locator(".dg-overlay")).toContainText("You guessed it!", { timeout: 20_000 });
  await expect(board(ana).locator(".dg-overlay")).toContainText("Bo guessed it!");

  // Both screens keep running for a while — neither falls back to its "plain version".
  await ana.waitForTimeout(60_000);
  await expect(plainVersion(ana)).toHaveCount(0);
  await expect(plainVersion(bo)).toHaveCount(0);
  await context.close();
  await ana.context().close();
});
