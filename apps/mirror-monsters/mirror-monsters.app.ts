// Mirror Monsters — the selfie camera as a mirror with a monster in it. Googly eyes, horns and fangs
// that sit on your own eyes and mouth and wobble when you move; a mirror twin; a kaleidoscope;
// neon trails wherever you move; an 8-bit monster. Snap keeps the picture in the Gallery.
//
// The camera comes live through `ctx.caps.camera.live()` (docs/25) and nothing else: the app never
// reaches into the browser for it (CLAUDE.md rule 2). The shell shows "Camera on" while it runs, and
// turns it off when the page is hidden or the app is left — the app hears why, and offers to turn it
// back on. It asks for faces too (`live({ faces: true })`): Potyro finds the person's eyes, mouth and
// expressions on the device, with no network, and the monster sits on them. Where faces cannot be
// found it falls back to a skin-tone blob on a 64-pixel thumbnail (monsters.ts) — which is why a
// monster happily sits on a hand too. Drawing needs a page, so it runs as your own app.
//
// In six languages (#303); every language but English is a model's draft (#297).
import { defineApp, msg } from "potyro";
import type { Ctx, Face, FileRef, LiveCamera, LiveCameraStop, LiveFrameInfo, Resolved, ViewProps, Words } from "potyro";
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
  MIRRORS,
  moreMirrors,
  sample,
  segment,
  easeRig,
  rigFromBox,
  rigFromFace,
  stageMapper,
  wobble,
  type Box,
  type Mirrors,
  type Mode,
  type Pupil,
  type Rig,
  type Spark,
} from "./monsters.js";
import { STYLES } from "./styles.js";

// ---- words ----

const MODE_WORDS: Record<Mode, Words> = {
  monster: msg("Monster"),
  twin: msg("Twin"),
  kaleido: msg("Kaleido"),
  trails: msg("Trails"),
  pixel: msg("Pixel"),
};
const MODE_FACE: Record<Mode, string> = { monster: "👹", twin: "🪞", kaleido: "🔮", trails: "✨", pixel: "👾" };

