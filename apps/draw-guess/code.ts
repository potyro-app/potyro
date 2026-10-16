// The game's code: what the host reads out, shows on screen or sends, and friends type in to join.
//
// Twelve characters from an alphabet without look-alikes (no 0/O, 1/I/L), shown in three groups —
// "KQ7M-XR4P-2DHC" — which is 59 random bits (31^12). The room's id on the relay is the code behind a fixed
// prefix, so the code IS the invitation (docs/26 §1). Shorter than the 128 bits the relay suggests on
// purpose: a party game's code is read aloud across a room and typed on a phone, a room lives only
// while someone is in it, and everyone who joins shows up in the lobby for all to see. Guessing one
// would take about 2^58 tries on average at a relay that lets an address in eight rooms at a time.

export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 12;
const PREFIX = "potyro-draw-guess-";

/** A new code, from `random` (0 ≤ x < 1) — crypto-strong in the app, seeded in tests. */
export function newCode(random: () => number): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[Math.min(ALPHABET.length - 1, Math.floor(random() * ALPHABET.length))];
  return out;
}

/** What a person typed (any case, with or without dashes and spaces) as a code, or null. */
export function parseCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((ch) => ALPHABET.includes(ch)) ? code : null;
}

/** "KQ7MXR4P2DHC" → "KQ7M-XR4P-2DHC". */
export const showCode = (code: string): string => code.match(/.{1,4}/g)?.join("-") ?? code;

/** The room on the relay that a code opens. */
export const roomIdFor = (code: string): string => `${PREFIX}${code}`;

/** A crypto-strong random in [0, 1). */
export function strongRandom(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0]! / 4294967296;
}
