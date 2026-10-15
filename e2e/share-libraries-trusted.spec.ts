import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// An app with a library, shared by link, opens on the other device (#281).
//
// Before, the guest got the source and nothing else, and the app opened to "this app uses fancy-sum,
// which is not part of this app yet". Now the lock and the app's own modules travel with the source;
// the library's bytes do not. The guest is asked — in the card's words — before anything is fetched,
// fetches once, every byte checked against the lock, and from then on the app opens with no network.
// A library whose address no longer serves the locked bytes is refused by its name.
//
// esm.sh is answered from e2e/fixtures/esm, never contacted: what a person sees is the check — the
// question, the list drawing what the library computed, and the refusal naming the library.

const RELAY = process.env.POTYRO_E2E_RELAY ?? "ws://localhost:4201";
const ROOT = "https://esm.sh/fancy-sum@1.2.3?bundle";
const BUNDLE = "https://esm.sh/fancy-sum@1.2.3/es2022/fancy-sum.bundle.mjs";
const SITE: Record<string, string> = {
  [ROOT]: "fancy-sum-root.mjs",
  [BUNDLE]: "fancy-sum.bundle.mjs",
  "https://esm.sh/tiny-twice@0.1.0/es2022/tiny-twice.mjs": "tiny-twice.mjs",
};
const fixture = (name: string) => readFileSync(new URL(`./fixtures/esm/${name}`, import.meta.url), "utf8");

// The list's first line comes from the app's own module (`./label`), its second from the library: both
// kinds of code that have to reach the guest are drawn.
const summer = (withModule: boolean) => `import { defineApp } from "potyro";
import { describe } from "${ROOT}";
${withModule ? 'import { label } from "./label.ts";' : "const label = (t: string) => `Sum: ${t}`;"}
export default defineApp({
  id: "summer",
  name: "Summer",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    sum: { label: "Sum", displayField: "title", fields: { title: { type: "text", required: true }, n: { type: "number" } } },
  },
  pages: [
    { id: "all", title: "Sums", view: { type: "list", entity: "sum", display: { primary: (s) => label(s.title), secondary: (s) => describe(s.n) } } },
  ],
});
`;
const LABEL = "export const label = (t: string) => `Sum: ${t}`;\n";
const file = (name: string, text: string, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(text) });

/** Serve esm.sh from the fixtures (`override` replaces a file's body); returns the URLs asked for. */
async function esmSh(context: BrowserContext, override: Record<string, string> = {}): Promise<string[]> {
  const asked: string[] = [];
  await context.route("https://esm.sh/**", (route) => {
    const url = route.request().url();
    asked.push(url);
    const body = override[url] ?? (SITE[url] ? fixture(SITE[url]!) : undefined);
    if (body === undefined) return route.abort("internetdisconnected");
    return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
  });
  return asked;
}

/** No network beyond this machine from here on: every request elsewhere is refused, and recorded. */
async function offline(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => {
      asked.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  return asked;
}

async function device(browser: import("@playwright/test").Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), RELAY);
  return { context, page: await context.newPage() };
}

/** The author's device: Summer added from its files, with one record, shared. Returns the link. */
async function sharedSummer(page: Page, opts: { withModule: boolean; beforeSharing?: () => Promise<void> }): Promise<string> {
  await esmSh(page.context());
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([
    file("summer.app.tsx", summer(opts.withModule)),
    ...(opts.withModule ? [file("label.ts", LABEL)] : []),
    file("seed.json", '{"sum":[{"title":"Twelve","n":12}]}', "application/json"),
  ]);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Sum: Twelve" })).toContainText("fancy-sum says 24", { timeout: 30_000 });
  await opts.beforeSharing?.();

  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(page, "Summer", "share");
  // Added from a file without "run it as mine", it runs sealed — and sharing one is asked about.
  await page.locator(".k-dialog").getByRole("button", { name: "Share anyway" }).click();
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turns sync on
  await answerNamePrompt(page);
  const linkField = page.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await page.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  return link;
}

