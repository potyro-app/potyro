import { describe, expect, it } from "vitest";
import { CLOSE, CLOSE_REASON, ROOM_ID, SERVER_PREFIX, cleanName, isServerEvent, newRoomId, readServerEvent } from "../src/protocol.ts";
import { Bucket } from "../src/bucket.ts";

describe("room ids", () => {
  it("makes 22 characters of base64url, different each time, that the relay accepts", () => {
    const ids = new Set(Array.from({ length: 200 }, newRoomId));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(ROOM_ID.test(id)).toBe(true);
    }
  });

  it("accepts 22–64 base64url characters and nothing else", () => {
    expect(ROOM_ID.test("a".repeat(21))).toBe(false);
    expect(ROOM_ID.test("a".repeat(22))).toBe(true);
    expect(ROOM_ID.test("a".repeat(64))).toBe(true);
    expect(ROOM_ID.test("a".repeat(65))).toBe(false);
    expect(ROOM_ID.test("a".repeat(21) + "/")).toBe(false);
    expect(ROOM_ID.test("a".repeat(21) + "=")).toBe(false);
    expect(ROOM_ID.test("health")).toBe(false);
  });
});

describe("telling server events from peer messages", () => {
  it("is a prefix test on text frames", () => {
    expect(isServerEvent(`${SERVER_PREFIX}1,"type":"join","member":{"id":"a","name":""}}`)).toBe(true);
    expect(isServerEvent(' {"potyro-rooms":1}')).toBe(false);
    expect(isServerEvent('{ "potyro-rooms":1}')).toBe(false);
    expect(isServerEvent(new TextEncoder().encode(SERVER_PREFIX))).toBe(false);
    expect(isServerEvent(null)).toBe(false);
  });

  it("reads the event, or null for anything else", () => {
    expect(readServerEvent('{"potyro-rooms":1,"type":"leave","member":{"id":"a","name":"A"}}')).toEqual({
      "potyro-rooms": 1,
      type: "leave",
      member: { id: "a", name: "A" },
    });
    expect(readServerEvent('{"stroke":1}')).toBeNull();
    expect(readServerEvent('{"potyro-rooms":broken')).toBeNull();
  });
});

describe("names", () => {
  it("drops control and direction characters, collapses whitespace and caps the length", () => {
    expect(cleanName("  Ana\u0000 \u202eMaria\t\n ")).toBe("Ana Maria");
    expect(cleanName("Ana\nMaria")).toBe("Ana Maria");
    expect(cleanName(null)).toBe("");
    expect(Array.from(cleanName("😀".repeat(50)))).toHaveLength(40);
  });
});

describe("close codes", () => {
  it("has a reason for every code the relay sends itself, each within the protocol's 123 bytes", () => {
    for (const code of Object.values(CLOSE)) {
      if (code === CLOSE.tooBig) continue; // sent by ws
      expect(CLOSE_REASON[code]).toBeTruthy();
      expect(new TextEncoder().encode(CLOSE_REASON[code]).length).toBeLessThanOrEqual(123);
    }
  });
});

describe("the rate bucket", () => {
  it("allows the burst at once, then the rate", () => {
    const b = new Bucket(10, 5, 0);
    for (let i = 0; i < 5; i++) expect(b.take(1, 0)).toBe(true);
    expect(b.take(1, 0)).toBe(false);
    expect(b.take(1, 100)).toBe(true); // 100 ms at 10/s is one more
    expect(b.take(1, 100)).toBe(false);
  });

  it("never refills past the burst", () => {
    const b = new Bucket(10, 3, 0);
    expect(b.take(3, 60_000)).toBe(true);
    expect(b.take(1, 60_000)).toBe(false);
  });

  it("refuses a single take bigger than the burst", () => {
    const b = new Bucket(1000, 100, 0);
    expect(b.take(101, 0)).toBe(false);
  });
});
