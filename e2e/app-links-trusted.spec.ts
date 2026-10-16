import { test, expect, type Browser, type Page } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { routeRooms, startRoomsRelay, type RoomsRelay } from "./live-servers.js";
import { stranger } from "./share-demo";

// Links that open an app at one of its pages (docs/24 §11), the way Draw & Guess invites people:
// "Invite friends" sends a link that opens the game's Play page with the code filled in.
//   - a friend who has the game: the link opens THEIR copy, on Play, the code in the box — and only
//     a tap on Join joins;
//   - a friend who does not: the demo, then Keep this app, then (the drawing board is the app's own
//     code) Run it as mine — and they land on Play with the code still there;
//   - a link anyone could write: what does not fit is cut, silently; an app this device does not have
//     is said in plain words, and nothing is installed;
//   - the remix intent (`&remix=1`) on such a link still opens Make it mine.

let relay: RoomsRelay;
let zip: Buffer;

test.beforeAll(async ({ baseURL }) => {
  relay = await startRoomsRelay(new URL(baseURL!).origin);
  zip = packApp("draw-guess", "draw-guess.app.ts");
});
test.afterAll(async () => {
  await relay?.stop();
});

/** Pictures of the flow for a review, only when asked (`POTYRO_LINK_SHOTS=<dir>`). */
const shot = async (p: Page, name: string): Promise<void> => {
  const dir = process.env.POTYRO_LINK_SHOTS;
  if (dir) await p.screenshot({ path: `${dir}/${name}.png` });
};

const codeBox = (p: Page) => p.getByPlaceholder("KQ7M-XR4P-2DHC");
const invitedNote = (p: Page) => p.getByText("You're invited to a game. Say your name and tap Join.");

/** Someone with Draw & Guess added as theirs, on its start screen. */
async function player(browser: Browser, baseURL: string, name?: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1180, height: 900 } });
  const page = await context.newPage();
  await routeRooms(page, relay);
  await addAsMine(page, "draw-guess.potyro-app.zip", zip);
  await expect(page.getByRole("heading", { name: "Draw it. Guess it!" })).toBeVisible({ timeout: 30_000 });
  if (name) await page.getByLabel("Your name").fill(name);
  return page;
}

