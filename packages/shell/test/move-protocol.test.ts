// The hand-over between two windows (move-protocol.ts), and above all what the receiving side
// refuses: a hostile page that opens Potyro, frames it, or talks to it out of turn must not get
// anything in — not even the offer screen — and the archive comes only after the person said yes.

import { describe, expect, it } from "vitest";
import { acceptReply, envelope, isChannel, newChannel, readMessage, receive, type ReceiverState } from "../src/move-protocol.js";
import { MOVE_FORMAT, offerOf, type MoveManifest } from "../src/move-archive.js";

const OLD = "https://apps.vaz.io";
const NEW = "https://potyro.app";
const env = { dev: false };
const channel = newChannel();

const manifest: MoveManifest = {
  format: MOVE_FORMAT,
  from: OLD,
  createdAt: "2026-10-16T00:00:00.000Z",
  apps: [{ id: "notes", name: "Notes", source: "// n", trusted: true, wasShared: false, entities: ["note"], records: 2, files: 1, missingFiles: 0 }],
  shared: {},
  conversations: 0,
  prefs: {},
};
const DIGEST = "a".repeat(64);
const offer = envelope(channel, { step: "offer", offer: offerOf(manifest), digest: DIGEST, size: 10 });
const archive = envelope(channel, { step: "archive", bytes: new ArrayBuffer(4), digest: DIGEST });
const start: ReceiverState = { phase: "waiting", channel };
const from = (origin: string, data: unknown, fromOpener = true) => ({ origin, fromOpener, data });

describe("channels", () => {
  it("are 128 random bits, and only that shape is one", () => {
    expect(isChannel(channel)).toBe(true);
    expect(newChannel()).not.toBe(channel);
    expect(isChannel("x".repeat(32))).toBe(false);
    expect(isChannel(undefined)).toBe(false);
  });
});

describe("the new site receiving", () => {
  it("shows an offer from the Potyro that opened it, and pins that origin", () => {
    const d = receive(start, from(OLD, offer), NEW, env);
    expect(d.accept).toBe(true);
    if (d.accept) expect(d.state).toMatchObject({ phase: "offered", peer: OLD });
  });

  it("ignores a hostile origin, even one that opened the window", () => {
    expect(receive(start, from("https://evil.test", offer), NEW, env)).toEqual({ accept: false, reason: "not-potyro" });
    expect(receive(start, from("https://potyro.app.evil.test", offer), NEW, env)).toMatchObject({ accept: false });
  });

  it("ignores any window but its opener — a frame, a sibling, itself", () => {
    expect(receive(start, from(OLD, offer, false), NEW, env)).toEqual({ accept: false, reason: "not-opener" });
    expect(receive(start, from(NEW, offer), NEW, env)).toEqual({ accept: false, reason: "own-origin" });
  });

  it("ignores another channel and anything that is not a move message", () => {
    expect(receive(start, from(OLD, envelope(newChannel(), { step: "hello" })), NEW, env)).toEqual({ accept: false, reason: "not-ours" });
    expect(receive(start, from(OLD, { ...offer, v: 2 }), NEW, env)).toMatchObject({ accept: false, reason: "not-ours" });
    expect(receive(start, from(OLD, "hello"), NEW, env)).toMatchObject({ accept: false, reason: "not-ours" });
  });

  it("refuses an offer that would smuggle in who you are", () => {
    const sneaky = { ...offer, offer: { ...offerOf(manifest), manifest: { ...manifest, identity: { id: "co_zX", name: "x", secret: "sealerSecret_z" } } } };
    expect(receive(start, from(OLD, sneaky), NEW, env)).toMatchObject({ accept: false, reason: "not-ours" });
  });

  it("takes no archive before the person confirms, and none from anyone else after", () => {
    const offered = receive(start, from(OLD, offer), NEW, env);
    if (!offered.accept) throw new Error("offer refused");
    // Pushed before confirming: refused.
    expect(receive(offered.state, from(OLD, archive), NEW, env)).toEqual({ accept: false, reason: "out-of-turn" });
    // Another Potyro origin trying to answer in its place: refused.
    const confirmed: ReceiverState = { ...offered.state, phase: "confirmed" };
    expect(receive(confirmed, from("https://potyro.app", archive), "https://other.example", env)).toEqual({ accept: false, reason: "other-peer" });
    // A second offer cannot replace the first.
    expect(receive(offered.state, from(OLD, offer), NEW, env)).toEqual({ accept: false, reason: "out-of-turn" });
    // An archive that is not the one offered: refused.
    const other = envelope(channel, { step: "archive", bytes: new ArrayBuffer(4), digest: "b".repeat(64) });
    expect(receive(confirmed, from(OLD, other), NEW, env)).toEqual({ accept: false, reason: "out-of-turn" });
    // The one offered, from the one that offered it, after yes: taken.
    expect(receive(confirmed, from(OLD, archive), NEW, env)).toMatchObject({ accept: true, state: { phase: "importing" } });
  });

  it("does not take an archive that is not bytes", () => {
    expect(readMessage({ ...archive, bytes: "AAAA" }, channel)).toBeNull();
  });
});

describe("the old site listening", () => {
  it("hears only the window it opened, at the new home's exact origin", () => {
    const hello = envelope(channel, { step: "hello" });
    expect(acceptReply({ origin: NEW, fromChild: true, data: hello }, channel, NEW)).toEqual({ step: "hello" });
    expect(acceptReply({ origin: "https://evil.test", fromChild: true, data: hello }, channel, NEW)).toBeNull();
    expect(acceptReply({ origin: NEW, fromChild: false, data: hello }, channel, NEW)).toBeNull();
    expect(acceptReply({ origin: NEW, fromChild: true, data: envelope(newChannel(), { step: "send" }) }, channel, NEW)).toBeNull();
    // The new site never sends an archive or an offer; the old site does not take one.
    expect(acceptReply({ origin: NEW, fromChild: true, data: offer }, channel, NEW)).toBeNull();
  });
});
