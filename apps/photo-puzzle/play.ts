// The jigsaw table: a canvas the size of the screen, the board drawn on it, the pieces tipped out
// beside it. Drag a piece near its place and it clicks in. Everything about where and when is in
// jigsaw.ts; this file draws it and listens to fingers.
//
// Each piece is cut once into two small bitmaps — lying on the table (with its shadow baked in) and
// laid in the board (flat) — so a frame is a few dozen drawImage calls, cheap enough on a phone. A
// frame is drawn only when something moves.
import type { Ctx, FileRef, Resolved, ViewProps } from "potyro";
import { buzz, h, madeBy, photoUrl, reducedMotion, sendPuzzle } from "./common.js";
import {
  BLEED,
  bests,
  clock,
  coverCrop,
  cut,
  home,
  isBest,
  isEdgePiece,
  isLevel,
  layout,
  LEVEL_IDS,
  LEVELS,
  outline,
  pieceCount,
  rng,
  scatter,
  seedOf,
  snaps,
  type Cut,
  type Level,
  type LevelId,
  type Rect,
  type Seg,
  type Solve,
} from "./jigsaw.js";
import { STYLES } from "./styles.js";
import { LEVEL_NAMES, W } from "./words.js";

interface Piece {
  row: number;
  col: number;
  x: number;
  y: number;
  placed: boolean;
  /** Sliding into its place: no longer the person's to drag. */
  landing?: boolean;
  loose: HTMLCanvasElement;
  flat: HTMLCanvasElement;
  path: Path2D;
}

/** A game left half done, in table fractions so it survives a different screen. */
interface Saved {
  pos: Array<[number, number] | null>;
  seconds: number;
  moves: number;
  hints: number;
}
const savedKey = (puzzle: string, level: LevelId) => `play:${puzzle}:${level}`;

/** An outline as a Path2D at `size` pixels a side, the piece's square at (0, 0). */
function pathOf(segs: Seg[], size: number): Path2D {
  const p = new Path2D();
  p.moveTo(0, 0);
  for (const s of segs) {
    if ("c1" in s) p.bezierCurveTo(s.c1[0] * size, s.c1[1] * size, s.c2[0] * size, s.c2[1] * size, s.to[0] * size, s.to[1] * size);
    else p.lineTo(s.to[0] * size, s.to[1] * size);
  }
  p.closePath();
  return p;
}

