// The share card's layout (#484): the sentence wraps only where the plain text has a space, and the
// chart's points sit where the screen's chart puts them.
import { describe, expect, it } from "vitest";
import { cardLayout, fitSentence, leadOf, MOOD_AXIS, PANEL_MIN, plotPoints, SENTENCE, SLEEP_AXIS, wrapRuns, type Run } from "../card.js";
import type { Insight } from "../insights.js";

/** Every character 10 wide: lines are easy to count. */
const width = (r: Run) => r.text.length * 10;
const text = (line: Array<{ text: string }>) => line.map((r) => r.text).join("|");

const sentence: Insight["parts"] = ["On nights of ", { value: "7 hours", series: "sleep" }, " or more your mood averages ", { value: "4.3", series: "mood" }, "."];

describe("wrapRuns", () => {
  it("keeps a number with its unit and with the stop after it", () => {
    const lines = wrapRuns(sentence, width, 200);
    expect(lines.map(text)).toEqual(["On|nights|of|7 hours", "or|more|your|mood", "averages|4.3|."]);
    // "4.3" and "." touch: no space between them.
    const last = lines[2]!;
    expect(last[2]!.x).toBe(last[1]!.x + 30);
    expect(last[1]).toMatchObject({ series: "mood" });
  });

  it("never makes a line wider than asked when its widest word fits", () => {
    // The widest word is "averages", 80 wide.
    for (const max of [80, 120, 160, 240, 400]) {
      for (const line of wrapRuns(sentence, width, max)) {
        const end = line[line.length - 1]!;
        expect(end.x + width(end)).toBeLessThanOrEqual(max);
      }
    }
  });

  it("puts one sentence on one line when there is room", () => {
    expect(wrapRuns(sentence, width, 2000)).toHaveLength(1);
  });
});

describe("plotPoints", () => {
  const box = { x: 100, y: 50, w: 300, h: 70 };

  it("spreads the days across the box, top for the axis's high end, and leaves a gap where nothing was logged", () => {
    expect(plotPoints([10, null, 3, 6.5], SLEEP_AXIS, box)).toEqual([{ x: 100, y: 50 }, null, { x: 300, y: 120 }, { x: 400, y: 85 }]);
  });

  it("holds a value outside the axis at its edge", () => {
    expect(plotPoints([14, 1], SLEEP_AXIS, box).map((p) => p!.y)).toEqual([50, 120]);
    expect(plotPoints([5.5], MOOD_AXIS, box)[0]).toEqual({ x: 250, y: 50 });
  });
});

describe("fitSentence and cardLayout", () => {
  /** A display face whose every character is half its size wide, on the card's 904px measure. */
  const at = (size: number) => (r: Run) => r.text.length * size * 0.5;
  const MEASURE = 904;
  const words = (n: number): Insight["parts"] => [Array.from({ length: n }, (_, i) => `word${i % 10}`).join(" "), " ", { value: "4.3", series: "mood" }, "."];

  it("keeps the chart panel at least 420px tall, whatever the sentence (#484)", () => {
    for (let n = 1; n <= 40; n++) {
      const { panel } = cardLayout(fitSentence(words(n), at, MEASURE));
      expect(panel.h).toBeGreaterThanOrEqual(PANEL_MIN);
    }
  });

  it("steps the size down until the sentence is three lines or fewer", () => {
    // Fourteen words: four lines at 72, three once smaller.
    const fit = fitSentence(words(14), at, MEASURE);
    expect(wrapRuns(words(14), at(SENTENCE.max), MEASURE).length).toBeGreaterThan(3);
    expect(fit.lines.length).toBeLessThanOrEqual(3);
    expect(fit.size).toBeLessThan(SENTENCE.max);
    expect(fit.size).toBeGreaterThanOrEqual(SENTENCE.min);
  });

  it("keeps a short sentence at the largest size", () => {
    expect(fitSentence(sentence, at, MEASURE).size).toBe(SENTENCE.max);
  });

  it("past three lines even at the smallest size, sets it at the smallest, its lines and lead measured there", () => {
    const fit = fitSentence(words(40), at, MEASURE);
    expect(fit.size).toBe(SENTENCE.min);
    expect(fit.lead).toBe(leadOf(SENTENCE.min));
    expect(fit.lines).toEqual(wrapRuns(words(40), at(SENTENCE.min), MEASURE));
  });
});
