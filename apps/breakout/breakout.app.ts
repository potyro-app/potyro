// Breakout — a small canvas game, and a test of two things the shell can do: a custom screen that
// draws its own pixels (`mount` hands it an element; it puts a <canvas> in it and runs its own loop),
// and files an app ships with (`levels.json`, read with ctx.files — change the levels without
// touching the code).
//
// Your best score is kept in ctx.storage; every finished game is a `run` record, listed on Scores.
// Drag or move the mouse to steer, tap or press Space to launch, P to pause.
import { defineApp } from "potyro";
import type { Ctx, ViewProps } from "potyro";

// ---- levels: data, shipped beside the app ----

interface Level {
  name: string;
  speed: number;
  rows: string[];
}
interface Levels {
  colors: Record<string, string>;
  levels: Level[];
}

/** Checked on load: a broken levels.json says what is wrong instead of drawing an empty board. */
export function checkLevels(raw: unknown): Levels {
  const l = raw as Partial<Levels> | null;
  if (!l || typeof l !== "object") throw new Error("levels.json must be an object");
  if (!l.colors || typeof l.colors !== "object") throw new Error("levels.json needs `colors`: a letter for each brick colour");
  if (!Array.isArray(l.levels) || !l.levels.length) throw new Error("levels.json needs at least one level");
  l.levels.forEach((lv, i) => {
    if (!Array.isArray(lv.rows) || !lv.rows.length) throw new Error(`level ${i + 1} has no rows`);
    for (const row of lv.rows) {
      for (const ch of row) if (ch !== "." && !(ch in l.colors!)) throw new Error(`level ${i + 1}: "${ch}" is not one of the colours`);
    }
  });
  return l as Levels;
}

// ---- the game ----

const COLS = 8;
const STEEL = "S"; // takes two hits
const BEST = "best";

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  hits: number;
  points: number;
}

function sound(): (freq: number, ms?: number) => void {
  let audio: AudioContext | null = null;
  return (freq, ms = 60) => {
    try {
      audio ??= new AudioContext();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + ms / 1000);
    } catch {
      /* no audio on this device: the game is still a game */
    }
  };
}

