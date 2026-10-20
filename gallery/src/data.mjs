// The gallery's data (docs/24 §10): which apps it shows, in six languages, and the demo link each one
// opens. One file, `gallery/gallery.json`, edited by people (names, lines, categories, which apps are
// ready) and by `pnpm gallery:publish` (each ready app's link and screenshot, nothing else).
//
// Plain JavaScript with JSDoc types, so `node` runs it as it is — the build and the publish script are
// Node, and need no compiler. Validated before anything is built or published: a gallery that says a
// thing in five languages, or links somewhere a demo link cannot be, is refused in plain words.

/** Potyro's languages: the same six as packages/i18n (`LOCALES`; a test keeps the two equal). */
export const LANGUAGES = /** @type {const} */ (["en", "pt-BR", "de", "es", "pl", "it"]);

/** The source language: what a page without JavaScript shows, and what any gap falls back to. */
export const SOURCE_LANGUAGE = "en";

export const FORMAT = "potyro-gallery/1";

/** The remix intent a gallery card's "Make it mine" adds to the demo link (shell: demo-link.ts). */
export const REMIX_PARAM = "remix=1";

/** The longest one line a card can hold without wrapping to a paragraph. */
export const MAX_LINE = 110;

/**
 * @typedef {typeof LANGUAGES[number]} Language
 * @typedef {Record<Language, string>} Words
 * @typedef {{ example: string } | { package: string[]; files?: string; seed?: string }} From
 * @typedef {{
 *   id: string;
 *   status: "ready" | "coming-soon";
 *   category: string;
 *   icon?: string;
 *   name: Words;
 *   line: Words;
 *   from?: From;
 *   waitsFor?: string;
 *   link?: string;
 *   screenshot?: string;
 *   publishedAt?: string;
 * }} GalleryApp
 * @typedef {{ format: string; categories: Record<string, Words>; apps: GalleryApp[] }} Gallery
 */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A hosted demo link (docs/24 §2): `<site>/s/<id>#k=<key>`, and nothing else in its fragment. */