/** Join from the link, sandboxed, and return the question about the library. */
async function join(page: Page, link: string) {
  await page.goto(link);
  await page.locator(".k-dialog").getByRole("button", { name: /Join, keep it sealed/ }).click();
  await answerNamePrompt(page);
  const ask = page.locator(".k-dialog", { hasText: "needs fancy-sum 1.2.3 on this device" });
  await expect(ask).toBeVisible({ timeout: 60_000 });
  return ask;
}

test.describe.configure({ mode: "serial" });

test("an app with a library, shared by link, opens on the other device after it says yes — and then offline", async ({ browser }) => {
  test.slow();
  const a = await device(browser);
  const b = await device(browser);
  try {
    const link = await sharedSummer(a.page, { withModule: true });

    const fetched = await esmSh(b.context);
    const ask = await join(b.page, link);
    // The card's line: what, how much, from where. Nothing fetched until the person says so.
    await expect(ask).toContainText(/It fetches fancy-sum 1\.2\.3, \d+ B, from esm\.sh, once\./);
    expect(fetched).toEqual([]);
    await ask.getByRole("button", { name: "Fetch and open" }).click();

    // It opens, sandboxed, and the list draws what the library and the app's own module computed —
    // the record coming from the author's device through the space.
    await expect(b.page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 60_000 });
    await expect(b.page.locator(".k-list-row", { hasText: "Sum: Twelve" })).toContainText("fancy-sum says 24", { timeout: 60_000 });
    expect(new Set(fetched)).toEqual(new Set(Object.keys(SITE)));

    // And from now on with no network at all: nothing is asked, nothing leaves the machine.
    const elsewhere = await offline(b.context);
    const before = fetched.length;
    await b.page.goto("/?user=summer");
    await expect(b.page.locator(".k-list-row", { hasText: "Sum: Twelve" })).toContainText("fancy-sum says 24", { timeout: 60_000 });
    await expect(b.page.locator(".k-dialog", { hasText: "needs fancy-sum" })).toHaveCount(0);
    expect(elsewhere).toEqual([]);
    expect(fetched.length).toBe(before);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("a library whose address no longer serves the locked bytes is refused by its name", async ({ browser }) => {
  test.slow();
  const a = await device(browser);
  const c = await device(browser);
  try {
    const link = await sharedSummer(a.page, { withModule: true });

    await esmSh(c.context, { [BUNDLE]: 'export const describe = () => "changed upstream";\n' });
    const ask = await join(c.page, link);
    await ask.getByRole("button", { name: "Fetch and open" }).click();

    const splash = c.page.getByRole("alert");
    await expect(splash).toContainText("fancy-sum 1.2.3 from esm.sh is not the copy this app was made with", { timeout: 60_000 });
    await expect(c.page.locator(".k-app")).toHaveCount(0);
    await expect(c.page.getByText("changed upstream")).toHaveCount(0);
  } finally {
    await a.context.close();
    await c.context.close();
  }
});

test("an app shared from a device that sends no lock still opens: its library is fetched fresh, with consent", async ({ browser }) => {
  test.slow();
  const a = await device(browser);
  const b = await device(browser);
  try {
    // What an older client publishes: the source alone. Its lock is taken off its record before it
    // shares, so the space holds the app as a device from before #281 would have put it there.
    const link = await sharedSummer(a.page, {
      withModule: false,
      beforeSharing: () =>
        a.page.evaluate(() => {
          const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<Record<string, unknown>>;
          for (const app of apps) delete app.lock;
          localStorage.setItem("potyro:user-apps", JSON.stringify(apps));
        }),
    });

    const fetched = await esmSh(b.context);
    const ask = await join(b.page, link);
    await expect(ask).toContainText("It fetches fancy-sum 1.2.3 from esm.sh, once.");
    await ask.getByRole("button", { name: "Fetch and open" }).click();
    await expect(b.page.locator(".k-list-row", { hasText: "Sum: Twelve" })).toContainText("fancy-sum says 24", { timeout: 60_000 });
    expect(fetched.length).toBeGreaterThan(0);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