function mountGame(el: HTMLElement, props: ViewProps): () => void {
  const ctx = (props.runtime as { ctx: Ctx }).ctx;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;margin:0 auto;touch-action:none;border-radius:14px;max-width:100%;";
  el.appendChild(canvas);
  const g = canvas.getContext("2d")!;
  const beep = sound();

  // Sizing: a 3:4 board that fits the space it was given and stays sharp on a phone's screen.
  let W = 360;
  let H = 480;
  // How much of the bottom the shell's own bars take: the custom property it gives views for exactly
  // this (0 on a full-screen page). Measured, because it is a calc() the stylesheet resolves.
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--k-chrome-bottom, 0px)";
  el.appendChild(probe);
  const fit = (): void => {
    const room = Math.max(240, window.innerHeight - el.getBoundingClientRect().top - probe.offsetHeight - 24);
    W = Math.min(el.clientWidth || 360, 520, Math.floor((room * 3) / 4));
    H = Math.floor((W * 4) / 3);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  let levels: Levels | null = null;
  let error: string | null = null;
  let level = 0;
  let score = 0;
  let lives = 3;
  let best = 0;
  let bricks: Brick[] = [];
  let state: "loading" | "ready" | "playing" | "paused" | "won" | "over" = "loading";
  const paddle = { x: 0, w: 0, h: 10 };
  const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 6 };

  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#2b241e";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e4a93c";

  const build = (): void => {
    const lv = levels!.levels[level]!;
    const gap = 4;
    const top = 56;
    const bw = (W - gap * (COLS + 1)) / COLS;
    const bh = Math.max(12, H / 32);
    bricks = [];
    lv.rows.forEach((row, r) =>
      [...row].slice(0, COLS).forEach((ch, c) => {
        if (ch === ".") return;
        bricks.push({ x: gap + c * (bw + gap), y: top + r * (bh + gap), w: bw, h: bh, color: levels!.colors[ch]!, hits: ch === STEEL ? 2 : 1, points: (lv.rows.length - r) * 10 });
      }),
    );
    paddle.w = W / 5;
    paddle.x = (W - paddle.w) / 2;
    resetBall();
  };

  const resetBall = (): void => {
    ball.r = Math.max(5, W / 70);
    ball.x = paddle.x + paddle.w / 2;
    ball.y = H - 40 - ball.r;
    ball.vx = 0;
    ball.vy = 0;
    state = "ready";
  };

  const launch = (): void => {
    const speed = (W / 90) * (levels?.levels[level]?.speed ?? 1);
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.8;
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    state = "playing";
    beep(440, 40);
  };

  const finish = async (won: boolean): Promise<void> => {
    state = won ? "won" : "over";
    beep(won ? 880 : 140, 300);
    if (score > best) {
      best = score;
      await ctx.storage.set(BEST, best);
    }
    await ctx.create("run", { score, level: level + 1, levelName: levels!.levels[level]!.name, won, playedAt: new Date() });
  };

  const step = (): void => {
    if (state !== "playing") return;
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.x < ball.r || ball.x > W - ball.r) {
      ball.vx = -ball.vx;
      ball.x = Math.min(Math.max(ball.x, ball.r), W - ball.r);
      beep(300, 25);
    }
    if (ball.y < ball.r + 40) {
      ball.vy = Math.abs(ball.vy);
      beep(300, 25);
    }
    // The paddle: where it is hit sets the angle, so steering is a skill rather than luck.
    const py = H - 30;
    if (ball.vy > 0 && ball.y + ball.r >= py && ball.y + ball.r <= py + paddle.h + Math.abs(ball.vy) && ball.x >= paddle.x - ball.r && ball.x <= paddle.x + paddle.w + ball.r) {
      const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      const speed = Math.hypot(ball.vx, ball.vy) * 1.01;
      const angle = -Math.PI / 2 + hit * 1.05;
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      ball.y = py - ball.r;
      beep(520, 30);
    }
    for (const b of bricks) {
      if (b.hits <= 0) continue;
      if (ball.x + ball.r < b.x || ball.x - ball.r > b.x + b.w || ball.y + ball.r < b.y || ball.y - ball.r > b.y + b.h) continue;
      const fromSide = Math.min(Math.abs(ball.x - b.x), Math.abs(ball.x - (b.x + b.w))) < Math.min(Math.abs(ball.y - b.y), Math.abs(ball.y - (b.y + b.h)));
      if (fromSide) ball.vx = -ball.vx;
      else ball.vy = -ball.vy;
      b.hits--;
      if (b.hits === 0) {
        score += b.points;
        beep(660 + b.points * 4, 50);
        void ctx.caps.haptics?.vibrate(12);
      } else beep(200, 40);
      break;
    }
    if (bricks.every((b) => b.hits <= 0)) {
      if (level + 1 < levels!.levels.length) {
        level++;
        build();
        beep(990, 120);
      } else void finish(true);
    }
    if (ball.y - ball.r > H) {
      lives--;
      void ctx.caps.haptics?.vibrate(60);
      if (lives <= 0) void finish(false);
      else resetBall();
    }
  };

  const text = (s: string, y: number, size: number, color = ink): void => {
    g.fillStyle = color;
    g.font = `600 ${size}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.fillText(s, W / 2, y);
  };

  const draw = (): void => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(127,127,127,0.10)";
    g.fillRect(0, 0, W, H);
    if (error) {
      text("levels.json has a problem", H / 2 - 12, 16);
      g.font = `400 12px system-ui, sans-serif`;
      g.fillText(error.slice(0, 60), W / 2, H / 2 + 12);
      return;
    }
    if (state === "loading") return text("Loading levels…", H / 2, 16);
    g.font = `600 14px system-ui, sans-serif`;
    g.fillStyle = ink;
    g.textAlign = "left";
    g.fillText(`${score}`, 12, 26);
    g.textAlign = "center";
    g.fillText(levels!.levels[level]!.name, W / 2, 26);
    g.textAlign = "right";
    g.fillText(`${"●".repeat(Math.max(lives, 0))}  best ${best}`, W - 12, 26);
    for (const b of bricks) {
      if (b.hits <= 0) continue;
      g.fillStyle = b.color;
      g.globalAlpha = b.hits > 1 ? 1 : 0.92;
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 4);
      g.fill();
      if (b.hits > 1) {
        g.strokeStyle = "rgba(255,255,255,0.55)";
        g.lineWidth = 2;
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = accent;
    g.beginPath();
    g.roundRect(paddle.x, H - 30, paddle.w, paddle.h, 5);
    g.fill();
    g.fillStyle = ink;
    g.beginPath();
    g.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    g.fill();
    if (state === "ready") text("Tap to launch", H / 2 + 40, 15);
    if (state === "paused") text("Paused — tap to go on", H / 2 + 40, 15);
    if (state === "won") text(`You cleared it! ${score}`, H / 2, 20, accent), text("Tap to play again", H / 2 + 30, 14);
    if (state === "over") text(`Game over · ${score}`, H / 2, 20), text("Tap to play again", H / 2 + 30, 14);
  };

  let frame = 0;
  const loop = (): void => {
    step();
    draw();
    frame = requestAnimationFrame(loop);
  };

  const steer = (clientX: number): void => {
    const rect = canvas.getBoundingClientRect();
    paddle.x = Math.min(Math.max(clientX - rect.left - paddle.w / 2, 0), W - paddle.w);
    if (state === "ready") ball.x = paddle.x + paddle.w / 2;
  };
  const tap = (): void => {
    if (state === "ready") launch();
    else if (state === "paused") state = "playing";
    else if (state === "won" || state === "over") {
      level = 0;
      score = 0;
      lives = 3;
      build();
    }
  };
  const onPointerMove = (e: PointerEvent): void => steer(e.clientX);
  const onPointerDown = (e: PointerEvent): void => {
    steer(e.clientX);
    tap();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowLeft") steer(canvas.getBoundingClientRect().left + paddle.x + paddle.w / 2 - W / 16);
    else if (e.key === "ArrowRight") steer(canvas.getBoundingClientRect().left + paddle.x + paddle.w / 2 + W / 16);
    else if (e.key === " ") tap();
    else if (e.key.toLowerCase() === "p" && state === "playing") state = "paused";
    else return;
    e.preventDefault();
  };
  // Leaving the screen mid-game pauses it rather than letting the ball fall while nobody watches.
  const onHide = (): void => {
    if (document.hidden && state === "playing") state = "paused";
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", fit);
  document.addEventListener("visibilitychange", onHide);
  fit();
  frame = requestAnimationFrame(loop);

  void (async () => {
    try {
      best = (await ctx.storage.get<number>(BEST)) ?? 0;
      const raw = await ctx.files.json("levels.json");
      if (raw == null) throw new Error("levels.json has not reached this device yet");
      levels = checkLevels(raw);
      build();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  })();

  return () => {
    cancelAnimationFrame(frame);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", fit);
    document.removeEventListener("visibilitychange", onHide);
    canvas.remove();
    probe.remove();
  };
}

export default defineApp({
  id: "breakout",
  name: "Breakout",
  icon: "🧱",
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#e4a93c" },
  permissions: { haptics: true },
  entities: {
    run: {
      label: "Game",
      displayField: "levelName",
      fields: {
        score: { type: "number", integer: true },
        level: { type: "number", integer: true },
        levelName: { type: "text" },
        won: { type: "boolean" },
        playedAt: { type: "datetime", precision: "minute" },
      },
    },
  },
  pages: [
    { id: "play", title: "Play", icon: "🎮", fullscreen: true, view: { type: "custom", entity: "run", mount: mountGame } },
    {
      id: "scores",
      title: "Scores",
      icon: "🏆",
      view: {
        type: "list",
        entity: "run",
        sort: (a, b) => Number(b.score) - Number(a.score),
        display: { primary: (r) => `${r.score} points`, secondary: (r) => `${r.won ? "Cleared every level" : `Reached ${r.levelName}`}` },
      },
    },
  ],
});
