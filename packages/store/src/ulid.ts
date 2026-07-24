// A small monotonic, lexicographically-sortable id (ULID-ish). Good enough for a local-first
// personal-scale store: 48-bit ms timestamp + 80 bits of randomness, Crockford base32. Not a
// spec-perfect ULID, but sortable-by-creation and collision-safe at this scale.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TIME_LEN = 10;
const RAND_LEN = 16;

function randomByte(): number {
  // crypto is available in Node 18+ and browsers.
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint8Array(1);
    g.crypto.getRandomValues(buf);
    return buf[0]!;
  }
  return Math.floor(Math.random() * 256);
}

function encodeTime(now: number): string {
  let out = "";
  let t = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = t % 32;
    out = ENCODING[mod]! + out;
    t = (t - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  let out = "";
  for (let i = 0; i < RAND_LEN; i++) {
    out += ENCODING[randomByte() % 32]!;
  }
  return out;
}

/** Increment a Crockford-base32 string by one, right-to-left (for intra-ms monotonicity). */
function incrementBase32(s: string): string {
  const chars = s.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ENCODING.indexOf(chars[i]!);
    if (idx < 31) {
      chars[i] = ENCODING[idx + 1]!;
      return chars.join("");
    }
    chars[i] = ENCODING[0]!;
  }
  return s; // overflow (astronomically unlikely)
}

let lastTime = -1;
let lastRandom = "";

/** Generate a sortable, monotonic id. Within a millisecond the random part is incremented. */
export function ulid(nowMs: number = Date.now()): string {
  if (nowMs === lastTime) {
    lastRandom = incrementBase32(lastRandom);
  } else {
    lastTime = nowMs;
    lastRandom = encodeRandom();
  }
  return encodeTime(nowMs) + lastRandom;
}
