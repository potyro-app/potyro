import { test, expect } from "./console-guard";
import { foreignHosts, makeDemoLink, stranger } from "./share-demo";

// Link previews (docs/24 §4–§5). With the share service there (the dev server mounts it), a demo link
// is short — `/s/<id>#k=<key>` — and its page carries Open Graph and Twitter meta: the app's name, a
// line about trying it, and a picture drawn from DEMO records. The service holds the package sealed;
// the key is in the fragment, which it never sees. Nothing of the sharer's records is in any of it.

const SECRET = "Prezent dla Ani";

test("a hosted link: preview meta and picture for chats, nothing of the sharer's records, and it opens", async ({ page, browser, baseURL }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.getByRole("textbox", { name: "Add an item" }).fill(SECRET);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: SECRET })).toBeVisible();

  const link = await makeDemoLink(page, "Groceries");
  const url = new URL(link);
  expect(url.pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{22}$/);
  expect(url.hash).toMatch(/^#k=[A-Za-z0-9_-]{22}$/);
  // A hosted link shows a preview: the sheet does not warn that it will not.
  await expect(page.locator(".k-share-sheet")).not.toContainText("without a preview picture");

  // What a crawler fetches: the page, without the fragment.
  const res = await page.request.get(url.pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()["x-robots-tag"]).toMatch(/noindex/);
  const html = await res.text();
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
  expect(meta("og:title")).toBe("Groceries");
  expect(meta("og:description")).toMatch(/Try it in your browser/);
  expect(meta("twitter:card")).toBe("summary_large_image");
  expect(meta("og:url")).toBe(`${url.origin}${url.pathname}`);
  const image = meta("og:image")!;
  expect(image).toBe(`${url.origin}${url.pathname}/preview.jpg`);
  expect(meta("twitter:image")).toBe(image);
  expect(html).toContain("<title>Groceries · Potyro</title>");
  expect(html).not.toContain(SECRET);
  // The preview names the app, not what is in it: no record of anyone's, demo or not, is in the page.
  expect(html).not.toContain("Apples");

  // The picture: a JPEG, the card's size, well under WhatsApp's limit.
  const picture = await page.request.get(new URL(image).pathname);
  expect(picture.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await picture.body();
  expect(bytes.length).toBeGreaterThan(5_000);
  expect(bytes.length).toBeLessThanOrEqual(300 * 1024);
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
  const size = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, image);
  expect(size).toEqual([1200, 630]);

  // What the service holds is sealed: neither the sharer's record nor the demo's is readable in it.
  const id = url.pathname.split("/").pop()!;
  const sealed = (await (await page.request.get(`/share-api/shares/${id}/payload`)).body()).toString("latin1");
  expect(sealed).not.toContain(SECRET);
  expect(sealed).not.toContain("Apples");
  // Not a zip: no local-file header anywhere (two letters alone turn up in random bytes by chance).
  expect(sealed).not.toContain("PK\u0003\u0004");

  // And it opens, for someone who has never used Potyro, sealed and in their language.
  const { context, page: viewer } = await stranger(browser, baseURL!, { locale: "pl-PL" });
  const foreign = foreignHosts(context, url.hostname);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  await viewer.getByRole("checkbox", { name: "Milk" }).click();
  await expect(viewer.getByRole("checkbox", { name: "Milk" })).toHaveAttribute("aria-checked", "true");
  await expect(viewer.getByText(SECRET)).toHaveCount(0);
  await expect(viewer.locator(".k-demo-bar")).toContainText("Zrobione w Potyro");
  expect(foreign).toEqual([]);
  await context.close();
});

test("a link its sharer took down says so, in plain words", async ({ page, browser, baseURL, consoleGuard }) => {
  // The service answers a taken-down link's package with 404, on purpose; the browser logs that fetch.
  consoleGuard.allow(/Failed to load resource: the server responded with a status of 404/, "the link was taken down on purpose: its package is gone");
  const link = await makeDemoLink(page, "Groceries");
  const id = new URL(link).pathname.split("/").pop()!;
  const token = await page.evaluate((i) => (JSON.parse(localStorage.getItem("potyro:shares") ?? "[]") as Array<{ id: string; deleteToken: string }>).find((s) => s.id === i)?.deleteToken, id);
  expect(token).toBeTruthy();
  const gone = await page.request.delete(`/share-api/shares/${id}`, { headers: { "x-delete-token": token! } });
  expect(gone.status()).toBe(200);

  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-splash-failed")).toContainText("This link no longer works", { timeout: 15_000 });
  await context.close();
});
