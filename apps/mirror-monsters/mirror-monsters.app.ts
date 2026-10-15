// Mirror Monsters — the selfie camera as a mirror with a monster in it. Googly eyes, horns and fangs
// that find the face-ish blob in the picture and wobble when you move; a mirror twin; a kaleidoscope;
// neon trails wherever you move; an 8-bit monster. Snap keeps the picture in the Gallery.
//
// The camera comes live through `ctx.caps.camera.live()` (docs/25) and nothing else: the app never
// reaches into the browser for it (CLAUDE.md rule 2). The shell shows "Camera on" while it runs, and
// turns it off when the page is hidden or the app is left — the app hears why, and offers to turn it
// back on. No model, no network: the "face" is a skin-tone blob on a 64-pixel thumbnail (monsters.ts),
// which is why a monster happily sits on a hand too. Drawing needs a page, so it runs as your own app.
//
// In six languages (#303); every language but English is a model's draft (#297).
import { defineApp } from "potyro";
import type { Ctx, FileRef, LiveCamera, LiveCameraStop, Resolved, ViewProps, Words } from "potyro";
import {
  MODES,
  THUMB_H,
  THUMB_W,
  RESTING,
  cover,
  findFace,
  follow,
  luma,
  motion,
  posterize,
  rng,
  snapPath,
  sparkle,
  wedges,
  wobble,
  type Box,
  type Mode,
  type Pupil,
  type Spark,
} from "./monsters.js";
import { STYLES } from "./styles.js";

// ---- words ----

const MODE_WORDS: Record<Mode, Words> = {
  monster: { en: "Monster", "pt-BR": "Monstro", de: "Monster", es: "Monstruo", pl: "Potwór", it: "Mostro" },
  twin: { en: "Twin", "pt-BR": "Gêmeo", de: "Zwilling", es: "Gemelo", pl: "Bliźniak", it: "Gemello" },
  kaleido: { en: "Kaleido", "pt-BR": "Caleido", de: "Kaleido", es: "Caleido", pl: "Kalejdo", it: "Caleido" },
  trails: { en: "Trails", "pt-BR": "Rastros", de: "Spuren", es: "Estelas", pl: "Smugi", it: "Scie" },
  pixel: { en: "Pixel", "pt-BR": "Pixel", de: "Pixel", es: "Píxel", pl: "Piksel", it: "Pixel" },
};
const MODE_FACE: Record<Mode, string> = { monster: "👹", twin: "🪞", kaleido: "🔮", trails: "✨", pixel: "👾" };

