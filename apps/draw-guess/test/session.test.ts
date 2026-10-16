import { describe, expect, it } from "vitest";
import { Session } from "../session.js";
import { visible, pointsOf } from "../sketch.js";
import { roomIdFor } from "../code.js";
import { wordAt, seeded } from "../words.js";
import { PICK_MS, REVEAL_MS, GRACE_MS } from "../game.js";
import { FakeClock, FakeRelay } from "./fake-room.js";

// Whole games over an in-memory relay: three devices, each its own Session, exactly as the app wires
// them, with time moved by hand.

const CODE = "KQ7MXR4P2DHC";

function table() {
  const relay = new FakeRelay();
  const clock = new FakeClock(relay);
  let n = 0;
  const seat = (name: string, seed: number) => new Session(CODE, name, { open: relay.open, clock, random: seeded(seed), newId: () => `p${++n}-${name}` });
  return { relay, clock, seat };
}

async function settle(relay: FakeRelay): Promise<void> {
  // `connect` awaits the open; let those promises run, then drain the room.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    relay.run();
  }
}

async function threeInARoom() {
  const t = table();
  const ana = t.seat("Ana", 1);
  const bo = t.seat("Bo", 2);
  const cy = t.seat("Cy", 3);
  await ana.connect(true);
  await settle(t.relay);
  await bo.connect(false);
  await settle(t.relay);
  await cy.connect(false);
  await settle(t.relay);
  return { ...t, ana, bo, cy };
}

const names = (s: Session) => s.game!.players.map((p) => `${p.name}${p.m ? "" : " (away)"}`);
const scores = (s: Session) => Object.fromEntries(s.game!.players.map((p) => [p.name, p.score]));

/** The drawer picks the first word and draws a short line. Returns the word. */
function drawALine(drawer: Session, t: ReturnType<typeof table>): string {
  drawer.choose(0);
  t.relay.run();
  drawer.penDown(1, 1, 100, 100);
  drawer.penMove([
    [150, 120],
    [200, 160],
  ]);
  t.clock.advance(60);
  drawer.penMove([[260, 220]]);
  drawer.penUp();
  t.relay.run();
  return drawer.mine!.word!;
}

