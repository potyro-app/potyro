// The home of potyro.com (#8): what Potyro is, in eight screens, for a person who does not write
// code. Every picture is the real product — screenshots of the apps and recordings of the shell and
// the Studio (e2e/site-recordings-trusted.spec.ts) — and every number is counted from the
// repository at build time. The words are site/words.json; the look is DESIGN.md §9 on the design
// system's tokens (packages/design). No inline style and no inline script: the page is served under
// potyro.com's policy (deploy/potyro.app.Caddyfile), so the stylesheet and the script are files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCssVariablesTheme, createHighlighter } from "shiki";
import { escapeHtml as e, inlineLogo, APP_SITE, CONTACT } from "../../gallery/src/build.mjs";
import { hourOf, remixLink, shownApps } from "../../gallery/src/data.mjs";

export const REPO_URL = "https://github.com/potyro-app/potyro";

/** `{name}` filled in. @param {string} template @param {Record<string, string | number>} vars */
const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const ICON = {
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
};
const icon = (/** @type {string} */ paths, size = 20) =>
  `<svg class="k-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

/**
 * The hero's tiles: the eleven hours of the clock, each with one real app of that hour — the app's
 * own icon and name, as its module declares them (examples/, apps/): a Lucide name, or the emoji an app still has.
 */
export const TILES = [
  { hour: "vermelho", name: "Workout", icon: "check" },
  { hour: "laranja", name: "Recipes", icon: "cooking-pot" },
  { hour: "amarelo", name: "Photo Garden", icon: "image" },
  { hour: "lima", name: "Groceries", icon: "shopping-cart" },
  { hour: "verde", name: "Plants", icon: "sprout" },
  { hour: "menta", name: "Sleep & Mood", icon: "moon" },
  { hour: "ciano", name: "Places", icon: "map-pin" },
  { hour: "azul", name: "Receipt Split", icon: "receipt" },
  { hour: "anil", name: "Write Together", icon: "users-round" },
  { hour: "roxo", name: "Draw & Guess", icon: "pencil" },
  { hour: "magenta", name: "Piano", icon: "🎹" },
];
/** Where each tile sits and floats (percentages of the hero's picture box); `named` ones are big enough for their name. */
export const TILE_PLACES = [
  { l: 2, t: 2, w: 24, h: 24, pill: false }, { l: 30, t: -4, w: 38, h: 15, pill: true }, { l: 72, t: 6, w: 30, h: 30, pill: false },
  { l: -4, t: 34, w: 20, h: 36, pill: true }, { l: 78, t: 44, w: 28, h: 20, pill: false }, { l: 4, t: 78, w: 32, h: 17, pill: true },
  { l: 46, t: 86, w: 20, h: 20, pill: false }, { l: 70, t: 72, w: 34, h: 15, pill: true }, { l: -8, t: 12, w: 13, h: 13, pill: false },
  { l: 88, t: -6, w: 16, h: 16, pill: true }, { l: 26, t: 42, w: 9, h: 9, pill: false },
];
const named = (/** @type {typeof TILE_PLACES[number]} */ p) => (p.pill ? p.w >= 36 : p.w >= 28 && p.h >= 24);

/** The tiles' places as CSS, so the page carries no style attribute. */
export function tilesCss() {
  return TILE_PLACES.map((p, i) => `.tile-${i + 1} { left: ${p.l}%; top: ${p.t}%; width: ${p.w}%; height: ${p.h}%; --t: ${6 + (i % 5)}s; --d: ${-(i * 0.7)}s; }`).join("\n") + "\n";
}

/** The six apps the home shows, by their gallery id, in this order. */
export const HOME_APPS = ["write-together", "draw-guess", "piano", "photo-garden", "mirror-monsters", "plant-doctor"];

/** The screenshots the ideas show (site/screens), by idea. */
const SCREENS = { data: ["workout"], share: ["recipes"] };

/** A real cut of examples/plants.app.ts: the head of the module and one entity's fields. */
export const CODE = `export default defineApp({
  id: "plants",
  name: "Plants",
  icon: "sprout",
  entities: {
    plant: {
      fields: {
        name: { type: "text", required: true },
        photo: { type: "media", accept: "image" },
        room: { type: "text" },
        wateringIntervalDays: { type: "number" },
      },
    },
  },
  permissions: { camera: true, notifications: true, ai: true },
});`;

/** Code as HTML with classes, never inline styles (the site's policy has no inline style). @param {string} code */
export async function highlightCode(code) {
  const highlighter = await createHighlighter({ themes: [createCssVariablesTheme({ name: "potyro", variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: true })], langs: ["typescript"] });
  const html = highlighter.codeToHtml(code, {
    lang: "typescript",
    theme: "potyro",
    transformers: [
      {
        pre(node) { node.properties.class = "code shiki"; delete node.properties.style; delete node.properties.tabindex; },
        code(node) { delete node.properties.style; },
        span(node) {
          const st = String(node.properties.style ?? "");
          const cls = [...st.matchAll(/--shiki-token-([\w-]+)/g)].map((m) => `tk-${m[1]}`);
          if (/font-style:italic/.test(st)) cls.push("tk-italic");
          delete node.properties.style;
          if (cls.length) node.properties.class = cls.join(" ");
        },
      },
    ],
  });
  highlighter.dispose();
  return html;
}

/** Lucide's paths, from the design package's generated table (one path per icon, 24×24, stroke 2). @param {string} designDir */
export function lucidePaths(designDir) {
  const text = readFileSync(join(designDir, "src", "lucide-paths.generated.ts"), "utf8");
  return Object.fromEntries([...text.matchAll(/^\s+"([a-z0-9-]+)": "([^"]+)",?$/gm)].map((m) => [m[1], m[2]]));
}

/**
 * The home page.
 * @param {object} input
 * @param {import("../../gallery/src/data.mjs").Gallery} input.gallery
 * @param {Record<string, string>} input.words  the English words (site/words.json)
 * @param {Record<string, string>} input.lucide  icon name → path
 * @param {string} input.code  the highlighted code block
 * @param {Record<string, string>} input.logos  svg text by file name
 * @param {{ css: string; js: string }} input.v  cache-busting hashes
 * @param {Record<string, { width: number; height: number }>} input.sizes  by served path (`/screens/x.jpg`, `/shots/x.jpg`, `/media/x-poster.jpg`)
 * @param {boolean} input.legal  whether /privacy and /terms exist
 */
export function renderHome({ gallery, words: w, lucide, code, logos, v, sizes, legal }) {
  const published = shownApps(gallery).published;
  const count = published.length;
  const size = (/** @type {string} */ path, fallback = { width: 412, height: 915 }) => sizes[path] ?? fallback;

  const wordmark = inlineLogo(logos["wordmark-rosa.svg"], "mark wordmark");
  const lucideIcon = (/** @type {string} */ name, size = 28) => {
    // The table lists aliases beside paths: an alias names another entry.
    let d = lucide[name];
    if (d && !/^[Mm]/.test(d)) d = lucide[d];
    if (!d) return `<span class="tile-emoji" aria-hidden="true">${e(name)}</span>`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  };

  const phone = (/** @type {string} */ src, alt = "", cls = "") => {
    const s = size(src);
    return `<div class="phone ${cls}"><img src="${e(src)}" width="${s.width}" height="${s.height}" alt="${e(alt)}" loading="lazy" decoding="async"></div>`;
  };
  const clip = (/** @type {string} */ name, /** @type {string} */ label, cls = "") => {
    const poster = `/media/${name}-poster.jpg`;
    const s = size(poster);
    return `<div class="phone rec-phone ${cls}"><video class="rec" muted loop playsinline preload="none" poster="${poster}" width="${s.width}" height="${s.height}" aria-label="${e(label)}"><source src="/media/${name}.webm" type="video/webm"><source src="/media/${name}.mp4" type="video/mp4"></video></div>`;
  };

  const tiles = TILES.map((tile, i) => {
    const p = TILE_PLACES[i];
    const big = named(p);
    return `<li data-traco="${tile.hour}" class="tile tile-${i + 1} ${p.pill ? "pill" : ""} ${big ? "" : "small"}">${lucideIcon(tile.icon, big ? 28 : 22)}<span class="${big ? "" : "visually-hidden"}">${e(tile.name)}</span></li>`;
  }).join("");
  const heroShot = "/screens/split.jpg";

  const steps = [
    { id: "data", hour: "azul", pic: SCREENS.data.map((x) => phone(`/screens/${x}.jpg`)).join("") },
    { id: "database", hour: "anil", pic: clip("data", w.clipData) },
    { id: "make", hour: "amarelo", pic: clip("studio", w.clipStudio), extra: code },
    { id: "together", hour: "verde", pic: clip("together-a", w.clipTogetherA, "pair") + clip("together-b", w.clipTogetherB, "pair") },
    { id: "ai", hour: "roxo", pic: clip("plant-doctor", w.clipAi) },
    { id: "share", hour: "laranja", pic: SCREENS.share.map((x) => phone(`/screens/${x}.jpg`)).join(""), extra: `<p class="link-pill"><span>${e(w.shareLink)}</span><button type="button" class="btn" data-copy="https://potyro.com/">${e(w.copyLink)}</button></p>` },
    { id: "safe", hour: "menta", pic: phone("/media/permission-ai.png", w.stillPermissionAi, "boxed") + phone("/media/permission-camera.png", w.stillPermissionCamera) },
  ];
  const blocks = steps
    .map(
      (s, i) => `