/** Cut one piece out of the picture: flat (for the board) and lying loose (with a shadow). */
function cutPiece(img: CanvasImageSource, imgSize: { w: number; h: number }, level: Level, row: number, col: number, path: Path2D, size: number, dpr: number): { loose: HTMLCanvasElement; flat: HTMLCanvasElement } {
  const bleed = Math.ceil(size * BLEED);
  const shadow = Math.ceil(size * 0.12);
  const make = (pad: number) => {
    const c = document.createElement("canvas");
    c.width = Math.ceil((size + 2 * pad) * dpr);
    c.height = Math.ceil((size + 2 * pad) * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.translate(pad, pad);
    return { c, g };
  };
  const paint = (g: CanvasRenderingContext2D) => {
    // The picture under the piece, including the knobs that reach into the neighbours' squares.
    const sx = imgSize.w / level.cols;
    const sy = imgSize.h / level.rows;
    g.save();
    g.clip(path);
    g.drawImage(img, (col - BLEED) * sx, (row - BLEED) * sy, (1 + 2 * BLEED) * sx, (1 + 2 * BLEED) * sy, -bleed, -bleed, size + 2 * bleed, size + 2 * bleed);
    // A bevel: light from the top left, a little shade bottom right.
    g.lineWidth = Math.max(1.5, size * 0.035);
    g.translate(-0.8, -0.8);
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.stroke(path);
    g.translate(1.6, 1.6);
    g.strokeStyle = "rgba(0,0,0,0.28)";
    g.stroke(path);
    g.restore();
    g.lineWidth = 0.8;
    g.strokeStyle = "rgba(0,0,0,0.22)";
    g.stroke(path);
  };
  const flat = make(bleed);
  paint(flat.g);
  const loose = make(bleed + shadow);
  loose.g.save();
  loose.g.shadowColor = "rgba(20,14,8,0.38)";
  loose.g.shadowBlur = shadow * 0.9 * dpr;
  loose.g.shadowOffsetY = shadow * 0.35 * dpr;
  loose.g.fillStyle = "#000";
  loose.g.fill(path);
  loose.g.restore();
  paint(loose.g);
  return { loose: loose.c, flat: flat.c };
}

const ICONS: Record<string, string> = {
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5.5 4 4 2.5-2.5L21 19"/>',
  spread: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  wand: '<path d="m4 20 10-10"/><path d="m14 10 2-2"/><path d="M17 3v3M15.5 4.5h3M20 8v2M19 9h2M11 3v1.5M10.25 3.75h1.5"/>',
};

/** A toolbar icon: stroked, in the text colour. Static, known markup from this module. */
function toolIcon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

/** A shell token as a canvas colour. */
function token(el: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export function mountPlay(el: HTMLElement, props: ViewProps): () => void {
  const fresh = () => props.runtime.ctx;
  const ctx = fresh();
  const puzzleId = props.param?.puzzle ?? String(ctx.params.puzzle ?? "");
  const levelId: LevelId = isLevel(props.param?.level) ? props.param.level : isLevel(ctx.params.level) ? (ctx.params.level as LevelId) : "easy";
  const level = LEVELS[levelId];
  const style = h("style", {}, STYLES);
  const root = h("div", { class: "pp pp-play" });
  el.append(style, root);
  let alive = true;
  const isAlive = () => alive;

  // ---- the chrome ----
  const titleEl = h("h2", { class: "pp-title" });
  const sub = h("p", { class: "pp-sub" });
  const time = h("span", { class: "pp-time", "aria-label": "" }, "0:00");
  const count = h("span", { class: "pp-count", role: "status" });
  const head = h("header", { class: "pp-playhead" }, h("div", { class: "pp-heading" }, titleEl, sub), h("div", { class: "pp-meter" }, time, count));
  const stage = h("div", { class: "pp-stage" });
  const canvas = h("canvas", { role: "img", "aria-label": ctx.t(W.board) });
  const looseList = h("ul", { class: "pp-sr", "aria-label": ctx.t(W.loosePieces) });
  const live = h("p", { class: "pp-sr", "aria-live": "polite" });
  const veil = h("div", { class: "pp-veil" }, h("span", { class: "pp-spinner", "aria-hidden": "true" }), h("p", {}, ctx.t(W.loading)));
  stage.append(canvas, veil, looseList, live);
  const tool = (icon: string, label: string, help: string, extra: Record<string, string> = {}) =>
    h("button", { class: "pp-tool", type: "button", title: help, "aria-label": help, ...extra }, toolIcon(icon), h("span", { "aria-hidden": "true" }, label));
  const peek = tool("eye", ctx.t(W.peek), ctx.t(W.peekHelp));
  const ghost = tool("image", ctx.t(W.guide), ctx.t(W.ghost), { "aria-pressed": "true" });
  const tidy = tool("spread", ctx.t(W.tidy), ctx.t(W.tidyHelp));
  const hint = tool("wand", ctx.t(W.hint), ctx.t(W.hintHelp));
  const tools = h("div", { class: "pp-tools", role: "toolbar" }, peek, ghost, tidy, hint);
  const done = h("section", { class: "pp-done", hidden: "", role: "dialog", "aria-modal": "false", "aria-labelledby": "pp-done-title" });
  root.append(head, stage, tools, done);

  // ---- state ----
  let record: Resolved | null = null;
  let img: HTMLCanvasElement | null = null; // the photo, cropped to the level's shape
  let theCut: Cut | null = null;
  let pieces: Piece[] = [];
  let order: number[] = []; // draw order of loose pieces, last on top
  let W0 = 0;
  let H0 = 0;
  let board: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let size = 0;
  let dpr = 1;
  let seconds = 0;
  let moves = 0;
  let hints = 0;
  let started = 0; // ms timestamp the clock last resumed, 0 while stopped
  let finished = false;
  let ghostOn = true;
  let peeking = false;
  let solves: Solve[] = [];
  let paper = "#f3ede3";
  let wood = "#e9e1d3";
  let finishAt = 0; // when the finish animation started

  const elapsed = () => seconds + (started ? (Date.now() - started) / 1000 : 0);
  const placedCount = () => pieces.filter((p) => p.placed).length;
  const say = (text: string) => (live.textContent = text);

  // ---- drawing ----
  let frame = 0;
  const draw = () => {
    frame = 0;
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W0, H0);
    if (!img) return;
    // The board: a sunken tray, the faint picture if asked for, the pieces laid in it.
    g.save();
    g.fillStyle = wood;
    g.shadowColor = "rgba(0,0,0,0.12)";
    g.shadowBlur = 10;
    const r = Math.min(14, size * 0.18);
    g.beginPath();
    g.roundRect(board.x - 6, board.y - 6, board.w + 12, board.h + 12, r);
    g.fill();
    g.restore();
    g.fillStyle = paper;
    g.fillRect(board.x, board.y, board.w, board.h);
    if (ghostOn && !finished) {
      g.globalAlpha = 0.16;
      g.drawImage(img, board.x, board.y, board.w, board.h);
      g.globalAlpha = 1;
    }
    const bleedPx = Math.ceil(size * BLEED);
    for (const p of pieces) if (p.placed) g.drawImage(p.flat, p.x - bleedPx, p.y - bleedPx, p.flat.width / dpr, p.flat.height / dpr);
    if (finished) {
      // The seams fade and the photo is whole; a band of light passes over it.
      const t = Math.min(1, (performance.now() - finishAt) / 900);
      g.globalAlpha = reducedMotion() ? 1 : t;
      g.drawImage(img, board.x, board.y, board.w, board.h);
      g.globalAlpha = 1;
      if (!reducedMotion()) {
        const s = Math.min(1, Math.max(0, (performance.now() - finishAt - 500) / 900));
        if (s > 0 && s < 1) {
          const x = board.x - board.w * 0.5 + s * board.w * 2;
          const grad = g.createLinearGradient(x - 60, board.y, x + 60, board.y + board.h);
          grad.addColorStop(0, "rgba(255,255,255,0)");
          grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
          grad.addColorStop(1, "rgba(255,255,255,0)");
          g.save();
          g.beginPath();
          g.rect(board.x, board.y, board.w, board.h);
          g.clip();
          g.fillStyle = grad;
          g.fillRect(board.x, board.y, board.w, board.h);
          g.restore();
        }
        if (s < 1) schedule();
      }
    }
    if (peeking) {
      g.save();
      g.shadowColor = "rgba(0,0,0,0.35)";
      g.shadowBlur = 24;
      g.drawImage(img, board.x, board.y, board.w, board.h);
      g.restore();
    }
    // Loose pieces on top, the one in hand last and a touch bigger.
    const pad = Math.ceil(size * BLEED) + Math.ceil(size * 0.12);
    for (const i of order) {
      const p = pieces[i]!;
      if (p.placed) continue;
      const lifted = drag?.index === i;
      const k = lifted ? 1.06 : 1;
      const w = (p.loose.width / dpr) * k;
      const hgt = (p.loose.height / dpr) * k;
      const cx = p.x + size / 2;
      const cy = p.y + size / 2;
      g.drawImage(p.loose, cx - (size / 2 + pad) * k, cy - (size / 2 + pad) * k, w, hgt);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  // ---- the clock ----
  const tick = window.setInterval(() => {
    time.textContent = clock(elapsed());
  }, 500);
  const startClock = () => {
    if (!started && !finished) started = Date.now();
  };
  const stopClock = () => {
    if (started) seconds += (Date.now() - started) / 1000;
    started = 0;
  };
  const onVisibility = () => (document.hidden ? stopClock() : undefined);
  document.addEventListener("visibilitychange", onVisibility);

  const paintCount = () => {
    count.textContent = ctx.t(W.placed, { n: placedCount(), of: pieces.length });
    // The accessible way through: every loose piece is a button that puts it in place.
    // Top of the pile first, as they lie.
    looseList.replaceChildren(
      ...[...order]
        .reverse()
        .map((i) => [pieces[i]!, i] as const)
        .filter(([p]) => !p.placed && !p.landing)
        .map(([p, i]) => {
          const b = h("button", { type: "button", "data-piece": String(i), "data-x": String(Math.round(p.x + size / 2)), "data-y": String(Math.round(p.y + size / 2)), "data-home-x": String(Math.round(home(board, size, p.row, p.col).x + size / 2)), "data-home-y": String(Math.round(home(board, size, p.row, p.col).y + size / 2)) }, ctx.t(W.placeThis, { row: p.row + 1, col: p.col + 1 }));
          b.addEventListener("click", () => {
            hints++;
            void land(i, true);
          });
          return h("li", {}, b);
        }),
    );
  };

  // ---- placing ----
  const save = () => {
    if (finished || !record) return;
    const state: Saved = { pos: pieces.map((p) => (p.placed ? null : [p.x / W0, p.y / H0])), seconds: elapsed(), moves, hints };
    void fresh().storage.set(savedKey(record.id as string, levelId), state).catch(() => undefined);
  };
  const tween = (p: Piece, to: { x: number; y: number }, ms: number) =>
    new Promise<void>((ok) => {
      const from = { x: p.x, y: p.y };
      const t0 = performance.now();
      const stepIt = () => {
        const t = ms <= 0 ? 1 : Math.min(1, (performance.now() - t0) / ms);
        const e = 1 - (1 - t) ** 3;
        p.x = from.x + (to.x - from.x) * e;
        p.y = from.y + (to.y - from.y) * e;
        draw();
        if (t < 1) requestAnimationFrame(stepIt);
        else ok();
      };
      stepIt();
    });
  /** A piece goes home (dropped close enough, or placed for the person). */
  const land = async (i: number, helped = false) => {
    const p = pieces[i]!;
    if (p.placed || p.landing) return;
    startClock();
    p.landing = true;
    order = [...order.filter((j) => j !== i), i]; // on top while it slides in
    paintCount(); // no longer offered as a loose piece
    await tween(p, home(board, size, p.row, p.col), reducedMotion() ? 0 : helped ? 360 : 110);
    p.landing = false;
    p.placed = true;
    order = order.filter((j) => j !== i);
    draw();
    buzz(fresh(), 12);
    const n = placedCount();
    say(ctx.t(W.clicked, { n, of: pieces.length }));
    paintCount();
    if (n === pieces.length) await finish();
    else save();
  };

  // ---- fingers ----
  let drag: { index: number; dx: number; dy: number; moved: boolean; id: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pick = (x: number, y: number): number => {
    const g = canvas.getContext("2d")!;
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k]!;
      const p = pieces[i]!;
      if (p.placed || p.landing) continue;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      // A little slack around the outline: a fingertip is wider than a knob.
      const near = x > p.x - size * 0.12 && x < p.x + size * 1.12 && y > p.y - size * 0.12 && y < p.y + size * 1.12;
      const inside = near && (g.isPointInPath(p.path, x - p.x, y - p.y) || (x > p.x && x < p.x + size && y > p.y && y < p.y + size));
      g.restore();
      if (inside) return i;
    }
    return -1;
  };
  const onDown = (e: PointerEvent) => {
    if (finished || drag || !img) return;
    const at = local(e);
    const i = pick(at.x, at.y);
    if (i < 0) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const p = pieces[i]!;
    drag = { index: i, dx: at.x - p.x, dy: at.y - p.y, moved: false, id: e.pointerId };
    order = [...order.filter((j) => j !== i), i];
    startClock();
    buzz(fresh(), 5);
    schedule();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const at = local(e);
    const p = pieces[drag.index]!;
    p.x = Math.max(-size * 0.4, Math.min(W0 - size * 0.6, at.x - drag.dx));
    p.y = Math.max(-size * 0.4, Math.min(H0 - size * 0.6, at.y - drag.dy));
    drag.moved = true;
    schedule();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const i = drag.index;
    const moved = drag.moved;
    drag = null;
    if (moved) moves++;
    const p = pieces[i]!;
    if (snaps(p, home(board, size, p.row, p.col), size)) void land(i);
    else {
      schedule();
      paintCount();
      save();
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- tools ----
  const peekOn = (e: Event) => {
    e.preventDefault();
    peeking = true;
    schedule();
  };
  const peekOff = () => {
    peeking = false;
    schedule();
  };
  peek.addEventListener("pointerdown", peekOn);
  peek.addEventListener("pointerup", peekOff);
  peek.addEventListener("pointerleave", peekOff);
  peek.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && peekOn(e));
  peek.addEventListener("keyup", peekOff);
  ghost.addEventListener("click", () => {
    ghostOn = !ghostOn;
    ghost.setAttribute("aria-pressed", String(ghostOn));
    schedule();
  });
  tidy.addEventListener("click", async () => {
    const loose = pieces.map((p, i) => [p, i] as const).filter(([p]) => !p.placed);
    // Edge pieces first in the spread: the frame is where most people start.
    loose.sort(([a], [b]) => Number(isEdgePiece(theCut!, b.row, b.col)) - Number(isEdgePiece(theCut!, a.row, a.col)));
    const spots = scatter(loose.length, board, size, { x: 0, y: 0, w: W0, h: H0 }, rng(Date.now() & 0xffff));
    // `scatter` shuffles; tidy keeps them in reading order instead.
    spots.sort((a, b) => a.y - b.y || a.x - b.x);
    await Promise.all(loose.map(([p], k) => tween(p, spots[k]!, reducedMotion() ? 0 : 280)));
    paintCount();
    save();
  });
  hint.addEventListener("click", () => {
    const next = pieces.findIndex((p) => !p.placed && !p.landing);
    if (next < 0) return;
    hints++;
    void land(next, true);
  });

  // ---- the end ----
  const finish = async () => {
    finished = true;
    stopClock();
    const took = Math.max(1, Math.round(seconds));
    seconds = took; // the clock above says what the result says
    time.textContent = clock(took);
    finishAt = performance.now();
    schedule();
    buzz(fresh(), [20, 40, 20, 40, 60]);
    if (record) void fresh().storage.delete(savedKey(record.id as string, levelId)).catch(() => undefined);
    const before = bests(solves, record?.id as string)[levelId];
    const best = isBest(took, before);
    if (record) await fresh().create("solve", { puzzle: record.id, level: levelId, seconds: took, moves, by: fresh().me.name }).catch(() => undefined);
    await new Promise((ok) => setTimeout(ok, reducedMotion() ? 0 : 1100));
    if (!alive) return;
    showDone(took, best, before);
  };

  const showDone = (took: number, best: boolean, before: Solve | undefined) => {
    const lvl = ctx.t(LEVEL_NAMES[levelId]);
    const lines: Node[] = [
      h("div", { class: "pp-done-head" }, h("h3", { id: "pp-done-title", tabindex: "-1" }, ctx.t(W.doneTitle)), h("p", { class: "pp-done-time" }, ctx.t(W.doneLine, { time: clock(took), moves }))),
      h("p", { class: "pp-done-best" }, best ? `🏆 ${ctx.t(W.newBest, { level: lvl })}` : ctx.t(W.toBeat, { level: lvl, time: clock(before!.seconds) })),
    ];
    if (hints) lines.push(h("p", { class: "pp-done-note" }, ctx.t(W.withHints, { n: hints })));
    const send = h("button", { class: "pp-btn pp-primary", type: "button" }, `💌  ${ctx.t(W.send)}`);
    send.addEventListener("click", () => void sendPuzzle(fresh(), took));
    const again = h("button", { class: "pp-btn", type: "button" }, `↻  ${ctx.t(W.again)}`);
    again.addEventListener("click", () => restart(levelId));
    const harderId = LEVEL_IDS[LEVEL_IDS.indexOf(levelId) + 1];
    const row = h("div", { class: "pp-row" }, again);
    if (harderId) {
      const harder = h("button", { class: "pp-btn", type: "button" }, ctx.t(W.harder, { level: ctx.t(LEVEL_NAMES[harderId]) }));
      harder.addEventListener("click", () => props.navigate("play", { puzzle: puzzleId, level: harderId }));
      row.append(harder);
    }
    const all = h("button", { class: "pp-btn", type: "button" }, ctx.t(W.back));
    all.addEventListener("click", () => props.navigate("puzzles"));
    row.append(all);
    done.replaceChildren(...lines, send, row);
    done.hidden = false;
    (done.querySelector("h3") as HTMLElement | null)?.focus({ preventScroll: true });
    tools.hidden = true;
  };

  const restart = (lv: LevelId) => {
    if (lv !== levelId) return props.navigate("play", { puzzle: puzzleId, level: lv });
    if (record) void fresh().storage.delete(savedKey(record.id as string, levelId)).catch(() => undefined);
    finished = false;
    seconds = 0;
    moves = 0;
    hints = 0;
    started = 0;
    done.hidden = true;
    tools.hidden = false;
    pieces.forEach((p) => (p.placed = false));
    const spots = scatter(pieces.length, board, size, { x: 0, y: 0, w: W0, h: H0 }, rng(Date.now() & 0xffff));
    pieces.forEach((p, i) => Object.assign(p, spots[i]));
    order = pieces.map((_, i) => i);
    paintCount();
    schedule();
  };

  // ---- size ----
  const measure = (): [number, number] => {
    const w = Math.max(300, Math.floor(stage.clientWidth || el.clientWidth || 360));
    const room = window.innerHeight - stage.getBoundingClientRect().top - tools.offsetHeight - 24;
    const hgt = Math.floor(Math.max(420, Math.min(room, w < 640 ? w * 1.9 : 820)));
    return [w, hgt];
  };
  const build = (keep?: Saved | null) => {
    if (!img || !theCut) return;
    const [w, hgt] = measure();
    const old = { W0, H0, pieces: pieces.map((p) => ({ x: p.x, y: p.y, placed: p.placed })) };
    W0 = w;
    H0 = hgt;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W0 * dpr);
    canvas.height = Math.round(H0 * dpr);
    canvas.style.width = `${W0}px`;
    canvas.style.height = `${H0}px`;
    const lay = layout(level, W0, H0);
    board = lay.board;
    size = lay.piece;
    const imgSize = { w: img.width, h: img.height };
    const spots = scatter(pieceCount(level), board, size, lay.table, rng(seedOf(`${puzzleId}/${levelId}`)));
    pieces = [];
    for (let row = 0; row < level.rows; row++) {
      for (let col = 0; col < level.cols; col++) {
        const i = row * level.cols + col;
        const path = pathOf(outline(theCut, row, col), size);
        const { loose, flat } = cutPiece(img, imgSize, level, row, col, path, size, dpr);
        const was = old.pieces[i];
        const saved = keep?.pos[i];
        const placed = was ? was.placed : keep ? saved === null : false;
        const spot = was && old.W0 ? { x: (was.x / old.W0) * W0, y: (was.y / old.H0) * H0 } : saved ? { x: saved[0] * W0, y: saved[1] * H0 } : spots[i]!;
        const at = placed ? home(board, size, row, col) : spot;
        pieces.push({ row, col, x: at.x, y: at.y, placed, loose, flat, path });
      }
    }
    if (!order.length) order = pieces.map((_, i) => i);
    paintCount();
    draw();
  };
  const watchSize = new ResizeObserver(() => {
    if (!img || drag) return;
    const [w, hgt] = measure();
    if (Math.abs(w - W0) > 2 || Math.abs(hgt - H0) > 40) build();
  });
  watchSize.observe(el);
  const retheme = () => {
    paper = token(el, "--surface-sunken", "#efe8dc");
    wood = token(el, "--line", "#e2d9ca");
    schedule();
  };
  const watchTheme = new MutationObserver(retheme);
  watchTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  scheme?.addEventListener("change", retheme);

  // ---- start ----
  const fail = (words: Parameters<Ctx["t"]>[0]) => {
    veil.replaceChildren(h("p", {}, ctx.t(words)));
    veil.hidden = false;
  };
  void (async () => {
    retheme();
    record = puzzleId ? await fresh().get("puzzle", puzzleId).catch(() => null) : null;
    if (!alive) return;
    if (!record) return fail(W.gone);
    const who = madeBy(fresh(), record);
    titleEl.textContent = String(record.title ?? "");
    sub.textContent = `${ctx.t(LEVEL_NAMES[levelId])} · ${ctx.t(W.pieces, { n: pieceCount(level) })}${who.mine ? "" : ` · ${ctx.t(W.fromWho, { name: who.name })}`}`;
    const url = await photoUrl(fresh, record.photo as FileRef | undefined, isAlive, 1500);
    if (!alive) return;
    let src = url;
    if (!src) {
      veil.replaceChildren(h("span", { class: "pp-spinner", "aria-hidden": "true" }), h("p", {}, ctx.t(W.waiting)));
      src = await photoUrl(fresh, record.photo as FileRef | undefined, isAlive, 10 * 60_000);
      if (!src) return alive ? fail(W.waiting) : undefined;
    }
    const photo = new Image();
    photo.src = src;
    try {
      await photo.decode();
    } catch {
      return fail(W.gone);
    }
    if (!alive) return;
    // Cropped to this level's shape (3:4 or 4:5), at no more than the board will ever need.
    const crop = coverCrop(photo.naturalWidth, photo.naturalHeight, level.cols, level.rows);
    const c = document.createElement("canvas");
    const scale = Math.min(1, 1600 / crop.h);
    c.width = Math.round(crop.w * scale);
    c.height = Math.round(crop.h * scale);
    c.getContext("2d")!.drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
    img = c;
    theCut = cut(level, seedOf(`${puzzleId}/${levelId}`));
    const kept = await fresh().storage.get<Saved>(savedKey(puzzleId, levelId)).catch(() => null);
    const keep = kept && Array.isArray(kept.pos) && kept.pos.length === pieceCount(level) ? kept : null;
    if (keep) {
      seconds = Number(keep.seconds) || 0;
      moves = Number(keep.moves) || 0;
      hints = Number(keep.hints) || 0;
      time.textContent = clock(seconds);
    }
    veil.hidden = true;
    build(keep);
    canvas.focus?.();
  })();

  const stop = props.runtime.watchQuery("solve", undefined, ({ rows, loading }) => {
    if (loading) return;
    solves = rows.map((r) => ({ puzzle: String((r.puzzle as Resolved | undefined)?.id ?? r.puzzle ?? ""), level: r.level as LevelId, seconds: Number(r.seconds), by: String(r.by ?? "") }));
  });

  return () => {
    alive = false;
    save();
    stop();
    clearInterval(tick);
    if (frame) cancelAnimationFrame(frame);
    watchSize.disconnect();
    watchTheme.disconnect();
    scheme?.removeEventListener("change", retheme);
    document.removeEventListener("visibilitychange", onVisibility);
    root.remove();
    style.remove();
  };
}
