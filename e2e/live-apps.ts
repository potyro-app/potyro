import { expect, type Page, type WebSocketRoute } from "@playwright/test";

// The live hero apps (apps/earthquakes, apps/word-watch, apps/ticker) in a browser: added from this
// device as a packed app — yours (trusted) or shared (sealed, in the browser realm) — and each
// service's WebSocket answered by a local fake that speaks its real message format.
//
// The fake is Playwright's `routeWebSocket` with no server behind it: the page connects to the
// service's real address — so a sealed app's host check and its consent question name the real host
// — and the spec answers as the service would, with messages captured from it (each app's
// fixtures/). Nothing leaves this machine.

/** Add a packed app from this device; `mine: false` leaves "I wrote this" unticked, so it runs sealed. */
export async function addPackage(page: Page, name: string, zip: Buffer, mine: boolean): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name: `${name}.potyro-app.zip`, mimeType: "application/zip", buffer: zip });
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  if (mine) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 60_000 });
}

/** A page action (the buttons beside the filter chips). */
export const action = (page: Page, label: string) => page.locator(".k-page-action", { hasText: label });

/** The page's tab bar. */
export const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name });

/** Answer a sealed app's live-connection question, after checking it names the host. */
export async function allowLive(page: Page, says: string): Promise<void> {
  const dialog = page.locator(".k-dialog", { hasText: "wants a live connection" });
  await expect(dialog).toContainText(says);
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(dialog).toHaveCount(0);
}

/** Answer a sealed app's "use the network?" question (fetch). */
export async function allowNetwork(page: Page, app: string): Promise<void> {
  const dialog = page.locator(".k-dialog", { hasText: `Allow “${app}” to use the network?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^(Allow|Confirm|OK)$/ }).click();
  await expect(dialog).toHaveCount(0);
}

export interface FakeService {
  /** Connections open right now. */
  open(): number;
  /** Every connection ever made. */
  connections(): number;
  /** The address each connection asked for. */
  urls: string[];
  /** Every text message the app sent (subscriptions). */
  received: string[];
  /** Send a text message to every open connection. */
  push(text: string): void;
  /** End every connection from the server's side (the service went away). */
  drop(): void;
  /** Turn new connections away (the service is down), or take them again. */
  refuse(on: boolean): void;
  /** Answer a connection's first message (Coinbase's "subscriptions" reply). */
  onFirst?: (first: string, send: (text: string) => void) => void;
}

/** A scripted service the spec drives; `routeTo` puts it behind a real address. */
export function createFake(): FakeService {
  const live = new Set<WebSocketRoute>();
  let total = 0;
  let refusing = false;
  const fake: FakeService = {
    open: () => live.size,
    connections: () => total,
    urls: [],
    received: [],
    push: (text) => {
      for (const ws of live) ws.send(text);
    },
    drop: () => {
      for (const ws of [...live]) {
        live.delete(ws);
        void ws.close({ code: 1011, reason: "gone" });
      }
    },
    refuse: (on) => void (refusing = on),
  };
  (fake as FakeService & { attach(ws: WebSocketRoute): void }).attach = (ws) => {
    total++;
    fake.urls.push(ws.url());
    if (refusing) return void ws.close({ code: 1011, reason: "down" });
    live.add(ws);
    let first = true;
    ws.onMessage((m) => {
      const text = typeof m === "string" ? m : m.toString();
      fake.received.push(text);
      if (first) fake.onFirst?.(text, (t) => ws.send(t));
      first = false;
    });
    ws.onClose(() => live.delete(ws));
  };
  return fake;
}

/** Answer the page's connections to `realUrl` (a glob or a RegExp) with the fake. */
export async function routeTo(page: Page, realUrl: string | RegExp, fake: FakeService): Promise<void> {
  const attach = (fake as FakeService & { attach(ws: WebSocketRoute): void }).attach;
  await page.routeWebSocket(realUrl, (ws) => attach(ws));
}

/** Wait until `n` connections are open at the fake. */
export async function connected(fake: FakeService, n = 1): Promise<void> {
  await expect.poll(() => fake.open(), { timeout: 20_000 }).toBe(n);
}

/** Make the page believe it was hidden (`hidden: true`) or shown again, as a switch to another app does. */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
