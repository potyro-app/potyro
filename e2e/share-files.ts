// Shared steps for the share-files specs (docs/04 §Share): install the Cards fixture (trusted or
// sealed), open a card, and stand in for the browser's share sheet.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "./console-guard";

export async function installCards(page: Page, trusted: boolean): Promise<void> {
  const source = readFileSync(fileURLToPath(new URL("./fixtures/share-files.app.ts", import.meta.url)), "utf8");
  await page.addInitScript(
    ([src, t]) => {
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "share-files", name: "Cards", source: src, trusted: t, updatedAt: new Date().toISOString() }]));
    },
    [source, trusted] as const,
  );
  await page.goto("/?user=share-files");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", trusted ? "trusted" : "untrusted", { timeout: 30_000 });
  await page.getByRole("button", { name: /New card/ }).first().click();
  await expect(page.locator("article.k-detail")).toBeVisible({ timeout: 30_000 });
}

/** What a stand-in `navigator.share` was handed: the words, and each file's name, type, size and bytes. */
export interface Shared {
  title?: string;
  text?: string;
  url?: string;
  files: Array<{ name: string; type: string; size: number; head: number[] }>;
}

/**
 * A share sheet that records what it was given. `files: false` is a browser that shares words only
 * (`canShare({ files })` says no), as Chromium on Linux would if it had a sheet at all.
 */
export async function fakeShareSheet(page: Page, opts: { files: boolean } = { files: true }): Promise<void> {
  await page.addInitScript((filesOk) => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (d: { files?: File[] }) => (d.files?.length ? filesOk : true) });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: { title?: string; text?: string; url?: string; files?: File[] }) => {
        const files = await Promise.all((d.files ?? []).map(async (f) => ({ name: f.name, type: f.type, size: f.size, head: Array.from(new Uint8Array(await f.slice(0, 8).arrayBuffer())) })));
        w.__shared.push({ title: d.title, text: d.text, url: d.url, files });
      },
    });
  }, opts.files);
}

export const shared = (page: Page): Promise<Shared[]> => page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared);

/** Saved copies land here instead of a save dialog (Chromium's File System Access picker). */
export async function catchSaves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __saved: Array<{ name: string; size: number }>; showSaveFilePicker?: unknown };
    w.__saved = [];
    if (!("showSaveFilePicker" in window)) return; // Firefox: the <a download> fallback, a real download
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      createWritable: async () => {
        const parts: Blob[] = [];
        return { write: async (b: Blob) => void parts.push(b), close: async () => void w.__saved.push({ name: suggestedName, size: new Blob(parts).size }) };
      },
    });
  });
}

export const PNG_HEAD = [137, 80, 78, 71, 13, 10, 26, 10];
