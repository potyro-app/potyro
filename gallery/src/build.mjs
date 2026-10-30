#!/usr/bin/env node
// `pnpm gallery:build` — the landing page and gallery, from gallery/gallery.json, as a folder any
// static server can serve (docs/16: Caddy on potyro.com). No framework and nothing from anyone else:
// one HTML page, the design system's stylesheets and fonts (packages/design), a small script on the
// same origin, and the screenshots. The look is DESIGN.md §9.
//
//   pnpm gallery:build [--data gallery/gallery.json] [--shots gallery] [--out dist/gallery] [--allow-local]
//
// The page is complete without JavaScript, in English. The script only switches the language (from
// the browser's, or the one chosen), the theme and the category filter, and sends the prompt box on Enter.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hourOf, LANGUAGES, readGallery, remixLink, shownApps, SOURCE_LANGUAGE } from "./data.mjs";
// The privacy page and the terms of use (#117): built only once docs/legal has no placeholder left.
import { legalSite } from "../../packages/legal/src/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const GALLERY_DIR = resolve(here, "..");
const ROOT = resolve(GALLERY_DIR, "..");
const DESIGN = join(ROOT, "packages", "design");

/**
 * Where "Report a link" writes to: the terms' report address (`abuse` in packages/shell/src/contacts.json,
 * the one place Potyro's addresses are named, #11). While it is still the placeholder the owner has to
 * fill in, the general address, so the link always reaches the Potyro team.
 */
export const CONTACT = reportAddress(JSON.parse(readFileSync(join(ROOT, "packages", "shell", "src", "contacts.json"), "utf8")));

/** @param {{ abuse: string, general: string }} contacts */
function reportAddress(contacts) {
  return /^<[^>]*>$/.test(contacts.abuse.trim()) ? contacts.general : contacts.abuse;
}
/** Potyro itself: where "Open Potyro" and "Create my app" go, and where the prompt box sends. */
export const APP_SITE = "https://potyro.app/";

/** The languages' own names, for the picker: never translated. */
const AUTONYMS = { en: "English", "pt-BR": "Português (Brasil)", de: "Deutsch", es: "Español", pl: "Polski", it: "Italiano" };

/** The logo files the page shows as images, light and dark grounds (packages/design/logo). */
export const LOGO_FILES = ["wordmark-rosa.svg", "wordmark-rosa-on-dark.svg", "symbol-rosa.svg", "symbol-rosa-on-dark.svg"];

/** The eleven hours an app may wear, in order; 12 o'clock rosa is Potyro's own. */
const HOURS = ["vermelho", "laranja", "amarelo", "lima", "verde", "menta", "ciano", "azul", "anil", "roxo", "magenta"];

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
 * A logo file inlined, its fixed colours turned into classes so the page's theme colours it the
 * way the on-dark file does. DESIGN.md §4.1 forbids repainting the logo by hand; §9 asks for the
 * "y" to take the hour that passes, which `.stroke` is for.
 * @param {string} svg @param {string} className
 */
export function inlineLogo(svg, className) {
  return svg
    .replace(/^<\?xml[^>]*>\s*/, "")
    .replace(/<svg /, `<svg class="${className}" aria-hidden="true" focusable="false" `)
    .replace(/fill="#414042"/g, 'class="ink"')
    .replace(/fill="#231f20"/g, 'class="ink-strong"')
    .replace(/fill="#(?:ee2a7b|ec008c)"/g, 'class="stroke"')
    .trim();
}

/**
 * hours.css: the twelve hours as the colour clock gives them (packages/design/source/potyro-color.js,
 * the designer's own file), so an element wearing `data-traco` has its traço, tinta and aguada in
 * both themes — and the hour that passes for the closing's "y".
 */
