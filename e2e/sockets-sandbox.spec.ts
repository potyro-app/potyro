import { test, expect } from "./console-guard";
import { startEcho, startRoomsRelay, routeRooms, type EchoServer, type RoomsRelay } from "./live-servers.js";
import { allow, leave, line, openLiveEcho, tap } from "./live-echo.js";
import { startProbe, type Probe } from "./realm.js";

// `ctx.caps.network.socket` and `.room` in a SHARED app (docs/28), in the browser realm and in the
// QuickJS fallback: the connection is opened by the shell (the sealed frame connects nowhere — its
// CSP says connect-src 'none', and its Origin would be null), only to the host the app declares,
// after one question that names it; bytes cross the box (as base64 in QuickJS); and a host it did not
// declare is refused with no question at all — the server there never hears from it.

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

for (const sandbox of ["realm", "quickjs"] as const) {
  test(`a shared app asks once, names the host, then talks to it live (${sandbox})`, async ({ page }) => {
    await openLiveEcho(page, { echoPort: echo.port, otherPort: otherPort(), trusted: false, sandbox });
    await tap(page, "Connect");
    await allow(page, `“Live Echo” wants a live connection to 127.0.0.1:${echo.port}.`);
    await expect(line(page, "echo hello")).toBeVisible({ timeout: 15_000 });
    await expect(line(page, "bytes 7,8,9")).toBeVisible();

    // Asked once: the next connection to the same host goes without a question.
    await tap(page, "Hang up");
    await expect(line(page, "closed app 1000")).toBeVisible();
    await tap(page, "Connect");
    await expect(line(page, "echo hello")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator(".k-dialog")).toHaveCount(0);

    // Leaving the app closes it: the server sees the connection end.
    await expect.poll(() => echo.open()).toBe(1);
    await leave(page);
    await expect.poll(() => echo.open(), { timeout: 10_000 }).toBe(0);
  });

  test(`a shared app is refused a host it did not declare, without a question (${sandbox})`, async ({ page }) => {
    await openLiveEcho(page, { echoPort: echo.port, otherPort: otherPort(), trusted: false, sandbox });
    const before = other.hits.length;
    await tap(page, "Try another host");
    await expect(line(page, "refused not-allowed-host")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".k-dialog")).toHaveCount(0);
    // Nothing reached that server: no upgrade, no request.
    expect(other.hits.slice(before)).toEqual([]);
  });

  test(`two people in one room see each other's messages and comings and goings (${sandbox})`, async ({ page, browser, baseURL }) => {
    await routeRooms(page, relay);
    await openLiveEcho(page, { echoPort: echo.port, otherPort: otherPort(), trusted: false, sandbox });
    await tap(page, "Join as Ana");
    await allow(page, "“Live Echo” wants a live connection to Potyro’s rooms.");
    await expect(line(page, "me Ana with nobody")).toBeVisible({ timeout: 15_000 });

    const ctx2 = await browser.newContext({ baseURL });
    const bo = await ctx2.newPage();
    await routeRooms(bo, relay);
    await openLiveEcho(bo, { echoPort: echo.port, otherPort: otherPort(), trusted: false, sandbox });
    await tap(bo, "Join as Bo");
    await allow(bo, "“Live Echo” wants a live connection to Potyro’s rooms.");
    await expect(line(bo, "me Bo with Ana")).toBeVisible({ timeout: 15_000 });
    await expect(line(page, "join Bo")).toBeVisible();

    await tap(bo, "Wave");
    await expect(line(page, "peer wave from Bo")).toBeVisible();
    await tap(page, "Wave");
    await expect(line(bo, "peer wave from Ana")).toBeVisible();
    await expect(line(page, "peer wave from Ana")).toHaveCount(0);

    await leave(bo);
    await expect(line(page, "leave Bo")).toBeVisible({ timeout: 10_000 });
    await ctx2.close();
  });
}