const W = {
  hello: {
    en: "Meet your monster",
    "pt-BR": "Conheça o seu monstro",
    de: "Triff dein Monster",
    es: "Conoce a tu monstruo",
    pl: "Poznaj swojego potwora",
    it: "Incontra il tuo mostro",
  },
  helloBody: {
    en: "Turn on the camera and a monster moves into the mirror with you. Wiggle and its eyes wobble. Tap the picture for a new colour.",
    "pt-BR": "Ligue a câmera e um monstro se muda para o espelho com você. Mexa-se e os olhos dele chacoalham. Toque na imagem para trocar a cor.",
    de: "Schalt die Kamera ein, und ein Monster zieht mit dir in den Spiegel. Wackel, und seine Augen wackeln mit. Tipp aufs Bild für eine neue Farbe.",
    es: "Enciende la cámara y un monstruo se muda al espejo contigo. Muévete y sus ojos bailan. Toca la imagen para cambiar de color.",
    pl: "Włącz kamerę, a do lustra wprowadzi się z tobą potwór. Porusz się, a jego oczy zaczną latać. Stuknij obraz, by zmienić kolor.",
    it: "Accendi la fotocamera e un mostro si trasferisce nello specchio con te. Muoviti e i suoi occhi ballano. Tocca l'immagine per un nuovo colore.",
  },
  start: {
    en: "Turn on the camera",
    "pt-BR": "Ligar a câmera",
    de: "Kamera einschalten",
    es: "Encender la cámara",
    pl: "Włącz kamerę",
    it: "Accendi la fotocamera",
  },
  private: {
    en: "🔒 What the camera sees stays on this device. Only the snaps you keep are saved, in this app.",
    "pt-BR": "🔒 O que a câmera vê fica neste aparelho. Só as fotos que você guardar são salvas, neste app.",
    de: "🔒 Was die Kamera sieht, bleibt auf diesem Gerät. Gespeichert werden nur die Schnappschüsse, die du behältst – in dieser App.",
    es: "🔒 Lo que ve la cámara se queda en este dispositivo. Solo se guardan las fotos que conserves, en esta app.",
    pl: "🔒 To, co widzi kamera, zostaje na tym urządzeniu. Zapisują się tylko zachowane zdjęcia, w tej aplikacji.",
    it: "🔒 Quello che vede la fotocamera resta su questo dispositivo. Si salvano solo gli scatti che tieni, in questa app.",
  },
  paused: {
    en: "The camera is off",
    "pt-BR": "A câmera está desligada",
    de: "Die Kamera ist aus",
    es: "La cámara está apagada",
    pl: "Kamera jest wyłączona",
    it: "La fotocamera è spenta",
  },
  pausedBody: {
    en: "It turns off whenever you look away from the app, so nothing watches you by accident.",
    "pt-BR": "Ela desliga sempre que você sai do app, para que nada fique te olhando sem querer.",
    de: "Sie schaltet sich aus, sobald du die App verlässt – damit dich nichts aus Versehen beobachtet.",
    es: "Se apaga cada vez que sales de la app, para que nada te mire sin querer.",
    pl: "Wyłącza się, gdy tylko opuścisz aplikację, żeby nic cię przypadkiem nie podglądało.",
    it: "Si spegne ogni volta che esci dall'app, così niente ti guarda per sbaglio.",
  },
  resume: {
    en: "Turn it back on",
    "pt-BR": "Ligar de novo",
    de: "Wieder einschalten",
    es: "Volver a encenderla",
    pl: "Włącz ponownie",
    it: "Riaccendila",
  },
  denied: {
    en: "The camera was not allowed. You can allow it in your browser's or phone's settings for this site.",
    "pt-BR": "A câmera não foi permitida. Você pode permiti-la nas configurações do navegador ou do celular para este site.",
    de: "Die Kamera wurde nicht erlaubt. Du kannst sie in den Einstellungen deines Browsers oder Telefons für diese Seite erlauben.",
    es: "No se permitió la cámara. Puedes permitirla en los ajustes del navegador o del teléfono para este sitio.",
    pl: "Nie zezwolono na kamerę. Możesz na nią zezwolić w ustawieniach przeglądarki lub telefonu dla tej strony.",
    it: "La fotocamera non è stata consentita. Puoi consentirla nelle impostazioni del browser o del telefono per questo sito.",
  },
  missing: {
    en: "This device has no camera to look through.",
    "pt-BR": "Este aparelho não tem uma câmera para usar.",
    de: "Dieses Gerät hat keine Kamera.",
    es: "Este dispositivo no tiene cámara.",
    pl: "To urządzenie nie ma kamery.",
    it: "Questo dispositivo non ha una fotocamera.",
  },
  busy: {
    en: "Another app is using the camera. Close it and try again.",
    "pt-BR": "Outro app está usando a câmera. Feche-o e tente de novo.",
    de: "Eine andere App benutzt die Kamera. Schließ sie und versuch es noch einmal.",
    es: "Otra app está usando la cámara. Ciérrala y vuelve a intentarlo.",
    pl: "Inna aplikacja używa kamery. Zamknij ją i spróbuj ponownie.",
    it: "Un'altra app sta usando la fotocamera. Chiudila e riprova.",
  },
  failed: {
    en: "The camera would not start. Try again.",
    "pt-BR": "A câmera não quis ligar. Tente de novo.",
    de: "Die Kamera ließ sich nicht starten. Versuch es noch einmal.",
    es: "La cámara no arrancó. Vuelve a intentarlo.",
    pl: "Nie udało się uruchomić kamery. Spróbuj ponownie.",
    it: "La fotocamera non è partita. Riprova.",
  },
  sealed: {
    en: "The live camera isn’t here. It needs a Potyro that has it, and Mirror Monsters running as yours: add it with “I wrote this. Run it as mine.” ticked, or tap “Let it run as yours” in its menu.",
    "pt-BR": "A câmera ao vivo não está disponível. Ela precisa de um Potyro que a tenha e do Monstros no Espelho rodando como seu: adicione-o marcando “Eu escrevi isto. Rodar como meu.” ou toque em “Deixar rodar como seu” no menu dele.",
    de: "Die Live-Kamera ist hier nicht da. Sie braucht ein Potyro, das sie hat, und Spiegelmonster als deine eigene App: Füge sie mit „Das habe ich geschrieben. Als meine ausführen.“ hinzu oder tippe in ihrem Menü auf „Als deine eigene laufen lassen“.",
    es: "La cámara en vivo no está disponible. Necesita un Potyro que la tenga y Monstruos del Espejo ejecutándose como tuya: añádela marcando «Lo escribí yo. Ejecutar como mía» o toca «Dejar que se ejecute como tuya» en su menú.",
    pl: "Kamery na żywo tu nie ma. Potrzebny jest Potyro, który ją ma, i Potwory z Lustra uruchamiane jako twoje: dodaj je z zaznaczonym „Napisałem to. Uruchom jako moją” albo dotknij „Pozwól działać jako twoja” w ich menu.",
    it: "La fotocamera dal vivo qui non c’è. Serve un Potyro che ce l’abbia e Mostri allo Specchio eseguita come tua: aggiungila spuntando “L’ho scritta io. Eseguila come mia.” o tocca “Lasciala eseguire come tua” nel suo menu.",
  },
  snap: { en: "Snap", "pt-BR": "Fotografar", de: "Knipsen", es: "Hacer foto", pl: "Pstryknij", it: "Scatta" },
  flip: {
    en: "Switch camera",
    "pt-BR": "Trocar de câmera",
    de: "Kamera wechseln",
    es: "Cambiar de cámara",
    pl: "Przełącz kamerę",
    it: "Cambia fotocamera",
  },
  toGallery: {
    en: "Open the Gallery",
    "pt-BR": "Abrir a Galeria",
    de: "Galerie öffnen",
    es: "Abrir la Galería",
    pl: "Otwórz galerię",
    it: "Apri la Galleria",
  },
  monsters: { en: "Monsters", "pt-BR": "Monstros", de: "Monster", es: "Monstruos", pl: "Potwory", it: "Mostri" },
  kept: {
    en: "“{title}” is in your Gallery",
    "pt-BR": "“{title}” está na sua Galeria",
    de: "„{title}“ ist in deiner Galerie",
    es: "«{title}» está en tu Galería",
    pl: "„{title}” jest w galerii",
    it: "“{title}” è nella tua Galleria",
  },
  notKept: {
    en: "The snap could not be saved.",
    "pt-BR": "Não foi possível salvar a foto.",
    de: "Der Schnappschuss konnte nicht gespeichert werden.",
    es: "No se pudo guardar la foto.",
    pl: "Nie udało się zapisać zdjęcia.",
    it: "Non è stato possibile salvare lo scatto.",
  },
  canvas: {
    en: "The camera as a mirror, with a monster in it. Tap for a new colour.",
    "pt-BR": "A câmera como espelho, com um monstro dentro. Toque para trocar a cor.",
    de: "Die Kamera als Spiegel, mit einem Monster darin. Tippen für eine neue Farbe.",
    es: "La cámara como espejo, con un monstruo dentro. Toca para cambiar de color.",
    pl: "Kamera jako lustro, z potworem w środku. Stuknij, by zmienić kolor.",
    it: "La fotocamera come specchio, con un mostro dentro. Tocca per un nuovo colore.",
  },
} satisfies Record<string, Words>;

