// Palette Catcher — point the camera at something whose colours you love (a sunset, a sofa, a dress),
// and get the five to eight colours it is made of: shown as a paint-chip card beside the photo, with
// a marker on the photo where each colour was found. Tap a colour for its HEX, RGB and OKLCH, ready
// to copy, and how text reads on it. Name the palette, keep it in the Gallery, or share it as an
// image card.
//
// The photo comes only through `ctx.caps.camera` (CLAUDE.md rule 2); the app never touches the
// browser's camera itself. Kept palettes are records; their photos and share cards are files in the
// app's own folder, through `ctx.files`, and a card leaves the app through `ctx.files.export`. The
// colour science — OKLab, k-means, choosing the set, contrast — is in palette.ts, in plain functions
// with tests. The screens are custom views (a canvas, a dialog), so the app runs as your own.
//
// In six languages (#303), in words.ts. A palette's name is a record: it is made in the person's
// language when the colours are caught ("Honey & Midnight"), and stays as they leave it.
import { defineApp } from "potyro";
import type { Ctx, FileRef, Resolved, ViewProps } from "potyro";
import { CARD_H, CARD_W, drawCard } from "./card.js";
import { colorNames, paletteName, slug } from "./names.js";
import {
  analyse,
  contrast,
  decodeColors,
  encodeColors,
  formats,
  inkOn,
  MAX_COLORS,
  MIN_COLORS,
  paletteOf,
  parseHex,
  rgbToOklab,
  type Extraction,
  type Picture,
  type RGB,
  type Swatch,
} from "./palette.js";
import { paintSample } from "./sample.js";
import { STYLES } from "./styles.js";
import { W } from "./words.js";

// ---- small helpers ----

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

const css = ([r, g, b]: RGB) => `rgb(${r}, ${g}, ${b})`;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Paint an element in a colour, with the ink that reads on it. */
function tint(el: HTMLElement, rgb: RGB): void {
  el.style.setProperty("--c", css(rgb));
  el.style.setProperty("--chip-ink", css(inkOn(rgb).ink));
}

/**
 * Put text on the clipboard. The clipboard is the page's own (a custom view runs in the person's own
 * page), and where a browser refuses it — no focus, an old WebView — a selected textarea is the
 * fallback. `false` when neither worked, so the screen can say so.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { readonly: "", "aria-hidden": "true" });
    area.value = text;
    area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * An overlay hangs off <body>, outside the app's element, where the shell's own accent applies; it
 * takes the app's accent with it so its buttons look like the rest of the app.
 */
function adopt(node: HTMLElement): HTMLElement {
  const app = document.querySelector(".k-app");
  if (app) {
    const s = getComputedStyle(app);
    for (const t of ["--accent", "--on-accent"]) {
      const v = s.getPropertyValue(t).trim();
      if (v) node.style.setProperty(t, v);
    }
  }
  return node;
}

/** The shell's fonts, for drawing on a canvas the way the page writes. */
function fonts(el: HTMLElement): { display: string; ui: string; mono: string } {
  const s = getComputedStyle(el);
  const get = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
  return { display: get("--font-display", "Georgia, serif"), ui: get("--font-ui", "system-ui, sans-serif"), mono: get("--font-mono", "ui-monospace, monospace") };
}

// ---- a photo, ready to read ----

interface Shot {
  /** The photo as shown, at most 1600 pixels on its longer side. */
  view: HTMLCanvasElement;
  analysis: Extraction;
}

const SAMPLE_LONG = 260;
const VIEW_LONG = 1600;

function scaled(src: CanvasImageSource, w: number, h: number, long: number): HTMLCanvasElement {
  const k = Math.min(1, long / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function readPicture(view: HTMLCanvasElement): Picture {
  const small = scaled(view, view.width, view.height, SAMPLE_LONG);
  const { data } = small.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height);
  return { width: small.width, height: small.height, data };
}

/**
 * The photo decoded. `createImageBitmap` first (it honours the camera's orientation tag); where it
 * will not take the file — Firefox on Android, in the sealed frame, refused a camera's JPEG that way
 * (2026-10-20) — an `<img>` on an object URL decodes it instead, the way every browser shows a photo.
 */
async function decoded(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: "image/jpeg" }));
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }
}

