import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";

// Sync must survive losing the relay.
//
// It did not. `createRelayPeer` built ONE `createWebSocketPeer` over a raw `new WebSocket(url)` and
// handed it to the node at construction, so the first disconnection — a sleeping laptop, a wifi
// blip, a relay restart — ended sync for that page permanently and silently. Writes kept working
// and kept being durable locally, which is precisely what makes it invisible: nothing looks broken
// until two devices are compared, possibly days later.
//
// `cojson-transport-ws` has shipped `WebSocketPeerWithReconnection` all along; we were not using it.
//
// This spec owns its own relay on a private port so it can kill it without disturbing the shared one
// on 4201 that every other sync spec uses.

const PORT = 4321;
const RELAY = `ws://localhost:${PORT}`;

// `spawn` on Windows will not find `pnpm` — the shim on PATH is `pnpm.cmd`, and `pnpm.ps1` is the
// one PowerShell refuses to run under the default execution policy. Naming the extension is the
// portable fix; changing a machine's execution policy to make a test pass is not.
const WINDOWS = process.platform === "win32";
const PNPM = WINDOWS ? "pnpm.cmd" : "pnpm";

test.describe.configure({ mode: "serial" });

let relay: ChildProcess | null = null;

const listening = async (timeoutMs = 30_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port: PORT, host: "127.0.0.1" });
      socket.once("connect", () => (socket.end(), resolve(true)));
      socket.once("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const gone = async (timeoutMs = 20_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port: PORT, host: "127.0.0.1" });
      socket.once("connect", () => (socket.end(), resolve(true)));
      socket.once("error", () => resolve(false));
    });
    if (!up) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

async function startRelay(): Promise<void> {
  const args = ["jazz-run", "sync", "--port", String(PORT), "--in-memory"];
  relay = WINDOWS
    ? // Node has refused to `spawn` a `.cmd` directly since the CVE-2024-27980 fix — it fails with
      // `spawn EINVAL` — so Windows goes through a shell, as one string rather than args (passing
      // both is deprecated, and concatenating them here is unambiguous: every token is a literal
      // from this file, none of it from outside).
      spawn(`${PNPM} ${args.join(" ")}`, { stdio: "ignore", shell: true })
    : // A process group, so the whole tree can be killed at once. Windows has no equivalent here;
      // `detached` on a `.cmd` opens a console window instead, and the tree is killed by pid.
      spawn(PNPM, args, { stdio: "ignore", detached: true });
  expect(await listening(), `relay did not come up on ${PORT}`).toBe(true);
}

async function stopRelay(): Promise<void> {
  if (!relay?.pid) return;
  // The whole process TREE, not the launcher: `pnpm` spawns the real server as a child, and killing
  // the shim leaves the port held — which this spec then reads as "the relay survived a kill".
  if (WINDOWS) {
    spawnSync("taskkill", ["/pid", String(relay.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-relay.pid, "SIGKILL");
    } catch {
      relay.kill("SIGKILL");
    }
  }
  relay = null;
  expect(await gone(), "relay port stayed open after kill").toBe(true);
}

test.afterAll(async () => {
  await stopRelay();
});

const STARTER = `import { defineApp } from "potyro";

export default defineApp({
  id: "reconnect",
  name: "Reconnect",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: {
      label: "Note",
      icon: "📝",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
    },
  },
  pages: [
    { id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } },
  ],
});
`;

async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript(
    ([source, seedApp, relayUrl]) => {
      localStorage.setItem("potyro:sync:relay", relayUrl as string);
      if (!seedApp || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "reconnect", name: "Reconnect", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER, opts?.app ?? false, RELAY] as const,
  );
  return context.newPage();
}

const add = async (page: Page, title: string): Promise<void> => {
  await page.getByRole("button", { name: /New Note|Add Note/i }).first().click();
  await page.getByLabel(/title/i).fill(title);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: title })).toBeVisible();
};

test("two peers keep syncing after the relay dies and comes back", async ({ browser }) => {
  test.slow();
  await startRelay();

  // ---- two devices, converging normally ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA, { app: true });
  await a.goto("/?user=reconnect");
  await expect(a.locator("h1").first()).toHaveText("Reconnect", { timeout: 30_000 });
  await add(a, "before");

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Reconnect", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a);
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await a.goto("/?user=reconnect");

  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(b);
  await expect(b.locator(".k-list-row", { hasText: "before" })).toBeVisible({ timeout: 60_000 });

  // ---- the relay dies. NEITHER PAGE RELOADS — that is the whole point. ----
  await stopRelay();

  // Local writes must still work while disconnected: offline-first is the product, not a fallback.
  await add(a, "alpha-offline");
  await add(b, "bravo-offline");
  // And they must NOT have reached each other, or the test proves nothing about the transport.
  // Names deliberately share no substring: `hasText` matches substrings, so "while-down" and
  // "b-while-down" made this assertion pass for the wrong reason.
  await expect(b.locator(".k-list-row", { hasText: "alpha-offline" })).toHaveCount(0);

  // ---- the relay comes back ----
  await startRelay();

  // THE POINT: convergence resumes with no reload and no user action. Before the fix the socket was
  // never replaced, so these two assertions hung until timeout.
  await expect(b.locator(".k-list-row", { hasText: "alpha-offline" })).toBeVisible({ timeout: 90_000 });
  await expect(a.locator(".k-list-row", { hasText: "bravo-offline" })).toBeVisible({ timeout: 90_000 });

  // And a write made AFTER the reconnection still flows, i.e. the peer is genuinely re-attached
  // rather than having flushed a backlog once.
  await add(a, "after");
  await expect(b.locator(".k-list-row", { hasText: "after" })).toBeVisible({ timeout: 90_000 });

  await ctxA.close();
  await ctxB.close();
});
