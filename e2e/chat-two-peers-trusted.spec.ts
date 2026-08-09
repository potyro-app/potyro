import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Two people actually talking (KA-35, part 2).
//
// The storage half has unit coverage — including two-peer delivery — and unit coverage has been
// wrong three times in this track. But the specific thing only a browser can catch here is
// ATTRIBUTION: `by` comes from the signing session, and every step between that and the name on
// screen (the space's membership, the account profile, `memberName`) is host wiring that a Node
// test with one shared node never exercises. A chat where everyone's message says "You" would pass
// every unit test in the repo.
//
// Two CONTEXTS, not two pages: separate storage, so genuinely two devices with two identities.

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "chat-pair",
  name: "Chat Pair",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      icon: "🛒",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
    },
  },
  pages: [
    {
      id: "all",
      title: "Items",
      view: {
        type: "list",
        entity: "item",
        display: { primary: "title" },
        onOpen: { page: "one", param: { itemId: "id" } },
      },
    },
    { id: "one", title: "Item", view: { type: "detail", entity: "item", param: "itemId", sections: [{ fields: ["title"] }] } },
  ],
});
`;

/**
 * A device.
 *
 * Seeded ONCE per context, not once per navigation: an init script runs on every page load, and an
 * unconditional write to `karta:user-apps` silently resets `sync` to off — the trap documented on
 * `sync-two-peers-trusted.spec.ts`.
 */
async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript(
    ([source, seedApp]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!seedApp || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "chat-pair", name: "Chat Pair", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER, opts?.app ?? false] as const,
  );
  return context.newPage();
}

/**
 * Give this device's owner a name, through the dialog a person would use.
 *
 * Not seeded into `localStorage`: minting an identity writes the default name unconditionally, so a
 * pre-seeded one is overwritten on first boot and both devices would render as "Me" — which would
 * make every attribution assertion below vacuous while still passing. Going through "⌾ You" also
 * covers the thing that makes a name worth anything: it has to reach the OTHER person.
 */
const nameSelf = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await page.getByRole("button", { name: "You and your devices" }).click();
  await page.locator(".k-identity").getByRole("button", { name: "Rename", exact: true }).click();
  await page.locator(".k-dialog input").fill(name);
  await page.locator(".k-dialog").getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".k-identity-name")).toContainText(name);
  await page.locator(".k-identity").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Close launcher" }).click();
};

/**
 * Add an item and come back to the list.
 *
 * This app declares a DETAIL page — it has to, since half of what is under test hangs off one — so
 * saving lands on the record rather than on the list it was added from.
 */
const add = async (page: Page, title: string): Promise<void> => {
  await page.getByRole("button", { name: /New Item|Add Item/i }).first().click();
  await page.getByLabel(/title/i).fill(title);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await openList(page);
  await expect(page.locator(".k-list-row", { hasText: title })).toBeVisible();
};

const openList = async (page: Page): Promise<void> => {
  await page.locator(".k-tab", { hasText: "Items" }).click();
};

/** Say something in whichever thread is on screen. */
const say = async (page: Page, text: string): Promise<void> => {
  await page.getByLabel("Message").last().fill(text);
  await page.getByRole("button", { name: "Send" }).last().click();
};

test("two people talk in the room and on a record", async ({ browser }) => {
  test.slow();

  // ---- Ana owns the app, turns on sync, shares it ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA, { app: true });
  await a.goto("/?user=chat-pair");
  await expect(a.locator("h1").first()).toHaveText("Chat Pair", { timeout: 30_000 });
  await nameSelf(a, "Ana");
  await add(a, "milk");

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await a.getByRole("button", { name: "Share Chat Pair" }).click();
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turn sync on

  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "OK" }).click();

  // The recovery-words offer fires on the first sync of anything (ADR D2a). Declined — it has its
  // own spec.
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  await a.goto("/?user=chat-pair");
  // Assert we are on the store we think we are on BEFORE anything else. The sync pill renders only
  // when the app is flagged synced, which is exactly when `openStore` takes the CRDT branch — and
  // chat exists only on that branch, so without this a green run could be testing nothing.
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });

  // ---- Ana says something in the room ----
  await a.getByRole("button", { name: "Chat" }).click();
  await say(a, "there is no milk in the shop");
  await expect(a.locator(".k-chat-msg")).toContainText("there is no milk in the shop", { timeout: 30_000 });
  // Your own message is "You" — the other half of attribution, and the half that breaks if the
  // account id on the transaction is not the one the shell thinks is you.
  await expect(a.locator(".k-chat-msg").last().locator(".k-chat-who")).toHaveText("You");
  await a.locator(".k-chat-modal").getByRole("button", { name: "Close" }).click();

  // ---- Bo joins ----
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // trust prompt
  await expect(b.locator("h1").first()).toHaveText("Chat Pair", { timeout: 60_000 });
  await expect(b.locator(".k-list-row", { hasText: "milk" })).toBeVisible({ timeout: 60_000 });
  // Named AFTER joining, and never reloaded afterwards: a rename has to reach the people you are
  // already sharing with, not wait for the next open. Ana's assertion on "Bo" below is what proves
  // it did.
  await nameSelf(b, "Bo");

  // Bo has never opened the room, so Ana's message is unread — the badge is the only reason anyone
  // would think to look.
  const chatBtn = b.getByRole("button", { name: /^Chat/ });
  await expect(chatBtn).toHaveAttribute("data-unread", "1", { timeout: 60_000 });

  await chatBtn.click();
  const anaSaid = b.locator(".k-chat-msg", { hasText: "there is no milk in the shop" });
  await expect(anaSaid).toBeVisible({ timeout: 60_000 });
  // THE assertion this spec exists for: on Bo's device Ana's message is Ana's, by name.
  await expect(anaSaid.locator(".k-chat-who")).toHaveText("Ana");
  await expect(anaSaid).not.toHaveAttribute("data-mine", /.*/);

  // ---- Bo replies; Ana sees it without touching anything ----
  await say(b, "getting some on the way home");
  await b.locator(".k-chat-modal").getByRole("button", { name: "Close" }).click();
  // Reading it cleared the badge, and Bo's own reply must not raise it again.
  await expect(chatBtn).not.toHaveAttribute("data-unread", /.*/);

  await expect(a.getByRole("button", { name: /^Chat/ })).toHaveAttribute("data-unread", "1", { timeout: 60_000 });
  await a.getByRole("button", { name: /^Chat/ }).click();
  const boSaid = a.locator(".k-chat-msg", { hasText: "getting some on the way home" });
  await expect(boSaid).toBeVisible({ timeout: 60_000 });
  await a.locator(".k-chat-modal").getByRole("button", { name: "Close" }).click();

  // The name needs a reload here, and that is a limitation rather than a test convenience.
  //
  // Ana's membership list is re-read when the GROUP changes — a join, a role change. Bo renamed
  // himself AFTER joining, which changes his account profile and not the group, so nothing tells
  // Ana's open page to look again. What the reload proves is the half that is fixed: the rename
  // reached the space at all, from a device that never reloaded (`republishName`). Watching every
  // member's profile is the other half, and is recorded as a loose end rather than done here.
  await a.goto("/?user=chat-pair");
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });
  await a.getByRole("button", { name: /^Chat/ }).click();
  await expect(
    a.locator(".k-chat-msg", { hasText: "getting some on the way home" }).locator(".k-chat-who"),
  ).toHaveText("Bo", { timeout: 60_000 });
  await a.locator(".k-chat-modal").getByRole("button", { name: "Close" }).click();

  // ---- and on the record itself: the half nothing else can do ----
  await a.locator(".k-list-row", { hasText: "milk" }).click();
  await a.getByRole("button", { name: /Comments/ }).click();
  await say(a, "the oat one, not the soy one");

  await b.locator(".k-list-row", { hasText: "milk" }).click();
  const comment = b.locator(".k-record-thread .k-chat-msg", { hasText: "the oat one, not the soy one" });
  await expect(comment).toBeVisible({ timeout: 60_000 });
  await expect(comment.locator(".k-chat-who")).toHaveText("Ana");

  // A record's thread is its own: the room does not carry the comment, and the comment does not
  // carry the room. Same map, different thread key — which is exactly what could silently be wrong.
  await b.getByRole("button", { name: /^Chat/ }).click();
  await expect(b.locator(".k-chat-modal")).not.toContainText("the oat one");
  await expect(b.locator(".k-chat-modal")).toContainText("there is no milk in the shop");

  await ctxA.close();
  await ctxB.close();
});