<div class="block-row" id="${s.id}"><div class="wrap">
  <section class="block reveal ${i % 2 ? "flip" : ""}" data-traco="${s.hour}" aria-labelledby="${s.id}-h">
    <div class="block-words"><h2 id="${s.id}-h">${e(w[s.id])}</h2><p class="say">${e(w[`${s.id}Text`])}</p>${s.extra ?? ""}<p class="learn"><a href="/how/${s.id}/">${e(w.learnMore)}</a></p></div>
    <div class="block-pic">${s.pic}</div>
  </section>
</div></div>`,
    )
    .join("");

  const cards = HOME_APPS.map((id) => {
    const app = published.find((a) => a.id === id);
    if (!app) throw new Error(`the home shows ${id}, which the gallery does not publish`);
    const name = app.name.en;
    const shot = `/${app.screenshot}`;
    const s = size(shot, { width: 824, height: 1720 });
    return `
    <li class="card reveal" data-traco="${e(hourOf(app.category, gallery.categories))}">
      <a class="card-shot" href="${e(app.link ?? "")}" tabindex="-1" aria-hidden="true"><img src="${e(shot)}" width="${s.width}" height="${s.height}" alt="" loading="lazy" decoding="async"></a>
      <h3>${e(name)}</h3>
      <p>${e(app.line.en)}</p>
      <div class="card-actions">
        <a class="btn" href="${e(app.link ?? "")}" aria-label="${e(fill(w.tryLabel, { name }))}">${e(w.tryIt)} ${icon(ICON.arrowRight, 16)}</a>
        <a class="btn btn-mine" href="${e(remixLink(app.link ?? "#"))}" aria-label="${e(fill(w.mineLabel, { name }))}">${icon(ICON.copy, 16)} ${e(w.makeItMine)}</a>
      </div>
    </li>`;
  }).join("");

  const mail = `mailto:${CONTACT}?subject=${encodeURIComponent(w.reportSubject)}`;
  const newAppHref = (/** @type {string} */ text) => `${APP_SITE}?new=${encodeURIComponent(text)}`;
  const heroSize = size(heroShot);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${e(w.title)}</title>
  <meta name="description" content="${e(w.description)}" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#1c1b1c" media="(prefers-color-scheme: dark)" />
  <meta name="referrer" content="no-referrer" />
  <link rel="canonical" href="https://potyro.com/" />
  <meta property="og:site_name" content="Potyro" />
  <meta property="og:title" content="${e(w.title)}" />
  <meta property="og:description" content="${e(w.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://potyro.com/" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:image" content="https://potyro.com/media/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${e(w.ogAlt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${e(w.title)}" />
  <meta name="twitter:description" content="${e(w.description)}" />
  <meta name="twitter:image" content="https://potyro.com/media/og.png" />
  <meta name="twitter:image:alt" content="${e(w.ogAlt)}" />
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": "https://potyro.com/#site", url: "https://potyro.com/", name: "Potyro", description: w.description, inLanguage: "en" },
      { "@type": "SoftwareApplication", "@id": "https://potyro.app/#app", name: "Potyro", url: "https://potyro.app/", description: w.description, applicationCategory: "UtilitiesApplication", operatingSystem: "Web, Android", offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, image: "https://potyro.com/media/og.png", sameAs: [REPO_URL] },
    ],
  }).replace(/</g, "\\u003c")}</script>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preload" href="/fonts/quicksand-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/fonts/figtree-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="/tokens.css?v=${v.css}" />
  <link rel="stylesheet" href="/hours.css?v=${v.css}" />
  <link rel="stylesheet" href="/site.css?v=${v.css}" />
</head>
<body>
  <a class="skip" href="#main">${e(w.skip)}</a>
  <header class="top">
    <a class="brand" href="/" aria-label="Potyro">${wordmark}</a>
    <nav class="site-nav" aria-label="Potyro's site"><a href="/apps/">${e(w.apps)}</a><a href="/docs/">${e(w.docs)}</a><a href="/developers/">${e(w.developers)}</a></nav>
    <a class="btn-cta" href="${APP_SITE}">${e(w.cta)}</a>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-h">
      <div class="wrap">
        <div>
          <h1 id="hero-h">${e(w.h1)}</h1>
          <p class="lead">${e(w.lead)}</p>
          <form class="prompt" action="${APP_SITE}" method="get">
            <label class="prompt-label" for="prompt">${e(w.promptLabel)}</label>
            <div class="prompt-field">
              <textarea class="prompt-box" id="prompt" name="new" rows="3" placeholder="${e(w.promptPlaceholder)}" required></textarea>
              <button type="submit" class="prompt-send" aria-label="${e(w.promptSend)}">${icon(ICON.arrowUp, 24)}</button>
            </div>
            <ul class="examples">
              <li><a class="chip-link" href="${e(newAppHref(w.ex1))}">${e(w.ex1)}</a></li>
              <li><a class="chip-link" href="${e(newAppHref(w.ex2))}">${e(w.ex2)}</a></li>
              <li><a class="chip-link" href="${e(newAppHref(w.ex3))}">${e(w.ex3)}</a></li>
            </ul>
          </form>
        </div>
        <ul class="blocks" aria-label="${e(w.tilesLabel)}">${tiles}<li class="hero-phone"><div class="phone"><img src="${heroShot}" width="${heroSize.width}" height="${heroSize.height}" alt="Split: a weekend's shared costs, who owes whom" fetchpriority="high" decoding="async"></div></li></ul>
      </div>
    </section>
${blocks}
    <section class="apps" id="apps" aria-labelledby="apps-h" tabindex="-1">
      <h2 id="apps-h">${e(w.appsHeading)}</h2>
      <ol class="cards">${cards}
      </ol>
      <p class="see-all"><a href="/apps/">${e(fill(w.seeAll, { count }))} ${icon(ICON.arrowRight, 16)}</a></p>
    </section>

    <section class="close" aria-label="Potyro">
      ${inlineLogo(logos["wordmark-large.svg"], "mark wordmark-large")}
      ${inlineLogo(logos["tagline.svg"], "mark tagline")}
      <a class="btn-cta" href="${APP_SITE}">${e(w.cta)}</a>
    </section>
  </main>

  <footer class="foot">
    <p class="privacy">${e(w.privacy)}</p>
    <nav class="foot-links" aria-label="Potyro">
      <a href="${APP_SITE}">${e(w.open)}</a>
      <a href="/apps/">${e(w.apps)}</a>
      <a href="/docs/">${e(w.docs)}</a>
      <a href="/developers/">${e(w.developers)}</a>
      <a href="${REPO_URL}">${e(w.source)}</a>${
        legal
          ? `
      <a href="/privacy/">${e(w.legalPrivacy)}</a>
      <a href="/terms/">${e(w.legalTerms)}</a>`
          : ""
      }
      <a href="${e(mail)}">${e(w.report)}</a>
    </nav>
    <p class="made">${inlineLogo(logos["symbol-rosa.svg"], "mark symbol")} <span>${e(w.made)}</span></p>
  </footer>
  <script src="/site.js?v=${v.js}" defer></script>
</body>
</html>
`;
}
