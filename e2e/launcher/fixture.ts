import { expect, type Locator, type Page } from "@playwright/test";

// The launcher harness (#94): one seeded library, one way to reach each launcher surface, and the
// touch-target rule, shared by every spec in this directory.
//
// Eight user apps, on purpose: trusted and untrusted, synced and local, with names that collide on
// their first letter (three Gs, two Bs, two Ts) — the avatar is the initial, so a launcher that
// tells apps apart only by it fails here. Seeded once per page, not on every navigation, the way
// `edit-boundary-trusted.spec.ts` does it: a rename or delete under test must not be undone by the
// next page load re-seeding the original.

const app = (id: string, name: string, extra: { trusted?: boolean; sync?: boolean } = {}) => ({
  id,
  name,
  source:
    `import { defineApp } from "potyro";\n` +
    `export default defineApp({ id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, version: "1.0.0", schemaVersion: 1,\n` +
    `  entities: { item: { label: "Item", displayField: "title", fields: { title: { type: "text", required: true } } } },\n` +
    `  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }] });\n`,
  updatedAt: new Date(0).toISOString(),
  trusted: extra.trusted ?? true,
  ...(extra.sync ? { sync: true } : {}),
});

export const SEED = [
  app("groceries", "Groceries"),
  app("garden", "Garden", { sync: true }),
  app("gym-log", "Gym log", { trusted: false }),
  app("books", "Books"),
  app("budget", "Budget", { trusted: false, sync: true }),
  app("trips", "Trips"),
  app("tasks", "Tasks", { sync: true }),
  app("piano", "Piano practice", { trusted: false }),
] as const;

export const SEED_NAMES = SEED.map((a) => a.name);

/** Seed the library once per page. Pass `[]` for an empty one. */
export async function seed(page: Page, apps: readonly unknown[] = SEED): Promise<void> {
  await page.addInitScript(
    ([list]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify(list));
    },
    [apps] as const,
  );
}

export async function openHome(page: Page): Promise<Locator> {
  await page.goto("/");
  const home = page.locator(".k-launcher-home");
  await expect(home).toBeVisible();
  return home;
}

export async function openApp(page: Page, id: string, name: string): Promise<void> {
  await page.goto(`/?user=${id}`);
  await expect(page.locator("h1").first()).toHaveText(name, { timeout: 30_000 });
}

/** From inside an app: the ⊞ Apps button and the overlay it slides in. */
export async function openSwitcher(page: Page): Promise<Locator> {
  // By what it is, not by its name: the guard opens it in the pseudo-language too (#299).
  await page.locator("[data-tool=apps]:visible").first().click();
  const overlay = page.locator(".k-launcher-overlay");
  await expect(overlay).toBeVisible();
  // It slides in; a finger or a box measured mid-slide lands in the wrong place.
  await overlay.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  return overlay;
}

export const MIN_TAP = 44;

/** A control a thumb is expected to hit: at least 44px each way (WCAG 2.5.8 / HIG). */
export async function expectTappable(control: Locator): Promise<void> {
  const box = await control.boundingBox();
  expect(box, `${String(control)} has no box`).not.toBeNull();
  // Rounded: under mobile emulation 2.75rem comes back as 43.99999, which is 44px on any screen.
  expect(Math.round(Math.min(box!.width, box!.height)), `${String(control)} is ${box!.width}×${box!.height}`).toBeGreaterThanOrEqual(MIN_TAP);
}

/**
 * Pin the type to fonts every Linux Chromium has (DejaVu ships on Ubuntu runners and on developer
 * machines alike), so a baseline taken here compares on CI. The product's own stack is system
 * serif/sans, which differs from machine to machine — a baseline of that would be a baseline of the
 * fonts installed, not of the launcher.
 */
export async function pinFonts(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `:root { --font-display: "DejaVu Serif", serif !important; --font-ui: "DejaVu Sans", sans-serif !important; --font-mono: "DejaVu Sans Mono", monospace !important; }`,
  });
}

/**
 * The Tiles home screen (#96): the Start screen, chosen in Look. Classic is the default, so a spec
 * about Start says so — stored the way Look stores it, before the page's first script runs.
 */
export async function useStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const look = JSON.parse(localStorage.getItem("potyro:look") ?? "{}") as Record<string, unknown>;
    if (!look.launcher) localStorage.setItem("potyro:look", JSON.stringify({ appearance: "system", ...look, launcher: "start" }));
  });
}
