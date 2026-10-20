import { describe, expect, it } from "vitest";
import {
  COLOURS,
  countdown,
  dailyCode,
  feedback,
  FIRST_DAY,
  LENGTH,
  nextPuzzleAt,
  outcome,
  paletteHints,
  puzzleDate,
  puzzleNumber,
  rng,
  shareText,
  solved,
  squares,
  stats,
  TRIES,
  validGame,
  type Code,
  type Mark,
} from "../puzzle.js";

/** Every code there is: 7^5. */
const ALL: number[][] = (() => {
  const out: number[][] = [];
  const walk = (p: number[]) => {
    if (p.length === LENGTH) return void out.push(p);
    for (let c = 0; c < COLOURS; c++) walk([...p, c]);
  };
  walk([]);
  return out;
})();

/**
 * A careful player: every guess fits everything told so far (picked at random among those that do).
 * No cleverer than a person with pencil and paper — and no luckier, since the picks are seeded.
 */
function solve(code: Code, random: () => number): number {
  let left = ALL;
  for (let n = 1; n <= 20; n++) {
    const guess = left[Math.floor(random() * left.length)]!;
    const told = feedback(guess, code);
    if (solved(told)) return n;
    const key = told.join();
    left = left.filter((c) => feedback(guess, c).join() === key);
  }
  return Infinity;
}

describe("which puzzle today is", () => {
  it("is #1 on the first day, and counts calendar days after it", () => {
    expect(puzzleNumber(new Date(FIRST_DAY.y, FIRST_DAY.m - 1, FIRST_DAY.d, 0, 0, 1))).toBe(1);
    expect(puzzleNumber(new Date(2026, 9, 15, 23, 59, 59))).toBe(1);
    expect(puzzleNumber(new Date(2026, 9, 16, 0, 0, 0))).toBe(2);
    expect(puzzleNumber(new Date(2027, 9, 15, 12))).toBe(366);
  });

  it("does not skip or repeat a day across a daylight-saving change", () => {
    // Europe moves its clocks on 2026-10-25 and 2027-03-28; whatever zone this runs in, every
    // calendar day from the first through spring has its own number, one after another.
    let prev = puzzleNumber(new Date(2026, 9, 15, 12));
    for (let d = 1; d < 200; d++) {
      const at = new Date(2026, 9, 15 + d, 0, 30);
      const n = puzzleNumber(at);
      expect(n, at.toString()).toBe(prev + 1);
      prev = n;
    }
  });

  it("finds its date again, and the next one opens at local midnight", () => {
    for (const n of [1, 2, 17, 365, 1000]) expect(puzzleNumber(puzzleDate(n))).toBe(n);
    expect(puzzleDate(1)).toEqual(new Date(2026, 9, 15));
    expect(nextPuzzleAt(new Date(2026, 9, 15, 18, 30))).toEqual(new Date(2026, 9, 16));
    expect(countdown(new Date(2026, 9, 15, 18, 30, 0), new Date(2026, 9, 16))).toBe("05:30:00");
    expect(countdown(new Date(2026, 9, 15, 23, 59, 59, 500), new Date(2026, 9, 16))).toBe("00:00:00");
  });
});

describe("the code of the day", () => {
  it("is the same everywhere, forever: pinned for the first days", () => {
    // These pin the generator. If this fails, every shared result and streak would change under people.
    expect([1, 2, 3, 100].map(dailyCode)).toMatchInlineSnapshot(`
      [
        [
          1,
          1,
          5,
          3,
          5,
        ],
        [
          5,
          2,
          3,
          1,
          5,
        ],
        [
          2,
          0,
          3,
          3,
          3,
        ],
        [
          4,
          1,
          1,
          6,
          6,
        ],
      ]
    `);
  });

  it("is five gems of the seven colours, never one colour five times", () => {
    for (let n = 1; n <= 2000; n++) {
      const code = dailyCode(n);
      expect(code).toHaveLength(LENGTH);
      for (const c of code) expect(Number.isInteger(c) && c >= 0 && c < COLOURS).toBe(true);
      expect(new Set(code).size).toBeGreaterThan(1);
    }
  });

  it("changes every day, and uses every colour in every place about as often", () => {
    const seen = new Map<string, number>();
    const perPlace = Array.from({ length: LENGTH }, () => Array.from({ length: COLOURS }, () => 0));
    for (let n = 1; n <= 3500; n++) {
      const code = dailyCode(n);
      expect(code.join()).not.toBe(dailyCode(n + 1).join());
      seen.set(code.join(), (seen.get(code.join()) ?? 0) + 1);
      code.forEach((c, i) => perPlace[i]![c]!++);
    }
    for (const place of perPlace) for (const count of place) expect(count).toBeGreaterThan(3500 / COLOURS * 0.8);
    // Drawn freely from 16,807 codes, 3,500 days hold about 3,160 different ones (the birthday problem).
    expect(seen.size).toBeGreaterThan(3100);
  });

  it("is fair: a careful player cracks nearly every day within six, most in four or five", () => {
    const random = rng(2026);
    const tries: number[] = [];
    for (let n = 1; n <= 80; n++) for (let k = 0; k < 5; k++) tries.push(solve(dailyCode(n), random));
    const inSix = tries.filter((t) => t <= TRIES).length / tries.length;
    const mean = tries.reduce((a, b) => a + b, 0) / tries.length;
    expect(inSix).toBeGreaterThan(0.97);
    expect(mean).toBeGreaterThan(3.6);
    expect(mean).toBeLessThan(5);
  });
});

