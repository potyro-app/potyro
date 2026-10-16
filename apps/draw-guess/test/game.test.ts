import { describe, expect, it } from "vitest";
import * as G from "../game.js";

const T0 = 1_000_000;

function lobby(...names: string[]): G.Game {
  let g = G.newGame({ p: "pa", m: "ma", name: names[0] ?? "Ana" }, "en");
  names.slice(1).forEach((n, i) => (g = G.join(g, { p: `p${i}`, m: `m${i}`, name: n })));
  return g;
}

describe("the lobby", () => {
  it("starts with the host alone, and needs two to start", () => {
    const g = lobby("Ana");
    expect(g.phase).toBe("lobby");
    expect(G.canStart(g)).toBe(false);
    expect(G.start(g, T0)).toBe(g);
    expect(G.canStart(lobby("Ana", "Bo"))).toBe(true);
  });

  it("someone coming back keeps their player and score; their new connection replaces the old", () => {
    let g = G.start(lobby("Ana", "Bo", "Cy"), T0);
    g = { ...g, players: g.players.map((p) => (p.name === "Bo" ? { ...p, score: 70 } : p)) };
    g = G.drop(g, "m0", T0);
    expect(G.playerOf(g, "p0")).toMatchObject({ m: null, score: 70 });
    g = G.join(g, { p: "p0", m: "m9", name: "Bo" });
    expect(G.playerOf(g, "p0")).toMatchObject({ m: "m9", score: 70 });
    expect(g.players).toHaveLength(3);
  });

  it("cleans names and ignores settings out of range", () => {
    const g = G.join(lobby("Ana"), { p: "x", m: "mx", name: "  Bo \n  the   Great and Powerful Wizard of Oz " });
    expect(G.playerOf(g, "x")!.name).toBe("Bo the Great and Powerfu");
    expect(G.settings(g, { rounds: 9, seconds: 15 })).toBe(g);
    expect(G.settings(g, { rounds: 2, seconds: 60, lang: "pl" })).toMatchObject({ rounds: 2, seconds: 60, lang: "pl" });
  });
});

describe("turns and rounds", () => {
  it("every player present draws once a round, in the order they came, then the game ends", () => {
    let g = G.settings(lobby("Ana", "Bo", "Cy"), { rounds: 2 });
    g = G.start(g, T0);
    const drawers: string[] = [];
    let now = T0;
    while (g.phase !== "final") {
      expect(g.phase).toBe("pick");
      drawers.push(G.playerOf(g, g.drawer)!.name);
      g = G.drawing(g, g.turn, "___", now);
      now += 10_000;
      g = G.endTurn(g, g.turn, { word: "cat", by: null, left: 0, why: "time" }, now);
      now += G.REVEAL_MS;
      g = G.tick(g, now);
    }
    expect(drawers).toEqual(["Ana", "Bo", "Cy", "Ana", "Bo", "Cy"]);
    expect(g.round).toBe(2);
  });

  it("a right guess pays the guesser 50–100 by the time left, and the drawer half", () => {
    let g = G.start(lobby("Ana", "Bo", "Cy"), T0);
    g = G.drawing(g, g.turn, "___", T0);
    g = G.endTurn(g, g.turn, { word: "cat", by: "p1", left: 0.8, why: "guessed", row: 0 }, T0 + 16_000);
    expect(g.last).toEqual({ word: "cat", by: "p1", gained: { p1: 90, pa: 45 }, why: "guessed", drawer: "pa" });
    expect(G.standings(g).map((p) => [p.name, p.score])).toEqual([
      ["Cy", 90],
      ["Ana", 45],
      ["Bo", 0],
    ]);
    expect(g.used).toEqual([0]);
    expect(G.guesserPoints(0)).toBe(50);
    expect(G.guesserPoints(1)).toBe(100);
    expect(G.drawerPoints(1)).toBe(50);
  });

  it("the drawer cannot pay themselves, and an old turn's end changes nothing", () => {
    let g = G.start(lobby("Ana", "Bo"), T0);
    g = G.drawing(g, g.turn, "___", T0);
    const selfPaid = G.endTurn(g, g.turn, { word: "cat", by: "pa", left: 1, why: "guessed" }, T0);
    expect(selfPaid.last?.gained).toEqual({});
    expect(G.endTurn(g, g.turn - 1, { word: "cat", by: "p0", left: 1, why: "guessed" }, T0)).toBe(g);
  });

  it("the host's clock: a drawer who never picks is skipped; one who goes quiet past the end is timed out", () => {
    let g = G.start(lobby("Ana", "Bo"), T0);
    expect(G.nextDeadline(g)).toBe(T0 + G.PICK_MS);
    expect(G.tick(g, T0 + G.PICK_MS - 1)).toBe(g);
    const skipped = G.tick(g, T0 + G.PICK_MS);
    expect(skipped.last).toMatchObject({ why: "skipped", word: null });
    g = G.drawing(g, g.turn, "___", T0 + 1_000);
    const end = T0 + 1_000 + g.seconds * 1000;
    expect(G.tick(g, end)).toBe(g); // the drawer's own clock says first
    expect(G.tick(g, end + G.GRACE_MS).last).toMatchObject({ why: "time" });
  });

  it("hints are the same length as the blanks, in the turn they belong to", () => {
    let g = G.start(lobby("Ana", "Bo"), T0);
    g = G.drawing(g, g.turn, "_____", T0);
    expect(G.hint(g, g.turn, "__a__").mask).toBe("__a__");
    expect(G.hint(g, g.turn, "___")).toBe(g);
    expect(G.hint(g, g.turn + 1, "__a__")).toBe(g);
  });
});

describe("leaving", () => {
  it("the drawer leaving ends their turn; the others play on", () => {
    let g = G.start(lobby("Ana", "Bo", "Cy"), T0);
    g = G.drawing(g, g.turn, "___", T0);
    g = G.drop(g, "ma", T0 + 5);
    expect(g.phase).toBe("reveal");
    expect(g.last).toMatchObject({ why: "left", drawer: "pa", word: null });
    g = G.tick(g, T0 + 5 + G.REVEAL_MS);
    expect(G.playerOf(g, g.drawer)!.name).toBe("Bo");
  });

  it("with one player left mid-game, the game is over", () => {
    let g = G.start(lobby("Ana", "Bo"), T0);
    g = G.drawing(g, g.turn, "___", T0);
    g = G.drop(g, "m0", T0); // Bo, a guesser
    expect(g.phase).toBe("final");
  });

  it("a new host takes over from the snapshot: everyone gone in between is dropped, scores kept", () => {
    let g = G.start(lobby("Ana", "Bo", "Cy"), T0);
    g = G.drawing(g, g.turn, "___", T0);
    g = G.endTurn(g, g.turn, { word: "cat", by: "p1", left: 0.5, why: "guessed" }, T0);
    const before = g.v;
    const next = G.takeOver(g, ["m0", "m1"], T0 + 10);
    expect(next.v).toBeGreaterThan(before);
    expect(G.playerOf(next, "pa")!.m).toBeNull();
    expect(G.standings(next).map((p) => p.score)).toEqual([75, 38, 0]);
    expect(next.phase).toBe("reveal");
  });

  it("play again: back to the lobby with whoever is still here, all at zero", () => {
    let g = G.start(lobby("Ana", "Bo", "Cy"), T0);
    g = G.drop(g, "m1", T0);
    g = G.finish(g);
    g = G.again(g);
    expect(g.phase).toBe("lobby");
    expect(g.players.map((p) => [p.name, p.score])).toEqual([
      ["Ana", 0],
      ["Bo", 0],
    ]);
  });
});