describe("a room of three", () => {
  it("the first in hosts; everyone sees everyone, in the order they came", async () => {
    const { ana, bo, cy } = await threeInARoom();
    for (const s of [ana, bo, cy]) {
      expect(s.status).toBe("live");
      expect(names(s)).toEqual(["Ana", "Bo", "Cy"]);
      expect(s.hostPlayer).toBe(ana.p);
    }
    expect(ana.isHost).toBe(true);
    expect(bo.isHost || cy.isHost).toBe(false);
  });

  it("joining a code nobody is playing says so, and leaves the relay empty", async () => {
    const t = table();
    const lone = t.seat("Lone", 9);
    await lone.connect(false);
    await settle(t.relay);
    expect(lone.status).toBe("failed");
    expect(lone.problem).toBe("nobody");
    expect(t.relay.count(roomIdFor(CODE))).toBe(0);
  });

  it("a full room is worded as full", async () => {
    // The real relay closes the 17th member with 4002 "room full" before its welcome: room() rejects "refused".
    const full = async (): Promise<never> => {
      throw Object.assign(new Error("room full"), { code: "refused" });
    };
    const late = new Session(CODE, "Late", { open: full, newId: () => "x" });
    await late.connect(false);
    expect(late.status).toBe("failed");
    expect(late.problem).toBe("full");
    const offline = new Session(CODE, "Late", { open: async () => Promise.reject(Object.assign(new Error("x"), { code: "offline" })), newId: () => "y" });
    await offline.connect(true);
    expect(offline.problem).toBe("offline");
  });

  it("plays a turn: the drawing reaches the others, a wrong guess is seen, the right one scores and is never shown", async () => {
    const t = await threeInARoom();
    const { ana, bo, cy, relay, clock } = t;
    ana.start();
    relay.run();
    for (const s of [ana, bo, cy]) expect(s.game!.phase).toBe("pick");
    expect(ana.game!.drawer).toBe(ana.p);
    expect(ana.mine?.choices).toHaveLength(3);
    expect(bo.mine).toBeNull();

    const word = drawALine(ana, t);
    expect(bo.game!.phase).toBe("draw");
    expect(bo.game!.mask).toBe(word.replace(/[\p{L}\p{N}]/gu, "_"));
    // The line, point for point, on both other boards.
    const line = pointsOf(visible(ana.sketch)[0]!);
    expect(line).toEqual([100, 100, 150, 120, 200, 160, 260, 220]);
    for (const s of [bo, cy]) expect(visible(s.sketch).map(pointsOf)).toEqual([line]);

    // A wrong guess: everyone's feed shows it.
    clock.advance(400);
    expect(bo.guess("definitely not it")).toBe(true);
    relay.run();
    for (const s of [ana, bo, cy]) expect(s.feed).toContainEqual({ kind: "guess", p: bo.p, text: "definitely not it" });

    // The right one, typed loosely: Cy scores, Ana (the drawer) scores, nobody's feed has the word.
    clock.advance(10_000);
    const sentBefore = relay.log.length;
    expect(cy.guess(`  ${word.toUpperCase()} `)).toBe(true);
    relay.run();
    for (const s of [ana, bo, cy]) {
      expect(s.feed).toContainEqual({ kind: "got", p: cy.p });
      expect(JSON.stringify(s.feed)).not.toContain(word.toUpperCase());
      expect(s.game!.phase).toBe("reveal");
      expect(s.game!.last).toMatchObject({ word, by: cy.p, why: "guessed" });
    }
    const after = scores(bo);
    expect(after.Cy).toBeGreaterThan(80);
    expect(after.Cy).toBeLessThanOrEqual(100);
    expect(after.Ana).toBe(Math.round(after.Cy! / 2));
    expect(after.Bo).toBe(0);
    // The word went out once the turn was over, in the drawer's `end` — never before.
    const ends = relay.log.slice(sentBefore).filter((m) => m.text.includes('"t":"end"'));
    expect(ends).toHaveLength(1);

    // After the reveal, the next turn is Bo's: the one who came in next.
    clock.advance(REVEAL_MS + 10);
    for (const s of [ana, bo, cy]) expect(s.game!.drawer).toBe(bo.p);
    expect(bo.mine?.choices).toHaveLength(3);
    expect(visible(cy.sketch)).toEqual([]);
  });

  it("never puts the word on the wire before the turn ends: not in a hint, not in a verdict", async () => {
    const t = await threeInARoom();
    const { ana, bo, relay, clock } = t;
    ana.start();
    relay.run();
    const from = relay.log.length;
    const word = drawALine(ana, t);
    clock.advance(30_000); // past the first hints
    bo.guess("nope");
    relay.run();
    clock.advance(400);
    // A guess one letter off is "close": said to Bo only, and the verdict does not repeat it.
    const close = word.length >= 4 ? word.slice(0, -1) + (word.endsWith("z") ? "y" : "z") : null;
    if (close) {
      bo.guess(close);
      relay.run();
    }
    const fromAna = relay.log.slice(from).filter((m) => m.from === ana.me);
    for (const m of fromAna) expect(m.text.toLowerCase()).not.toContain(`"${word.toLowerCase()}"`);
    expect(bo.game!.mask).toMatch(/_/);
    expect(bo.game!.mask).not.toBe(word);
  });

  it("shows hint letters over the turn, and ends it with nobody scoring when time runs out", async () => {
    const t = await threeInARoom();
    const { ana, bo, cy, relay, clock } = t;
    ana.start();
    relay.run();
    // Pick a long word so there are hints.
    const long = ana.mine!.choices.findIndex((row) => wordAt("en", row).replace(/\W/g, "").length > 5);
    ana.choose(Math.max(0, long));
    relay.run();
    const word = ana.mine!.word!;
    const masks = new Set<string>();
    for (let s = 0; s < 80; s++) {
      clock.advance(1000);
      masks.add(bo.game!.mask);
    }
    if (long >= 0) expect(masks.size).toBeGreaterThan(1);
    for (const m of masks) expect(m).not.toBe(word);
    for (const s of [ana, bo, cy]) {
      expect(s.game!.phase).toBe("reveal");
      expect(s.game!.last).toMatchObject({ word, by: null, why: "time" });
    }
    expect(Object.values(scores(cy))).toEqual([0, 0, 0]);
  });

  it("skips a drawer who never chooses (the device picks for them at 12 s)", async () => {
    const t = await threeInARoom();
    const { ana, bo, relay, clock } = t;
    ana.start();
    relay.run();
    clock.advance(PICK_MS - 2_000);
    expect(bo.game!.phase).toBe("draw");
    expect(ana.mine!.row).toBe(ana.mine!.choices[0]);
  });
});

