// The gallery's feed (docs/33): what the gallery has published, as one small file beside its page,
// for the gallery's fediverse account to post from (packages/fediverse, which checks it again as it
// reads it: packages/fediverse/src/feed.ts). A file, not an import: that service runs on the server
// alone and depends on no Potyro package.
//
// Only what a post says goes in: each published app's name and line in every language, its demo
// link and Make-it-mine link, when the link was made (when the gallery knows), and one picture.
import { hasShotSet, LANGUAGES, remixLink, shotPath, shownApps, SHOT_WIDTHS } from "./data.mjs";

export const FEED_FORMAT = "potyro-gallery-feed/1";

const MEDIA_TYPES = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" };

/**
 * The picture a post carries: the first language's, light, the widest, as WebP (every server reads
 * it; not every one reads AVIF) — or the one file an app has when it has no set.
 * @param {{ id: string; screenshot?: string }} app
 * @param {(path: string) => { width: number; height: number } | null} sizeOf  a picture's size, by its path under the gallery
 */
export function feedImage(app, sizeOf) {
  if (!app.screenshot) return undefined;
  const path = hasShotSet(app) ? shotPath(app.id, { width: SHOT_WIDTHS[SHOT_WIDTHS.length - 1] }) : app.screenshot;
  const mediaType = MEDIA_TYPES[/** @type {keyof typeof MEDIA_TYPES} */ (path.split(".").pop() ?? "")];
  const size = sizeOf(path);
  if (!mediaType || !size) throw new Error(`${app.id}: its picture ${path} cannot go in the feed`);
  return { path, mediaType, width: size.width, height: size.height };
}

/**
 * @param {import("./data.mjs").Gallery} gallery  checked (readGallery)
 * @param {Record<string, Record<string, string>>} strings  checked (readStrings)
 * @param {(path: string) => { width: number; height: number } | null} sizeOf
 */
export function galleryFeed(gallery, strings, sizeOf) {
  const said = (/** @type {string} */ key) => Object.fromEntries(LANGUAGES.map((l) => [l, strings[l][key]]));
  return {
    format: FEED_FORMAT,
    languages: [...LANGUAGES],
    words: { tryIt: said("tryIt"), makeItMine: said("makeItMine"), shotAlt: said("shotAlt") },
    apps: shownApps(gallery).published.map((app) => ({
      id: app.id,
      ...(app.publishedAt ? { publishedAt: app.publishedAt } : {}),
      link: app.link,
      remix: remixLink(app.link ?? ""),
      name: app.name,
      line: app.line,
      image: feedImage(app, sizeOf),
    })),
  };
}