export function hoursCss() {
  // The designer's file is a UMD module in a package Node reads as ESM, so `require` would hand it
  // no `module`: it is run as the CommonJS it is, with a module object of its own.
  const shim = { exports: {} };
  new Function("module", "exports", "require", readFileSync(join(DESIGN, "source", "potyro-color.js"), "utf8"))(shim, shim.exports, () => undefined);
  /** @type {{ HORAS: { nome: string }[]; cor: (x: string) => { light: Record<string, string>; dark: Record<string, string> } }} */
  const PotyroColor = /** @type {any} */ (shim.exports);
  const light = [];
  const dark = [];
  for (const h of PotyroColor.HORAS) {
    if (h.nome === "rosa") continue;
    const c = PotyroColor.cor(h.nome);
    light.push(`[data-traco="${h.nome}"] { --traco: ${c.light.traco}; --tinta: ${c.light.tinta}; --aguada: ${c.light.aguada}; --focus: ${c.light.tinta}; }`);
    dark.push(`[data-traco="${h.nome}"] { --tinta: ${c.dark.tinta}; --aguada: ${c.dark.aguada}; --focus: ${c.dark.tinta}; }`);
  }
  const tracos = PotyroColor.HORAS.map((h) => PotyroColor.cor(h.nome).light.traco);
  const rosa = tracos[0];
  // One step per hour, round the clock in two minutes: a change, never a slide.
  const frames = tracos.map((t, i) => `${((i / tracos.length) * 100).toFixed(2)}% { --hora: ${t}; }`).join(" ");
  return [
    "/* Generated by gallery/src/build.mjs from the colour clock (packages/design): every element",
    "   wearing data-traco has its hour in both themes. The traço is the same in both. */",
    ...light,
    "@media (prefers-color-scheme: dark) {",
    ...dark.map((d) => `  :root:not([data-theme="light"]) ${d}`),
    "}",
    ...dark.map((d) => `:root[data-theme="dark"] ${d}`),
    `@property --hora { syntax: "<color>"; inherits: true; initial-value: ${rosa}; }`,
    `@keyframes clock { ${frames} 100% { --hora: ${rosa}; } }`,
    ".close { animation: clock 120s steps(1, end) infinite; }",
    "@media (prefers-reduced-motion: reduce) { .close { animation: none; } }",
    "",
  ].join("\n");
}

