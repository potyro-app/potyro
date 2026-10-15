// The page a demo link answers with (docs/24 §4): the shell's own index.html, with what a chat needs
// to draw a preview written into its <head> — Open Graph for WhatsApp, Telegram, iMessage, Discord and
// Facebook, Twitter's card for X. Every value is the sharer's title and description, escaped here.
import type { ImageType, ShareMeta } from "./wire.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

export interface PageLinks {
  /** The link itself, without its fragment: `https://apps.example/s/<id>` */
  page: string;
  /** The preview picture, when there is one. */
  image?: string;
  imageType?: ImageType;
}

/** OG's locale is `pl_PL`; a bare `pl` stays `pl`. */
const ogLocale = (lang: string): string => lang.replace("-", "_");

export function previewTags(meta: ShareMeta, links: PageLinks): string {
  const tag = (attr: "property" | "name", key: string, value: string) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const lines = [
    `<title>${escapeHtml(meta.title)} · Potyro</title>`,
    tag("name", "description", meta.description),
    // A link is for whoever it was sent to, not for search engines.
    tag("name", "robots", "noindex, nofollow"),
    tag("property", "og:type", "website"),
    tag("property", "og:site_name", "Potyro"),
    tag("property", "og:title", meta.title),
    tag("property", "og:description", meta.description),
    tag("property", "og:url", links.page),
    tag("property", "og:locale", ogLocale(meta.lang)),
    tag("name", "twitter:card", links.image ? "summary_large_image" : "summary"),
    tag("name", "twitter:title", meta.title),
    tag("name", "twitter:description", meta.description),
  ];
  if (links.image) {
    lines.push(
      tag("property", "og:image", links.image),
      tag("property", "og:image:type", links.imageType ?? "image/jpeg"),
      tag("property", "og:image:width", "1200"),
      tag("property", "og:image:height", "630"),
      tag("property", "og:image:alt", meta.title),
      tag("name", "twitter:image", links.image),
    );
  }
  return lines.join("\n    ");
}

/**
 * The shell's index.html with the preview written in. Its own <title> is replaced; everything else —
 * the CSP, the scripts — is left exactly as built.
 */
export function sharePage(indexHtml: string, meta: ShareMeta, links: PageLinks): string {
  const tags = previewTags(meta, links);
  const withoutTitle = indexHtml.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
  // After the charset, which must stay first; else straight after <head>.
  if (/<meta\s+charset[^>]*>/i.test(withoutTitle)) return withoutTitle.replace(/<meta\s+charset[^>]*>/i, (charset) => `${charset}\n    ${tags}`);
  if (/<head[^>]*>/i.test(withoutTitle)) return withoutTitle.replace(/<head[^>]*>/i, (head) => `${head}\n    ${tags}`);
  return `<!doctype html><html><head>${tags}</head><body></body></html>`;
}
