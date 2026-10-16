// A record's picture, wherever it comes from: a media field's photo (`MediaRef`), a file field's file
// (`FileRef`), or a path in the app's own files (`"art/squat.jpg"`) — what a computed returns to give
// every kind of record its own picture, and what a page's `background` names.

import { useEffect, useRef, useState } from "react";
import type { Ctx, FileRef, MediaRef } from "potyro";
import { releaseMediaUrl } from "./media-input.js";

const isMediaRef = (v: unknown): v is MediaRef => typeof v === "object" && v !== null && typeof (v as MediaRef).key === "string";
const isFileRef = (v: unknown): v is FileRef => typeof v === "object" && v !== null && typeof (v as FileRef).id === "string";

/** The first picture in a value (a list of photos shows its first). */
export function pictureOf(value: unknown): MediaRef | FileRef | string | undefined {
  const one = Array.isArray(value) ? value[0] : value;
  if (isMediaRef(one) || isFileRef(one)) return one;
  if (typeof one === "string" && one.trim()) return one.trim();
  return undefined;
}

/**
 * A URL for a picture, and whether the caller owns it. A photo's URL is minted for this caller and
 * must be released; a file's comes from the app's folder, which keeps it.
 */
export async function pictureUrl(ctx: Pick<Ctx, "media" | "files">, picture: MediaRef | FileRef | string): Promise<{ url: string; owned: boolean } | null> {
  try {
    if (isMediaRef(picture)) {
      const url = await ctx.media.url(picture);
      return url ? { url, owned: true } : null;
    }
    const url = await ctx.files?.url(picture);
    return url ? { url, owned: false } : null;
  } catch {
    // A picture that cannot be read is a page without that picture: the words around it still say
    // what the record is. The store has already said why where it failed.
    return null;
  }
}

/**
 * `pictureUrl` as a hook: `null` until it is ready, or when there is none.
 *
 * Keyed by the PICTURE, never by `ctx`: `runtime.ctx` is a fresh object on every access, so an effect
 * that depended on it ran again on every render — each run asked for the URL anew and set it, which
 * rendered again — and the image's `src` changed faster than it could load. A page's background
 * picture never appeared (#368). The URL a page shows is freed once another has replaced it.
 */
export function usePictureUrl(ctx: Pick<Ctx, "media" | "files">, value: unknown): string | null {
  const picture = pictureOf(value);
  const key = picture === undefined ? "" : typeof picture === "string" ? `p:${picture}` : isMediaRef(picture) ? `m:${picture.key}` : `f:${picture.id}`;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const pictureRef = useRef(picture);
  pictureRef.current = picture;
  const [shown, setShown] = useState<{ url: string; owned: boolean } | null>(null);
  useEffect(() => {
    const want = pictureRef.current;
    if (!want) {
      setShown(null);
      return;
    }
    let alive = true;
    void pictureUrl(ctxRef.current, want).then((got) => {
      if (alive) setShown(got);
      else if (got?.owned) releaseMediaUrl(got.url);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  // Free a photo's URL once the next one is on screen, or the page has gone.
  const onScreen = useRef<{ url: string; owned: boolean } | null>(null);
  useEffect(() => {
    const before = onScreen.current;
    onScreen.current = shown;
    if (before?.owned && before.url !== shown?.url) releaseMediaUrl(before.url);
  }, [shown]);
  useEffect(
    () => () => {
      if (onScreen.current?.owned) releaseMediaUrl(onScreen.current.url);
    },
    [],
  );
  return shown?.url ?? null;
}