/** A Lucide icon drawn the system's way (§3.5): stroke 2, round caps and joins. Inline, so nothing is fetched. */
const icon = (/** @type {string} */ paths, size = 20) =>
  `<svg class="k-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICON = {
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  sunMoon: '<path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/><circle cx="12" cy="12" r="4"/>',
};

/**
 * The page, as HTML. Pure: everything it says comes from its arguments.
 * @param {import("./data.mjs").Gallery} gallery
 * @param {Record<string, Record<string, string>>} strings
 * @param {{ css: string; js: string; shots: Record<string, { width: number; height: number }>; logos?: Record<string, string>; legal?: boolean }} assets
 *   `legal`: the folder has /privacy and /terms, so the footer links them.
 */
export function renderPage(gallery, strings, assets) {
  const s = strings[SOURCE_LANGUAGE];
  const e = escapeHtml;
  const { published, soon } = shownApps(gallery);
  const used = [...new Set(published.map((a) => a.category))];
  const word = (/** @type {Record<string,string>} */ w) => w[SOURCE_LANGUAGE];
  const logos = assets.logos ?? {};
  const hour = (/** @type {string} */ category) => hourOf(category, gallery.categories);

  // The logo: the original files, one per ground; the stylesheet shows the theme's (§4.1).
  const wordmark = `<span class="wordmark" role="img" aria-label="Potyro"><img class="wordmark-light" src="logo/wordmark-rosa.svg" alt="" width="133" height="50" /><img class="wordmark-dark" src="logo/wordmark-rosa-on-dark.svg" alt="" width="133" height="50" /></span>`;
  const symbol = `<span class="wordmark symbol" aria-hidden="true"><img class="wordmark-light" src="logo/symbol-rosa.svg" alt="" width="33" height="31" /><img class="wordmark-dark" src="logo/symbol-rosa-on-dark.svg" alt="" width="33" height="31" /></span>`;
  const newAppHref = (/** @type {string} */ text) => `${APP_SITE}?new=${encodeURIComponent(text)}`;

  const card = (/** @type {import("./data.mjs").GalleryApp} */ app, /** @type {number} */ i) => {
    const name = word(app.name);
    const shot = assets.shots[app.screenshot ?? ""] ?? { width: 412, height: 860 };
    return `
      <li class="card" data-category="${e(app.category)}" data-id="${e(app.id)}" data-traco="${e(hour(app.category))}">
        <a class="card-block" href="${e(app.link ?? "")}" tabindex="-1" aria-hidden="true">
          <img src="${e(app.screenshot ?? "")}" width="${shot.width}" height="${shot.height}" alt="" data-t-alt="shotAlt" data-name-of="${e(app.id)}" ${i < 2 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" />
        </a>
        <div class="card-body">
          <p class="card-meta"><span class="cat" data-cat-name="${e(app.category)}">${e(word(gallery.categories[app.category]))}</span></p>
          <h3 class="card-name"><span data-app-name="${e(app.id)}">${e(name)}</span></h3>
          <p class="card-line" data-app-line="${e(app.id)}">${e(word(app.line))}</p>
          <div class="card-actions">
            <a class="btn btn-try" href="${e(app.link ?? "")}" data-label="tryLabel" data-name-of="${e(app.id)}" aria-label="${e(fill(s.tryLabel, { name }))}"><span data-t="tryIt">${e(s.tryIt)}</span>${icon(ICON.arrowRight, 16)}</a>
            <a class="btn btn-mine" href="${e(remixLink(app.link ?? "#"))}" data-label="mineLabel" data-name-of="${e(app.id)}" aria-label="${e(fill(s.mineLabel, { name }))}">${icon(ICON.copy, 16)}<span data-t="makeItMine">${e(s.makeItMine)}</span></a>
          </div>
        </div>
      </li>`;
  };

  const soonItem = (/** @type {import("./data.mjs").GalleryApp} */ app) => `
        <li class="soon-item" data-waits-for="${e(app.waitsFor ?? "")}">
          <span class="soon-text"><strong data-app-name="${e(app.id)}">${e(word(app.name))}</strong> <span data-app-line="${e(app.id)}">${e(word(app.line))}</span></span>
          <span class="soon-tag" data-t="soon">${e(s.soon)}</span>
        </li>`;

  // The twelve hours as flat blocks, rosa first (§9). Decoration, so hidden from readers.
  const clock = `<ul class="clock" aria-hidden="true"><li></li>${HOURS.map((h) => `<li data-traco="${h}"></li>`).join("")}</ul>`;

  // What the script needs to say it all in another language: the words, never the links.
  const data = {
    languages: LANGUAGES,
    strings,
    categories: gallery.categories,
    apps: Object.fromEntries(gallery.apps.map((a) => [a.id, { name: a.name, line: a.line }])),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const mail = `mailto:${CONTACT}?subject=${encodeURIComponent(s.reportSubject)}`;

  const filters =
    used.length > 1
      ? `<div class="filters" role="group" aria-labelledby="filters-l" hidden>
          <span id="filters-l" class="filters-label" data-t="show">${e(s.show)}</span>
          <button type="button" class="chip" data-filter="" aria-pressed="true" data-t="all">${e(s.all)}</button>
          ${used.map((c) => `<button type="button" class="chip" data-filter="${e(c)}" data-traco="${e(hour(c))}" aria-pressed="false" data-cat-name="${e(c)}">${e(word(gallery.categories[c]))}</button>`).join("\n          ")}
        </div>`
      : "";

  const workbench = soon.length
    ? `<section class="soon" aria-labelledby="soon-h">
      <h2 id="soon-h" data-t="soonHeading">${e(s.soonHeading)}</h2>
      <p class="soon-lead" data-t="soonLead">${e(s.soonLead)}</p>
      <ul class="soon-list">${soon.map(soonItem).join("")}
      </ul>
    </section>`
    : "";

  return `<!doctype html>
<html lang="${SOURCE_LANGUAGE}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title data-t="title">${e(s.title)}</title>
  <meta name="description" content="${e(s.description)}" data-t-content="description" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#1c1b1c" media="(prefers-color-scheme: dark)" />
  <meta name="referrer" content="no-referrer" />
  <meta property="og:title" content="${e(s.title)}" />
  <meta property="og:description" content="${e(s.description)}" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="tokens.css?v=${assets.css}" />
  <link rel="stylesheet" href="hours.css?v=${assets.css}" />
  <link rel="stylesheet" href="gallery.css?v=${assets.css}" />
</head>
<body>
  <a class="skip" href="#apps" data-t="skip">${e(s.skip)}</a>
  <header class="top">
    <a class="brand" href="${APP_SITE}">${wordmark}</a>
    <div class="top-tools">
      <label class="lang" hidden><span class="visually-hidden" data-t="language">${e(s.language)}</span>
        <select id="lang">${LANGUAGES.map((l) => `<option value="${l}" lang="${l}">${e(AUTONYMS[l])}</option>`).join("")}</select>
      </label>
      <button type="button" class="theme" id="theme" hidden aria-label="${e(s.toDark)}">${icon(ICON.sunMoon)}</button>
      <a class="btn-cta" href="${APP_SITE}" data-t="cta">${e(s.cta)}</a>
    </div>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-h">
      <div class="hero-words">
        <h1 id="hero-h" data-t="hero">${e(s.hero)}</h1>
        <p class="lead" data-t="lead">${e(s.lead)}</p>
        <form class="prompt" action="${APP_SITE}" method="get">
          <label class="prompt-label" for="prompt" data-t="promptLabel">${e(s.promptLabel)}</label>
          <div class="prompt-field">
            <textarea class="prompt-box" id="prompt" name="new" rows="3" placeholder="${e(s.promptPlaceholder)}" data-t-placeholder="promptPlaceholder" required></textarea>
            <button type="submit" class="prompt-send" aria-label="${e(s.promptSend)}" data-t-label="promptSend">${icon(ICON.arrowUp, 24)}</button>
          </div>
          <ul class="examples">
            <li><a class="chip-link" href="${e(newAppHref(s.ex1))}" data-t="ex1" data-new-from="ex1">${e(s.ex1)}</a></li>
            <li><a class="chip-link" href="${e(newAppHref(s.ex2))}" data-t="ex2" data-new-from="ex2">${e(s.ex2)}</a></li>
            <li><a class="chip-link" href="${e(newAppHref(s.ex3))}" data-t="ex3" data-new-from="ex3">${e(s.ex3)}</a></li>
          </ul>
        </form>
      </div>
      ${clock}
    </section>

    <section class="apps" id="apps" aria-labelledby="apps-h" tabindex="-1">
      <div class="apps-head">
        <h2 id="apps-h" data-t="appsHeading">${e(s.appsHeading)}</h2>
        ${filters}
      </div>
      ${published.length ? `<ol class="cards">${published.map(card).join("")}
      </ol>` : `<p class="empty" data-t="empty">${e(s.empty)}</p>`}
    </section>

    <section class="how" aria-labelledby="how-h">
      <h2 id="how-h" data-t="howHeading">${e(s.howHeading)}</h2>
      <ol class="steps">
        <li><span class="step-no" aria-hidden="true">1</span><span><strong data-t="step1">${e(s.step1)}</strong><span data-t="step1Text">${e(s.step1Text)}</span></span></li>
        <li><span class="step-no" aria-hidden="true">2</span><span><strong data-t="step2">${e(s.step2)}</strong><span data-t="step2Text">${e(s.step2Text)}</span></span></li>
        <li><span class="step-no" aria-hidden="true">3</span><span><strong data-t="step3">${e(s.step3)}</strong><span data-t="step3Text">${e(s.step3Text)}</span></span></li>
      </ol>
    </section>

    ${workbench}

    <section class="close" aria-label="Potyro">
      ${logos["wordmark-large"] ? inlineLogo(logos["wordmark-large"], "mark wordmark-large") : ""}
      ${logos.tagline ? inlineLogo(logos.tagline, "mark tagline") : ""}
      <a class="btn-cta" href="${APP_SITE}" data-t="cta">${e(s.cta)}</a>
    </section>
  </main>

  <footer class="foot">
    <p class="privacy" data-t="privacy">${e(s.privacy)}</p>
    <nav class="foot-links" aria-label="Potyro">
      <a href="${APP_SITE}" data-t="open">${e(s.open)}</a>
      <a href="${e(mail)}" data-mail="${e(CONTACT)}" data-t="report">${e(s.report)}</a>${
        assets.legal
          ? `
      <a href="privacy/" data-t="legalPrivacy">${e(s.legalPrivacy)}</a>
      <a href="terms/" data-t="legalTerms">${e(s.legalTerms)}</a>`
          : ""
      }
    </nav>
    <p class="made">${symbol} <span data-t="made">${e(s.made)}</span></p>
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
 * Build the gallery into `out`: index.html, its stylesheets (the design system's tokens, the hours,
 * the page's own), script, favicon, fonts, logo files and the screenshots it shows. `out` is emptied
 * first, so a screenshot dropped from the gallery is dropped from the site.
 * @param {{ data?: string; shots?: string; out?: string; allowLocal?: boolean; legal?: string }} [opts]
 *   `legal`: the folder of legal texts (default docs/legal, or `POTYRO_LEGAL_DIR`).
 */
export function buildGallery(opts = {}) {
  const dataPath = resolve(opts.data ?? join(GALLERY_DIR, "gallery.json"));
  const shotsRoot = resolve(opts.shots ?? dirname(dataPath));
  const out = resolve(opts.out ?? join(ROOT, "dist", "gallery"));
  const gallery = readGallery(readJson(dataPath), { allowLocal: opts.allowLocal });
  const strings = readStrings(readJson(join(GALLERY_DIR, "strings.json")));
  const css = readFileSync(join(here, "page", "gallery.css"));
  const js = readFileSync(join(here, "page", "gallery.js"));
  const tokens = readFileSync(join(DESIGN, "tokens.css"));
  const hours = hoursCss();
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
  writeFileSync(join(out, "tokens.css"), tokens);
  writeFileSync(join(out, "hours.css"), hours);
  copyFileSync(join(here, "page", "favicon.svg"), join(out, "favicon.svg"));
  mkdirSync(join(out, "fonts"), { recursive: true });
  for (const f of readdirSync(join(DESIGN, "fonts"))) if (f.endsWith(".woff2")) copyFileSync(join(DESIGN, "fonts", f), join(out, "fonts", f));
  mkdirSync(join(out, "logo"), { recursive: true });
  for (const f of LOGO_FILES) copyFileSync(join(DESIGN, "logo", f), join(out, "logo", f));
  const logos = {
    "wordmark-large": readFileSync(join(DESIGN, "logo", "wordmark-large.svg"), "utf8"),
    tagline: readFileSync(join(DESIGN, "logo", "tagline.svg"), "utf8"),
  };
  // The legal pages beside the gallery, at the same paths as on potyro.app — or none, and the
  // footer does not link them (packages/legal).
  // "Open Potyro" on them goes to the app, as the gallery's own does: `../` here is potyro.com.
  const legal = legalSite({ dir: opts.legal, appHref: APP_SITE });
  for (const [path, body] of legal.files) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), body);
  }
  const html = renderPage(gallery, strings, { css: shortHash(Buffer.concat([tokens, Buffer.from(hours), css])), js: shortHash(js), shots, logos, legal: legal.ready });
  writeFileSync(join(out, "index.html"), html);
  return { out, published: published.length, soon: shownApps(gallery).soon.length, legal: legal.ready ? null : legal.notice };
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
    if (done.legal) console.log(done.legal);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
