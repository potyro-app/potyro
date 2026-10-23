import { test, expect } from "./console-guard";
import { PNG_HEAD, catchSaves, fakeShareSheet, installCards, shared } from "./share-files";

// `ctx.ui.share({ files })` (docs/04 §Share), the app trusted, in Chromium and Firefox. The person sees
// every file before anything leaves — a picture as itself — and it goes through the device's share
// sheet where that can take files, or is saved as a copy. Firefox runs it too (`POTYRO_FIREFOX=1`):
// desktop Firefox has no share sheet at all, so there only Save a copy and Copy are offered.

const SHOTS = process.env.POTYRO_SHOTS;

test.use({ viewport: { width: 412, height: 860 }, hasTouch: true });

test("a picture the app made is shown in the dialog, and goes through the share sheet as a PNG with its words", async ({ page }) => {
  await fakeShareSheet(page);
  await installCards(page, true);
  await page.getByRole("button", { name: "Share picture" }).click();
  const dialog = page.getByRole("dialog", { name: "Share Autumn" });
  await expect(dialog).toBeVisible();
  // The picture is really drawn — not just an <img> element.
  const img = dialog.getByRole("img", { name: "picture-1.png" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(120);
  await expect(dialog.getByText("picture-1.png")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "What will be sent" })).toHaveValue("Autumn palette 🎨");
  if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/share-dialog-picture-${test.info().project.name}.png` });

  // The share sheet takes files here: it is the dialog's main way.
  const send = dialog.getByRole("button", { name: "Share", exact: true });
  await expect(send).toBeFocused();
  await send.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".k-toast", { hasText: "Sent" })).toBeVisible();
  const [one] = await shared(page);
  expect(one).toMatchObject({ text: "Autumn palette 🎨", files: [{ name: "picture-1.png", type: "image/png", head: PNG_HEAD }] });
  expect(one!.files[0]!.size).toBeGreaterThan(1000);
});

test("files of the app's folder: the picture and a CSV, each by its own name; saved as copies where there is no share sheet for files", async ({ page, browserName }) => {
  await fakeShareSheet(page, { files: false });
  await catchSaves(page);
  await installCards(page, true);
  await page.getByRole("button", { name: "Share kept" }).click();
  const dialog = page.getByRole("dialog", { name: "Share Autumn files" });
  await expect(dialog).toBeVisible();
  const list = dialog.getByRole("list", { name: "What will be sent" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("img", { name: "Autumn.png" })).toBeVisible();
  await expect(list.getByText("Autumn.csv")).toBeVisible();
  await expect(list.locator('[data-kind="file"]')).toContainText("CSV");
  if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/share-dialog-files-${test.info().project.name}.png` });

  // A sheet that cannot take files is not offered for them; nothing to copy either (no words, no link).
  await expect(dialog.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Copy/ })).toHaveCount(0);
  const save = dialog.getByRole("button", { name: "Save a copy" });
  await expect(save).toBeFocused();

  const isChromium = browserName === "chromium";
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await save.click();
  await expect(dialog.getByRole("status")).toHaveText("Saved the files");
  if (isChromium) {
    expect(await page.evaluate(() => (window as unknown as { __saved: Array<{ name: string; size: number }> }).__saved.map((s) => s.name))).toEqual(["Autumn.png", "Autumn.csv"]);
  } else {
    await expect.poll(() => downloads).toEqual(["Autumn.png", "Autumn.csv"]);
  }
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".k-toast", { hasText: "Sent" })).toBeVisible();
  expect(await shared(page)).toEqual([]);
});

test("closing the dialog sends nothing, and the app hears it", async ({ page }) => {
  await fakeShareSheet(page);
  await installCards(page, true);
  await page.getByRole("button", { name: "Share picture" }).click();
  const dialog = page.getByRole("dialog", { name: "Share Autumn" });
  await expect(dialog.getByRole("img", { name: "picture-1.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".k-toast", { hasText: "Not sent" })).toBeVisible();
  expect(await shared(page)).toEqual([]);
});
