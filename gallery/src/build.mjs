#!/usr/bin/env node
// `pnpm gallery:build` — the gallery page, from gallery/gallery.json, as a folder any static server
// can serve (docs/16: Caddy on potyro.com). No framework and nothing from anyone else: one HTML page,
// its stylesheet and a small script on the same origin, system fonts, and the screenshots.
//
//   pnpm gallery:build [--data gallery/gallery.json] [--shots gallery] [--out dist/gallery] [--allow-local]
//
// The page is complete without JavaScript, in English. The script only switches the language (from
// the browser's, or the one chosen), the theme and the category filter.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, readGallery, remixLink, shownApps, SOURCE_LANGUAGE } from "./data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const GALLERY_DIR = resolve(here, "..");
const ROOT = resolve(GALLERY_DIR, "..");

/** Where "Report a link" writes to. A placeholder until Potyro has its own address; one place only. */
export const CONTACT = "contact@potyro.com";
/** Potyro itself: where "Open Potyro" goes. */
export const APP_SITE = "https://potyro.app/";

/** The languages' own names, for the picker: never translated. */
const AUTONYMS = { en: "English", "pt-BR": "Português (Brasil)", de: "Deutsch", es: "Español", pl: "Polski", it: "Italiano" };

/** @param {string} s */
export const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** `{name}` filled in. @param {string} template @param {Record<string, string>} vars */
const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** @param {Buffer | string} bytes */
const shortHash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);

/**
 * The strings, checked: every language has every key the source language has.
 * @param {unknown} raw
 * @returns {Record<string, Record<string, string>>}
 */
export function readStrings(raw) {
  const strings = /** @type {Record<string, Record<string, string>>} */ (raw);
  const keys = Object.keys(strings?.[SOURCE_LANGUAGE] ?? {});
  const problems = [];
  if (!keys.length) problems.push(`strings.json has no ${SOURCE_LANGUAGE}`);
  for (const lang of LANGUAGES) {
    for (const key of keys) {
      const value = strings?.[lang]?.[key];
      if (typeof value !== "string" || !value.trim()) problems.push(`strings.json: ${lang} has no "${key}"`);
      else if ((value.match(/\{\w+\}/g) ?? []).sort().join() !== (strings[SOURCE_LANGUAGE][key].match(/\{\w+\}/g) ?? []).sort().join()) problems.push(`strings.json: ${lang} "${key}" does not keep the placeholders`);
    }
  }
  if (problems.length) throw new Error(`The gallery's words have problems:\n- ${problems.join("\n- ")}`);
  return strings;
}

/**
 * The page, as HTML. Pure: everything it says comes from its arguments.
 * @param {import("./data.mjs").Gallery} gallery
 * @param {Record<string, Record<string, string>>} strings
 * @param {{ css: string; js: string; shots: Record<string, { width: number; height: number }> }} assets
 */