const W = {
  hello: msg("Meet your monster"),
  helloBody: msg("Turn on the camera and a monster moves into the mirror with you. Wiggle and its eyes wobble. Tap the picture for a new colour."),
  start: msg("Turn on the camera"),
  private: msg("🔒 What the camera sees stays on this device. Only the snaps you keep are saved, in this app."),
  paused: msg("The camera is off"),
  pausedBody: msg("It turns off whenever you look away from the app, so nothing watches you by accident."),
  resume: msg("Turn it back on"),
  denied: msg("The camera was not allowed. You can allow it in your browser's or phone's settings for this site."),
  missing: msg("This device has no camera to look through."),
  busy: msg("Another app is using the camera. Close it and try again."),
  failed: msg("The camera would not start. Try again."),
  sealed: msg("The live camera isn’t here. It needs a Potyro that has it, and Mirror Monsters running as yours: add it with “I wrote this. Run it as mine.” ticked, or tap “Let it run as yours” in its menu."),
  snap: msg("Snap"),
  flip: msg("Switch camera"),
  toGallery: msg("Open the Gallery"),
  monsters: msg("Monsters"),
  kept: msg("“{title}” is in your Gallery"),
  notKept: msg("The snap could not be saved."),
  canvas: msg("The camera as a mirror, with a monster in it. Tap for a new colour."),
  noFaces: msg("The monster can’t see faces on this device, so it follows the colours of your skin instead."),
  canvasKaleido: msg("The camera as a kaleidoscope. Tap for more mirrors."),
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
  mirrors?: number;
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

/**
 * Horns, googly eyes and a fanged grin, on a rig (monsters.ts): on the person's own eyes and mouth
 * when the camera found a face, on the skin-tone blob when it did not. Drawn in the head's frame, so
 * the horns and the grin tilt with it; the eyes shut when the person's do, the mouth opens with theirs.
 */
function drawMonster(g: CanvasRenderingContext2D, rig: Rig, look: MonsterLook): void {
  const w = rig.width;
  const horn = `hsl(${look.hue} 85% 58%)`;
  const hornDark = `hsl(${look.hue} 70% 30%)`;
  g.lineJoin = "round";
  g.lineCap = "round";

  // Horns: curved, leaning out, with a darker rim, growing from the forehead.
  g.save();
  g.translate(rig.brow.x, rig.brow.y);
  g.rotate(rig.angle);
  const hornH = w * 0.42;
  for (const side of [-1, 1]) {
    const bx = side * w * 0.27;
    g.beginPath();
    g.moveTo(bx - side * w * 0.09, hornH * 0.12);
    g.quadraticCurveTo(bx + side * w * 0.06, -hornH * 0.55, bx + side * w * 0.2, -hornH);
    g.quadraticCurveTo(bx + side * w * 0.12, -hornH * 0.25, bx + side * w * 0.1, hornH * 0.12);
    g.closePath();
    g.fillStyle = horn;
    g.fill();
    g.lineWidth = Math.max(2, w * 0.018);
    g.strokeStyle = hornDark;
    g.stroke();
  }
  g.restore();

  // Googly eyes: a white dish, a loose pupil, and a lid that comes down when the person blinks.
  rig.eyes.forEach((eye, i) => {
    const { x: ex, y: ey } = eye.at;
    const er = eye.r;
    g.beginPath();
    g.arc(ex, ey, er, 0, Math.PI * 2);
    g.fillStyle = "#fffdf7";
    g.fill();
    const p = look.pupils[i]!;
    if (eye.shut < 0.85) {
      g.beginPath();
      g.arc(ex + p.x * er, ey + p.y * er, er * 0.44, 0, Math.PI * 2);
      g.fillStyle = "#1b1026";
      g.fill();
      g.beginPath();
      g.arc(ex + p.x * er - er * 0.14, ey + p.y * er - er * 0.16, er * 0.12, 0, Math.PI * 2);
      g.fillStyle = "#ffffff";
      g.fill();
    }
    if (eye.shut > 0.05) {
      // The lid: the monster's colour, from the top of the eye down to how shut it is.
      g.save();
      g.beginPath();
      g.arc(ex, ey, er, 0, Math.PI * 2);
      g.clip();
      g.translate(ex, ey);
      g.rotate(rig.angle);
      const edge = -er + eye.shut * er * 2.1;
      g.fillStyle = horn;
      g.fillRect(-er - 1, -er - 1, er * 2 + 2, edge + er + 1);
      g.beginPath();
      g.moveTo(-er, edge);
      g.lineTo(er, edge);
      g.lineWidth = Math.max(2, er * 0.14);
      g.strokeStyle = hornDark;
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.arc(ex, ey, er, 0, Math.PI * 2);
    g.lineWidth = Math.max(2, er * 0.12);
    g.strokeStyle = "#1b1026";
    g.stroke();
  });

  // A grin with two fangs, on the person's mouth, opening as theirs does — a tongue when it is wide.
  g.save();
  g.translate(rig.mouth.at.x, rig.mouth.at.y);
  g.rotate(rig.angle);
  const mw = rig.mouth.w / 2;
  const open = rig.mouth.open;
  const drop = w * (0.16 + open * 0.34);
  const lift = w * (0.07 - open * 0.1);
  const lips = new Path2D();
  lips.moveTo(-mw, 0);
  lips.quadraticCurveTo(0, drop, mw, 0);
  lips.quadraticCurveTo(0, lift, -mw, 0);
  lips.closePath();
  g.fillStyle = "#3a0d24";
  g.fill(lips);
  if (open > 0.35) {
    // The tongue, inside the mouth only.
    g.save();
    g.clip(lips);
    g.beginPath();
    g.ellipse(0, drop * 0.48, mw * 0.5, drop * 0.22, 0, 0, Math.PI * 2);
    g.fillStyle = "#e0507a";
    g.fill();
    g.restore();
  }
  g.lineWidth = Math.max(2, w * 0.016);
  g.strokeStyle = hornDark;
  g.stroke(lips);
  for (const side of [-1, 1]) {
    const fx = side * mw * 0.45;
    const fy = Math.max(0, lift * 0.5) + w * 0.02;
    g.beginPath();
    g.moveTo(fx - w * 0.035, fy);
    g.lineTo(fx + w * 0.035, fy);
    g.lineTo(fx, fy + w * 0.075);
    g.closePath();
    g.fillStyle = "#fffdf7";
    g.fill();
  }
  g.restore();
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
  // The kaleidoscope's one wedge of the picture, drawn once a frame and stamped into every segment.
  const wedge = document.createElement("canvas");
  const wg = wedge.getContext("2d")!;

  let mode: Mode = "monster";
  let hue = 280;
  let mirrors: Mirrors = MIRRORS[0];
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
  /** The person's face, when the camera found one this frame (video pixels); the blob stands in when not. */
  let person: Face | null = null;
  let rig: Rig | null = null;
  let toldNoFaces = false;
  let split = 0.5;
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

  const savePrefs = () => void ctx.storage.set(PREFS, { mode, hue, started: startedBefore, mirrors } satisfies Prefs).catch(() => undefined);
  const showMode = () => {
    modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    canvas.setAttribute("aria-label", ctx.t(mode === "kaleido" ? W.canvasKaleido : W.canvas));
  };

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

  /**
   * The kaleidoscope (monsters.ts has its geometry): one wedge of the picture — a slowly turning,
   * drifting circle around the face — drawn into a small canvas, then stamped into every segment,
   * every other one mirrored. One clip a frame, not one per segment, and the stamps are plain image
   * draws, so it holds a phone's frame rate. The wedge reaches a pixel past both of its edges, all
   * the way to the centre: the neighbours overlap on the reflection lines, where they show the same
   * pixels, and no seam of background shows through between them.
   */
  const drawKaleido = (video: HTMLVideoElement) => {
    const n = mirrors;
    const a = (Math.PI * 2) / n;
    // Far enough that the wedge's straight outer edge still reaches past the stage's corners.
    const R = (Math.hypot(Wpx, Hpx) / 2 + 2) / Math.cos(a / 2);
    const scale = Math.min(dpr, 1.5, 900 / R); // wedge pixels per stage pixel
    const o = 1; // how far, in stage pixels, the wedge reaches past each edge — the same at the centre as at the rim
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const apex = (-o * (1 + Math.cos(a))) / Math.sin(a);
    const pad = Math.ceil(o * scale) + 1;
    const tw = Math.ceil((R + o) * scale) + 1;
    const th = Math.ceil((R * Math.sin(a) + 2 * o) * scale) + pad + 1;
    const left = Math.floor(Math.min(0, apex, R * Math.cos(a) + o * nx) * scale) - 1;
    if (wedge.width !== tw - left || wedge.height !== th) {
      wedge.width = tw - left;
      wedge.height = th;
    }
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const still = reducedMotion();
    const centre = person ? { x: person.nose.x / vw, y: person.nose.y / vh } : { x: face.x + face.w / 2, y: face.y + face.h * 0.45 };
    const s = sample(t, centre, vw, vh, still);
    wg.setTransform(1, 0, 0, 1, 0, 0);
    wg.clearRect(0, 0, wedge.width, wedge.height);
    wg.save();
    wg.setTransform(scale, 0, 0, scale, -left, pad);
    wg.beginPath();
    wg.moveTo(apex, -o);
    wg.lineTo(R, -o);
    wg.lineTo(R * Math.cos(a) + o * nx, R * Math.sin(a) + o * ny);
    wg.closePath();
    wg.clip();
    const k = R / s.radius;
    wg.scale(k, k);
    wg.rotate(-s.turn);
    if (facing === "user") wg.scale(-1, 1);
    wg.translate(-s.cx, -s.cy);
    wg.drawImage(video, 0, 0, vw, vh);
    wg.restore();

    g.fillStyle = "#140a24";
    g.fillRect(0, 0, Wpx, Hpx);
    for (let i = 0; i < n; i++) {
      const seg = segment(i, n);
      g.save();
      g.translate(Wpx / 2, Hpx / 2);
      g.rotate(seg.angle);
      if (seg.flip) g.scale(1, -1);
      g.drawImage(wedge, left / scale, -pad / scale, wedge.width / scale, wedge.height / scale);
      g.restore();
    }
  };

  const drawFrame = (video: HTMLVideoElement, info: LiveFrameInfo) => {
    const time = info.time;
    const dt = lastTime ? Math.max(1, Math.min(100, time - lastTime)) : 33;
    lastTime = time;
    t += dt;
    person = info.faces?.[0] ?? null;
    if (info.facesFailed && !toldNoFaces) {
      // Said once: the monster still works, on the skin-tone blob.
      toldNoFaces = true;
      ctx.ui.toast(ctx.t(W.noFaces));
    }
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
      if (!person) face = follow(face, findFace(small, THUMB_W, THUMB_H), dt);
      drawKaleido(video);
      return;
    }

    drawCamera(video);

    if (mode === "twin") {
      // The left side, as it is on screen, mirrored onto the right: one face, two left sides. Split
      // down the person's nose when the camera finds their face, so it stays one face as they move.
      const nose = person ? stageMapper(video.videoWidth, video.videoHeight, Wpx, Hpx, facing === "user")(person.nose).x / Wpx : 0.5;
      split += (Math.min(0.75, Math.max(0.25, nose)) - split) * (1 - Math.exp(-dt / 90));
      const sx = Math.round(split * Wpx);
      g.save();
      g.setTransform(-dpr, 0, 0, dpr, 2 * sx * dpr, 0);
      g.drawImage(canvas, 0, 0, sx * dpr, canvas.height, 0, 0, sx, Hpx);
      g.restore();
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(sx - 0.5, 0, 1, Hpx);
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

    // Monster: on the person's eyes and mouth (or the blob), the eyes wobbling with how it moved.
    let target: Rig;
    if (person) target = rigFromFace(person, stageMapper(video.videoWidth, video.videoHeight, Wpx, Hpx, facing === "user"));
    else {
      face = follow(face, findFace(small, THUMB_W, THUMB_H), dt);
      target = rigFromBox(toStage(face, video));
    }
    rig = easeRig(rig, target, dt);
    const centre = { x: (rig.eyes[0].at.x + rig.eyes[1].at.x) / 2, y: (rig.eyes[0].at.y + rig.eyes[1].at.y) / 2 };
    const s = dt / 1000;
    const vel = { x: (centre.x - lastCentre.x) / s, y: (centre.y - lastCentre.y) / s };
    const er = Math.max(8, rig.eyes[0].r);
    const clamp = (v: number) => Math.max(-400, Math.min(400, v));
    const shove = { x: clamp((vel.x - lastVel.x) / s / er), y: clamp((vel.y - lastVel.y) / s / er) };
    lastCentre = centre;
    lastVel = vel;
    pupils = [wobble(pupils[0], shove, dt), wobble(pupils[1], shove, dt)];
    drawMonster(g, rig, { hue, pupils });
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
    drawMonster(g, rigFromBox(box), { hue, pupils });
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
      // Faces too: the monster sits on the person's own eyes and mouth (docs/25 §Faces).
      const next = await live({ facing, width: 960, height: 720, faces: true });
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
      rig = null;
      offFrame = next.onFrame((video, info) => drawFrame(video, info));
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
    if (mode === "kaleido" && cam) {
      mirrors = moreMirrors(mirrors);
      savePrefs();
      void ctx.caps.haptics?.vibrate(8);
      return;
    }
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
      rig = null;
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
      const m = MIRRORS.find((x) => x === prefs?.mirrors);
      if (m) mirrors = m;
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
    const deleteWord = ctx.t("Delete");
    const share = h("button", { class: "mm-plain mm-share", type: "button" }, `↗ ${ctx.t("Share")}`);
    const save = h("button", { class: "mm-plain", type: "button" }, ctx.t("Save a copy"));
    const del = h("button", { class: "mm-plain mm-danger", type: "button" }, deleteWord);
    const shut = h("button", { class: "mm-plain", type: "button" }, ctx.t("Close"));
    const box = h(
      "div",
      { class: "mm-lightbox", role: "dialog", "aria-modal": "true", "aria-label": String(r.title) },
      h("div", { class: "mm-lightbox-card" }, h("img", { src: url, alt: String(r.title) }), h("div", { class: "mm-lightbox-meta" }, h("h3", {}, String(r.title)), h("div", { class: "mm-row" }, share, save, del, shut))),
    );
    box.addEventListener("click", (e) => e.target === box && close());
    shut.addEventListener("click", close);
    // The picture itself, through Potyro's share dialog: the person sees it and picks where it goes.
    share.addEventListener("click", () =>
      void ctx.ui
        .share({
          title: String(r.title),
          text: ctx.t("My monster from Mirror Monsters 👹"),
          files: [r.image as FileRef],
        })
        .catch(() => ctx.ui.toast(ctx.t("It could not be shared."))),
    );
    save.addEventListener("click", () =>
      void ctx.files.export(r.image as FileRef).catch(() =>
        ctx.ui.toast(ctx.t("It could not be saved here.")),
      ),
    );
    del.addEventListener("click", async () => {
      const sure = await ctx.ui.confirm(
        ctx.t("Delete “{title}”?", { title: String(r.title) }),
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
      const go = h("button", { class: "mm-btn", type: "button" }, ctx.t("Open the mirror"));
      go.addEventListener("click", () => props.navigate("mirror"));
      root.replaceChildren(
        h(
          "div",
          { class: "mm-empty" },
          h("div", { class: "mm-big", "aria-hidden": "true" }, "👹"),
          h("h3", {}, ctx.t("No monsters yet")),
          h("p", {}, ctx.t("Pull a face in the mirror and press the round button. Your snaps land here.")),
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
          { class: "mm-piece", type: "button", "aria-label": ctx.t("{title}, open", { title: String(r.title) }) },
          h(
            "figure",
            {},
            url ? h("img", { src: url, alt: "", loading: "lazy" }) : h("div", { class: "mm-empty" }, ctx.t("Not on this device yet")),
            h("figcaption", {}, h("b", {}, `${MODE_FACE[kind]} ${String(r.title)}`), h("span", {}, when ? shortDate(when, ctx) : "")),
          ),
        );
        if (url) b.addEventListener("click", () => open(r, url));
        return b;
      }),
    );
    if (!alive || mine !== generation) return;
    root.replaceChildren(
      h("p", { class: "mm-head" }, ctx.t("{n, plural, one {# snap} other {# snaps}}, newest first.", { n: sorted.length })),
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
  name: "Mirror Monsters",
  icon: "👹",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#b44fd8" },
  category: "camera",
  nav: "tabs",
  permissions: { camera: true, haptics: true },
  entities: {
    snap: {
      label: { text: "Snap", context: "snap" },
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Title" },
        monster: {
          type: "enum",
          options: [...MODES],
          colors: { monster: "purple", twin: "blue", kaleido: "pink", trails: "orange", pixel: "green" },
          label: "Monster",
          labels: MODE_WORDS,
        },
        date: { type: "datetime", precision: "minute", label: "Date" },
        image: { type: "file", accept: ".png", folder: "snaps", label: "Picture" },
      },
    },
  },
  pages: [
    {
      id: "mirror",
      title: "Mirror",
      icon: "🪞",
      view: { type: "custom", entity: "snap", mount: mountMirror },
    },
    {
      id: "gallery",
      title: "Gallery",
      icon: "🖼",
      view: { type: "custom", entity: "snap", mount: mountGallery },
    },
  ],
});
