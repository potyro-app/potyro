// Photo Garden — take a photo, and thousands of specks that carry its colours drift on a current,
// gather into the picture, and scatter wherever you touch or drag. Three styles (Flow, Points,
// Mosaic), a density slider, and "Keep this" saves the moment as a PNG in the app's own folder with a
// record for the Gallery.
//
// Drawn with p5.js in instance mode, imported by URL (#266): the shell fetches p5 once, when the app
// is added, and runs it from the copy it keeps. The photo comes through `ctx.caps.camera` — the app
// never touches the browser's camera itself (CLAUDE.md rule 2) — so it is a still, not a live
// stream; the motion is the garden's. p5 needs a real web page, so this app runs as your own
// (trusted) app only. What a speck does is decided in garden.ts, in plain functions with tests.
//
// In six languages (#303); every language but English is a model's draft (#297). The screens say
// their words through `ctx.t`. A kept picture's title ("Amber Drift") is a record — a name made
// when it is kept, and part of its file name — so it is made in English, like a title, and stays
// as it was named.
import { defineApp } from "potyro";
import type { Ctx, FileRef, Resolved, ViewProps } from "potyro";
import p5 from "https://esm.sh/p5@1.11.11?bundle";
import {
  coverCrop,
  dusk,
  lightness,
  makeSpecks,
  MOTION,
  rng,
  sampleSize,
  snapshotPath,
  step,
  STYLES as STYLE_LIST,
  titleFor,
  unsettled,
  type Source,
  type Specks,
  type Style,
  type Touch,
} from "./garden.js";
import { STYLES } from "./styles.js";

// ---- small helpers ----

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

/** A shell token as [r, g, b], whatever colour syntax it is written in. */
function tokenRgb(el: HTMLElement, name: string, fallback: string): [number, number, number] {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = fallback;
  g.fillStyle = getComputedStyle(el).getPropertyValue(name).trim() || fallback;
  g.fillRect(0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  return [r!, gg!, b!];
}

/** The photo, cropped to the stage's shape and shrunk to the few hundred pixels the specks sample. */
async function sourceFrom(blob: Blob, width: number, height: number): Promise<Source> {
  const bmp = await createImageBitmap(blob);
  try {
    const crop = coverCrop(bmp.width, bmp.height, width, height);
    const size = sampleSize(width, height);
    const c = document.createElement("canvas");
    c.width = size.w;
    c.height = size.h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, size.w, size.h);
    const { data } = g.getImageData(0, 0, size.w, size.h);
    return { w: size.w, h: size.h, data };
  } finally {
    bmp.close();
  }
}

/** A style in the person's words: the same as `style`'s labels below. Records keep "flow". */
const styleName = (s: unknown, ctx: Ctx): string => {
  if (s === "flow") return ctx.t("Flow");
  if (s === "points") return ctx.t("Points");
  if (s === "mosaic") return ctx.t("Mosaic");
  return "";
};

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const isPhone = (w: number) => w < 640 || (window.matchMedia?.("(pointer: coarse)").matches ?? false);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const PREFS = "studio";
/** The photo in the Studio, kept for this session only: a garden is a moment, not a record. */
let lastPhoto: Source | null = null;
interface Prefs {
  style: Style;
  density: number;
}

// ---- the Studio ----

