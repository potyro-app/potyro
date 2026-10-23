import { test, expect } from "./console-guard";
import { PNG_HEAD, fakeShareSheet, installCards, shared } from "./share-files";

// `ctx.ui.share({ files })` from a SEALED app (docs/04 §Share): its logic runs in the browser realm, and
// the files cross as data — a Blob as itself, a file of its folder by reference, resolved by the host
// in this app's own store only. No permission is asked: the person sees exactly what would be sent
// and picks where it goes.

const SHOTS = process.env.POTYRO_SHOTS;

test.use({ viewport: { width: 412, height: 860 }, hasTouch: true });

test("a sealed app's picture reaches the dialog and the share sheet, with no permission asked", async ({ page }) => {
  await fakeShareSheet(page);
  await installCards(page, false);
  await page.getByRole("button", { name: "Share picture" }).click();
  const dialog = page.getByRole("dialog", { name: "Share Autumn" });
  const img = dialog.getByRole("img", { name: "picture-1.png" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(120);
  // No permission prompt came first: the dialog IS the consent.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/share-dialog-picture-sealed.png` });
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.locator(".k-toast", { hasText: "Sent" })).toBeVisible();
  expect((await shared(page))[0]).toMatchObject({ text: "Autumn palette 🎨", files: [{ name: "picture-1.png", type: "image/png", head: PNG_HEAD }] });
});

test("a sealed app's own files go by reference: the picture and the CSV it kept", async ({ page }) => {
  await fakeShareSheet(page);
  await installCards(page, false);
  await page.getByRole("button", { name: "Share kept" }).click();
  const dialog = page.getByRole("dialog", { name: "Share Autumn files" });
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.locator(".k-toast", { hasText: "Sent" })).toBeVisible();
  const files = (await shared(page))[0]!.files;
  expect(files.map((f) => [f.name, f.type])).toEqual([
    ["Autumn.png", "image/png"],
    ["Autumn.csv", "text/csv"],
  ]);
  expect(files[0]!.head).toEqual(PNG_HEAD);
});