async function shotFrom(blob: Blob): Promise<Shot> {
  const pic = await decoded(blob);
  try {
    const view = scaled(pic.source, pic.width, pic.height, VIEW_LONG);
    return { view, analysis: analyse(readPicture(view)) };
  } finally {
    pic.close();
  }
}

function sampleShot(): Shot {
  const pic = paintSample(960, 720);
  const view = document.createElement("canvas");
  view.width = pic.width;
  view.height = pic.height;
  view.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pic.data), pic.width, pic.height), 0, 0);
  return { view, analysis: analyse(readPicture(view)) };
}

const blobOf = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("no image"))), type, quality));

/** A palette with no photo (typed in by hand): its colours, as broad bands, are its picture. */
function bands(hexes: string[]): HTMLElement {
  const el = h("div", { class: "pc-bands", "aria-hidden": "true" });
  for (const hex of hexes) {
    const b = h("i", {});
    b.style.setProperty("--c", hex);
    el.append(b);
  }
  return el;
}

/** The share card as a PNG, through the app's folder and out with `ctx.files.export`. */
async function shareCard(ctx: Ctx, el: HTMLElement, photo: CanvasImageSource | null, pw: number, ph: number, hexes: string[], name: string): Promise<void> {
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const f = fonts(el);
  drawCard(c.getContext("2d")!, {
    photo,
    photoW: pw,
    photoH: ph,
    chips: hexes.map((hex) => ({ hex, rgb: parseHex(hex)! })),
    name,
    footer: `${ctx.t(W.colours, { n: hexes.length })} · ${ctx.t(W.appName)}`,
    fontDisplay: f.display,
    fontUi: f.ui,
    fontMono: f.mono,
  });
  const file = await ctx.files.write(`cards/${slug(name, ctx.now())}.png`, await blobOf(c, "image/png"), { mime: "image/png" });
  try {
    await ctx.files.export({ id: file.id, path: file.path, name: file.name, mime: file.mime });
  } finally {
    // The card is made to leave the app; the app does not keep a copy of it.
    await ctx.files.remove({ id: file.id, path: file.path, name: file.name, mime: file.mime }).catch(() => undefined);
  }
}

// ---- the demo fan ----

const DEMOS = [
  ["#2b2d5c", "#76487f", "#c75c7a", "#f2a65a", "#fbd9a0", "#3f5b6e", "#c4673f"],
  ["#0e3b5c", "#1f6f8b", "#7fc4d6", "#f4efe6", "#e9c46a", "#e07a5f", "#3d405b"],
  ["#7a2e1f", "#c4673f", "#e3a46b", "#f3e3c3", "#8f9a5b", "#4d5e3a", "#2a2f2a"],
];

/** A fan of paint chips that cycles through a few palettes, as a promise of what a photo gives. */
function fan(mini = false): { el: HTMLElement; stop: () => void } {
  const el = h("div", { class: mini ? "pc-fan pc-mini" : "pc-fan", "aria-hidden": "true" });
  const chips = DEMOS[0]!.map((_, i) => {
    const c = h("span", { class: "pc-fchip" }, h("b", {}));
    c.style.setProperty("--i", String(i));
    c.style.setProperty("--rot", `${(i - 3) * (mini ? 11 : 12)}deg`);
    return c;
  });
  el.append(...chips);
  const paint = (k: number) =>
    chips.forEach((c, i) => {
      const hex = DEMOS[k % DEMOS.length]![i]!;
      tint(c, parseHex(hex)!);
      c.querySelector("b")!.textContent = hex.toUpperCase();
    });
  paint(0);
  let k = 0;
  const timer = reducedMotion() ? 0 : window.setInterval(() => paint(++k), 3800);
  return { el, stop: () => clearInterval(timer) };
}

// ---- one colour, up close ----

interface Shown {
  rgb: RGB;
  name: string;
  /** "31% of the photo", or what a made tint is. */
  note: string;
}

