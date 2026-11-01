// Shared steps for the share-files specs (docs/04 §Share): install the Cards fixture (trusted or
// sealed), open a card, and stand in for the browser's share sheet — which keeps what it was handed,
// so an app's spec can read the picture it shared.
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
    const w = window as unknown as { __shared: unknown[]; __sharedFiles: File[] };
    w.__shared = [];
    // The files themselves too, for a spec that reads the picture it was handed (sharedPicture).
    w.__sharedFiles = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (d: { files?: File[] }) => (d.files?.length ? filesOk : true) });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: { title?: string; text?: string; url?: string; files?: File[] }) => {
        w.__sharedFiles.push(...(d.files ?? []));
        const files = await Promise.all((d.files ?? []).map(async (f) => ({ name: f.name, type: f.type, size: f.size, head: Array.from(new Uint8Array(await f.slice(0, 8).arrayBuffer())) })));
        w.__shared.push({ title: d.title, text: d.text, url: d.url, files });
      },
    });
  }, opts.files);
}

/**
 * The last file the share sheet was handed, drawn on a canvas the page keeps as `window.__picture`
 * (its 2D context): a spec then reads the picture itself in a `page.evaluate`, not merely that some
 * file went. Answers the picture's size and file name.
 */
export async function drawSharedPicture(page: Page): Promise<{ w: number; h: number; name: string; type: string }> {
  return page.evaluate(async () => {
    const w = window as unknown as { __sharedFiles: File[]; __picture?: CanvasRenderingContext2D };
    const f = w.__sharedFiles.at(-1)!;
    const bmp = await createImageBitmap(f);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    w.__picture = g;
    return { w: c.width, h: c.height, name: f.name, type: f.type };
  });
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
