// What both screens share: a DOM helper, the photo (in, and back out of the app's folder), and
// sending a puzzle to someone.
import type { Ctx, FileRef, Resolved } from "potyro";
import { clock, coverCrop } from "./jigsaw.js";
import { W } from "./words.js";

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

export const reducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
export const buzz = (ctx: Ctx, pattern: number | number[]): void => void ctx.caps.haptics?.vibrate(pattern).catch(() => undefined);

/** The longest side a kept photo has: sharp on a phone's screen, small enough to travel. */
const KEEP = 1440;

/**
 * A photo from the camera capability (never the browser's camera itself — CLAUDE.md rule 2), cropped
 * to 3:4 and shrunk, as a JPEG. `null` when the person chose nothing.
 */
export async function takePhoto(ctx: Ctx, source: "camera" | "library"): Promise<Blob | null> {
  const camera = ctx.caps.camera;
  if (!camera) {
    ctx.ui.toast(W.noCamera);
    return null;
  }
  let picked: Blob;
  try {
    picked = await camera.capture({ source });
  } catch {
    return null; // nothing chosen
  }
  try {
    const bmp = await createImageBitmap(picked);
    try {
      const crop = coverCrop(bmp.width, bmp.height, 3, 4);
      const scale = Math.min(1, KEEP / crop.h);
      const c = document.createElement("canvas");
      c.width = Math.round(crop.w * scale);
      c.height = Math.round(crop.h * scale);
      const g = c.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
      const jpeg = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.86));
      if (!jpeg) throw new Error("no image");
      return jpeg;
    } finally {
      bmp.close();
    }
  } catch {
    ctx.ui.toast(W.notPicture);
    return null;
  }
}

/** Keep a photo as a puzzle: the JPEG in the app's folder, and a record pointing at it. */
export async function keepPuzzle(ctx: Ctx, jpeg: Blob): Promise<Resolved | null> {
  try {
    const now = ctx.now();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const file = await ctx.files.write(`photos/${stamp}.jpg`, jpeg, { mime: "image/jpeg" });
    const photo: FileRef = { id: file.id, path: file.path, name: file.name, mime: file.mime };
    const title = ctx.t(W.untitled, { when: ctx.format.date(now, { day: "numeric", month: "short" }) });
    return await ctx.create("puzzle", { title, photo, from: ctx.me.name });
  } catch {
    ctx.ui.toast(W.notSaved);
    return null;
  }
}

/**
 * The photo's address, waiting for it when it is not on this device yet: a shared app's files come on
 * demand (#255), and asking is what fetches them. `null` if it never came within `waitMs`.
 */
export async function photoUrl(ctx: () => Ctx, ref: FileRef | undefined, alive: () => boolean, waitMs = 60_000): Promise<string | null> {
  if (!ref) return null;
  const until = Date.now() + waitMs;
  for (let delay = 300; alive() && Date.now() < until; delay = Math.min(3000, delay * 1.6)) {
    const url = await ctx().files.url(ref).catch(() => null);
    if (url) return url;
    await new Promise((ok) => setTimeout(ok, delay));
  }
  return null;
}

/** Who made a puzzle, as this device should say it: you, or the person by name. */
export function madeBy(ctx: Ctx, r: Resolved): { mine: boolean; name: string } {
  const mine = !r.createdBy || r.createdBy === ctx.me.id;
  const member = ctx.space?.members.find((m) => m.id === r.createdBy);
  return { mine, name: member?.name || String(r.from || "") };
}

/**
 * Send a puzzle: it travels inside the app, so "send" means a link into this app's shared space. The
 * person is told first, plainly, that the photo goes to whoever opens the link. A solo app has no
 * space yet: sharing it is the shell's (it turns on sync and asks), so the app says where to do it.
 */
export async function sendPuzzle(ctx: Ctx, best?: number): Promise<void> {
  const space = ctx.space;
  if (!space) {
    await ctx.ui.confirm(W.shareFirst, { detail: W.shareFirstDetail, ok: W.gotIt, cancel: W.cancel });
    return;
  }
  if (space.role !== "admin") {
    ctx.ui.toast(W.alreadyShared);
    return;
  }
  const go = await ctx.ui.confirm(W.sendTitle, { detail: W.sendDetail, ok: W.sendOk, cancel: W.cancel });
  if (!go) return;
  const link = await space.invite();
  const text = best ? ctx.t(W.sendText, { time: clock(best) }) : ctx.t(W.sendTextNew);
  const sent = await ctx.ui.share({ title: W.sendShareTitle, text, url: link });
  if (sent) ctx.ui.toast(W.sent);
}