/** The colour sheet: the colour large, its three codes with Copy, and how text reads on it. */
function openColour(ctx: Ctx, list: Shown[], start: number, onShow?: (i: number) => void): void {
  let i = start;
  const opener = document.activeElement as HTMLElement | null;
  const title = h("h3", { id: "pc-sheet-title" });
  const note = h("p", {});
  const prev = h("button", { type: "button", "aria-label": ctx.t(W.prev) }, "‹");
  const next = h("button", { type: "button", "aria-label": ctx.t(W.next) }, "›");
  const x = h("button", { type: "button", class: "pc-sheet-x", "aria-label": ctx.t(W.close) }, "✕");
  const top = h("div", { class: "pc-sheet-top" }, x, h("div", { class: "pc-sheet-nav" }, prev, next), title, note);
  const codes = h("dl", { class: "pc-codes" });
  const pairs = h("div", { class: "pc-pairs" });
  const sheet = h(
    "div",
    { class: "pc-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "pc-sheet-title" },
    top,
    codes,
    h("div", { class: "pc-contrast" }, h("h4", {}, ctx.t(W.textOn)), pairs),
  );
  const scrim = h("div", { class: "pc-scrim" }, sheet);
  const nav = list.length > 1;
  prev.hidden = next.hidden = !nav;

  const grade = (r: number) => (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA+" : "");
  const show = () => {
    const s = list[i]!;
    tint(top, s.rgb);
    title.textContent = s.name;
    note.textContent = s.note;
    const f = formats(s.rgb);
    codes.replaceChildren(
      ...(
        [
          ["HEX", f.hex],
          ["RGB", f.rgb],
          ["OKLCH", f.oklch],
        ] as const
      ).map(([label, value]) => {
        const b = h("button", { type: "button", class: "pc-btn pc-copy", "aria-label": ctx.t(W.copyThis, { value }) }, ctx.t(W.copy));
        b.addEventListener("click", async () => {
          const ok = await copyText(value);
          if (!ok) return ctx.ui.toast(ctx.t(W.copyFail));
          void ctx.caps.haptics?.vibrate(10);
          b.textContent = `✓ ${ctx.t(W.copied)}`;
          b.classList.add("pc-done");
          ctx.ui.toast(ctx.t(W.copiedToast, { value }));
          setTimeout(() => {
            b.textContent = ctx.t(W.copy);
            b.classList.remove("pc-done");
          }, 1600);
        });
        return h("div", { class: "pc-code" }, h("dt", {}, label), h("dd", {}, value), b);
      }),
    );
    pairs.replaceChildren(
      ...(
        [
          [[255, 255, 255], ctx.t(W.white)],
          [[0, 0, 0], ctx.t(W.black)],
        ] as const
      ).map(([ink, word]) => {
        const r = contrast(ink as RGB, s.rgb);
        const g = grade(r);
        const p = h(
          "div",
          { class: "pc-pair" },
          h("b", {}, "Aa"),
          h("span", {}, h("strong", {}, word), h("span", {}, `${r.toFixed(1)}:1`, g ? h("i", { class: "pc-grade" }, g === "AA+" ? `AA · ${ctx.t(W.large)}` : g) : ` · ${ctx.t(W.faint)}`)),
        );
        p.style.setProperty("--c", css(s.rgb));
        p.style.color = css(ink as RGB);
        return p;
      }),
    );
    onShow?.(i);
  };
  const step = (d: number) => {
    i = (i + d + list.length) % list.length;
    show();
  };
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  const close = () => {
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
    onShow?.(-1);
    opener?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (nav && e.key === "ArrowRight") step(1);
    else if (nav && e.key === "ArrowLeft") step(-1);
    else if (e.key === "Tab") {
      // Keep focus inside the sheet while it is open.
      const f = [...sheet.querySelectorAll<HTMLElement>("button:not([hidden])")];
      const first = f[0];
      const last = f[f.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  x.addEventListener("click", close);
  scrim.addEventListener("click", (e) => e.target === scrim && close());
  document.addEventListener("keydown", onKey, true);
  show();
  document.body.append(adopt(scrim));
  // Focus the first code's Copy: what the person most likely came for.
  sheet.querySelector<HTMLElement>(".pc-copy")?.focus();
}

/** A palette as a paint-chip card: one strip per colour, each opening its sheet. */
function chipCard(ctx: Ctx, list: Shown[], hexes: string[], onHover?: (i: number) => void): HTMLOListElement {
  const ol = h("ol", { class: "pc-chips" });
  list.forEach((s, i) => {
    const hex = hexes[i]!.toUpperCase();
    const b = h(
      "button",
      { type: "button", class: "pc-chip", "aria-label": ctx.t(W.openColour, { name: s.name, hex }) },
      h("span", { class: "pc-chip-name" }, s.name),
      h("span", { class: "pc-chip-hex" }, hex, h("span", { class: "pc-chip-go", "aria-hidden": "true" }, "→")),
      ...(s.note ? [h("span", { class: "pc-chip-meta" }, s.note)] : []),
    );
    tint(b, s.rgb);
    b.style.setProperty("--i", String(i));
    b.dataset.hex = hexes[i]!;
    b.addEventListener("click", () => openColour(ctx, list, i, onHover));
    if (onHover) {
      b.addEventListener("pointerenter", () => onHover(i));
      b.addEventListener("pointerleave", () => onHover(-1));
      b.addEventListener("focus", () => onHover(i));
      b.addEventListener("blur", () => onHover(-1));
    }
    ol.append(h("li", {}, b));
  });
  return ol;
}

const shownOf = (list: Swatch[], ctx: Ctx): Shown[] => {
  const names = colorNames(list.map((s) => s.lab), ctx);
  return list.map((s, i) => ({
    rgb: s.rgb,
    name: names[i]!,
    note: s.derived ? ctx.t(W.madeTint) : ctx.t(W.ofPhoto, { p: Math.max(1, Math.round(s.weight * 100)) }),
  }));
};

// ---- the Catch screen ----

/** The photo on screen, kept for this session: a remount (a layout change) must not lose it. */
let lastShot: Shot | null = null;
let lastName: { forColors: string; name: string } | null = null;
const PREFS = "catch";

function mountCatch(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "pc" });
  el.append(style, root);

  let count = 6;
  let shot: Shot | null = lastShot;
  let swatches: Swatch[] = [];
  let name = "";
  /** What was saved last, so Save says "Saved" until the palette or its name changes. */
  let savedAs = "";

  // ---- before a photo ----
  const demo = fan();
  const take = h("button", { class: "pc-btn pc-primary", type: "button" }, h("span", { class: "pc-glyph", "aria-hidden": "true" }, "📷"), ctx.t(W.take));
  const choose = h("button", { class: "pc-btn", type: "button" }, ctx.t(W.choose));
  const trySample = h("button", { class: "pc-link", type: "button" }, ctx.t(W.sample));
  const hero = h(
    "section",
    { class: "pc-hero", "aria-labelledby": "pc-hero-title" },
    demo.el,
    h("div", { class: "pc-hero-text" }, h("h2", { id: "pc-hero-title" }, ctx.t(W.heroTitle)), h("p", {}, ctx.t(W.heroBody)), h("div", { class: "pc-row" }, take, choose), trySample),
  );

  // ---- with a photo ----
  const photo = h("figure", { class: "pc-photo", role: "img", "aria-label": ctx.t(W.photoLabel) });
  const pins = h("div", { class: "pc-pins" });
  const status = h("div", { class: "pc-status", role: "status", "aria-live": "polite" });
  photo.append(pins, h("div", { class: "pc-scan" }), status);
  const title = h("h2", { class: "pc-name" });
  const rename = h("button", { class: "pc-icon", type: "button", "aria-label": ctx.t(W.rename), title: ctx.t(W.rename) }, "✎");
  const sub = h("p", { class: "pc-sub" });
  const chipsHolder = h("div", {});
  const segButtons = Array.from({ length: MAX_COLORS - MIN_COLORS + 1 }, (_, k) => {
    const n = MIN_COLORS + k;
    return h("button", { type: "button", "aria-pressed": "false", "data-n": String(n) }, String(n));
  });
  const seg = h("div", { class: "pc-seg", role: "group", "aria-label": ctx.t(W.count) }, ...segButtons);
  const save = h("button", { class: "pc-btn pc-primary", type: "button" });
  const share = h("button", { class: "pc-btn", type: "button" }, h("span", { class: "pc-glyph", "aria-hidden": "true" }, "↗"), ctx.t(W.share));
  const again = h("button", { class: "pc-btn", type: "button" }, h("span", { class: "pc-glyph", "aria-hidden": "true" }, "📷"), ctx.t(W.newPhoto));
  const panel = h(
    "div",
    { class: "pc-panel" },
    h("div", { class: "pc-head" }, title, rename),
    sub,
    chipsHolder,
    h("div", { class: "pc-count" }, h("span", { "aria-hidden": "true" }, ctx.t(W.count)), seg),
    h("div", { class: "pc-actions" }, save, share, again),
  );
  const work = h("section", { class: "pc-work" }, photo, panel);
  root.append(hero, work);

  const key = () => `${encodeColors(swatches.map((s) => s.hex))}|${name}`;
  const showSave = () => {
    const done = savedAs !== "" && savedAs === key();
    save.replaceChildren(done ? `✓ ${ctx.t(W.saved)}` : ctx.t(W.save));
    save.classList.toggle("pc-done", done);
  };

  let pinEls: HTMLElement[] = [];
  const highlight = (i: number) => pinEls.forEach((p, j) => p.classList.toggle("pc-on", j === i));

  /** Draw the palette for the current photo and count; `fresh` plays the catching motion. */
  const render = (fresh: boolean) => {
    if (!shot) {
      hero.hidden = false;
      work.hidden = true;
      return;
    }
    hero.hidden = true;
    work.hidden = false;
    const view = shot.view;
    if (!photo.contains(view)) {
      photo.querySelector("canvas")?.remove();
      photo.prepend(view);
    }
    photo.style.setProperty("--ar", String(view.width / view.height));
    swatches = paletteOf(shot.analysis, count);
    const colors = encodeColors(swatches.map((s) => s.hex));
    if (lastName?.forColors !== colors) {
      // A new set of colours gets a new name, unless the person named this very set.
      name = paletteName(swatches, ctx);
      lastName = { forColors: colors, name };
    } else name = lastName.name;
    title.textContent = name;
    const shown = shownOf(swatches, ctx);
    sub.textContent = `${ctx.t(W.caught, { n: swatches.length })} · ${ctx.t(W.tapHint)}`;
    const card = chipCard(ctx, shown, swatches.map((s) => s.hex), highlight);
    chipsHolder.replaceChildren(card);
    pinEls = swatches.map((s, i) => {
      const pin = h("button", { type: "button", class: "pc-pin", tabindex: "-1", "aria-hidden": "true" });
      tint(pin, s.rgb);
      pin.style.setProperty("--i", String(i));
      if (s.at) {
        pin.style.left = `${s.at.x * 100}%`;
        pin.style.top = `${s.at.y * 100}%`;
      } else pin.hidden = true;
      pin.addEventListener("click", () => openColour(ctx, shown, i, highlight));
      return pin;
    });
    pins.replaceChildren(...pinEls);
    segButtons.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === count)));
    showSave();
    if (fresh && !reducedMotion()) {
      photo.classList.remove("pc-catching");
      void photo.offsetWidth;
      photo.classList.add("pc-catching");
      status.textContent = ctx.t(W.catching);
      status.classList.remove("pc-gone");
      setTimeout(() => {
        status.textContent = ctx.t(W.caught, { n: swatches.length });
        status.classList.add("pc-gone");
      }, 900);
    } else {
      status.textContent = ctx.t(W.caught, { n: swatches.length });
      status.classList.add("pc-gone");
    }
  };

  const use = (next: Shot) => {
    shot = next;
    lastShot = next;
    savedAs = "";
    render(true);
    void ctx.caps.haptics?.vibrate(12);
    title.scrollIntoView?.({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const fromCamera = async (source: "camera" | "library") => {
    const camera = ctx.caps.camera;
    if (!camera) return ctx.ui.toast(ctx.t(W.noCamera));
    let blob: Blob;
    try {
      blob = await camera.capture({ source });
    } catch {
      return; // nothing chosen
    }
    try {
      use(await shotFrom(blob));
    } catch {
      ctx.ui.toast(ctx.t(W.unreadable));
    }
  };
  take.addEventListener("click", () => void fromCamera("camera"));
  choose.addEventListener("click", () => void fromCamera("library"));
  trySample.addEventListener("click", () => use(sampleShot()));
  again.addEventListener("click", async () => {
    const pick = await ctx.ui.sheet<"camera" | "library">({
      title: ctx.t(W.newPhotoTitle),
      items: [
        { id: "camera", label: ctx.t(W.take), icon: "camera" },
        { id: "library", label: ctx.t(W.library), icon: "image" },
      ],
    });
    if (pick) await fromCamera(pick);
  });

  segButtons.forEach((b) =>
    b.addEventListener("click", () => {
      count = Number(b.dataset.n);
      void ctx.storage.set(PREFS, { count });
      render(false);
    }),
  );

  rename.addEventListener("click", async () => {
    const next = (await ctx.ui.prompt(ctx.t(W.renamePrompt), { default: name }))?.trim();
    if (!next || next === name) return;
    name = next;
    lastName = { forColors: encodeColors(swatches.map((s) => s.hex)), name };
    title.textContent = name;
    showSave();
  });

  save.addEventListener("click", async () => {
    if (!shot || !swatches.length || save.classList.contains("pc-done")) return;
    save.disabled = true;
    const keptName = name;
    const keptKey = key();
    try {
      const now = ctx.now();
      const jpeg = await blobOf(scaled(shot.view, shot.view.width, shot.view.height, 1280), "image/jpeg", 0.86);
      const file = await ctx.files.write(`photos/${slug(keptName, now)}.jpg`, jpeg, { mime: "image/jpeg" });
      const photoRef: FileRef = { id: file.id, path: file.path, name: file.name, mime: file.mime };
      await ctx.create("palette", { name: keptName, colors: encodeColors(swatches.map((s) => s.hex)), date: now, photo: photoRef });
      savedAs = keptKey;
      void ctx.caps.haptics?.vibrate([10, 40, 14]);
      ctx.ui.toast(ctx.t(W.savedToast, { name: keptName }));
    } catch {
      ctx.ui.toast(ctx.t(W.notSaved));
    } finally {
      save.disabled = false;
      showSave();
    }
  });

  share.addEventListener("click", async () => {
    if (!shot || !swatches.length) return;
    share.disabled = true;
    try {
      await shareCard(ctx, el, shot.view, shot.view.width, shot.view.height, swatches.map((s) => s.hex), name);
      ctx.ui.toast(ctx.t(W.shareDone));
    } catch {
      ctx.ui.toast(ctx.t(W.shareFail));
    } finally {
      share.disabled = false;
    }
  });

  // The count you left it at, then the first draw.
  let alive = true;
  render(false);
  void ctx.storage
    .get<{ count?: number }>(PREFS)
    .catch(() => null)
    .then((p) => {
      if (!alive) return;
      if (p && Number.isFinite(p.count)) count = Math.min(MAX_COLORS, Math.max(MIN_COLORS, Math.round(p.count!)));
      render(false);
    });

  return () => {
    alive = false;
    demo.stop();
    document.querySelectorAll(".pc-scrim").forEach((n) => n.remove());
    root.remove();
    style.remove();
  };
}

// ---- the Gallery ----

const shortDate = (d: Date, ctx: Ctx): string => ctx.format.date(d, { day: "numeric", month: "short" });

function mountGallery(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "pc" });
  el.append(style, root);
  const urls = new Map<string, string>();
  let alive = true;
  let generation = 0;
  let mini: { stop: () => void } | null = null;

  const urlFor = async (ref: FileRef | undefined): Promise<string | null> => {
    if (!ref) return null;
    const known = urls.get(ref.id);
    if (known) return known;
    const url = await ctx.files.url(ref).catch(() => null);
    if (url) urls.set(ref.id, url);
    return url;
  };

  const shownFor = (hexes: string[]): Shown[] => {
    const rgbs = hexes.map((hex) => parseHex(hex)!);
    const names = colorNames(rgbs.map(rgbToOklab), ctx);
    return rgbs.map((rgb, i) => ({ rgb, name: names[i]!, note: "" }));
  };

  const open = (r: Resolved, url: string | null) => {
    const hexes = decodeColors(r.colors);
    const opener = document.activeElement as HTMLElement | null;
    const nameEl = h("h3", { class: "pc-name", id: "pc-box-title" }, String(r.name));
    const shareB = h("button", { class: "pc-btn pc-primary", type: "button" }, h("span", { class: "pc-glyph", "aria-hidden": "true" }, "↗"), ctx.t(W.share));
    const renameB = h("button", { class: "pc-btn", type: "button" }, ctx.t(W.rename));
    const del = h("button", { class: "pc-btn pc-danger", type: "button" }, ctx.t(W.deleteWord));
    const shut = h("button", { class: "pc-btn", type: "button" }, ctx.t(W.close));
    const img = url ? h("img", { src: url, alt: "" }) : null;
    const hasPhoto = Boolean(r.photo);
    const box = h(
      "div",
      { class: "pc-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "pc-box-title" },
      h(
        "div",
        { class: "pc-box-card" },
        img ?? (hasPhoto ? h("div", { class: "pc-missing" }, ctx.t(W.notHere)) : bands(hexes)),
        h(
          "div",
          { class: "pc-box-side" },
          nameEl,
          h("p", { class: "pc-sub" }, `${ctx.t(W.colours, { n: hexes.length })}${r.date ? ` · ${shortDate(new Date(r.date as string), ctx)}` : ""}`),
          chipCard(ctx, shownFor(hexes), hexes),
          h("div", { class: "pc-actions" }, shareB, renameB, del, shut),
        ),
      ),
    );
    const close = () => {
      box.remove();
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".pc-scrim")) close();
    };
    box.addEventListener("click", (e) => e.target === box && close());
    shut.addEventListener("click", close);
    shareB.addEventListener("click", async () => {
      if (!img && hasPhoto) return ctx.ui.toast(ctx.t(W.notHere));
      shareB.disabled = true;
      try {
        await img?.decode();
        await shareCard(ctx, el, img, img?.naturalWidth ?? 1, img?.naturalHeight ?? 1, hexes, nameEl.textContent ?? "");
        ctx.ui.toast(ctx.t(W.shareDone));
      } catch {
        ctx.ui.toast(ctx.t(W.shareFail));
      } finally {
        shareB.disabled = false;
      }
    });
    renameB.addEventListener("click", async () => {
      const next = (await ctx.ui.prompt(ctx.t(W.renamePrompt), { default: nameEl.textContent ?? "" }))?.trim();
      if (!next) return;
      await ctx.patch("palette", String(r.id), { name: next });
      nameEl.textContent = next;
    });
    del.addEventListener("click", async () => {
      const sure = await ctx.ui.confirm(ctx.t(W.deleteQ, { name: nameEl.textContent ?? "" }), { detail: ctx.t(W.deleteDetail), ok: ctx.t(W.deleteWord), destructive: true });
      if (!sure) return;
      close();
      if (r.photo) await ctx.files.remove(r.photo as FileRef).catch(() => undefined);
      await ctx.delete("palette", String(r.id));
    });
    document.addEventListener("keydown", onKey);
    document.body.append(adopt(box));
    shareB.focus();
  };

  const render = async (rows: Resolved[]) => {
    const mine = ++generation;
    const sorted = [...rows].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    mini?.stop();
    mini = null;
    if (!sorted.length) {
      const f = fan(true);
      mini = f;
      const go = h("button", { class: "pc-btn pc-primary", type: "button" }, ctx.t(W.emptyGo));
      go.addEventListener("click", () => props.navigate("catch"));
      root.replaceChildren(h("div", { class: "pc-empty" }, f.el, h("h3", {}, ctx.t(W.emptyTitle)), h("p", {}, ctx.t(W.emptyBody)), go));
      return;
    }
    const cards = await Promise.all(
      sorted.map(async (r, i) => {
        const url = await urlFor(r.photo as FileRef | undefined);
        const hexes = decodeColors(r.colors);
        const strip = h("div", { class: "pc-strip", "aria-hidden": "true" }, ...hexes.map((hex) => {
          const s = h("i", {});
          s.style.setProperty("--c", hex);
          return s;
        }));
        const when = r.date ? new Date(r.date as string) : null;
        const b = h(
          "button",
          { class: "pc-card", type: "button", "aria-label": ctx.t(W.open, { name: String(r.name) }) },
          h("div", { class: "pc-card-art" }, url ? h("img", { src: url, alt: "", loading: "lazy" }) : r.photo ? h("div", { class: "pc-missing" }, ctx.t(W.notHere)) : bands(hexes), strip),
          h("div", { class: "pc-card-cap" }, h("b", {}, String(r.name)), h("span", {}, when ? shortDate(when, ctx) : "")),
        );
        b.style.setProperty("--i", String(i));
        b.addEventListener("click", () => open(r, url));
        return b;
      }),
    );
    if (!alive || mine !== generation) return;
    root.replaceChildren(h("p", { class: "pc-gallery-head" }, ctx.t(W.galleryHead, { n: sorted.length })), h("div", { class: "pc-wall" }, ...cards));
  };

  const stop = props.runtime.watchQuery("palette", undefined, ({ rows, loading }) => {
    if (!loading) void render(rows);
  });

  return () => {
    alive = false;
    stop();
    mini?.stop();
    for (const url of urls.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    document.querySelectorAll(".pc-box, .pc-scrim").forEach((n) => n.remove());
    root.remove();
    style.remove();
  };
}

// ---- the app ----

export default defineApp({
  id: "palette-catcher",
  name: W.appName,
  icon: "palette",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#ef7d57" },
  nav: "tabs",
  permissions: { camera: true, haptics: true },
  // Palettes are caught on the Catch screen; this is for the one you already know by heart.
  quickActions: [
    {
      id: "type",
      label: { en: "Type in a palette", "pt-BR": "Digitar uma paleta", de: "Palette eintippen", es: "Escribir una paleta", pl: "Wpisz paletę", it: "Scrivi una palette" },
      icon: "pencil",
      entity: "palette",
      mode: "form",
      openPage: "gallery",
    },
  ],
  entities: {
    palette: {
      label: { en: "Palette", "pt-BR": "Paleta", de: "Palette", es: "Paleta", pl: "Paleta", it: "Palette" },
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        colors: {
          type: "text",
          required: true,
          label: { en: "Colours", "pt-BR": "Cores", de: "Farben", es: "Colores", pl: "Kolory", it: "Colori" },
          placeholder: "#264653 #2a9d8f #e9c46a #f4a261 #e76f51",
          help: {
            en: "Hex codes, as shown, separated by spaces",
            "pt-BR": "Códigos hex, na ordem mostrada, separados por espaços",
            de: "Hex-Codes in der gezeigten Reihenfolge, durch Leerzeichen getrennt",
            es: "Códigos hex, en el orden mostrado, separados por espacios",
            pl: "Kody hex w pokazanej kolejności, oddzielone spacjami",
            it: "Codici hex, nell'ordine mostrato, separati da spazi",
          },
        },
        date: { type: "datetime", precision: "minute", default: (ctx: Ctx) => ctx.now(), label: { en: "Caught", "pt-BR": "Capturada em", de: "Eingefangen", es: "Atrapada", pl: "Złapana", it: "Catturata" } },
        photo: { type: "file", accept: ".jpg,.jpeg", folder: "photos", label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } },
      },
    },
  },
  pages: [
    {
      id: "catch",
      title: { en: "Catch", "pt-BR": "Capturar", de: "Einfangen", es: "Atrapar", pl: "Łap", it: "Cattura" },
      icon: "palette",
      view: { type: "custom", entity: "palette", mount: mountCatch },
    },
    {
      id: "gallery",
      title: { en: "Gallery", "pt-BR": "Galeria", de: "Galerie", es: "Galería", pl: "Galeria", it: "Galleria" },
      icon: "image",
      view: { type: "custom", entity: "palette", mount: mountGallery },
    },
  ],
});