function mountStudio(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "pg" });
  const stage = h("div", { class: "pg-stage", "data-testid": "garden-stage" });
  root.append(stage);
  el.append(style, root);

  let mode: Style = "flow";
  let density = 55;
  // The last photo outlives a remount (the shell rebuilds the page when the layout changes).
  let src: Source = lastPhoto ?? dusk();
  let hasPhoto = lastPhoto !== null;

  let specks: Specks | null = null;
  let gather = 0;
  let W = 360;
  let H = 480;
  let paper: [number, number, number] = [240, 235, 225];
  const random = rng(Date.now() & 0xffff);
  const touch: Touch = { x: 0, y: 0, strength: 0, radius: 70 };
  let pressed = false;

  // Welcome card, shown over the idle garden until there is a photo.
  const takeWords = ctx.t("Take a photo");
  const take = h("button", { class: "pg-btn pg-primary", type: "button" }, `📷  ${takeWords}`);
  const choose = h(
    "button",
    { class: "pg-btn", type: "button" },
    ctx.t("Choose one"),
  );
  const welcome = h(
    "div",
    { class: "pg-welcome" },
    h(
      "h2",
      {},
      ctx.t("Grow a garden from a photo"),
    ),
    h(
      "p",
      {},
      ctx.t("Take a picture of something you love — a face, a plant, a street at night. It becomes thousands of drifting specks that remember it. Touch them and they scatter."),
    ),
    h("div", { class: "pg-row" }, take, choose),
  );
  const hint = h(
    "div",
    { class: "pg-hint", hidden: "" },
    ctx.t("Drag across it to scatter the specks"),
  );

  // Control bar
  const styleButtons = STYLE_LIST.map((s) => h("button", { type: "button", "data-style": s, "aria-pressed": "false" }, styleName(s, ctx)));
  const slider = h("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "1",
    "aria-label": ctx.t("Density"),
  });
  const newPhoto = ctx.t("New photo");
  const again = h("button", { class: "pg-btn", type: "button", "aria-label": newPhoto }, "📷", h("span", { class: "pg-wide" }, ` ${newPhoto}`));
  const keep = h(
    "button",
    { class: "pg-btn pg-primary", type: "button", disabled: "" },
    ctx.t("Keep this"),
  );
  const bar = h(
    "div",
    { class: "pg-bar" },
    h("div", { class: "pg-styles", role: "group", "aria-label": ctx.t("Style") }, ...styleButtons),
    h(
      "label",
      { class: "pg-density" },
      h("span", {}, ctx.t("Sparse")),
      slider,
      h("span", {}, ctx.t("Dense")),
    ),
    h("div", { class: "pg-actions" }, again, keep),
  );
  stage.append(welcome, hint, bar);
  if (hasPhoto) {
    welcome.hidden = true;
    keep.disabled = false;
  }

  const showStyle = () => styleButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.style === mode)));

  // Sizing: as wide as the page, as tall as the room under it allows, within a portrait-ish shape.
  const probe = h("div", {});
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--k-chrome-bottom, 0px)";
  el.append(probe);
  const measure = (): [number, number] => {
    const w = Math.max(280, Math.floor(stage.clientWidth || el.clientWidth || 360));
    const room = window.innerHeight - stage.getBoundingClientRect().top - probe.offsetHeight - 20;
    // A phone held upright gets a tall canvas; a wide screen a landscape-ish one.
    const hgt = Math.floor(Math.max(380, Math.min(room, w * (w < 640 ? 1.9 : 1.35))));
    return [w, hgt];
  };

  const rebuild = (scatter = true) => {
    const fresh = makeSpecks(mode, src, W, H, density, isPhone(W), random);
    if (!scatter && specks) {
      // Keep where the old specks were, so a density change ripples rather than restarts.
      for (let i = 0; i < fresh.n; i++) {
        const j = i % specks.n;
        fresh.x[i] = specks.x[j]!;
        fresh.y[i] = specks.y[j]!;
      }
    }
    specks = fresh;
    gather = scatter ? 0 : Math.min(gather, 0.6);
  };

  let sketch: p5 | null = null;
  let t = 0;

  const drawFrame = (p: p5) => {
    const g = p.drawingContext;
    const s = specks;
    if (!s) return;
    const dt = Math.min(50, p.deltaTime || 16);
    t += dt;
    gather = Math.min(1, gather + dt / 2600);
    if (!pressed) touch.strength *= 0.9;
    const field = (x: number, y: number) => p.noise(x * 0.0028, y * 0.0028, t * 0.00011) * Math.PI * 4;
    step(s, MOTION[mode], easeOut(gather), field, touch);
    const [pr, pg, pb] = paper;
    g.fillStyle = `rgb(${pr},${pg},${pb})`;
    g.fillRect(0, 0, W, H);
    if (mode === "flow") {
      // Brush strokes: each speck drawn as a short dash along the way it is moving, so the current
      // shows. (Fading the last frame instead leaves grey ghosts on a light paper.)
      g.lineCap = "round";
      g.globalAlpha = 0.92;
      for (let i = 0; i < s.n; i++) {
        const x = s.x[i]!;
        const y = s.y[i]!;
        const vx = s.vx[i]!;
        const vy = s.vy[i]!;
        const len = Math.min(13, 5 + Math.hypot(vx, vy) * 2.2);
        const k = len / (Math.hypot(vx, vy) || 1);
        g.strokeStyle = s.fill[i]!;
        g.lineWidth = s.size[i]!;
        g.beginPath();
        g.moveTo(x - vx * k, y - vy * k);
        g.lineTo(x, y);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    const paperL = lightness(paper);
    if (mode === "points") {
      // A dot is as big as it differs from the paper: a portrait reads like a halftone print.
      for (let i = 0; i < s.n; i++) {
        const contrast = Math.abs(lightness([s.rgb[i * 3]!, s.rgb[i * 3 + 1]!, s.rgb[i * 3 + 2]!]) - paperL);
        const breathe = 0.9 + 0.1 * Math.sin(t * 0.0021 + i * 0.37);
        const r = s.size[i]! * 0.5 * (0.32 + 0.78 * contrast) * breathe;
        g.fillStyle = s.fill[i]!;
        g.beginPath();
        g.arc(s.x[i]!, s.y[i]!, Math.max(0.6, r), 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    // Mosaic: tiles laid by hand — each a touch off square — and a tile knocked from its place turns
    // and shrinks, then settles back.
    const dpr = p.pixelDensity();
    for (let i = 0; i < s.n; i++) {
      const u = unsettled(s, i);
      const wobble = Math.sin(i * 12.9898) * 0.06;
      const z = s.size[i]! * (0.86 + 0.05 * Math.sin(i * 78.233) - 0.5 * u);
      g.fillStyle = s.fill[i]!;
      const a = wobble + u * (i % 2 ? 1.2 : -1.2);
      const cos = Math.cos(a) * dpr;
      const sin = Math.sin(a) * dpr;
      g.setTransform(cos, sin, -sin, cos, s.x[i]! * dpr, s.y[i]! * dpr);
      g.fillRect(-z / 2, -z / 2, z, z);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const start = () => {
    p5.disableFriendlyErrors = true;
    [W, H] = measure();
    paper = tokenRgb(el, "--surface-sunken", "#f1ebe1");
    sketch = new p5((p) => {
      p.setup = () => {
        p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        const c = p.createCanvas(W, H).elt;
        c.setAttribute("role", "img");
        c.setAttribute(
          "aria-label",
          ctx.t("A living picture made of drifting specks of colour. Drag across it to scatter them."),
        );
        stage.prepend(c);
        p.frameRate(60);
        p.noiseDetail(3, 0.5);
        rebuild();
        const g = p.drawingContext;
        g.fillStyle = `rgb(${paper.join(",")})`;
        g.fillRect(0, 0, W, H);
        if (reducedMotion()) {
          // Still beautiful, but still: settle at once and draw a single frame.
          gather = 1;
          for (let i = 0; i < 120; i++) drawFrame(p);
          p.noLoop();
        }
        attachPointer(c);
      };
      p.draw = () => drawFrame(p);
    }, stage);
  };

  // ---- touch and mouse: our own listeners on the canvas, so the page still scrolls elsewhere ----
  const at = (e: PointerEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect();
    touch.x = ((e.clientX - r.left) / r.width) * W;
    touch.y = ((e.clientY - r.top) / r.height) * H;
  };
  const onDown = (e: PointerEvent) => {
    const c = e.currentTarget as HTMLCanvasElement;
    pressed = true;
    c.setPointerCapture?.(e.pointerId);
    at(e, c);
    touch.strength = 1;
    touch.radius = e.pointerType === "touch" ? 90 : 75;
    hint.hidden = true;
    if (sketch && !sketch.isLooping() && !reducedMotion()) sketch.loop();
  };
  const onMove = (e: PointerEvent) => {
    const c = e.currentTarget as HTMLCanvasElement;
    at(e, c);
    if (pressed) touch.strength = 1;
    else if (e.pointerType === "mouse") touch.strength = Math.max(touch.strength, 0.25); // a hovering mouse brushes gently
    if (reducedMotion() && sketch) sketch.redraw();
  };
  const onUp = () => {
    pressed = false;
  };
  let pointerOn: HTMLCanvasElement | null = null;
  const attachPointer = (c: HTMLCanvasElement) => {
    pointerOn = c;
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerup", onUp);
    c.addEventListener("pointercancel", onUp);
    c.addEventListener("pointerleave", onUp);
  };

  // ---- the photo ----
  const usePhoto = async (source: "camera" | "library") => {
    const camera = ctx.caps.camera;
    if (!camera) {
      ctx.ui.toast(
        ctx.t("This device does not let apps take photos."),
      );
      return;
    }
    let blob: Blob;
    try {
      blob = await camera.capture({ source });
    } catch {
      return; // nothing chosen
    }
    try {
      src = await sourceFrom(blob, W, H);
    } catch {
      ctx.ui.toast(
        ctx.t("That file could not be read as a picture."),
      );
      return;
    }
    hasPhoto = true;
    lastPhoto = src;
    welcome.hidden = true;
    keep.disabled = false;
    hint.hidden = false;
    setTimeout(() => (hint.hidden = true), 4200);
    rebuild();
    if (sketch && !sketch.isLooping()) {
      gather = 1;
      sketch.redraw();
    }
  };
  take.addEventListener("click", () => void usePhoto("camera"));
  choose.addEventListener("click", () => void usePhoto("library"));
  again.addEventListener("click", async () => {
    const pick = await ctx.ui.sheet<"camera" | "library">({
      title: ctx.t("A new photo"),
      items: [
        { id: "camera", label: takeWords, icon: "📷" },
        {
          id: "library",
          label: ctx.t("Choose from your photos"),
          icon: "🖼",
        },
      ],
    });
    if (pick) await usePhoto(pick);
  });

  // ---- style and density ----
  const savePrefs = () => void ctx.storage.set(PREFS, { style: mode, density } satisfies Prefs);
  styleButtons.forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.style as Style;
      showStyle();
      rebuild();
      savePrefs();
      if (sketch && !sketch.isLooping()) sketch.redraw();
    }),
  );
  let densityTimer = 0;
  slider.addEventListener("input", () => {
    density = Number(slider.value);
    clearTimeout(densityTimer);
    densityTimer = window.setTimeout(() => {
      rebuild(false);
      savePrefs();
    }, 120);
  });

  // ---- keep ----
  keep.addEventListener("click", async () => {
    const c = pointerOn;
    if (!c || !hasPhoto) return;
    keep.disabled = true;
    // What is on screen now is what is kept, even if the style changes while it saves.
    const keptStyle = mode;
    const picture = src;
    const notSaved = ctx.t("The picture could not be saved.");
    try {
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
      if (!blob) throw new Error(notSaved);
      const taken = (await ctx.query("artwork")).map((r) => String(r.title));
      const title = titleFor(picture, keptStyle, taken);
      const now = ctx.now();
      const file = await ctx.files.write(snapshotPath(title, now), blob, { mime: "image/png" });
      const image: FileRef = { id: file.id, path: file.path, name: file.name, mime: file.mime };
      await ctx.create("artwork", { title, style: keptStyle, date: now, image });
      stage.classList.remove("pg-kept");
      void stage.offsetWidth; // restart the flash
      stage.classList.add("pg-kept");
      void ctx.caps.haptics?.vibrate(18);
      ctx.ui.toast(
        ctx.t(
          "Kept “{title}” in your gallery",
          { title },
        ),
      );
    } catch (e) {
      ctx.ui.toast(e instanceof Error ? e.message : notSaved);
    } finally {
      keep.disabled = false;
    }
  });

  // ---- pause when nobody can see it ----
  let visible = true;
  const syncLoop = () => {
    if (!sketch || reducedMotion()) return;
    if (visible && !document.hidden) sketch.loop();
    else sketch.noLoop();
  };
  const onVisibility = () => syncLoop();
  document.addEventListener("visibilitychange", onVisibility);
  const seen = new IntersectionObserver((entries) => {
    visible = entries.some((x) => x.isIntersecting);
    syncLoop();
  });
  seen.observe(stage);

  // ---- resize and theme ----
  const resize = () => {
    if (!sketch) return;
    const [w, hgt] = measure();
    if (w === W && hgt === H) return;
    const sx = w / W;
    const sy = hgt / H;
    W = w;
    H = hgt;
    sketch.resizeCanvas(W, H);
    if (specks) {
      for (let i = 0; i < specks.n; i++) {
        specks.x[i] = specks.x[i]! * sx;
        specks.y[i] = specks.y[i]! * sy;
      }
    }
    rebuild(false);
  };
  const watchSize = new ResizeObserver(() => resize());
  watchSize.observe(el);
  const retheme = () => {
    paper = tokenRgb(el, "--surface-sunken", "#f1ebe1");
    if (sketch && !sketch.isLooping()) sketch.redraw();
  };
  const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  scheme?.addEventListener("change", retheme);
  const watchTheme = new MutationObserver(retheme);
  watchTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });

  // Preferences first, then the sketch: it opens in the style you left it in.
  let alive = true;
  void ctx.storage
    .get<Prefs>(PREFS)
    .catch(() => null)
    .then((prefs) => {
      if (!alive) return;
      if (prefs && STYLE_LIST.includes(prefs.style)) mode = prefs.style;
      if (prefs && Number.isFinite(prefs.density)) density = Math.min(100, Math.max(0, prefs.density));
      slider.value = String(density);
      showStyle();
      start();
    });

  return () => {
    alive = false;
    clearTimeout(densityTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    seen.disconnect();
    watchSize.disconnect();
    watchTheme.disconnect();
    scheme?.removeEventListener("change", retheme);
    if (pointerOn) {
      pointerOn.removeEventListener("pointerdown", onDown);
      pointerOn.removeEventListener("pointermove", onMove);
      pointerOn.removeEventListener("pointerup", onUp);
      pointerOn.removeEventListener("pointercancel", onUp);
      pointerOn.removeEventListener("pointerleave", onUp);
    }
    // p5's own teardown: stops the loop, removes the canvas and every listener it added.
    sketch?.remove();
    sketch = null;
    specks = null;
    root.remove();
    style.remove();
    probe.remove();
  };
}

// ---- the Gallery ----

/** "Oct 12", "12 paź": the day a picture was kept, as the person's calendar writes it. */
const shortDate = (d: Date, ctx: Ctx): string => ctx.format.date(d, { day: "numeric", month: "short" });

function mountGallery(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "pg" });
  el.append(style, root);
  const urls = new Map<string, string>();
  let alive = true;
  let generation = 0;

  const urlFor = async (ref: FileRef): Promise<string | null> => {
    const known = urls.get(ref.id);
    if (known) return known;
    const url = await ctx.files.url(ref).catch(() => null);
    if (url) urls.set(ref.id, url);
    return url;
  };

  const open = async (r: Resolved, url: string) => {
    const close = () => {
      box.remove();
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const opener = document.activeElement as HTMLElement | null;
    const deleteWord = ctx.t("Delete");
    const share = h(
      "button",
      { class: "pg-btn pg-primary", type: "button" },
      ctx.t("Share"),
    );
    const save = h(
      "button",
      { class: "pg-btn", type: "button" },
      ctx.t("Save a copy"),
    );
    const del = h("button", { class: "pg-btn pg-danger", type: "button" }, deleteWord);
    const shut = h("button", { class: "pg-btn", type: "button" }, ctx.t("Close"));
    const when = r.date ? new Date(r.date as string) : null;
    const box = h(
      "div",
      { class: "pg-lightbox", role: "dialog", "aria-modal": "true", "aria-label": String(r.title) },
      h(
        "div",
        { class: "pg-lightbox-card" },
        h("img", { src: url, alt: String(r.title) }),
        h(
          "div",
          { class: "pg-lightbox-meta" },
          h("div", {}, h("h3", {}, String(r.title)), h("p", {}, `${styleName(r.style, ctx)}${when ? ` · ${shortDate(when, ctx)}` : ""}`)),
          h("div", { class: "pg-row" }, share, save, del, shut),
        ),
      ),
    );
    box.addEventListener("click", (e) => e.target === box && close());
    shut.addEventListener("click", close);
    const notHere = ctx.t("It could not be saved here.");
    save.addEventListener("click", () => void ctx.files.export(r.image as FileRef).catch(() => ctx.ui.toast(notHere)));
    // The picture itself, through Potyro's share dialog: the person sees it and picks where it goes.
    share.addEventListener("click", () =>
      void ctx.ui.share({ title: String(r.title), files: [r.image as FileRef] }).catch(() =>
        ctx.ui.toast(ctx.t("It could not be shared.")),
      ),
    );
    del.addEventListener("click", async () => {
      const sure = await ctx.ui.confirm(
        ctx.t(
          "Delete “{title}”?",
          { title: String(r.title) },
        ),
        {
          detail: ctx.t("The picture is removed from this app."),
          ok: deleteWord,
          destructive: true,
        },
      );
      if (!sure) return;
      close();
      await ctx.files.remove(r.image as FileRef).catch(() => undefined);
      await ctx.delete("artwork", String(r.id));
    });
    document.addEventListener("keydown", onKey);
    document.body.append(box);
    shut.focus();
  };

  const render = async (rows: Resolved[]) => {
    const mine = ++generation;
    const sorted = [...rows].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    const head = h(
      "div",
      { class: "pg-gallery-head" },
      h(
        "p",
        {},
        sorted.length
          ? ctx.t(
              "{n} kept, newest first. Tap one to see it large.",
              { n: sorted.length },
            )
          : "",
      ),
    );
    if (!sorted.length) {
      const go = h(
        "button",
        { class: "pg-btn pg-primary", type: "button" },
        ctx.t("Open the Studio"),
      );
      go.addEventListener("click", () => props.navigate("studio"));
      root.replaceChildren(
        head,
        h(
          "div",
          { class: "pg-empty" },
          h("h3", {}, ctx.t("Nothing kept yet")),
          h(
            "p",
            {},
            ctx.t("Grow a garden from a photo, then press “Keep this”. It lands here."),
          ),
          go,
        ),
      );
      return;
    }
    const pieces = await Promise.all(
      sorted.map(async (r) => {
        const ref = r.image as FileRef | undefined;
        const url = ref ? await urlFor(ref) : null;
        const when = r.date ? new Date(r.date as string) : null;
        const b = h(
          "button",
          {
            class: "pg-piece",
            type: "button",
            "aria-label": ctx.t(
              "{title}, open",
              { title: String(r.title) },
            ),
          },
          h(
            "figure",
            {},
            url
              ? h("img", { src: url, alt: "", loading: "lazy" })
              : h(
                  "div",
                  { class: "pg-empty" },
                  ctx.t("Not on this device yet"),
                ),
            h("figcaption", {}, h("b", {}, String(r.title)), h("span", {}, `${styleName(r.style, ctx)}${when ? ` · ${shortDate(when, ctx)}` : ""}`)),
          ),
        );
        if (url) b.addEventListener("click", () => void open(r, url));
        return b;
      }),
    );
    if (!alive || mine !== generation) return;
    root.replaceChildren(head, h("div", { class: "pg-wall" }, ...pieces));
  };

  const stop = props.runtime.watchQuery("artwork", undefined, ({ rows, loading }) => {
    if (!loading) void render(rows);
  });

  return () => {
    alive = false;
    stop();
    for (const url of urls.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    document.querySelectorAll(".pg-lightbox").forEach((n) => n.remove());
    root.remove();
    style.remove();
  };
}

// ---- the app ----

export default defineApp({
  id: "photo-garden",
  name: "Photo Garden",
  icon: "🌸",
  version: "1.1.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#e0567a" },
  category: "camera",
  nav: "tabs",
  permissions: { camera: true, haptics: true },
  entities: {
    artwork: {
      label: "Artwork",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Title" },
        style: {
          type: "enum",
          options: [...STYLE_LIST],
          colors: { flow: "blue", points: "orange", mosaic: "purple" },
          label: "Style",
          labels: {
            flow: "Flow",
            points: "Points",
            mosaic: "Mosaic",
          },
        },
        date: { type: "datetime", precision: "minute", label: "Date" },
        image: { type: "file", accept: ".png", folder: "garden", label: "Image" },
      },
    },
  },
  pages: [
    {
      id: "studio",
      title: "Studio",
      icon: "🌸",
      view: { type: "custom", entity: "artwork", mount: mountStudio },
    },
    {
      id: "gallery",
      title: "Gallery",
      icon: "🖼",
      view: { type: "custom", entity: "artwork", mount: mountGallery },
    },
  ],
});
