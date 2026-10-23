// What the browser shows of an open app outside the page (DESIGN.md §8.5, #424): the tab's title is
// the app's name, and the tab's icon is the app's favicon — a circle of its colour with its initial in
// Quicksand 700 graphite — drawn here on a canvas (a favicon cannot reach the page's fonts on its
// own). Back on the launcher, Potyro's own title and icon return.

import { initialOf } from "@potyro/views";
import { useEffect } from "react";
import { tracoOf } from "./app-colour.js";

const GRAPHITE = "#231f20";
const SIZE = 64;

let potyro: { title: string; href: string | null } | null = null;

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

/** The favicon for an app: its colour's circle with the name's initial, as a PNG data: URL. */
export async function appFavicon(name: string, hue: number): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    await document.fonts?.load(`700 ${SIZE * 0.56}px "Quicksand"`);
  } catch {
    // the system's rounded face then
  }
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = tracoOf(hue);
  ctx.fill();
  ctx.fillStyle = GRAPHITE;
  ctx.font = `700 ${SIZE * 0.56}px "Quicksand", "Nunito", ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initialOf(name), SIZE / 2, SIZE / 2 + SIZE * 0.03);
  return canvas.toDataURL("image/png");
}

/** While an app is open: its name as the title, its favicon in the tab. Potyro's own come back after. */
export function useAppHead(name: string | undefined, hue: number, on = true): void {
  useEffect(() => {
    if (!on || !name || typeof document === "undefined") return;
    const link = iconLink();
    potyro ??= { title: document.title, href: link?.getAttribute("href") ?? null };
    document.title = name;
    let live = true;
    void appFavicon(name, hue).then((url) => {
      if (live && url && link) link.setAttribute("href", url);
    });
    return () => {
      live = false;
      if (!potyro) return;
      document.title = potyro.title;
      if (link && potyro.href) link.setAttribute("href", potyro.href);
    };
  }, [name, hue, on]);
}
