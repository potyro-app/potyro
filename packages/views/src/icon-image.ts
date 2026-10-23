// A picture as an icon (#425): what goes in an <img>'s `src` for an inline `<svg>` or a `data:`
// URL written in an app's source. Shown only through <img> (or drawn on a canvas) — an image never
// runs script, never loads what it references, never reaches the page's DOM — and the SVG text is
// still cleaned first: scripts, handlers, foreign objects and anything pointing outside the file go,
// so the same string is as harmless pasted anywhere else as it is here.

import { isImageIcon, isImagePath } from "potyro";

const SVG_DROP_TAGS = /<\s*(script|foreignObject|iframe|embed|object|animate|set|animateTransform|animateMotion)\b[\s\S]*?(?:<\/\s*\1\s*>|\/>)/gi;
const SVG_DROP_ATTRS = /\s(?:on[a-z]+|xlink:href|href)\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*'|(?!["'#])[^\s>"']+)/gi;
const SVG_DROP_STYLE_URLS = /url\(\s*(?:'|")?(?!#)[^)]*\)/gi;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The SVG text with everything that could run or reach out removed; same-document `#id` links
 * stay. An <img> draws an SVG only with its namespace declared, which a hand-written or generated
 * one often leaves out: it is put on the root when missing.
 */
export function cleanSvg(svg: string): string {
  const clean = svg.replace(SVG_DROP_TAGS, "").replace(SVG_DROP_ATTRS, "").replace(SVG_DROP_STYLE_URLS, "none");
  return /<svg\b[^>]*\sxmlns\s*=/i.test(clean) ? clean : clean.replace(/<svg\b/i, `<svg xmlns="${SVG_NS}"`);
}

/**
 * The `src` for a picture carried in the string: the `data:` URL as given, an inline `<svg>` cleaned
 * and encoded. A path (a file the app ships) has no `src` of its own — it is resolved through the
 * app's files — so this answers undefined for it, as for anything that is not a picture.
 */
export function imageIconSrc(icon: string | undefined | null): string | undefined {
  if (!isImageIcon(icon) || isImagePath(icon)) return undefined;
  if (/^data:/i.test(icon)) {
    // A `data:image/svg+xml` carries text that may carry script: clean it the same way.
    const m = /^data:image\/svg\+xml(;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(icon);
    if (!m) return icon;
    let text: string;
    try {
      text = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!);
    } catch {
      return undefined;
    }
    return `data:image/svg+xml;utf8,${encodeURIComponent(cleanSvg(text))}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(cleanSvg(icon.trim()))}`;
}