/** Ana starts a game and taps Invite friends: the link the share dialog hands on, and the game's code. */
async function anaInvites(browser: Browser, baseURL: string): Promise<{ ana: Page; link: string; code: string }> {
  const ana = await player(browser, baseURL, "Ana");
  await ana.getByRole("button", { name: "New game" }).click();
  await expect(ana.getByRole("heading", { name: "Waiting for players" })).toBeVisible({ timeout: 20_000 });
  const code = (await ana.locator(".dg-tiles").getAttribute("aria-label"))!;
  await ana.getByRole("button", { name: "Invite friends" }).click();
  const sent = ana.getByRole("textbox", { name: "What will be sent" });
  // The words say the code too, for anyone who would rather type it; the link comes once it is made.
  await expect(sent).toHaveValue(/http:\/\/[^\s]+\/s\/[^\s#]+#k=[^\s]+&app=id%3Adraw-guess&to=play&p\.code=[2-9A-Z]{12}$/, { timeout: 30_000 });
  await expect(sent).toHaveValue(new RegExp(`type the code ${code}`));
  await shot(ana, "1-invite-dialog");
  const link = (await sent.inputValue()).split("\n").pop()!;
  expect(link).toContain(`p.code=${code.replaceAll("-", "")}`);
  await ana.getByRole("button", { name: "Done" }).click();
  return { ana, link, code };
}

const lobbyHas = (p: Page, who: string) => p.locator(".dg-person", { hasText: who });

test("a friend who has the game: the invite opens their own copy on Play, with the code filled in, and Join joins", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const { ana, link, code } = await anaInvites(browser, baseURL!);
  const bo = await player(browser, baseURL!);

  await bo.goto(link);
  // Their copy, not the demo: the address is the app's own, the app runs as theirs.
  await expect(bo).toHaveURL(/\/\?user=draw-guess$/, { timeout: 30_000 });
  await expect(bo.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");
  await expect(bo.locator(".k-demo-bar")).toHaveCount(0);
  await expect(codeBox(bo)).toHaveValue(code, { timeout: 30_000 });
  await expect(invitedNote(bo)).toBeVisible();
  // What is left to do is theirs: a name (the box has the focus), then Join — nothing joins by itself.
  await expect(bo.getByLabel("Your name")).toBeFocused();
  await bo.keyboard.type("Bo");
  await shot(bo, "2-landed-with-code");
  await bo.waitForTimeout(1500);
  await expect(bo.getByRole("heading", { name: "Waiting for players" })).toHaveCount(0);
  await expect(lobbyHas(ana, "Bo")).toHaveCount(0);

  await bo.getByRole("button", { name: "Join", exact: true }).click();
  await expect(bo.getByRole("heading", { name: "Waiting for players" })).toBeVisible({ timeout: 20_000 });
  await expect(lobbyHas(ana, "Bo")).toBeVisible({ timeout: 20_000 });
  await expect(lobbyHas(bo, "Ana")).toBeVisible();
});

test("a friend who does not have it: the demo, Keep this app, Run it as mine — and they land on Play with the code", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const { ana, link, code } = await anaInvites(browser, baseURL!);
  const { context, page: cy } = await stranger(browser, baseURL!);
  await routeRooms(cy, relay);

  await cy.goto(link);
  // The demo, sealed, opened on the page the link is for.
  await expect(cy.locator(".k-demo-bar")).toBeVisible({ timeout: 30_000 });
  await expect(cy.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await expect(cy.getByText("This screen is built with the app’s own code, so it only runs when the app runs as yours.")).toBeVisible();
  await expect(cy.locator(".k-tab", { hasText: "Play" })).toHaveAttribute("data-active", "true");
  // Nothing was installed by opening it.
  expect(await cy.evaluate(() => JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]").length)).toBe(0);
  await shot(cy, "3-demo-on-play");

  await cy.locator(".k-demo-bar").getByRole("button", { name: "Keep this app" }).click();
  const card = cy.getByRole("dialog", { name: "Add an app" });
  await expect(card.getByRole("heading", { name: "Draw & Guess" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Add app" }).click();

  // Kept, sealed, on Play. The board is the app's own code: running it as theirs is the person's call.
  await expect(cy).toHaveURL(/\/\?user=draw-guess$/, { timeout: 30_000 });
  await expect(cy.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await cy.getByRole("button", { name: "Run it as mine…" }).click();
  await cy.getByRole("button", { name: "Yes, run it as yours" }).click();

  // After the reload that lets it run: still on Play, the code still in the box.
  await expect(cy.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await expect(codeBox(cy)).toHaveValue(code, { timeout: 30_000 });
  await expect(invitedNote(cy)).toBeVisible();
  await expect(cy.getByLabel("Your name")).toBeFocused();
  await shot(cy, "4-kept-landed-with-code");
  // The kept copy is the same app: its next invite link names the same line.
  const kept = await cy.evaluate(() => JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; line?: string; lineOf?: string }>);
  expect(kept.find((a) => a.id === "draw-guess")).toMatchObject({ id: "draw-guess" });
  expect(kept.find((a) => a.id === "draw-guess")?.lineOf).toBeUndefined();

  await cy.getByLabel("Your name").fill("Cy");
  await cy.getByLabel("Your name").press("Enter");
  await expect(cy.getByRole("heading", { name: "Waiting for players" })).toBeVisible({ timeout: 20_000 });
  await expect(lobbyHas(ana, "Cy")).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test("a link anyone could write: huge and unknown params are cut silently, and an app you do not have installs nothing", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const bo = await player(browser, baseURL!, "Bo");
  // A real code padded far past what a link may carry: the game itself would read it (it ignores
  // spaces), so only the cut keeps it out — and a link this long carries nothing at all.
  const huge = encodeURIComponent(`KQ7M-XR4P-2DHC${" ".repeat(5000)}`);

  await bo.goto(`/#app=id%3Adraw-guess&to=play&p.code=${huge}&p.admin=1&p.__proto__=x&p.run=delete`);
  await expect(bo).toHaveURL(/\/\?user=draw-guess$/, { timeout: 30_000 });
  await expect(bo.getByRole("heading", { name: "Draw it. Guess it!" })).toBeVisible({ timeout: 30_000 });
  await expect(codeBox(bo)).toHaveValue("");
  await expect(invitedNote(bo)).toHaveCount(0);

  // A page that does not take a code from a link gets none; a page the app does not have is no page.
  await bo.goto("/#app=id%3Adraw-guess&to=games&p.code=KQ7MXR4P2DHC");
  await expect(bo.getByText("Finished games land here, with everyone's scores.")).toBeVisible({ timeout: 30_000 });
  await bo.goto("/#app=id%3Adraw-guess&to=nowhere&p.code=KQ7MXR4P2DHC");
  await expect(bo.getByRole("heading", { name: "Draw it. Guess it!" })).toBeVisible({ timeout: 30_000 });
  await expect(codeBox(bo)).toHaveValue("");

  // A link to an app this device does not have, with no demo in it: said, and nothing else happens.
  const before = await bo.evaluate(() => localStorage.getItem("potyro:user-apps"));
  await bo.goto("/#app=id%3Apiano&to=play&p.code=x");
  await expect(bo.getByText("This link opens an app you don't have here.", { exact: false })).toBeVisible({ timeout: 30_000 });
  expect(await bo.evaluate(() => localStorage.getItem("potyro:user-apps"))).toBe(before);
  await bo.getByRole("button", { name: "Open your apps" }).click();
  await expect(bo.getByRole("button", { name: "Add an app" })).toBeVisible({ timeout: 30_000 });
});

test("the remix intent on an invite link still opens Make it mine — even for someone who has the app", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const { link } = await anaInvites(browser, baseURL!);
  // Bo has the game; asking to make it his own is asking for a copy, not for his app.
  const bo = await player(browser, baseURL!);
  await bo.goto(`${link}&remix=1`);
  const card = bo.getByRole("dialog", { name: "Make it mine" });
  await expect(card.getByRole("heading", { name: "Draw & Guess" })).toBeVisible({ timeout: 30_000 });
  await expect(bo.locator(".k-demo-bar")).toBeVisible();
  await expect(bo.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
});
