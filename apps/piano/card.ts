// The "Day done" picture: a 1080×1350 card of a finished practice day — a keyboard across the top,
// the minutes, the blocks done and the week — in the app's light look, for a message or a story.
//
// Where the keys go (`keyboard`) is a plain function the tests run without a browser; `drawDayCard`
// paints the card on a canvas and hands back a PNG.

export const CARD_W = 1080;
export const CARD_H = 1350;

/** The light theme's neutrals, as DESIGN.md §3.1 sets them: a shared card always has the day look. */
export const DAY = {
  bg: "#ffffff",
  surface: "#f3f3f4",
  surface2: "#e6e5e7",
  ink: "#231f20",
  inkSoft: "#414042",
  muted: "#6d6b6e",
} as const;

export interface DayColours {
  /** The app's colour, its liveliest level (`--traco`): the felt under the keys, the ticks, the days. */
  traco: string;
  /** The app's colour at the light theme's text level (`--tinta-l`): the minutes. */
  tinta: string;
  display: string;
  body: string;
}

export interface DayCardData {
  /** "Saturday, October 31". */
  date: string;
  title: string;
  /** "Week 1 · Day 3 of 7". */
  week: string;
  /** "40 min". */
  minutes: string;
  /** "5/5 blocks today". */
  blocksLine: string;
  blocks: string[];
  weekTitle: string;
  days: Array<{ n: number; practised: boolean; today: boolean; future: boolean }>;
  name: string;
}

export interface Key {
  x: number;
  w: number;
}

/** Of C D E F G A B, the white keys a black key follows: C, D, F, G and A. */
const BLACK_AFTER = new Set([0, 1, 3, 4, 5]);

/**
 * `whites` white keys from C across `width`, and the black keys between them: each black key is
 * 0.6 of a white one, centred on the line between its two white keys.
 */
export function keyboard(width: number, whites: number): { white: Key[]; black: Key[] } {
  const w = width / whites;
  const white = Array.from({ length: whites }, (_, i) => ({ x: i * w, w }));
  const black: Key[] = [];
  for (let i = 0; i < whites - 1; i++) if (BLACK_AFTER.has(i % 7)) black.push({ x: (i + 1) * w - w * 0.3, w: w * 0.6 });
  return { white, black };
}

const PAD = 88;
const KEYS_H = 300;

/** The card as a PNG. Waits for the two fonts, so the first share is not drawn in a fallback. */
export async function drawDayCard(data: DayCardData, colours: DayColours): Promise<Blob> {
  const display = (size: number) => `700 ${size}px ${colours.display}`;
  const body = (size: number, weight = 500) => `${weight} ${size}px ${colours.body}`;
  try {
    await Promise.all([document.fonts.load(display(96)), document.fonts.load(body(30)), document.fonts.load(body(30, 600))]);
  } catch {
    // A font that will not load draws in the next one in the stack.
  }
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext("2d")!;
  g.fillStyle = DAY.bg;
  g.fillRect(0, 0, CARD_W, CARD_H);

  // The keyboard: two octaves and a C, in a graphite frame, on a strip of the app's colour.
  g.fillStyle = DAY.ink;
  g.fillRect(0, 0, CARD_W, KEYS_H);
  const keys = keyboard(CARD_W, 15);
  g.fillStyle = DAY.bg;
  for (const k of keys.white) {
    g.beginPath();
    g.roundRect(k.x + 2, 0, k.w - 4, KEYS_H - 4, [0, 0, 10, 10]);
    g.fill();
  }
  g.fillStyle = DAY.ink;
  for (const k of keys.black) {
    g.beginPath();
    g.roundRect(k.x, 0, k.w, KEYS_H * 0.6, [0, 0, 8, 8]);
    g.fill();
  }
  g.fillStyle = colours.traco;
  g.fillRect(0, KEYS_H, CARD_W, 14);

  // The day
  let y = KEYS_H + 14 + 76;
  g.fillStyle = DAY.muted;
  g.font = body(28, 600);
  g.letterSpacing = "2px";
  g.fillText(data.date.toLocaleUpperCase(), PAD, y, CARD_W - PAD * 2);
  g.letterSpacing = "0px";
  y += 90;
  g.fillStyle = DAY.ink;
  g.font = display(96);
  g.fillText(data.title, PAD, y, CARD_W - PAD * 2);
  y += 52;
  g.fillStyle = DAY.muted;
  g.font = body(34);
  g.fillText(data.week, PAD, y, CARD_W - PAD * 2);

  // The minutes, big, in the app's colour; what they were under them.
  y += 168;
  g.fillStyle = colours.tinta;
  g.font = display(170);
  g.fillText(data.minutes, PAD - 6, y, CARD_W - PAD * 2);
  y += 58;
  g.fillStyle = DAY.inkSoft;
  g.font = body(32, 600);
  g.fillText(data.blocksLine, PAD, y);

  // The blocks done, each with a tick.
  y += 12;
  g.font = body(30);
  for (const label of data.blocks.slice(0, 5)) {
    y += 50;
    g.fillStyle = colours.traco;
    g.beginPath();
    g.arc(PAD + 16, y - 10, 16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = DAY.ink;
    g.lineWidth = 4;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(PAD + 8, y - 10);
    g.lineTo(PAD + 14, y - 3);
    g.lineTo(PAD + 25, y - 17);
    g.stroke();
    g.fillStyle = DAY.ink;
    g.fillText(label, PAD + 48, y, CARD_W - PAD * 2 - 48);
  }

  // The week: a circle a day, filled where you practised, ringed today.
  const weekY = CARD_H - 185;
  g.fillStyle = DAY.muted;
  g.font = body(26, 600);
  g.fillText(data.weekTitle, PAD, weekY - 60);
  const r = 34;
  const gap = (CARD_W - PAD * 2 - r * 2 * 7) / 6;
  data.days.forEach((d, i) => {
    const cx = PAD + r + i * (r * 2 + gap);
    g.globalAlpha = d.future ? 0.6 : 1;
    g.fillStyle = d.practised ? colours.traco : DAY.surface2;
    g.beginPath();
    g.arc(cx, weekY, r, 0, Math.PI * 2);
    g.fill();
    if (d.today) {
      g.strokeStyle = DAY.ink;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, weekY, r + 6, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = d.practised ? DAY.ink : DAY.muted;
    g.font = body(28, 700);
    g.textAlign = "center";
    g.fillText(String(d.n), cx, weekY + 10);
    g.textAlign = "left";
    g.globalAlpha = 1;
  });

  g.fillStyle = DAY.inkSoft;
  g.font = display(36);
  g.fillText(data.name, PAD, CARD_H - 56);

  return new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("no picture"))), "image/png"));
}
