import { test, expect, type Page } from "@playwright/test";

// There is ALWAYS a way to let a sealed app run as yours (owner, 2026-10-13). The bug that asked for
// it: Photo Garden added from a link installs sealed, p5 touches `window` as it loads, so the app
// never opens in the sealed box — and the screen that said so, "until you let it run as yours", had
// no way to do it. The badge and the sealed custom screen's button were unreachable because the app
// never rendered.
//
// The library here is a fixture that does the same: it reads `window` at load, then paints a canvas.
// Nothing leaves the test: the link and the library host are answered by the page's routes. The
// checks are what a person sees and gets: the card after the link install says it only works as
// theirs and offers it; skipped, the failure screen offers it too; after the one dialog the app
// opens as theirs and its canvas has real pixels. A sealed app is also promoted from its tile's
// menu with the keyboard. A library changed behind the app's back is NOT offered as fixable.

const LIB = "https://libs.example.test/paint-page@1.0.0/index.mjs";
// Reads the page as it loads (like p5 and most drawing libraries), then fills a canvas with one colour.
const LIBRARY = `export const ratio = window.devicePixelRatio || 1;
export function paint(canvas, colour) {
  const g = canvas.getContext("2d");
  g.fillStyle = colour;
  g.fillRect(0, 0, canvas.width, canvas.height);
}
`;

const source = (id: string, name: string) => `import { defineApp } from "potyro";
import { paint, ratio } from "${LIB}";
export default defineApp({
  id: "${id}",
  name: "${name}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { sketch: { label: "Sketch", fields: { title: { type: "text" } } } },
  pages: [
    {
      id: "draw",
      title: "Draw",
      view: {
        type: "custom",
        entity: "sketch",
        mount: (el) => {
          const canvas = document.createElement("canvas");
          canvas.className = "paint-stage";
          canvas.width = 160;
          canvas.height = 100;
          canvas.dataset.ratio = String(ratio);
          el.appendChild(canvas);
          paint(canvas, "#2a9d8f");
          return () => canvas.remove();
        },
      },
    },
  ],
});
`;

async function serve(page: Page, links: Record<string, string>, library = LIBRARY): Promise<void> {
  await page.context().route("https://libs.example.test/**", (route) =>
    route.request().url() === LIB
      ? route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: library })
      : route.abort("internetdisconnected"),
  );
  for (const [url, body] of Object.entries(links)) {
    await page.context().route(url, (route) => route.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body }));
  }
}

async function addFromLink(page: Page, url: string, name: string) {
  await page.goto(`/#add=${encodeURIComponent(url)}`);
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  await dialog.getByRole("button", { name: "Fetch" }).click();
  await expect(dialog.getByRole("region", { name: `About ${name}` })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("checkbox", { name: /I wrote this/ })).toHaveCount(0); // a link is never trusted on the way in
  await dialog.getByRole("button", { name: "Add app" }).click();
  return dialog;
}

/** The colour at the middle of the app's canvas, read from its pixels. */
async function paintedColour(page: Page): Promise<number[]> {
  const canvas = page.locator("canvas.paint-stage");
  await expect(canvas).toHaveCount(1, { timeout: 30_000 });
  return canvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext("2d")!.getImageData(80, 50, 1, 1).data));
}

const TEAL = [42, 157, 143, 255];

test.use({ viewport: { width: 1280, height: 800 } });

test("added from a link, an app that cannot open sealed is offered to run as yours: on the card, then on the screen that says it could not open", async ({ page }) => {
  const link = "https://apps.example.test/painter.app.tsx";
  await serve(page, { [link]: source("painter", "Painter") });
  const dialog = await addFromLink(page, link, "Painter");

  // The card after install says it plainly, offers the way, and says what happens otherwise.
  const after = dialog.getByRole("alert");
  await expect(after).toContainText("It only works when it runs as yours.", { timeout: 30_000 });
  await expect(after).toContainText("Otherwise it stays sealed, and it will not open.");
  await expect(after).toContainText("paint-page 1.0.0 needs a full web page to work");
  await expect(after.getByRole("button", { name: "Let it run as yours" })).toBeVisible();

  // Skipped: opened sealed, it does not open — and the screen that says so offers the same way out.
  await dialog.getByRole("button", { name: "Open Painter" }).click();
  const splash = page.locator(".k-splash-failed");
  await expect(splash).toContainText("It could not open.", { timeout: 30_000 });
  await expect(splash).toContainText("paint-page 1.0.0 needs a full web page to work");
  await expect(page.locator(".k-app")).toHaveCount(0);
  await splash.getByRole("button", { name: "Let it run as yours" }).click();

  // The one trust dialog, with the one warning.
  const trust = page.getByRole("dialog", { name: "Promote to trusted?" });
  await expect(trust).toContainText("Only promote an app you wrote or fully trust.");
  await trust.getByRole("button", { name: "Promote to trusted" }).click();

  // It reopens as yours, and the library really drew.
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  expect(await paintedColour(page)).toEqual(TEAL);
});

