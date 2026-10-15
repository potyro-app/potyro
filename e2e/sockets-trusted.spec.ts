import { test, expect } from "./console-guard";
import { startEcho, startRoomsRelay, routeRooms, type EchoServer, type RoomsRelay } from "./live-servers.js";
import { leave, line, openLiveEcho, tap } from "./live-echo.js";
import { startProbe, type Probe } from "./realm.js";

// `ctx.caps.network.socket` in the person's own app (docs/28): a real WebSocket to a local echo
// server, opened by the shell, text and bytes both ways, written down by the app's own callbacks; no
// question asked; closed by Potyro when the person leaves the app (the SERVER sees it go). And
// `ctx.caps.network.room` against the real rooms relay, started locally.

let echo: EchoServer;
let other: Probe;
let relay: RoomsRelay;

test.beforeAll(async ({ baseURL }) => {
  echo = await startEcho();
  other = await startProbe();
  relay = await startRoomsRelay(new URL(baseURL!).origin);
});
test.afterAll(async () => {
  await echo?.close();
  await other?.close();
  await relay?.stop();
});

const otherPort = () => Number(new URL(other.origin).port);

test("your own app talks to a server live, without being asked, and the connection ends when you leave", async ({ page }) => {
  await openLiveEcho(page, { echoPort: echo.port, otherPort: otherPort(), trusted: true });
  await tap(page, "Connect");
  await expect(line(page, "echo hello")).toBeVisible({ timeout: 15_000 });
  await expect(line(page, "bytes 7,8,9")).toBeVisible();
  // Your own app is not asked.
  await expect(page.locator(".k-dialog")).toHaveCount(0);
  expect(echo.open()).toBe(1);

  // The app closes it itself: it hears why.
  await tap(page, "Hang up");
  await expect(line(page, "closed app 1000")).toBeVisible();
  await expect.poll(() => echo.open()).toBe(0);

  // Leaving the app closes what it left open — the server sees the connection end.
  await tap(page, "Connect");
  await expect.poll(() => echo.open()).toBe(1);
  await leave(page);
  await expect.poll(() => echo.open(), { timeout: 10_000 }).toBe(0);
});

test("your own app joins a room on the rooms relay, and hears who else is there", async ({ page, browser, baseURL }) => {
  await routeRooms(page, relay);
  await openLiveEcho(page, { echoPort: echo.port, otherPort: otherPort(), trusted: true });
  await tap(page, "Join as Ana");
  await expect(line(page, "me Ana with nobody")).toBeVisible({ timeout: 15_000 });

  const ctx2 = await browser.newContext({ baseURL });
  const bo = await ctx2.newPage();
  await routeRooms(bo, relay);
  await openLiveEcho(bo, { echoPort: echo.port, otherPort: otherPort(), trusted: true });
  await tap(bo, "Join as Bo");
  await expect(line(bo, "me Bo with Ana")).toBeVisible({ timeout: 15_000 });
  await expect(line(page, "join Bo")).toBeVisible();

  await tap(bo, "Wave");
  await expect(line(page, "peer wave from Bo")).toBeVisible();
  // Never your own back.
  await expect(line(bo, "peer wave from Bo")).toHaveCount(0);

  await leave(bo);
  await expect(line(page, "leave Bo")).toBeVisible({ timeout: 10_000 });
  await ctx2.close();
});
