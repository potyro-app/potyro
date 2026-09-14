import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Linking a second device with a recovery passphrase (KA-16 · ADR 0001 D2a).
//
// Two CONTEXTS, so genuinely separate storage — device two starts with nothing at all. The claim
// being tested is the whole point of the feature: after typing the words, the second device IS the
// same person, with the same account id, and can therefore open the same spaces.
//
// This needs a browser rather than the identity unit tests, which already cover the derivation. What
// they cannot cover is the part that broke twice in this track: whether the identity a real page
// boots with is the one the panel exports, across a real reload.

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "who",
  name: "Who",
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

async function device(context: BrowserContext): Promise<Page> {
  await context.addInitScript(
    ([source]) => {
      if (localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "who", name: "Who", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER],
  );
  return context.newPage();
}

/**
 * The account id this page booted with — the thing linking has to make equal.
 *
 * Tolerates the page navigating out from under it. Signing in ends with `location.reload()`, so
 * polling this necessarily races a real navigation and `page.evaluate` throws "Execution context was
 * destroyed" when it lands mid-flight. That is the expected path, not a failure, so it is retried
 * rather than reported.
 */
const accountId = async (page: Page): Promise<string | null> => {
  try {
    return await page.evaluate(() => localStorage.getItem("karta:identity:id"));
  } catch {
    return null;
  }
};

test("a second device adopts the same identity from the recovery words", async ({ browser }) => {
  test.slow();

  // ---- device A: has an identity, and can show its words ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA);
  await a.goto("/?user=who");
  await expect(a.locator("h1").first()).toHaveText("Who", { timeout: 30_000 });

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await a.getByRole("button", { name: "You and your devices" }).click();
  await a.getByRole("button", { name: /Add a device/ }).click();

  const words = (await a.locator(".k-passphrase").innerText({ timeout: 30_000 })).trim();
  // 24, not 12: the seed is 32 bytes and BIP39 spends 3 words per 4. A short phrase here would mean
  // the seed had been truncated somewhere.
  expect(words.split(/\s+/)).toHaveLength(24);

  const idA = await accountId(a);
  expect(idA).toMatch(/^co_/);

  // ---- device B: a separate context, so it starts with no identity of its own ----
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto("/?user=who");
  await expect(b.locator("h1").first()).toHaveText("Who", { timeout: 30_000 });

  const idBefore = await accountId(b);
  expect(idBefore).toMatch(/^co_/);
  expect(idBefore).not.toBe(idA); // a different person, until it is told otherwise

  // Typing the words in. The panel reloads the page afterwards on purpose — every store and runtime
  // was built around the old identity.
  b.once("dialog", () => {});
  await b.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await b.getByRole("button", { name: "You and your devices" }).click();
  await b.getByRole("button", { name: /This is my second device/ }).click();

  const field = b.locator(".k-dialog input");
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(words);
  await b.locator(".k-dialog").getByRole("button", { name: "OK" }).click();

  // THE CLAIM: same person now, and it survives the reload the panel triggers.
  await expect.poll(() => accountId(b), { timeout: 60_000 }).toBe(idA);

  await ctxA.close();
  await ctxB.close();
});