describe("what a guess is told", () => {
  const f = (g: number[], c: number[]) => feedback(g, c).map((m) => m[0]).join("");

  it("right place first, then elsewhere, then not in it", () => {
    expect(f([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBe("eeeee");
    expect(f([0, 1, 2, 3, 4], [4, 0, 1, 2, 3])).toBe("ppppp");
    expect(f([5, 5, 5, 5, 5], [0, 1, 2, 3, 4])).toBe("aaaaa");
    expect(f([0, 6, 2, 6, 6], [0, 1, 2, 3, 4])).toBe("eaeaa");
  });

  it("counts repeats the way Wordle does", () => {
    // Two rubies against a code with one: the one in place is right, the other is told nothing.
    expect(f([0, 0, 1, 1, 1], [0, 2, 2, 2, 2])).toBe("eaaaa");
    // Two rubies, neither in place, one in the code: only the first is "elsewhere".
    expect(f([1, 0, 0, 1, 1], [0, 2, 2, 2, 2])).toBe("apaaa");
    // A right-place ruby uses up the code's ruby before an earlier misplaced one can claim it.
    expect(f([0, 2, 2, 2, 0], [3, 3, 3, 3, 0])).toBe("aaaae");
    expect(f([3, 0, 0, 3, 3], [0, 0, 1, 1, 1])).toBe("aepaa");
  });

  it("knows when the game is over", () => {
    const code = [0, 1, 2, 3, 4];
    expect(outcome({ guesses: [] }, code)).toBe("playing");
    expect(outcome({ guesses: [[0, 1, 2, 3, 4]] }, code)).toBe("won");
    expect(outcome({ guesses: Array.from({ length: 5 }, () => [6, 6, 6, 6, 6]) }, code)).toBe("playing");
    expect(outcome({ guesses: Array.from({ length: 6 }, () => [6, 6, 6, 6, 6]) }, code)).toBe("lost");
    expect(outcome({ guesses: [...Array.from({ length: 5 }, () => [6, 6, 6, 6, 6]), code] }, code)).toBe("won");
  });

  it("lets the palette remember the best it has learnt about each colour", () => {
    const code = [0, 1, 2, 3, 4];
    const hints = paletteHints([[0, 0, 5, 1, 6], [3, 1, 6, 6, 6]], code);
    expect(hints).toEqual<Array<Mark | undefined>>(["exact", "exact", undefined, "present", undefined, "absent", "absent"]);
  });

  it("refuses a stored game it could not have produced", () => {
    expect(validGame({ guesses: [[0, 1, 2, 3, 4]] })).toBe(true);
    expect(validGame({ guesses: [[0, 1, 2, 3]] })).toBe(false);
    expect(validGame({ guesses: [[0, 1, 2, 3, 7]] })).toBe(false);
    expect(validGame({ guesses: Array.from({ length: 7 }, () => [0, 0, 0, 0, 0]) })).toBe(false);
    expect(validGame(null)).toBe(false);
    expect(validGame({ guesses: "nope" })).toBe(false);
  });
});

describe("the line people paste", () => {
  const code = [0, 1, 2, 3, 4];
  const game = { guesses: [[0, 0, 5, 1, 6], [3, 1, 6, 6, 4], [0, 1, 2, 3, 4]] };

  it("is the title, the score and a spoiler-free grid", () => {
    expect(shareText(12, game, code)).toBe(["Potyro Daily #12 3/6", "🟩⬛⬛🟨⬛", "🟨🟩⬛⬛🟩", "🟩🟩🟩🟩🟩"].join("\n"));
  });

  it("says X/6 for a day that got away, and swaps to orange and blue in high contrast", () => {
    const lost = { guesses: Array.from({ length: 6 }, () => [6, 6, 6, 6, 0]) };
    expect(shareText(3, lost, code).split("\n")[0]).toBe("Potyro Daily #3 X/6");
    expect(shareText(12, game, code, { contrast: true }).split("\n")[3]).toBe("🟧🟧🟧🟧🟧");
    expect(squares(["exact", "present", "absent", "absent", "present"], true)).toBe("🟧🟦⬛⬛🟦");
  });

  it("never names a colour", () => {
    const [, ...grid] = shareText(12, game, code).split("\n");
    for (const row of grid) expect(row).toMatch(/^(🟩|🟨|⬛){5}$/u);
  });
});

describe("stats", () => {
  const p = (number: number, won: boolean, guesses = 4) => ({ number, won, guesses });

  it("counts a streak back from today, or from yesterday while today is unplayed", () => {
    const days = [p(1, true), p(2, true), p(3, false), p(4, true, 3), p(5, true, 5), p(6, true, 2)];
    expect(stats(days, 6)).toMatchObject({ played: 6, wins: 5, winRate: 83, streak: 3, best: 3 });
    expect(stats(days, 7).streak).toBe(3); // today (#7) not played yet
    expect(stats(days, 8).streak).toBe(0); // a day was missed
    expect(stats(days, 6).spread).toEqual([0, 1, 1, 2, 1, 0]);
  });

  it("finds the best run anywhere, and a gap breaks a run as a loss does", () => {
    const days = [p(1, true), p(2, true), p(3, true), p(5, true), p(6, true)];
    expect(stats(days, 6)).toMatchObject({ streak: 2, best: 3 });
  });

  it("counts a day once, and starts at zero", () => {
    expect(stats([p(2, true), p(2, true)], 2)).toMatchObject({ played: 1, wins: 1, streak: 1 });
    expect(stats([], 1)).toEqual({ played: 0, wins: 0, winRate: 0, streak: 0, best: 0, spread: [0, 0, 0, 0, 0, 0] });
  });
});