test("the card's button promotes too, and a sealed app is promoted from its tile's menu with the keyboard", async ({ page }) => {
  const one = "https://apps.example.test/painter-one.app.tsx";
  const two = "https://apps.example.test/painter-two.app.tsx";
  await serve(page, { [one]: source("painter-one", "Painter One"), [two]: source("painter-two", "Painter Two") });

  // From the card, straight after it was added.
  const dialog = await addFromLink(page, one, "Painter One");
  await dialog.getByRole("alert").getByRole("button", { name: "Let it run as yours" }).click({ timeout: 30_000 });
  await page.getByRole("dialog", { name: "Promote to trusted?" }).getByRole("button", { name: "Promote to trusted" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  expect(await paintedColour(page)).toEqual(TEAL);

  // Another one, added and left sealed: from home, its tile's ⋯ menu.
  const second = await addFromLink(page, two, "Painter Two");
  await expect(second.getByRole("alert")).toContainText("It only works when it runs as yours.", { timeout: 30_000 });
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Actions for Painter Two" });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Actions for Painter Two" });
  await expect(menu.getByRole("menuitem", { name: "Let it run as yours" })).toBeVisible();
  // An app that runs as yours already has no such item.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Actions for Painter One" }).click();
  await expect(page.getByRole("menu", { name: "Actions for Painter One" }).getByRole("menuitem", { name: "Let it run as yours" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await menuButton.focus();
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "Let it run as yours" }).focus();
  await page.keyboard.press("Enter");
  const trust = page.getByRole("dialog", { name: "Promote to trusted?" });
  await expect(trust).toContainText("no special capabilities");
  // Escape is no; focus starts on Cancel, the safe answer.
  await page.keyboard.press("Escape");
  await expect(trust).toHaveCount(0);
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "Let it run as yours" }).focus();
  await page.keyboard.press("Enter");
  await expect(trust.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(trust.getByRole("button", { name: "Promote to trusted" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("user")).toBe("painter-two");
  expect(await paintedColour(page)).toEqual(TEAL);
});

test("a library changed behind a sealed app's back is not offered as something promoting fixes", async ({ page }) => {
  const link = "https://apps.example.test/painter-tampered.app.tsx";
  await serve(page, { [link]: source("painter-tampered", "Painter Tampered") });
  const dialog = await addFromLink(page, link, "Painter Tampered");
  await expect(dialog.getByRole("alert")).toContainText("It only works when it runs as yours.", { timeout: 30_000 });

  // Swap the library's bytes in the app's folder, the way a broken sync or a meddling tool could.
  await page.goto("/");
  await page.evaluate(async (url) => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; lock?: Record<string, { file: string }> }>;
    const file = apps.find((a) => a.id === "painter-tampered")!.lock![url]!.file;
    const { openStore } = await import("/src/open-store.ts");
    const { writeLibraryFiles } = await import("/src/studio-libraries.ts");
    const store = await openStore("user:painter-tampered");
    await writeLibraryFiles(store, [{ path: file, data: new TextEncoder().encode("export const ratio = 1; export function paint() {}\n") }]);
  }, LIB);

  await page.goto("/?user=painter-tampered");
  const splash = page.locator(".k-splash-failed");
  await expect(splash).toContainText("paint-page 1.0.0 is not the copy this app was installed with, so it was not run.", { timeout: 30_000 });
  await expect(splash.getByRole("button", { name: "Back to my apps" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Let it run as yours" })).toHaveCount(0);
});

test("the Studio previews a sealed app sealed, and offers the same dialog — once, though the app is open underneath", async ({ page }) => {
  const custom = `import { defineApp } from "potyro";
export default defineApp({
  id: "own-screen",
  name: "Own Screen",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { note: { fields: { title: { type: "text" } } } },
  pages: [{ id: "home", title: "Home", view: { type: "custom", entity: "note", render: () => "Hello from my own code" } }],
});
`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  await dialog.getByRole("button", { name: /Paste the source/ }).click();
  await dialog.getByRole("textbox", { name: "The app's source" }).fill(custom);
  await dialog.getByRole("button", { name: "Check it" }).click();
  await expect(dialog.getByRole("region", { name: "About Own Screen" })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });

  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  const preview = studio.locator(".k-preview");
  // Opening it in the Studio is not saying it is yours: its own code does not run here either.
  await expect(preview.getByRole("button", { name: "Run it as mine…" })).toBeVisible({ timeout: 60_000 });
  await expect(preview.getByText("Hello from my own code")).toHaveCount(0);

  // The sealed screen's own button: one dialog, though the same app is open under the Studio.
  await preview.getByRole("button", { name: "Run it as mine…" }).click();
  await expect(page.getByRole("dialog", { name: "Promote to trusted?" })).toHaveCount(1);
  await page.getByRole("dialog", { name: "Promote to trusted?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Promote to trusted?" })).toHaveCount(0);

  await preview.getByRole("button", { name: "Let it run as yours" }).click();
  await page.getByRole("dialog", { name: "Promote to trusted?" }).getByRole("button", { name: "Promote to trusted" }).click();
  await expect(preview.getByText("Hello from my own code")).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole("button", { name: "Let it run as yours" })).toHaveCount(0);

  // Closed, the app underneath is the promoted one too.
  await studio.getByRole("button", { name: "Close studio" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await expect(page.getByText("Hello from my own code")).toBeVisible();
});