const HOSTED_RE = /^https?:\/\/[^/\s#?]+(?:\/[^\s#?]*)?\/s\/[A-Za-z0-9_-]{16,64}#k=[A-Za-z0-9_-]+$/;
const SHOT_RE = /^shots\/[a-z0-9][a-z0-9-]*\.(?:jpg|png|webp)$/;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Problems with words that must be in every language.
 * @param {unknown} words @param {string} where @param {number} [max]
 * @returns {string[]}
 */
function wordProblems(words, where, max) {
  if (!isObject(words)) return [`${where} must be an object with ${LANGUAGES.join(", ")}`];
  const out = [];
  for (const lang of LANGUAGES) {
    const w = words[lang];
    if (typeof w !== "string" || !w.trim()) out.push(`${where} has no ${lang}`);
    else if (max && w.length > max) out.push(`${where}.${lang} is ${w.length} characters; a card holds ${max}`);
  }
  for (const lang of Object.keys(words)) if (!LANGUAGES.includes(/** @type {Language} */ (lang))) out.push(`${where} has ${lang}, which Potyro does not speak`);
  return out;
}

/**
 * Whether a link is a demo link the gallery may show: hosted, https (http only on this machine, for a
 * test against a local server), with the key in the fragment and no remix intent of its own.
 * @param {string} link @param {{ allowLocal?: boolean }} [opts]
 */
export function isDemoLink(link, opts = {}) {
  if (!HOSTED_RE.test(link)) return false;
  const url = new URL(link);
  if (url.protocol === "https:") return true;
  return Boolean(opts.allowLocal) && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/**
 * Everything wrong with a gallery, in plain words; empty when it is fine.
 * @param {unknown} data @param {{ allowLocal?: boolean }} [opts]
 * @returns {string[]}
 */
export function galleryProblems(data, opts = {}) {
  if (!isObject(data)) return ["The gallery must be a JSON object"];
  const out = [];
  if (data.format !== FORMAT) out.push(`format must be "${FORMAT}"`);
  const categories = isObject(data.categories) ? data.categories : {};
  if (!isObject(data.categories)) out.push("categories must be an object");
  for (const [key, words] of Object.entries(categories)) out.push(...wordProblems(words, `category ${key}`));
  if (!Array.isArray(data.apps)) return [...out, "apps must be a list"];
  const seen = new Set();
  data.apps.forEach((app, i) => {
    if (!isObject(app)) return out.push(`apps[${i}] must be an object`);
    const id = typeof app.id === "string" ? app.id : "";
    const where = id ? `app ${id}` : `apps[${i}]`;
    if (!ID_RE.test(id)) out.push(`${where}: id must be lower-case letters, digits and dashes`);
    if (seen.has(id)) out.push(`${where}: listed twice`);
    seen.add(id);
    if (app.status !== "ready" && app.status !== "coming-soon") out.push(`${where}: status must be "ready" or "coming-soon"`);
    if (typeof app.category !== "string" || !(app.category in categories)) out.push(`${where}: category ${String(app.category)} is not one of the gallery's`);
    out.push(...wordProblems(app.name, `${where} name`, 40), ...wordProblems(app.line, `${where} line`, MAX_LINE));
    if (app.status === "ready") {
      const from = app.from;
      const fromOk =
        isObject(from) &&
        ((typeof from.example === "string" && ID_RE.test(from.example)) ||
          (Array.isArray(from.package) && from.package.length > 0 && from.package.every((p) => typeof p === "string" && /^apps\/[^\s]+$/.test(p) && !p.includes(".."))));
      if (!fromOk) out.push(`${where}: a ready app says where it comes from — { "example": "<id>" } or { "package": ["apps/…"] }`);
      const seed = isObject(from) ? from.seed : undefined;
      if (seed !== undefined && !(typeof seed === "string" && /^apps\/[^\s]+\.json$/.test(seed) && !seed.includes(".."))) out.push(`${where}: a seed is a JSON file under apps/`);
      // The files it ships with (docs/24 §2), a folder packed whole: `apps/markdown-notes/files`.
      const files = isObject(from) ? from.files : undefined;
      if (files !== undefined && !(typeof files === "string" && /^apps\/[^\s]+[^/\s]$/.test(files) && !files.includes(".."))) out.push(`${where}: files is a folder under apps/`);
    } else {
      if (typeof app.waitsFor !== "string" || !app.waitsFor.trim()) out.push(`${where}: a coming-soon app says what it waits for`);
      if (app.link !== undefined) out.push(`${where}: a coming-soon app has no link yet`);
    }
    if (app.link !== undefined && (typeof app.link !== "string" || !isDemoLink(app.link, opts))) out.push(`${where}: link is not a demo link (https://<site>/s/<id>#k=<key>)`);
    if (app.screenshot !== undefined && (typeof app.screenshot !== "string" || !SHOT_RE.test(app.screenshot))) out.push(`${where}: screenshot must be shots/<name>.jpg, .png or .webp`);
    if (app.link !== undefined && app.screenshot === undefined) out.push(`${where}: a published app has a screenshot`);
  });
  return out;
}

/**
 * The gallery, checked. Throws every problem at once.
 * @param {unknown} data @param {{ allowLocal?: boolean }} [opts]
 * @returns {Gallery}
 */
export function readGallery(data, opts = {}) {
  const problems = galleryProblems(data, opts);
  if (problems.length) throw new Error(`The gallery has problems:\n- ${problems.join("\n- ")}`);
  return /** @type {Gallery} */ (data);
}

/** The same demo link, asking for Make it mine. @param {string} link */
export function remixLink(link) {
  if (!link.includes("#")) throw new Error("A demo link carries its key in the fragment");
  return link.split("#")[1].split("&").includes(REMIX_PARAM) ? link : `${link}&${REMIX_PARAM}`;
}

/** What the page shows: published apps first, in the file's order; coming-soon ones after. @param {Gallery} g */
export function shownApps(g) {
  return {
    published: g.apps.filter((a) => a.status === "ready" && a.link && a.screenshot),
    soon: g.apps.filter((a) => a.status === "coming-soon"),
  };
}

/** The apps `gallery:publish` works on: ready ones, optionally only some. @param {Gallery} g @param {string[]} [only] */
export function publishable(g, only) {
  return g.apps.filter((a) => a.status === "ready" && (!only?.length || only.includes(a.id)));
}