describe("host migration", () => {
  it("when the host leaves, the next oldest carries the game on: scores, turn, clock", async () => {
    const t = await threeInARoom();
    const { ana, bo, cy, relay, clock } = t;
    ana.start();
    relay.run();
    const word = drawALine(ana, t);
    clock.advance(2_000);
    bo.guess(word);
    relay.run();
    clock.advance(REVEAL_MS + 10); // Bo's turn now
    expect(cy.game!.drawer).toBe(bo.p);
    const before = scores(cy);

    ana.leave();
    relay.run();
    expect(bo.isHost).toBe(true);
    for (const s of [bo, cy]) {
      expect(s.hostPlayer).toBe(bo.p);
      expect(names(s)).toEqual(["Ana (away)", "Bo", "Cy"]);
      expect(scores(s)).toEqual(before);
      expect(s.game!.drawer).toBe(bo.p);
    }

    // The game goes on with the new host's clock: Bo draws, Cy guesses, the turn passes to Cy.
    const w2 = drawALine(bo, t);
    clock.advance(1_000);
    cy.guess(w2);
    relay.run();
    expect(cy.game!.phase).toBe("reveal");
    expect(scores(cy).Cy).toBeGreaterThan(before.Cy!);
    clock.advance(REVEAL_MS + 10);
    expect(cy.game!.drawer).toBe(cy.p);
    expect(cy.mine?.choices).toHaveLength(3);
  });

  it("a host who was drawing ends their turn by leaving; the new host moves on", async () => {
    const t = await threeInARoom();
    const { ana, bo, cy, relay, clock } = t;
    ana.start();
    relay.run();
    drawALine(ana, t);
    relay.conn(ana.me).drop();
    relay.run();
    for (const s of [bo, cy]) {
      expect(s.game!.phase).toBe("reveal");
      expect(s.game!.last).toMatchObject({ why: "left", word: null, drawer: ana.p });
    }
    clock.advance(REVEAL_MS + 10);
    expect(cy.game!.drawer).toBe(bo.p);
  });

  it("with fewer than two left, the game ends with the scores it has", async () => {
    const t = await threeInARoom();
    const { ana, bo, cy, relay } = t;
    ana.start();
    relay.run();
    bo.leave();
    relay.run();
    cy.leave();
    relay.run();
    expect(ana.game!.phase === "reveal" || ana.game!.phase === "final").toBe(true);
    t.clock.advance(REVEAL_MS + GRACE_MS);
    expect(ana.game!.phase).toBe("final");
  });
});

describe("late joiners and reconnects", () => {
  it("someone who joins mid-turn gets the drawing so far, then the rest live", async () => {
    const t = await threeInARoom();
    const { ana, relay, clock } = t;
    ana.start();
    relay.run();
    drawALine(ana, t);
    // A long stroke, too: more than one snapshot message's worth would still arrive whole.
    ana.penDown(0, 2, 10, 10);
    for (let i = 0; i < 400; i++) ana.penMove([[10 + ((i * 7) % 900), 10 + ((i * 13) % 900)]]);
    ana.penUp();
    relay.run();
    const dee = t.seat("Dee", 4);
    await dee.connect(false);
    await settle(relay);
    expect(dee.game!.phase).toBe("draw");
    expect(visible(dee.sketch).map(pointsOf)).toEqual(visible(ana.sketch).map(pointsOf));
    // And what comes next arrives live.
    ana.penDown(3, 0, 500, 500);
    ana.penMove([[600, 600]]);
    ana.penUp();
    clock.advance(60);
    expect(visible(dee.sketch)).toHaveLength(3);
    expect(names(ana)).toEqual(["Ana", "Bo", "Cy", "Dee"]);
  });

  it("a player whose connection drops comes back as themselves, with their score", async () => {
    const t = await threeInARoom();
    const { ana, bo, cy, relay, clock } = t;
    ana.start();
    relay.run();
    const word = drawALine(ana, t);
    clock.advance(1_000);
    cy.guess(word);
    relay.run();
    const cyScore = scores(ana).Cy!;
    const oldMember = cy.me;
    relay.conn(cy.me).drop("network");
    relay.run();
    expect(cy.status).toBe("reconnecting");
    expect(names(ana)).toContain("Cy (away)");
    clock.advance(1_100);
    await settle(relay);
    expect(cy.status).toBe("live");
    expect(cy.me).not.toBe(oldMember);
    expect(names(ana)).toEqual(["Ana", "Bo", "Cy"]);
    expect(scores(bo).Cy).toBe(cyScore);
  });

  it("undo and clear reach everyone, and a clear can be undone", async () => {
    const t = await threeInARoom();
    const { ana, bo, relay, clock } = t;
    ana.start();
    relay.run();
    drawALine(ana, t);
    ana.penDown(0, 0, 400, 400);
    ana.penMove([[450, 450]]);
    ana.penUp();
    clock.advance(60);
    expect(visible(bo.sketch)).toHaveLength(2);
    ana.undo();
    relay.run();
    expect(visible(bo.sketch)).toHaveLength(1);
    ana.clear();
    relay.run();
    expect(visible(bo.sketch)).toHaveLength(0);
    ana.undo();
    relay.run();
    expect(visible(bo.sketch)).toHaveLength(1);
  });

  it("is told it was put away when Potyro closes the room, and can rejoin as itself", async () => {
    const t = await threeInARoom();
    const { bo, relay, ana } = t;
    relay.conn(bo.me).drop("hidden");
    relay.run();
    expect(bo.status).toBe("away");
    await bo.rejoin();
    await settle(relay);
    expect(bo.status).toBe("live");
    expect(names(ana)).toEqual(["Ana", "Bo", "Cy"]);
  });
});
