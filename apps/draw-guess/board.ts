// The paper: draws a sketch (sketch.ts) on a canvas, and — on the drawer's device — turns a finger or
// the mouse into board points. One drawing routine for everyone, so what the drawer sees is what the
// guessers see, at whatever size their screen gives the board.
//
// Smooth strokes: each stroke is a chain of quadratic curves through the midpoints of its points,
// with round caps and joins; a single tap is a dot. Finished strokes are drawn once into a cache and
// stamped; only the strokes still being drawn are drawn every frame.
import { BOARD, COLORS, ERASER, PAPER, SIZES, pointsOf, visible, type Sketch, type Stroke } from "./sketch.js";

const colorOf = (c: number) => (c === ERASER ? PAPER : (COLORS[c] ?? COLORS[0]));

function drawStroke(g: CanvasRenderingContext2D, s: Stroke, k: number): void {
  const p = pointsOf(s);
  if (p.length < 2) return;
  const width = (SIZES[s.w] ?? SIZES[1]) * k;
  g.strokeStyle = colorOf(s.c);
  g.fillStyle = colorOf(s.c);
  g.lineWidth = width;
  g.lineCap = "round";
  g.lineJoin = "round";
  if (p.length === 2) {
    g.beginPath();
    g.arc(p[0]! * k, p[1]! * k, width / 2, 0, Math.PI * 2);
    g.fill();
    return;
  }
  g.beginPath();
  g.moveTo(p[0]! * k, p[1]! * k);
  if (p.length === 4) g.lineTo(p[2]! * k, p[3]! * k);
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = ((p[i]! + p[i + 2]!) / 2) * k;
    const my = ((p[i + 1]! + p[i + 3]!) / 2) * k;
    g.quadraticCurveTo(p[i]! * k, p[i + 1]! * k, mx, my);
  }
  if (p.length > 4) g.lineTo(p[p.length - 2]! * k, p[p.length - 1]! * k);
  g.stroke();
}

export interface Pen {
  color: number;
  size: number;
}

export interface BoardHandlers {
  down(x: number, y: number): void;
  move(points: Array<[number, number]>): void;
  up(): void;
}

export class Board {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly cache: HTMLCanvasElement;
  private readonly cg: CanvasRenderingContext2D;
  /** The finished strokes in the cache, by identity: when they are the same objects, the cache is good. */
  private cached: Stroke[] = [];
  private sketch: Sketch | null = null;
  private frame = 0;
  private px = 0;
  private handlers: BoardHandlers | null = null;
  private pointer: number | null = null;

  constructor(label: string) {
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
    this.canvas.className = "dg-canvas";
    this.g = this.canvas.getContext("2d")!;
    this.cache = document.createElement("canvas");
    this.cg = this.cache.getContext("2d")!;
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("lostpointercapture", this.onUp);
  }

  /** The board's size on screen, in CSS pixels (it is square). */
  resize(css: number): void {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const px = Math.max(1, Math.round(css * dpr));
    this.canvas.style.width = `${css}px`;
    this.canvas.style.height = `${css}px`;
    if (px === this.px) return;
    this.px = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.cache.width = px;
    this.cache.height = px;
    this.cached = [];
    this.paint();
  }

  /** Drawing allowed (the drawer, mid-turn) or not. */
  setInput(h: BoardHandlers | null): void {
    this.handlers = h;
    this.canvas.classList.toggle("dg-can-draw", !!h);
    if (!h && this.pointer !== null) this.pointer = null;
  }

  show(sk: Sketch): void {
    this.sketch = sk;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.paint());
  }

  private paint(): void {
    this.frame = 0;
    const k = this.px / BOARD;
    const strokes = this.sketch ? visible(this.sketch) : [];
    // The cache holds the longest run of finished strokes from the start.
    let done = 0;
    while (done < strokes.length && strokes[done]!.done) done++;
    const same = this.cached.length <= done && this.cached.every((s, i) => strokes[i] === s);
    if (!same) {
      this.cg.fillStyle = PAPER;
      this.cg.fillRect(0, 0, this.px, this.px);
      this.cached = [];
    }
    for (let i = this.cached.length; i < done; i++) drawStroke(this.cg, strokes[i]!, k);
    this.cached = strokes.slice(0, done);
    this.g.drawImage(this.cache, 0, 0);
    for (let i = done; i < strokes.length; i++) drawStroke(this.g, strokes[i]!, k);
  }

  private toBoard(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * BOARD;
    const y = ((e.clientY - r.top) / Math.max(1, r.height)) * BOARD;
    return [Math.max(0, Math.min(BOARD, x)), Math.max(0, Math.min(BOARD, y))];
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.handlers || this.pointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already-gone pointer cannot be captured; drawing still works without it.
    }
    const [x, y] = this.toBoard(e);
    this.handlers.down(x, y);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.handlers || e.pointerId !== this.pointer) return;
    e.preventDefault();
    // Every point the device saw since the last event, not only the last one: smoother curves.
    const all = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const pts = (all.length ? all : [e]).map((ev) => this.toBoard(ev));
    this.handlers.move(pts);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.handlers?.up();
  };

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }
}