// ---- small helpers ----

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const isMode = (m: unknown): m is Mode => typeof m === "string" && (MODES as readonly string[]).includes(m);
const PREFS = "mirror";
interface Prefs {
  mode: Mode;
  hue: number;
  started: boolean;
}

/** What a refused `live()` says to the person, by its `code`. */
function failureWords(e: unknown): Words {
  const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : "failed";
  if (code === "denied") return W.denied;
  if (code === "missing") return W.missing;
  if (code === "busy") return W.busy;
  return W.failed;
}

// ---- drawing the monster ----

interface MonsterLook {
  hue: number;
  pupils: [Pupil, Pupil];
}

/** Horns, googly eyes and a fanged grin on a face box (stage pixels). */
function drawMonster(g: CanvasRenderingContext2D, b: Box, look: MonsterLook): void {
  const cx = b.x + b.w / 2;
  const er = b.w * 0.17;
  const hornH = b.h * 0.36;
  const horn = `hsl(${look.hue} 85% 58%)`;
  const hornDark = `hsl(${look.hue} 70% 30%)`;
  g.lineJoin = "round";
  g.lineCap = "round";
  // Horns: curved, leaning out, with a darker rim.
  for (const side of [-1, 1]) {
    const bx = cx + side * b.w * 0.27;
    const by = b.y + b.h * 0.08;
    g.beginPath();
    g.moveTo(bx - side * b.w * 0.09, by + hornH * 0.12);
    g.quadraticCurveTo(bx + side * b.w * 0.06, by - hornH * 0.55, bx + side * b.w * 0.2, by - hornH);
    g.quadraticCurveTo(bx + side * b.w * 0.12, by - hornH * 0.25, bx + side * b.w * 0.1, by + hornH * 0.12);
    g.closePath();
    g.fillStyle = horn;
    g.fill();
    g.lineWidth = Math.max(2, b.w * 0.018);
    g.strokeStyle = hornDark;
    g.stroke();
  }
  // Googly eyes.
  for (let i = 0; i < 2; i++) {
    const ex = cx + (i ? 1 : -1) * b.w * 0.2;
    const ey = b.y + b.h * 0.4;
    g.beginPath();
    g.arc(ex, ey, er, 0, Math.PI * 2);
    g.fillStyle = "#fffdf7";
    g.fill();
    g.lineWidth = Math.max(2, er * 0.12);
    g.strokeStyle = "#1b1026";
    g.stroke();
    const p = look.pupils[i]!;
    g.beginPath();
    g.arc(ex + p.x * er, ey + p.y * er, er * 0.44, 0, Math.PI * 2);
    g.fillStyle = "#1b1026";
    g.fill();
    g.beginPath();
    g.arc(ex + p.x * er - er * 0.14, ey + p.y * er - er * 0.16, er * 0.12, 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
  }
  // A grin with two fangs.
  const my = b.y + b.h * 0.78;
  const mw = b.w * 0.34;
  g.beginPath();
  g.moveTo(cx - mw, my);
  g.quadraticCurveTo(cx, my + b.h * 0.16, cx + mw, my);
  g.quadraticCurveTo(cx, my + b.h * 0.07, cx - mw, my);
  g.closePath();
  g.fillStyle = "#3a0d24";
  g.fill();
  g.lineWidth = Math.max(2, b.w * 0.016);
  g.strokeStyle = hornDark;
  g.stroke();
  for (const side of [-1, 1]) {
    const fx = cx + side * mw * 0.45;
    const fy = my + b.h * 0.035;
    g.beginPath();
    g.moveTo(fx - b.w * 0.035, fy);
    g.lineTo(fx + b.w * 0.035, fy);
    g.lineTo(fx, fy + b.h * 0.075);
    g.closePath();
    g.fillStyle = "#fffdf7";
    g.fill();
  }
}

// ---- the mirror ----

function mountMirror(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "mm" });
  const stage = h("div", { class: "mm-stage", "data-testid": "mirror-stage" });
  const canvas = h("canvas", { role: "img", "aria-label": ctx.t(W.canvas) });
  const flash = h("div", { class: "mm-flash" });

  const start = h("button", { class: "mm-btn", type: "button" }, `📷  ${ctx.t(W.start)}`);
  const welcomeNote = h("p", {}, ctx.t(W.helloBody));
  const welcome = h("div", { class: "mm-card" }, h("h2", {}, ctx.t(W.hello)), welcomeNote, start, h("p", { class: "mm-private" }, ctx.t(W.private)));
  const resume = h("button", { class: "mm-btn", type: "button" }, ctx.t(W.resume));
  const pausedNote = h("p", {}, ctx.t(W.pausedBody));
  const paused = h("div", { class: "mm-card", hidden: "" }, h("h2", {}, ctx.t(W.paused)), pausedNote, resume);
  stage.append(canvas, flash, welcome, paused);

  const modeButtons = MODES.map((m) =>
    h("button", { type: "button", "data-mode": m, "aria-pressed": "false" }, h("span", { class: "mm-face", "aria-hidden": "true" }, MODE_FACE[m]), ctx.t(MODE_WORDS[m])),
  );
  const flip = h("button", { class: "mm-round mm-left", type: "button", "aria-label": ctx.t(W.flip), title: ctx.t(W.flip), disabled: "" }, "🔄");
  const shutter = h("button", { class: "mm-shutter", type: "button", "aria-label": ctx.t(W.snap), title: ctx.t(W.snap), disabled: "" });
  const gallery = h("button", { class: "mm-round mm-right", type: "button", "aria-label": ctx.t(W.toGallery), title: ctx.t(W.toGallery) }, "🖼");
  const dock = h(
    "div",
    { class: "mm-dock" },
    h("div", { class: "mm-modes", role: "group", "aria-label": ctx.t(W.monsters) }, ...modeButtons),
    h("div", { class: "mm-controls" }, flip, shutter, gallery),
  );
  root.append(stage, dock);
  el.append(style, root);

  const g = canvas.getContext("2d")!;
  const thumb = document.createElement("canvas");
  thumb.width = THUMB_W;
  thumb.height = THUMB_H;
  const tg = thumb.getContext("2d", { willReadFrequently: true })!;
  const pixels = document.createElement("canvas");
  const pg = pixels.getContext("2d", { willReadFrequently: true })!;

  let mode: Mode = "monster";
  let hue = 280;
  let startedBefore = false;
  let facing: "user" | "environment" = "user";
  let cam: LiveCamera | null = null;
  let offFrame: (() => void) | null = null;
  let alive = true;
  let starting = false;

  let Wpx = 360;
  let Hpx = 480;
  let dpr = 1;
  let face: Box = { ...RESTING };
  let lastCentre = { x: 0, y: 0 };
  let lastVel = { x: 0, y: 0 };
  let pupils: [Pupil, Pupil] = [
    { x: -0.2, y: 0.3, vx: 0, vy: 0 },
    { x: 0.2, y: 0.3, vx: 0, vy: 0 },
  ];
  let sparks: Spark[] = [];
  let prevLuma: Uint8Array | null = null;
  let lastTime = 0;
  let t = 0;
  const random = rng(Date.now() & 0xffff);

  const showMode = () => modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  const savePrefs = () => void ctx.storage.set(PREFS, { mode, hue, started: startedBefore } satisfies Prefs).catch(() => undefined);

  // ---- size: as wide as the page; on a phone as tall as the room under it, portrait ----
  const probe = h("div", {});
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--k-chrome-bottom, 0px)";
  el.append(probe);
  const measure = () => {
    const w = Math.max(260, Math.floor(stage.clientWidth || el.clientWidth || 360));
    const room = window.innerHeight - stage.getBoundingClientRect().top - dock.offsetHeight - probe.offsetHeight - 28;
    const phone = w < 640;
    const hgt = Math.floor(Math.max(320, Math.min(phone ? room : Math.min(room, 720), w * (phone ? 1.6 : 0.75))));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    Wpx = w;
    Hpx = hgt;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    canvas.style.height = `${hgt}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // ---- one camera frame, drawn ----
  /** Draw the camera covering the stage (mirrored for the selfie camera). */
  const drawCamera = (video: HTMLVideoElement, target = g, w = Wpx, hgt = Hpx) => {
    const c = cover(video.videoWidth, video.videoHeight, w, hgt);
    target.save();
    if (facing === "user") {
      target.translate(w, 0);
      target.scale(-1, 1);
    }
    target.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, w, hgt);
    target.restore();
  };

  /** A box in the camera's fractions → stage pixels, through the same cover crop and mirror. */
  const toStage = (b: Box, video: HTMLVideoElement): Box => {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const c = cover(vw, vh, Wpx, Hpx);
    const k = Wpx / c.sw;
    const x = (b.x * vw - c.sx) * k;
    const y = (b.y * vh - c.sy) * k;
    const bw = b.w * vw * k;
    const bh = b.h * vh * k;
    return { x: facing === "user" ? Wpx - x - bw : x, y, w: bw, h: bh };
  };

  const drawFrame = (video: HTMLVideoElement, time: number) => {
    const dt = lastTime ? Math.max(1, Math.min(100, time - lastTime)) : 33;
    lastTime = time;
    t += dt;
    // The thumbnail every analysis reads, unmirrored.
    tg.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const small = tg.getImageData(0, 0, THUMB_W, THUMB_H).data;

    if (mode === "pixel") {
      const cols = Wpx < 520 ? 54 : 84;
      const rows = Math.max(1, Math.round((cols * Hpx) / Wpx));
      if (pixels.width !== cols || pixels.height !== rows) {
        pixels.width = cols;
        pixels.height = rows;
      }
      drawCamera(video, pg, cols, rows);
      const img = pg.getImageData(0, 0, cols, rows);
      posterize(img.data);
      pg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(pixels, 0, 0, Wpx, Hpx);
      g.imageSmoothingEnabled = true;
      return;
    }

    if (mode === "kaleido") {
      const n = wedges(Wpx);
      const r = Math.hypot(Wpx, Hpx) / 2 + 2;
      const a = (Math.PI * 2) / n;
      const turn = reducedMotion() ? 0 : t * 0.00012;
      g.fillStyle = "#140a24";
      g.fillRect(0, 0, Wpx, Hpx);
      for (let i = 0; i < n; i++) {
        g.save();
        g.translate(Wpx / 2, Hpx / 2);
        g.rotate(i * a + turn);
        if (i % 2) g.scale(1, -1);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(r, 0);
        g.lineTo(r * Math.cos(a) + 1, r * Math.sin(a) + 1);
        g.closePath();
        g.clip();
        g.rotate(-turn);
        g.translate(-Wpx / 2, -Hpx / 2);
        drawCamera(video);
        g.restore();
      }
      return;
    }

    drawCamera(video);

    if (mode === "twin") {
      // The left half, as it is on screen, mirrored onto the right: one face, two left sides.
      g.save();
      g.setTransform(-dpr, 0, 0, dpr, canvas.width, 0);
      g.drawImage(canvas, 0, 0, canvas.width / 2, canvas.height, 0, 0, Wpx / 2, Hpx);
      g.restore();
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(Wpx / 2 - 0.5, 0, 1, Hpx);
      return;
    }

    if (mode === "trails") {
      g.fillStyle = "rgba(14, 6, 28, 0.62)";
      g.fillRect(0, 0, Wpx, Hpx);
      const cur = luma(small, THUMB_W, THUMB_H);
      const moved = prevLuma ? motion(prevLuma, cur) : [];
      prevLuma = cur;
      sparks = sparkle(sparks, moved, THUMB_W, THUMB_H, dt, t, random);
      g.save();
      g.globalCompositeOperation = "lighter";
      const unit = Math.max(Wpx, Hpx) / 160;
      for (const s of sparks) {
        const at = toStage({ x: s.x, y: s.y, w: 0, h: 0 }, video);
        g.fillStyle = `hsla(${s.hue} 100% 62% / ${Math.min(1, s.life * 1.2)})`;
        g.beginPath();
        g.arc(at.x, at.y, unit * (0.6 + s.life * 1.6), 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      return;
    }

    // Monster: follow the face, wobble the eyes with how it moved.
    face = follow(face, findFace(small, THUMB_W, THUMB_H), dt);
    const box = toStage(face, video);
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const s = dt / 1000;
    const vel = { x: (centre.x - lastCentre.x) / s, y: (centre.y - lastCentre.y) / s };
    const er = Math.max(8, box.w * 0.17);
    const clamp = (v: number) => Math.max(-400, Math.min(400, v));
    const shove = { x: clamp((vel.x - lastVel.x) / s / er), y: clamp((vel.y - lastVel.y) / s / er) };
    lastCentre = centre;
    lastVel = vel;
    pupils = [wobble(pupils[0], shove, dt), wobble(pupils[1], shove, dt)];
    drawMonster(g, box, { hue, pupils });
  };

  // ---- before the camera: the monster waits in the dark ----
  let idle = 0;
  const idleLoop = (now: number) => {
    if (!alive || cam) return;
    const dt = lastTime ? Math.min(50, now - lastTime) : 16;
    lastTime = now;
    t += dt;
    const grad = g.createRadialGradient(Wpx / 2, Hpx * 0.4, 10, Wpx / 2, Hpx * 0.45, Math.max(Wpx, Hpx) * 0.7);
    grad.addColorStop(0, `hsl(${hue} 45% 26%)`);
    grad.addColorStop(1, "#120820");
    g.fillStyle = grad;
    g.fillRect(0, 0, Wpx, Hpx);
    const bw = Math.min(Wpx * 0.56, Hpx * 0.42);
    const sway = reducedMotion() ? 0 : Math.sin(t * 0.0016) * bw * 0.06;
    const box: Box = { x: Wpx / 2 - bw / 2 + sway, y: Hpx * 0.14 + Math.cos(t * 0.0021) * bw * 0.03, w: bw, h: bw * 1.15 };
    const shove = reducedMotion() ? { x: 0, y: 0 } : { x: -Math.sin(t * 0.0016) * 30, y: 0 };
    pupils = [wobble(pupils[0], shove, dt), wobble(pupils[1], shove, dt)];
    drawMonster(g, box, { hue, pupils });
    if (!reducedMotion()) idle = requestAnimationFrame(idleLoop);
  };
  const startIdle = () => {
    cancelAnimationFrame(idle);
    lastTime = 0;
    idle = requestAnimationFrame(idleLoop);
  };

  // ---- the camera ----
  const showCard = (card: HTMLElement | null, words?: Words) => {
    welcome.hidden = card !== welcome;
    paused.hidden = card !== paused;
    if (card === paused) pausedNote.textContent = ctx.t(words ?? W.pausedBody);
    if (card === welcome && words) welcomeNote.textContent = ctx.t(words);
  };
  const setLive = (on: boolean) => {
    shutter.disabled = !on;
    flip.disabled = !on;
  };

  const onStopped = (_why: LiveCameraStop) => {
    offFrame = null;
    cam = null;
    setLive(false);
    if (!alive) return;
    showCard(paused);
    startIdle();
  };

  const turnOn = async () => {
    const live = ctx.caps.camera?.live;
    if (!live) {
      showCard(welcome, W.sealed);
      start.hidden = true;
      return;
    }
    if (starting) return;
    starting = true;
    start.disabled = resume.disabled = true;
    try {
      const next = await live({ facing, width: 960, height: 720 });
      if (!alive) {
        next.stop();
        return;
      }
      cam = next;
      facing = next.facing;
      cancelAnimationFrame(idle);
      lastTime = 0;
      prevLuma = null;
      sparks = [];
      showCard(null);
      setLive(true);
      next.onStop(onStopped);
      offFrame = next.onFrame((video, info) => drawFrame(video, info.time));
      if (!startedBefore) {
        startedBefore = true;
        savePrefs();
      }
    } catch (e) {
      // Hidden is not a failure: the app left the screen while it started, and the paused card waits.
      const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : "failed";
      if (alive && !cam) showCard(startedBefore ? paused : welcome, code === "hidden" ? undefined : failureWords(e));
    } finally {
      starting = false;
      start.disabled = resume.disabled = false;
    }
  };
  start.addEventListener("click", () => void turnOn());
  resume.addEventListener("click", () => void turnOn());
  flip.addEventListener("click", () => {
    facing = facing === "user" ? "environment" : "user";
    void ctx.caps.haptics?.vibrate(10);
    void turnOn();
  });

  // ---- monsters, colours, snaps ----
  modeButtons.forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode as Mode;
      prevLuma = null;
      sparks = [];
      showMode();
      savePrefs();
      void ctx.caps.haptics?.vibrate(8);
    }),
  );
  canvas.addEventListener("click", () => {
    hue = (hue + 67) % 360;
    pupils = [
      { ...pupils[0], vy: pupils[0].vy - 4, vx: pupils[0].vx + 2 },
      { ...pupils[1], vy: pupils[1].vy - 4, vx: pupils[1].vx - 2 },
    ];
    savePrefs();
    if (!cam && reducedMotion()) idleLoop(performance.now());
  });
  gallery.addEventListener("click", () => props.navigate("gallery"));

  shutter.addEventListener("click", async () => {
    if (!cam) return;
    shutter.disabled = true;
    const kept = mode;
    try {
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
      if (!blob) throw new Error(ctx.t(W.notKept));
      const now = ctx.now();
      const mine = (await ctx.query("snap")).filter((r) => r.monster === kept).length;
      const title = `${ctx.t(MODE_WORDS[kept])} ${mine + 1}`;
      const file = await ctx.files.write(snapPath(kept, now), blob, { mime: "image/png" });
      const image: FileRef = { id: file.id, path: file.path, name: file.name, mime: file.mime };
      await ctx.create("snap", { title, monster: kept, date: now, image });
      flash.classList.remove("mm-go");
      void flash.offsetWidth; // restart the flash
      flash.classList.add("mm-go");
      void ctx.caps.haptics?.vibrate(20);
      ctx.ui.toast(ctx.t(W.kept, { title }));
    } catch (e) {
      ctx.ui.toast(e instanceof Error && e.message ? e.message : ctx.t(W.notKept));
    } finally {
      shutter.disabled = !cam;
    }
  });

  // ---- size and start ----
  measure();
  const watchSize = new ResizeObserver(() => {
    const before = [Wpx, Hpx];
    measure();
    if (before[0] !== Wpx || before[1] !== Hpx) {
      face = { ...RESTING };
      if (!cam) startIdle();
    }
  });
  watchSize.observe(el);
  startIdle();

  void ctx.storage
    .get<Prefs>(PREFS)
    .catch(() => null)
    .then((prefs) => {
      if (!alive) return;
      if (prefs && isMode(prefs.mode)) mode = prefs.mode;
      if (prefs && Number.isFinite(prefs.hue)) hue = prefs.hue % 360;
      startedBefore = prefs?.started === true;
      showMode();
      // Opened before and turned on then: turning it on again is what opening the mirror means. The
      // first time, the person presses the button — and reads, under it, where the picture goes.
      if (startedBefore && !document.hidden) void turnOn();
    });

  return () => {
    alive = false;
    cancelAnimationFrame(idle);
    offFrame?.();
    cam?.stop();
    cam = null;
    watchSize.disconnect();
    root.remove();
    style.remove();
    probe.remove();
  };
}

// ---- the gallery ----

const shortDate = (d: Date, ctx: Ctx): string => ctx.format.date(d, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function mountGallery(el: HTMLElement, props: ViewProps): () => void {
  const ctx = props.runtime.ctx;
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "mm" });
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

  const open = (r: Resolved, url: string) => {
    const opener = document.activeElement as HTMLElement | null;
    const close = () => {
      box.remove();
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const deleteWord = ctx.t({ en: "Delete", "pt-BR": "Excluir", de: "Löschen", es: "Eliminar", pl: "Usuń", it: "Elimina" });
    const save = h("button", { class: "mm-plain", type: "button" }, ctx.t({ en: "Save a copy", "pt-BR": "Salvar uma cópia", de: "Kopie speichern", es: "Guardar una copia", pl: "Zapisz kopię", it: "Salva una copia" }));
    const del = h("button", { class: "mm-plain mm-danger", type: "button" }, deleteWord);
    const shut = h("button", { class: "mm-plain", type: "button" }, ctx.t({ en: "Close", "pt-BR": "Fechar", de: "Schließen", es: "Cerrar", pl: "Zamknij", it: "Chiudi" }));
    const box = h(
      "div",
      { class: "mm-lightbox", role: "dialog", "aria-modal": "true", "aria-label": String(r.title) },
      h("div", { class: "mm-lightbox-card" }, h("img", { src: url, alt: String(r.title) }), h("div", { class: "mm-lightbox-meta" }, h("h3", {}, String(r.title)), h("div", { class: "mm-row" }, save, del, shut))),
    );
    box.addEventListener("click", (e) => e.target === box && close());
    shut.addEventListener("click", close);
    save.addEventListener("click", () =>
      void ctx.files.export(r.image as FileRef).catch(() =>
        ctx.ui.toast(ctx.t({ en: "It could not be saved here.", "pt-BR": "Não deu para salvar aqui.", de: "Hier ließ es sich nicht speichern.", es: "No se pudo guardar aquí.", pl: "Nie udało się tu zapisać.", it: "Non è stato possibile salvarlo qui." })),
      ),
    );
    del.addEventListener("click", async () => {
      const sure = await ctx.ui.confirm(
        ctx.t({ en: "Delete “{title}”?", "pt-BR": "Excluir “{title}”?", de: "„{title}“ löschen?", es: "¿Eliminar «{title}»?", pl: "Usunąć „{title}”?", it: "Eliminare “{title}”?" }, { title: String(r.title) }),
        { ok: deleteWord, destructive: true },
      );
      if (!sure) return;
      close();
      await ctx.files.remove(r.image as FileRef).catch(() => undefined);
      await ctx.delete("snap", String(r.id));
    });
    document.addEventListener("keydown", onKey);
    document.body.append(box);
    shut.focus();
  };

  const render = async (rows: Resolved[]) => {
    const mine = ++generation;
    const sorted = [...rows].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    if (!sorted.length) {
      const go = h("button", { class: "mm-btn", type: "button" }, ctx.t({ en: "Open the mirror", "pt-BR": "Abrir o espelho", de: "Spiegel öffnen", es: "Abrir el espejo", pl: "Otwórz lustro", it: "Apri lo specchio" }));
      go.addEventListener("click", () => props.navigate("mirror"));
      root.replaceChildren(
        h(
          "div",
          { class: "mm-empty" },
          h("div", { class: "mm-big", "aria-hidden": "true" }, "👹"),
          h("h3", {}, ctx.t({ en: "No monsters yet", "pt-BR": "Nenhum monstro ainda", de: "Noch keine Monster", es: "Aún no hay monstruos", pl: "Jeszcze żadnych potworów", it: "Ancora nessun mostro" })),
          h("p", {}, ctx.t({ en: "Pull a face in the mirror and press the round button. Your snaps land here.", "pt-BR": "Faça uma careta no espelho e aperte o botão redondo. Suas fotos aparecem aqui.", de: "Schneid im Spiegel eine Grimasse und drück den runden Knopf. Deine Schnappschüsse landen hier.", es: "Pon una mueca en el espejo y pulsa el botón redondo. Tus fotos aparecen aquí.", pl: "Zrób minę w lustrze i naciśnij okrągły przycisk. Twoje zdjęcia trafią tutaj.", it: "Fai una smorfia allo specchio e premi il pulsante rotondo. I tuoi scatti finiscono qui." })),
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
        const kind = isMode(r.monster) ? r.monster : "monster";
        const b = h(
          "button",
          { class: "mm-piece", type: "button", "aria-label": ctx.t({ en: "{title}, open", "pt-BR": "{title}, abrir", de: "{title}, öffnen", es: "{title}, abrir", pl: "{title}, otwórz", it: "{title}, apri" }, { title: String(r.title) }) },
          h(
            "figure",
            {},
            url ? h("img", { src: url, alt: "", loading: "lazy" }) : h("div", { class: "mm-empty" }, ctx.t({ en: "Not on this device yet", "pt-BR": "Ainda não está neste aparelho", de: "Noch nicht auf diesem Gerät", es: "Aún no está en este dispositivo", pl: "Jeszcze nie ma go na tym urządzeniu", it: "Non ancora su questo dispositivo" })),
            h("figcaption", {}, h("b", {}, `${MODE_FACE[kind]} ${String(r.title)}`), h("span", {}, when ? shortDate(when, ctx) : "")),
          ),
        );
        if (url) b.addEventListener("click", () => open(r, url));
        return b;
      }),
    );
    if (!alive || mine !== generation) return;
    root.replaceChildren(
      h("p", { class: "mm-head" }, ctx.t({ en: "{n, plural, one {# snap} other {# snaps}}, newest first.", "pt-BR": "{n, plural, one {# foto} other {# fotos}}, as mais novas primeiro.", de: "{n, plural, one {# Schnappschuss} other {# Schnappschüsse}}, die neuesten zuerst.", es: "{n, plural, one {# foto} other {# fotos}}, las más recientes primero.", pl: "{n, plural, one {# zdjęcie} few {# zdjęcia} many {# zdjęć} other {# zdjęcia}}, najnowsze najpierw.", it: "{n, plural, one {# scatto} other {# scatti}}, i più recenti per primi." }, { n: sorted.length })),
      h("div", { class: "mm-wall" }, ...pieces),
    );
  };

  const stop = props.runtime.watchQuery("snap", undefined, ({ rows, loading }) => {
    if (!loading) void render(rows);
  });

  return () => {
    alive = false;
    stop();
    for (const url of urls.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    document.querySelectorAll(".mm-lightbox").forEach((n) => n.remove());
    root.remove();
    style.remove();
  };
}

// ---- the app ----

export default defineApp({
  id: "mirror-monsters",
  name: { en: "Mirror Monsters", "pt-BR": "Monstros no Espelho", de: "Spiegelmonster", es: "Monstruos del Espejo", pl: "Potwory z Lustra", it: "Mostri allo Specchio" },
  icon: "👹",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#b44fd8" },
  nav: "tabs",
  permissions: { camera: true, haptics: true },
  entities: {
    snap: {
      label: { en: "Snap", "pt-BR": "Foto", de: "Schnappschuss", es: "Foto", pl: "Zdjęcie", it: "Scatto" },
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: { en: "Title", "pt-BR": "Título", de: "Titel", es: "Título", pl: "Tytuł", it: "Titolo" } },
        monster: {
          type: "enum",
          options: [...MODES],
          colors: { monster: "purple", twin: "blue", kaleido: "pink", trails: "orange", pixel: "green" },
          label: { en: "Monster", "pt-BR": "Monstro", de: "Monster", es: "Monstruo", pl: "Potwór", it: "Mostro" },
          labels: MODE_WORDS,
        },
        date: { type: "datetime", precision: "minute", label: { en: "Date", "pt-BR": "Data", de: "Datum", es: "Fecha", pl: "Data", it: "Data" } },
        image: { type: "file", accept: ".png", folder: "snaps", label: { en: "Picture", "pt-BR": "Imagem", de: "Bild", es: "Imagen", pl: "Obraz", it: "Immagine" } },
      },
    },
  },
  pages: [
    {
      id: "mirror",
      title: { en: "Mirror", "pt-BR": "Espelho", de: "Spiegel", es: "Espejo", pl: "Lustro", it: "Specchio" },
      icon: "🪞",
      view: { type: "custom", entity: "snap", mount: mountMirror },
    },
    {
      id: "gallery",
      title: { en: "Gallery", "pt-BR": "Galeria", de: "Galerie", es: "Galería", pl: "Galeria", it: "Galleria" },
      icon: "🖼",
      view: { type: "custom", entity: "snap", mount: mountGallery },
    },
  ],
});
