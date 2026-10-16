import { describe, expect, it } from "vitest";
import { decode, encode, fromWireGame, toWireGame, MAX_MESSAGE, type Msg } from "../protocol.js";
import { newGame, join, start } from "../game.js";
import { addPiece, emptySketch, fromWire, packPoints, pointsOf, toWire, unpackPoints, visible, addClear } from "../sketch.js";

describe("messages", () => {
  const all: Msg[] = [
    { t: "hi", m: "k3J9xQ2mZp1a", p: "pX-_1", n: "Ana" },
    { t: "go", k: 3, mask: "___ _____" },
    { t: "hint", k: 3, mask: "_c_ _____" },
    { t: "d", k: 3, s: 7, q: 2, c: 8, w: 2, p: [10, 20, 1, -1, 0, 3], e: 1 },
    { t: "d", k: 3, s: 7, q: 0, c: 1, w: 0, p: [500, 500] },
    { t: "u", k: 3, s: 7 },
    { t: "x", k: 3, s: 8 },
    { t: "snap", to: "Qw8", k: 3, ops: [{ x: 1 }, { s: 2, c: 0, w: 1, q: [[0, [1, 2, 3, 4]]], e: 1 }] },
    { t: "g", k: 3, p: "pB", id: 4, text: "a cat" },
    { t: "v", k: 3, p: "pB", id: 4, r: "no", text: "a cat" },
    { t: "v", k: 3, p: "pB", id: 5, r: "close" },
    { t: "end", k: 3, word: "ice cream", by: "pB", left: 0.42, row: 80 },
    { t: "end", k: 3, word: "cat", by: null, left: 0, row: 0 },
  ];

  it("every kind survives the trip as it was", () => {
    for (const m of all) expect(decode(encode(m))).toEqual(m);
  });

  it("a game snapshot carries the clock as time left, so devices that disagree on the time agree on it", () => {
    let g = newGame({ p: "pa", m: "ma", name: "Ana" }, "de");
    g = join(g, { p: "pb", m: "mb", name: "Bo" });
    g = start(g, 1_000);
    const wire = toWireGame(g, 3_000);
    expect(wire.left).toBe(g.ends - 3_000);
    const text = encode({ t: "st", h: "ma", g: wire });
    const back = decode(text) as Extract<Msg, { t: "st" }>;
    expect(back.t).toBe("st");
    const there = fromWireGame(back.g, 50_000);
    expect(there.ends).toBe(50_000 + wire.left);
    expect({ ...there, ends: 0 }).toEqual({ ...g, ends: 0 });
  });

  it("drops what it does not know or does not believe — silently", () => {
    const bad = [
      "not json",
      "[]",
      '{"t":"nope"}',
      '{"t":"hi","m":"has space","p":"x","n":"A"}',
      '{"t":"d","k":1,"s":1,"q":0,"c":99,"w":0,"p":[1,2]}', // no such colour
      '{"t":"d","k":1,"s":1,"q":0,"c":0,"w":0,"p":[1,2,3]}', // odd number of coordinates
      '{"t":"d","k":1,"s":1,"q":0,"c":0,"w":0,"p":[1,2],"e":2}',
      `{"t":"d","k":1,"s":1,"q":0,"c":0,"w":0,"p":[${Array(700).fill(1).join(",")}]}`, // a piece too long
      '{"t":"g","k":1,"p":"a","id":1,"text":""}',
      `{"t":"g","k":1,"p":"a","id":1,"text":"${"x".repeat(41)}"}`,
      '{"t":"v","k":1,"p":"a","id":1,"r":"maybe"}',
      '{"t":"end","k":1,"word":"cat","by":null,"left":2,"row":0}',
      '{"t":"end","k":1,"word":"cat","by":null,"left":0.5,"row":99999}',
      '{"t":"st","h":"m","g":{"v":1}}',
      '{"t":"st","h":"m","g":{"v":1,"phase":"lobby","lang":"xx","rounds":3,"seconds":80,"players":[],"round":0,"drawn":[],"drawer":null,"turn":0,"left":0,"mask":"","last":null,"used":[]}}',
    ];
    for (const b of bad) expect(decode(b), b).toBeNull();
    expect(decode(new Uint8Array([1, 2]))).toBeNull();
  });

  it("a right guess's verdict does not carry the words back; only a wrong one does", () => {
    const yes = decode('{"t":"v","k":1,"p":"a","id":1,"r":"yes","text":"cat"}') as Extract<Msg, { t: "v" }>;
    expect(yes.text).toBeUndefined();
  });

  it("refuses to send a message past its own limit, well under the relay's 64 KiB", () => {
    expect(MAX_MESSAGE).toBeLessThan(65_536);
    expect(() => encode({ t: "snap", to: "a", k: 1, ops: [{ s: 1, c: 0, w: 0, q: [[0, Array(30_000).fill(1)]] }] })).toThrow(RangeError);
  });
});

describe("strokes on the wire", () => {
  it("points go as steps from the one before, and come back the same", () => {
    const pts = [100, 100, 103, 98, 110, 90, 110, 90, 0, 1000];
    expect(packPoints(pts)).toEqual([100, 100, 3, -2, 7, -8, 0, 0, -110, 910]);
    expect(unpackPoints(packPoints(pts))).toEqual(pts);
  });

  it("a point a peer puts off the board is brought back onto it", () => {
    expect(unpackPoints([990, 5, 50, -20])).toEqual([990, 5, 1000, 0]);
  });

  it("a stroke every 50 ms from every player in a full room stays far under the relay's limits", () => {
    // 3 points a piece (a quick finger), 20 pieces a second.
    const piece = encode({ t: "d", k: 12, s: 140, q: 33, c: 3, w: 1, p: packPoints([512, 512, 530, 518, 549, 530]) });
    expect(piece.length).toBeLessThan(100);
    expect(piece.length * 20).toBeLessThan(65_536 / 16);
  });

  it("a whole turn's drawing reaches a late joiner in messages that fit, and merges into what they already have", () => {
    let sk = emptySketch();
    for (let s = 1; s <= 120; s++) {
      for (let q = 0; q < 10; q++) {
        const pts = Array.from({ length: 30 }, (_, i) => ((s * 37 + q * 11 + i * 7) % 1000) | 0);
        sk = addPiece(sk, { s: s * 2, q, c: s % 8, w: s % 3, pts, end: q === 9 });
      }
      if (s === 60) sk = addClear(sk, s * 2 + 1);
    }
    const batches = toWire(sk);
    expect(batches.length).toBeGreaterThan(1);
    for (const ops of batches) expect(encode({ t: "snap", to: "abc", k: 1, ops }).length).toBeLessThanOrEqual(MAX_MESSAGE);
    // The joiner had a piece of the last stroke live already: nothing doubles.
    let theirs = addPiece(emptySketch(), { s: 240, q: 9, c: 0, w: 0, pts: pointsOf(visible(sk).at(-1)!).slice(-30) });
    for (const ops of batches) theirs = fromWire(theirs, decode(encode({ t: "snap", to: "abc", k: 1, ops }))!.t === "snap" ? ops : []);
    expect(visible(theirs).map(pointsOf)).toEqual(visible(sk).map(pointsOf));
  });
});
