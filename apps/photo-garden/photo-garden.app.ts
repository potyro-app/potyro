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
  if (s === "flow") return ctx.t({ en: "Flow", "pt-BR": "Fluxo", de: "Fluss", es: "Flujo", pl: "Nurt", it: "Flusso" });
  if (s === "points") return ctx.t({ en: "Points", "pt-BR": "Pontos", de: "Punkte", es: "Puntos", pl: "Kropki", it: "Punti" });
  if (s === "mosaic") return ctx.t({ en: "Mosaic", "pt-BR": "Mosaico", de: "Mosaik", es: "Mosaico", pl: "Mozaika", it: "Mosaico" });
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
  const takeWords = ctx.t({ en: "Take a photo", "pt-BR": "Tirar uma foto", de: "Foto aufnehmen", es: "Hacer una foto", pl: "Zrób zdjęcie", it: "Scatta una foto" });
  const take = h("button", { class: "pg-btn pg-primary", type: "button" }, `📷  ${takeWords}`);
  const choose = h(
    "button",
    { class: "pg-btn", type: "button" },
    ctx.t({ en: "Choose one", "pt-BR": "Escolher uma", de: "Eins auswählen", es: "Elegir una", pl: "Wybierz zdjęcie", it: "Scegline una" }),
  );
  const welcome = h(
    "div",
    { class: "pg-welcome" },
    h(
      "h2",
      {},
      ctx.t({
        en: "Grow a garden from a photo",
        "pt-BR": "Faça um jardim nascer de uma foto",
        de: "Lass aus einem Foto einen Garten wachsen",
        es: "Haz crecer un jardín a partir de una foto",
        pl: "Wyhoduj ogród ze zdjęcia",
        it: "Fai crescere un giardino da una foto",
      }),
    ),
    h(
      "p",
      {},
      ctx.t({
        en: "Take a picture of something you love — a face, a plant, a street at night. It becomes thousands of drifting specks that remember it. Touch them and they scatter.",
        "pt-BR": "Fotografe algo que você ama — um rosto, uma planta, uma rua à noite. A foto vira milhares de partículas à deriva que se lembram dela. Toque nelas e elas se espalham.",
        de: "Fotografiere etwas, das du liebst — ein Gesicht, eine Pflanze, eine Straße bei Nacht. Daraus werden Tausende treibende Pünktchen, die sich daran erinnern. Berühr sie, und sie stieben auseinander.",
        es: "Haz una foto de algo que te guste — una cara, una planta, una calle de noche. Se convierte en miles de motas a la deriva que la recuerdan. Tócalas y se dispersan.",
        pl: "Zrób zdjęcie czegoś, co kochasz — twarzy, rośliny, ulicy nocą. Zmieni się w tysiące dryfujących drobinek, które je pamiętają. Dotknij ich, a się rozpierzchną.",
        it: "Fotografa qualcosa che ami — un volto, una pianta, una strada di notte. Diventa migliaia di granelli alla deriva che lo ricordano. Toccali e si sparpagliano.",
      }),
    ),
    h("div", { class: "pg-row" }, take, choose),
  );
  const hint = h(
    "div",
    { class: "pg-hint", hidden: "" },
    ctx.t({
      en: "Drag across it to scatter the specks",
      "pt-BR": "Arraste o dedo por cima para espalhar as partículas",
      de: "Wisch darüber, um die Pünktchen zu verstreuen",
      es: "Desliza por encima para dispersar las motas",
      pl: "Przeciągnij palcem, by rozproszyć drobinki",
      it: "Trascina sopra per sparpagliare i granelli",
    }),
  );

  // Control bar
  const styleButtons = STYLE_LIST.map((s) => h("button", { type: "button", "data-style": s, "aria-pressed": "false" }, styleName(s, ctx)));
  const slider = h("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "1",
    "aria-label": ctx.t({ en: "Density", "pt-BR": "Densidade", de: "Dichte", es: "Densidad", pl: "Gęstość", it: "Densità" }),
  });
  const newPhoto = ctx.t({ en: "New photo", "pt-BR": "Nova foto", de: "Neues Foto", es: "Nueva foto", pl: "Nowe zdjęcie", it: "Nuova foto" });
  const again = h("button", { class: "pg-btn", type: "button", "aria-label": newPhoto }, "📷", h("span", { class: "pg-wide" }, ` ${newPhoto}`));
  const keep = h(
    "button",
    { class: "pg-btn pg-primary", type: "button", disabled: "" },
    ctx.t({ en: "Keep this", "pt-BR": "Guardar esta", de: "Behalten", es: "Guardar esta", pl: "Zachowaj", it: "Tienila" }),
  );
  const bar = h(
    "div",
    { class: "pg-bar" },
    h("div", { class: "pg-styles", role: "group", "aria-label": ctx.t({ en: "Style", "pt-BR": "Estilo", de: "Stil", es: "Estilo", pl: "Styl", it: "Stile" }) }, ...styleButtons),
    h(
      "label",
      { class: "pg-density" },
      h("span", {}, ctx.t({ en: "Sparse", "pt-BR": "Esparso", de: "Locker", es: "Disperso", pl: "Rzadko", it: "Rado" })),
      slider,
      h("span", {}, ctx.t({ en: "Dense", "pt-BR": "Denso", de: "Dicht", es: "Denso", pl: "Gęsto", it: "Fitto" })),
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
          ctx.t({
            en: "A living picture made of drifting specks of colour. Drag across it to scatter them.",
            "pt-BR": "Uma imagem viva feita de partículas de cor à deriva. Arraste por cima para espalhá-las.",
            de: "Ein lebendiges Bild aus treibenden Farbpünktchen. Wisch darüber, um sie zu verstreuen.",
            es: "Una imagen viva hecha de motas de color a la deriva. Desliza por encima para dispersarlas.",
            pl: "Żywy obraz z dryfujących drobinek koloru. Przeciągnij palcem, by je rozproszyć.",
            it: "Un'immagine viva fatta di granelli di colore alla deriva. Trascina sopra per sparpagliarli.",
          }),
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
        ctx.t({
          en: "This device does not let apps take photos.",
          "pt-BR": "Este aparelho não deixa os apps tirarem fotos.",
          de: "Dieses Gerät lässt Apps keine Fotos machen.",
          es: "Este dispositivo no deja que las apps hagan fotos.",
          pl: "To urządzenie nie pozwala aplikacjom robić zdjęć.",
          it: "Questo dispositivo non permette alle app di scattare foto.",
        }),
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
        ctx.t({
          en: "That file could not be read as a picture.",
          "pt-BR": "Não foi possível ler esse arquivo como imagem.",
          de: "Diese Datei ließ sich nicht als Bild lesen.",
          es: "No se pudo leer ese archivo como imagen.",
          pl: "Tego pliku nie udało się odczytać jako obrazu.",
          it: "Non è stato possibile leggere quel file come immagine.",
        }),
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
      title: ctx.t({ en: "A new photo", "pt-BR": "Uma nova foto", de: "Ein neues Foto", es: "Una foto nueva", pl: "Nowe zdjęcie", it: "Una nuova foto" }),
      items: [
        { id: "camera", label: takeWords, icon: "📷" },
        {
          id: "library",
          label: ctx.t({ en: "Choose from your photos", "pt-BR": "Escolher entre as suas fotos", de: "Aus deinen Fotos wählen", es: "Elegir de tus fotos", pl: "Wybierz ze swoich zdjęć", it: "Scegli tra le tue foto" }),
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
    const notSaved = ctx.t({
      en: "The picture could not be saved.",
      "pt-BR": "Não foi possível salvar a imagem.",
      de: "Das Bild konnte nicht gespeichert werden.",
      es: "No se pudo guardar la imagen.",
      pl: "Nie udało się zapisać obrazu.",
      it: "Non è stato possibile salvare l'immagine.",
    });
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
          {
            en: "Kept “{title}” in your gallery",
            "pt-BR": "“{title}” foi para a sua galeria",
            de: "„{title}“ ist jetzt in deiner Galerie",
            es: "«{title}» está en tu galería",
            pl: "„{title}” trafiło do galerii",
            it: "“{title}” è nella tua galleria",
          },
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
    const deleteWord = ctx.t({ en: "Delete", "pt-BR": "Excluir", de: "Löschen", es: "Eliminar", pl: "Usuń", it: "Elimina" });
    const save = h(
      "button",
      { class: "pg-btn", type: "button" },
      ctx.t({ en: "Save a copy", "pt-BR": "Salvar uma cópia", de: "Kopie speichern", es: "Guardar una copia", pl: "Zapisz kopię", it: "Salva una copia" }),
    );
    const del = h("button", { class: "pg-btn pg-danger", type: "button" }, deleteWord);
    const shut = h("button", { class: "pg-btn", type: "button" }, ctx.t({ en: "Close", "pt-BR": "Fechar", de: "Schließen", es: "Cerrar", pl: "Zamknij", it: "Chiudi" }));
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
          h("div", { class: "pg-row" }, save, del, shut),
        ),
      ),
    );
    box.addEventListener("click", (e) => e.target === box && close());
    shut.addEventListener("click", close);
    const notHere = ctx.t({
      en: "It could not be saved here.",
      "pt-BR": "Não deu para salvar aqui.",
      de: "Hier ließ es sich nicht speichern.",
      es: "No se pudo guardar aquí.",
      pl: "Nie udało się tu zapisać.",
      it: "Non è stato possibile salvarlo qui.",
    });
    save.addEventListener("click", () => void ctx.files.export(r.image as FileRef).catch(() => ctx.ui.toast(notHere)));
    del.addEventListener("click", async () => {
      const sure = await ctx.ui.confirm(
        ctx.t(
          { en: "Delete “{title}”?", "pt-BR": "Excluir “{title}”?", de: "„{title}“ löschen?", es: "¿Eliminar «{title}»?", pl: "Usunąć „{title}”?", it: "Eliminare “{title}”?" },
          { title: String(r.title) },
        ),
        {
          detail: ctx.t({
            en: "The picture is removed from this app.",
            "pt-BR": "A imagem será removida deste app.",
            de: "Das Bild wird aus dieser App entfernt.",
            es: "La imagen se quitará de esta app.",
            pl: "Obraz zostanie usunięty z tej aplikacji.",
            it: "L'immagine verrà rimossa da questa app.",
          }),
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
              {
                en: "{n} kept, newest first. Tap one to see it large.",
                "pt-BR": "{n, plural, one {# guardada} other {# guardadas}}, as mais novas primeiro. Toque em uma para ver em tamanho grande.",
                de: "{n} behalten, die neuesten zuerst. Tippe eins an, um es groß zu sehen.",
                es: "{n, plural, one {# guardada} other {# guardadas}}, las más recientes primero. Toca una para verla en grande.",
                pl: "{n, plural, one {# zachowany} few {# zachowane} many {# zachowanych} other {# zachowanego}}, najnowsze najpierw. Stuknij, by zobaczyć w dużym rozmiarze.",
                it: "{n, plural, one {# salvata} other {# salvate}}, le più recenti per prime. Toccane una per vederla in grande.",
              },
              { n: sorted.length },
            )
          : "",
      ),
    );
    if (!sorted.length) {
      const go = h(
        "button",
        { class: "pg-btn pg-primary", type: "button" },
        ctx.t({ en: "Open the Studio", "pt-BR": "Abrir o Ateliê", de: "Atelier öffnen", es: "Abrir el Estudio", pl: "Otwórz Pracownię", it: "Apri lo Studio" }),
      );
      go.addEventListener("click", () => props.navigate("studio"));
      root.replaceChildren(
        head,
        h(
          "div",
          { class: "pg-empty" },
          h("h3", {}, ctx.t({ en: "Nothing kept yet", "pt-BR": "Nada guardado ainda", de: "Noch nichts behalten", es: "Aún no has guardado nada", pl: "Jeszcze nic nie zachowano", it: "Ancora niente di salvato" })),
          h(
            "p",
            {},
            ctx.t({
              en: "Grow a garden from a photo, then press “Keep this”. It lands here.",
              "pt-BR": "Faça um jardim nascer de uma foto e toque em “Guardar esta”. Ela aparece aqui.",
              de: "Lass aus einem Foto einen Garten wachsen und tippe dann auf „Behalten“. Es landet hier.",
              es: "Haz crecer un jardín a partir de una foto y pulsa «Guardar esta». Aparecerá aquí.",
              pl: "Wyhoduj ogród ze zdjęcia i naciśnij „Zachowaj”. Trafi tutaj.",
              it: "Fai crescere un giardino da una foto, poi premi “Tienila”. Finisce qui.",
            }),
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
              { en: "{title}, open", "pt-BR": "{title}, abrir", de: "{title}, öffnen", es: "{title}, abrir", pl: "{title}, otwórz", it: "{title}, apri" },
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
                  ctx.t({
                    en: "Not on this device yet",
                    "pt-BR": "Ainda não está neste aparelho",
                    de: "Noch nicht auf diesem Gerät",
                    es: "Aún no está en este dispositivo",
                    pl: "Jeszcze nie ma go na tym urządzeniu",
                    it: "Non ancora su questo dispositivo",
                  }),
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
  name: { en: "Photo Garden", "pt-BR": "Jardim de fotos", de: "Fotogarten", es: "Jardín de fotos", pl: "Ogród ze zdjęć", it: "Giardino di foto" },
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
      label: { en: "Artwork", "pt-BR": "Obra", de: "Werk", es: "Obra", pl: "Praca", it: "Opera" },
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: { en: "Title", "pt-BR": "Título", de: "Titel", es: "Título", pl: "Tytuł", it: "Titolo" } },
        style: {
          type: "enum",
          options: [...STYLE_LIST],
          colors: { flow: "blue", points: "orange", mosaic: "purple" },
          label: { en: "Style", "pt-BR": "Estilo", de: "Stil", es: "Estilo", pl: "Styl", it: "Stile" },
          labels: {
            flow: { en: "Flow", "pt-BR": "Fluxo", de: "Fluss", es: "Flujo", pl: "Nurt", it: "Flusso" },
            points: { en: "Points", "pt-BR": "Pontos", de: "Punkte", es: "Puntos", pl: "Kropki", it: "Punti" },
            mosaic: { en: "Mosaic", "pt-BR": "Mosaico", de: "Mosaik", es: "Mosaico", pl: "Mozaika", it: "Mosaico" },
          },
        },
        date: { type: "datetime", precision: "minute", label: { en: "Date", "pt-BR": "Data", de: "Datum", es: "Fecha", pl: "Data", it: "Data" } },
        image: { type: "file", accept: ".png", folder: "garden", label: { en: "Image", "pt-BR": "Imagem", de: "Bild", es: "Imagen", pl: "Obraz", it: "Immagine" } },
      },
    },
  },
  pages: [
    {
      id: "studio",
      title: { en: "Studio", "pt-BR": "Ateliê", de: "Atelier", es: "Estudio", pl: "Pracownia", it: "Studio" },
      icon: "🌸",
      view: { type: "custom", entity: "artwork", mount: mountStudio },
    },
    {
      id: "gallery",
      title: { en: "Gallery", "pt-BR": "Galeria", de: "Galerie", es: "Galería", pl: "Galeria", it: "Galleria" },
      icon: "🖼",
      view: { type: "custom", entity: "artwork", mount: mountGallery },
    },
  ],
});
