import { test, expect } from "./console-guard";

// What a DEPLOYED Potyro does — run against `vite build` + `vite preview`, not the dev server.
//
// Every claim here was false in a production build until KA-28, and no amount of dev-server testing
// could have shown it: the dev server has a relay default, hosts the generator endpoint as a
// middleware, and disables the service worker. The bugs live exactly in the gap between the two.
//
// Built with NOTHING configured, on purpose. This is what someone gets from `vite build` and a web
// server, so a test that set `VITE_POTYRO_RELAY` would be testing a deployment nobody has.

test("a deployed build has a relay to sync through", async ({ page }) => {
  // The bug this replaces: `syncRelayUrl()` returned `undefined` outside dev, so every deployed app
  // was local-only and the only way to say otherwise was typing a localStorage key into devtools —
  // on every device, for every person. Sync could not be tried on a domain at all.
  await page.goto("/");
  const relay = await page.evaluate(() => {
    // Same derivation the shell uses; asserted on the running origin rather than a hardcoded host so
    // it stays true wherever this is served from.
    const loc = location;
    return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/sync`;
  });
  expect(relay).toMatch(/^wss?:\/\/localhost:\d+\/sync$/);

  // And the shell agrees: opening the identity panel reports the same URL as the one in force.
  await page.getByRole("button", { name: "You and your devices" }).click();
  await expect(page.locator(".k-relay-current")).toContainText(relay);
});

test("a deployed build can be pointed at another relay, without devtools", async ({ page }) => {
  // "Bring your own relay" is the free self-host escape hatch (business plan §8.4). It was only
  // reachable by typing a localStorage key by hand, which is not an escape hatch anyone can use.
  await page.goto("/");
  await page.getByRole("button", { name: "You and your devices" }).click();
  // The relay is infrastructure, so it lives under Advanced (#95).
  await page.getByText(/^Advanced/).click();
  await page.getByRole("button", { name: "Change relay" }).click();

  const dialog = page.locator(".k-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("input").fill("not-a-websocket");
  await dialog.getByRole("button", { name: "OK" }).click();
  // Refused with something a person can act on, rather than silently storing a URL that can never
  // connect and leaving them to wonder why sync is broken.
  await expect(page.locator(".k-dialog")).toContainText("wss://");
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();

  await page.getByRole("button", { name: "Change relay" }).click();
  await page.locator(".k-dialog input").fill("wss://relay.example.com/sync");
  await page.locator(".k-dialog").getByRole("button", { name: "OK" }).click();

  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("potyro:sync:relay")), { timeout: 30_000 })
    .toBe("wss://relay.example.com/sync");
});

test("a deployed build still lets you repair an app, and does not offer the dev server's generator", async ({ page }) => {
  // `/__generate` is a Vite DEV-SERVER middleware. In a deployed build the route does not exist, and
  // every AI surface still offered itself, failed on the fetch, and showed a stranger the words
  // "Is `pnpm dev` still running?". The first fix hid the Studio and the agent entirely — which left
  // someone whose app had broken with no way to fix it. The source editor never needed a model, and
  // a model reached with the person's own key never needed a server; only `claude -p` does.
  await page.goto("/");
  await expect(page.locator(".k-launcher")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /New app/ }).first().click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible({ timeout: 30_000 });
  // It starts on an engine that can work here — one that asks for a key — not on `claude -p`.
  await expect(studio.getByRole("button", { name: "Model settings" })).not.toContainText("claude -p");
  await studio.getByRole("button", { name: "Model settings" }).click();
  const cli = page.getByRole("radio", { name: /claude -p/ });
  await expect(cli).toBeDisabled();
  await expect(page.locator(".k-engine-row", { has: cli })).toContainText("only while the dev server runs");

  // The endpoint really is absent — this is the fact the gate is protecting against, so assert it
  // rather than assuming. A preview server answers unknown paths with the SPA shell, so "not JSON"
  // is the honest check.
  const answered = await page.evaluate(async () => {
    const res = await fetch("/__generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system: "x", prompt: "y" }),
    });
    const text = await res.text();
    try {
      return { ok: res.ok, json: JSON.parse(text) as unknown };
    } catch {
      return { ok: res.ok, json: null };
    }
  });
  expect((answered.json as { id?: string } | null)?.id).toBeUndefined();
});

test("a built-in app still runs, offline-first, with no server behind it", async ({ page }) => {
  // The half that must keep working with no relay, no generator and no backend of any kind — the
  // product's actual claim.
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await expect(page.locator(".k-list-row").first()).toBeVisible({ timeout: 30_000 });
});