export function renderPage(gallery, strings, assets) {
  const s = strings[SOURCE_LANGUAGE];
  const e = escapeHtml;
  const { published, soon } = shownApps(gallery);
  const used = [...new Set(published.map((a) => a.category))];
  const word = (/** @type {Record<string,string>} */ w) => w[SOURCE_LANGUAGE];

  const card = (/** @type {import("./data.mjs").GalleryApp} */ app, /** @type {number} */ i) => {
    const name = word(app.name);
    const shot = assets.shots[app.screenshot ?? ""] ?? { width: 412, height: 860 };
    const no = String(i + 1).padStart(2, "0");
    return `
      <li class="card" data-category="${e(app.category)}" data-id="${e(app.id)}" style="--i:${i}">
        <a class="card-shot" href="${e(app.link ?? "")}" tabindex="-1" aria-hidden="true">
          <img src="${e(app.screenshot ?? "")}" width="${shot.width}" height="${shot.height}" alt="" data-t-alt="shotAlt" data-name-of="${e(app.id)}" ${i < 2 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" />
        </a>
        <div class="card-body">
          <p class="card-meta"><span class="card-no" aria-hidden="true">No. ${no}</span><span class="card-cat" data-cat-name="${e(app.category)}">${e(word(gallery.categories[app.category]))}</span></p>
          <h3 class="card-name"><span class="card-icon" aria-hidden="true">${e(app.icon ?? "◆")}</span><span data-app-name="${e(app.id)}">${e(name)}</span></h3>
          <p class="card-line" data-app-line="${e(app.id)}">${e(word(app.line))}</p>
          <div class="card-actions">
            <a class="btn btn-try" href="${e(app.link ?? "")}" data-label="tryLabel" data-name-of="${e(app.id)}" aria-label="${e(fill(s.tryLabel, { name }))}"><span data-t="tryIt">${e(s.tryIt)}</span> <span aria-hidden="true">→</span></a>
            <a class="btn btn-mine" href="${e(remixLink(app.link ?? "#"))}" data-label="mineLabel" data-name-of="${e(app.id)}" aria-label="${e(fill(s.mineLabel, { name }))}"><span aria-hidden="true">✦</span> <span data-t="makeItMine">${e(s.makeItMine)}</span></a>
          </div>
        </div>
      </li>`;
  };

  const soonItem = (/** @type {import("./data.mjs").GalleryApp} */ app) => `
        <li class="soon-item" data-waits-for="${e(app.waitsFor ?? "")}">
          <span class="soon-icon" aria-hidden="true">${e(app.icon ?? "◆")}</span>
          <span class="soon-text"><strong data-app-name="${e(app.id)}">${e(word(app.name))}</strong> <span data-app-line="${e(app.id)}">${e(word(app.line))}</span></span>
          <span class="soon-tag" data-t="soon">${e(s.soon)}</span>
        </li>`;

  // What the script needs to say it all in another language: the words, never the links.
  const data = {
    languages: LANGUAGES,
    strings,
    categories: gallery.categories,
    apps: Object.fromEntries(gallery.apps.map((a) => [a.id, { name: a.name, line: a.line }])),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const mail = `mailto:${CONTACT}?subject=${encodeURIComponent(s.reportSubject)}`;

  return `<!doctype html>
<html lang="${SOURCE_LANGUAGE}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title data-t="title">${e(s.title)}</title>
  <meta name="description" content="${e(s.description)}" data-t-content="description" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#f6f1e7" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#1b1814" media="(prefers-color-scheme: dark)" />
  <meta name="referrer" content="no-referrer" />
  <meta property="og:title" content="${e(s.title)}" />
  <meta property="og:description" content="${e(s.description)}" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="gallery.css?v=${assets.css}" />
</head>
<body>
  <a class="skip" href="#apps" data-t="skip">${e(s.skip)}</a>
  <header class="top">
    <a class="brand" href="${APP_SITE}"><span class="brand-mark" aria-hidden="true">◆</span><span class="brand-name">Potyro</span><span class="brand-tag"> — <span data-t="tagline">${e(s.tagline)}</span></span></a>
    <div class="top-tools">
      <label class="lang" hidden><span class="visually-hidden" data-t="language">${e(s.language)}</span>
        <select id="lang">${LANGUAGES.map((l) => `<option value="${l}" lang="${l}">${e(AUTONYMS[l])}</option>`).join("")}</select>
      </label>
      <button type="button" class="theme" id="theme" hidden aria-label="${e(s.toDark)}"><span aria-hidden="true">◐</span></button>
    </div>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-h">
      <p class="eyebrow" data-t="eyebrow">${e(s.eyebrow)}</p>
      <h1 id="hero-h" data-t="hero">${e(s.hero)}</h1>
      <p class="lead" data-t="lead">${e(s.lead)}</p>
      <ol class="steps">
        <li><span class="step-no" aria-hidden="true">1</span><strong data-t="step1">${e(s.step1)}</strong><span data-t="step1Text">${e(s.step1Text)}</span></li>
        <li><span class="step-no" aria-hidden="true">2</span><strong data-t="step2">${e(s.step2)}</strong><span data-t="step2Text">${e(s.step2Text)}</span></li>
        <li><span class="step-no" aria-hidden="true">3</span><strong data-t="step3">${e(s.step3)}</strong><span data-t="step3Text">${e(s.step3Text)}</span></li>
      </ol>
    </section>

    <section class="apps" id="apps" aria-labelledby="apps-h" tabindex="-1">
      <div class="apps-head">
        <h2 id="apps-h" data-t="appsHeading">${e(s.appsHeading)}</h2>
        ${
          used.length > 1
            ? `<div class="filters" role="group" aria-labelledby="filters-l" hidden>
          <span id="filters-l" class="filters-label" data-t="show">${e(s.show)}</span>
          <button type="button" class="chip" data-filter="" aria-pressed="true" data-t="all">${e(s.all)}</button>
          ${used.map((c) => `<button type="button" class="chip" data-filter="${e(c)}" aria-pressed="false" data-cat-name="${e(c)}">${e(word(gallery.categories[c]))}</button>`).join("\n          ")}
        </div>`
            : ""
        }
      </div>
      ${published.length ? `<ol class="cards">${published.map(card).join("")}
      </ol>` : `<p class="empty" data-t="empty">${e(s.empty)}</p>`}
    </section>

    ${
      soon.length
        ? `<section class="soon" aria-labelledby="soon-h">
      <h2 id="soon-h" data-t="soonHeading">${e(s.soonHeading)}</h2>
      <p class="soon-lead" data-t="soonLead">${e(s.soonLead)}</p>
      <ul class="soon-list">${soon.map(soonItem).join("")}
      </ul>
    </section>`
        : ""
    }
  </main>

  <footer class="foot">
    <p class="privacy" data-t="privacy">${e(s.privacy)}</p>
    <nav class="foot-links" aria-label="Potyro">
      <a href="${APP_SITE}" data-t="open">${e(s.open)}</a>
      <a href="${e(mail)}" data-mail="${e(CONTACT)}" data-t="report">${e(s.report)}</a>
    </nav>
    <p class="made"><span class="brand-mark" aria-hidden="true">◆</span> <span data-t="made">${e(s.made)}</span></p>
  </footer>

  <script type="application/json" id="gallery-data">${json}</script>
  <script src="gallery.js?v=${assets.js}"></script>
</body>
</html>
`;
}

/** The size of a PNG or JPEG, read from its header; null when it is neither. @param {Buffer} b */
export function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Build the gallery into `out`: index.html, gallery.css, gallery.js, favicon.svg and the screenshots it
 * shows. `out` is emptied first, so a screenshot dropped from the gallery is dropped from the site.
 * @param {{ data?: string; shots?: string; out?: string; allowLocal?: boolean }} [opts]
 */
export function buildGallery(opts = {}) {
  const dataPath = resolve(opts.data ?? join(GALLERY_DIR, "gallery.json"));
  const shotsRoot = resolve(opts.shots ?? dirname(dataPath));
  const out = resolve(opts.out ?? join(ROOT, "dist", "gallery"));
  const gallery = readGallery(readJson(dataPath), { allowLocal: opts.allowLocal });
  const strings = readStrings(readJson(join(GALLERY_DIR, "strings.json")));
  const css = readFileSync(join(here, "page", "gallery.css"));
  const js = readFileSync(join(here, "page", "gallery.js"));
  /** @type {Record<string, { width: number; height: number }>} */
  const shots = {};
  const { published } = shownApps(gallery);
  for (const app of published) {
    const from = join(shotsRoot, app.screenshot ?? "");
    if (!existsSync(from)) throw new Error(`${app.id}: its screenshot ${app.screenshot} is not in ${shotsRoot}`);
    const size = imageSize(readFileSync(from));
    if (!size) throw new Error(`${app.id}: ${app.screenshot} is not a PNG or JPEG`);
    shots[app.screenshot ?? ""] = size;
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "shots"), { recursive: true });
  for (const path of Object.keys(shots)) copyFileSync(join(shotsRoot, path), join(out, path));
  writeFileSync(join(out, "gallery.css"), css);
  writeFileSync(join(out, "gallery.js"), js);
  copyFileSync(join(here, "page", "favicon.svg"), join(out, "favicon.svg"));
  const html = renderPage(gallery, strings, { css: shortHash(css), js: shortHash(js), shots });
  writeFileSync(join(out, "index.html"), html);
  return { out, published: published.length, soon: shownApps(gallery).soon.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (/** @type {string} */ flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const at = (/** @type {string | undefined} */ p) => (p ? resolve(cwd, p) : undefined);
  try {
    const done = buildGallery({ data: at(take("--data")), shots: at(take("--shots")), out: at(take("--out")), allowLocal: args.includes("--allow-local") });
    console.log(`gallery: ${done.published} apps and ${done.soon} coming soon → ${done.out}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
