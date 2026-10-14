import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// An app in two languages, shared between an English device and a Polish one (#302, docs/20 §6).
//
// The owner reads English on an en-US browser and runs the app as their own. The guest's browser is
// Polish, and they join keeping the app SANDBOXED — so the guest's copy runs in the sealed box, where
// there is no `Intl`: its Polish words come from the definition's maps, its dates and plurals from
// the host through `__hostPure`. Both see the same records, each in their own language; a record's
// own text is never translated, and an enum keeps its stored option while its label follows the
// device.

const RELAY = process.env.POTYRO_RELAY_URL ?? "ws://localhost:4201";

const APP = `import { defineApp } from "potyro";

export default defineApp({
  id: "langs",
  name: { en: "Spots", pl: "Miejsca" },
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pl"],
  entities: {
    spot: {
      label: { en: "Spot", pl: "Miejsce" },
      icon: "📍",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", pl: "Nazwa" } },
        kind: {
          type: "enum",
          options: ["cafe", "park"],
          label: { en: "Kind", pl: "Rodzaj" },
          labels: { cafe: { en: "Café", pl: "Kawiarnia" }, park: { en: "Park", pl: "Park miejski" } },
        },
      },
      computed: {
        added: (s, ctx) => ctx.t({ en: "Added {d}", pl: "Dodane {d}" }, { d: ctx.format.date(new Date(String(s.createdAt)), { dateStyle: "long" }) }),
      },
    },
  },
  pages: [
    {
      id: "all",
      title: { en: "Spots", pl: "Miejsca" },
      summary: [
        {
          label: { en: "How many", pl: "Ile" },
          value: (rows, ctx) =>
            ctx.t({ en: "{n, plural, one {# spot} other {# spots}}", pl: "{n, plural, one {# miejsce} few {# miejsca} many {# miejsc} other {# miejsca}}" }, { n: rows.length }),
        },
      ],
      view: {
        type: "list",
        entity: "spot",
        display: { primary: "name", secondary: "added", badges: ["kind"] },
        emptyText: { en: "No spots yet.", pl: "Jeszcze nie ma miejsc." },
      },
    },
  ],
});
`;

const EN_MONTH = /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/;
const PL_MONTH = /\d{1,2} (stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia) \d{4}/;

async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript(
    ([source, seedApp, relay]) => {
      localStorage.setItem("potyro:sync:relay", relay as string);
      if (!seedApp || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "langs", name: "Spots", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [APP, opts?.app ?? false, RELAY] as const,
  );
  return context.newPage();
}

async function add(page: Page, opts: { newButton: RegExp; nameLabel: string; name: string; kind: string }): Promise<void> {
  await page.getByRole("button", { name: opts.newButton }).first().click();
  await page.getByLabel(new RegExp(`^${opts.nameLabel}`)).first().fill(opts.name);
  await page.getByRole("radio", { name: opts.kind }).click();
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: opts.name })).toBeVisible({ timeout: 30_000 });
}

const row = (page: Page, name: string) => page.locator(".k-list-row", { hasText: name });

test("one app, two languages: an English owner and a Polish guest in the sealed box share its records", async ({ browser }) => {
  test.slow();

  // ---- the owner, in English ----
  const ctxA = await browser.newContext({ locale: "en-US" });
  const a = await device(ctxA, { app: true });
  await a.goto("/?user=langs");
  await expect(a.locator("h1").first()).toHaveText("Spots", { timeout: 30_000 });
  await expect(a.getByText("No spots yet.")).toBeVisible();
  await add(a, { newButton: /Add: Spot|Add Spot/i, nameLabel: "Name", name: "Miradouro", kind: "Café" });
  await expect(row(a, "Miradouro")).toContainText(EN_MONTH);
  await expect(row(a, "Miradouro").locator(".k-badge")).toHaveText("Café");
  await expect(a.getByText("1 spot", { exact: true })).toBeVisible();

  // ---- share it ----
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Spots", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a);
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await a.goto("/?user=langs");
  await expect(a.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });

  // ---- the guest, in Polish, keeping it sandboxed ----
  const ctxB = await browser.newContext({ locale: "pl-PL" });
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: "Join, keep sandboxed" }).click();
  await answerNamePrompt(b);
  await expect(b.locator("h1").first()).toHaveText("Miejsca", { timeout: 60_000 });
  await expect(b.getByRole("button", { name: "Runs in a sandbox: review" })).toBeVisible(); // the sealed box
  await expect(row(b, "Miradouro")).toBeVisible({ timeout: 60_000 }); // the record, as typed
  await expect(row(b, "Miradouro")).toContainText(PL_MONTH); // ctx.format, answered by the host
  await expect(row(b, "Miradouro")).toContainText("Dodane ");
  await expect(row(b, "Miradouro").locator(".k-badge")).toHaveText("Kawiarnia"); // the option's Polish label
  await expect(b.getByText("1 miejsce", { exact: true })).toBeVisible(); // an ICU plural, in Polish

  // ---- the guest adds one, in Polish; the owner reads it in English ----
  await add(b, { newButton: /Add: Miejsce|Add Miejsce|Add: Spot/i, nameLabel: "Nazwa", name: "Łazienki", kind: "Park miejski" });
  await expect(b.getByText("2 miejsca", { exact: true })).toBeVisible();
  await expect(row(a, "Łazienki")).toBeVisible({ timeout: 60_000 });
  await expect(row(a, "Łazienki").locator(".k-badge")).toHaveText("Park"); // stored "park", read in English
  await expect(a.getByText("2 spots", { exact: true })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test("a Polish browser reads groceries in Polish; an app without its language says so, quietly", async ({ browser }) => {
  const pl = await browser.newContext({ locale: "pl-PL" });
  const page = await pl.newPage();
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Zakupy", { timeout: 30_000 });
  await expect(page.getByText("Lista jest pusta. Dodaj pierwszą rzecz poniżej.").or(page.locator(".k-check-row").first())).toBeVisible();
  await pl.close();

  // Every example carries the six languages the shell ships (#303), so a French browser is the one
  // an example has no words for: Plants opens in English, with one line in the app's menu.
  const fr = await browser.newContext({ locale: "fr-FR" });
  const p = await fr.newPage();
  await p.goto("/?user=plants");
  await expect(p.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
  await expect(p.locator('[lang="en"]').first()).toBeAttached();
  await expect(p.getByRole("button", { name: /Translate into/ }).or(p.getByText("This app is in English.")).first()).toBeAttached();
  await fr.close();
});
