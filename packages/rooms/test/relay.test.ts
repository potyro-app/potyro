import { afterEach, describe, expect, it } from "vitest";
import { cleanup, connect, join, newRoomId, relay, silent } from "./helpers.ts";
import { CLOSE, ROOM_LIMITS, isServerEvent } from "../src/protocol.ts";

afterEach(cleanup);

describe("relaying", () => {
  it("sends a member's text frame as-is to every other member, and not back to the sender", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    const c = await join(url(room));
    await a.nextEvent(); // b joined
    await a.nextEvent(); // c joined
    await b.nextEvent(); // c joined

    a.ws.send('{"stroke":[1,2,3]}');
    expect(await b.next()).toEqual({ data: '{"stroke":[1,2,3]}', binary: false });
    expect(await c.next()).toEqual({ data: '{"stroke":[1,2,3]}', binary: false });
    expect(await silent(a)).toBe(true);
  });

  it("keeps binary frames binary and byte-identical", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    const bytes = Buffer.from([0, 255, 1, 254, 0x7b, 0x22]);
    a.ws.send(bytes);
    const got = await b.next();
    expect(got.binary).toBe(true);
    expect(Buffer.compare(got.data as Buffer, bytes)).toBe(0);
  });

  it("keeps messages in order", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    for (let i = 0; i < 20; i++) a.ws.send(String(i));
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) seen.push((await b.next()).data as string);
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
  });

  it("keeps rooms apart", async () => {
    const { url } = await relay();
    const one = newRoomId();
    const two = newRoomId();
    const a = await join(url(one));
    const b = await join(url(one));
    const x = await join(url(two));
    const y = await join(url(two));
    await a.nextEvent();
    await x.nextEvent();
    expect(x.welcome.members).toEqual([]);
    a.ws.send("for room one");
    expect((await b.next()).data).toBe("for room one");
    expect(await silent(x)).toBe(true);
    expect(await silent(y)).toBe(true);
  });

  it("relays a text frame that merely looks like an event, and an app can still tell it apart", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    const lookalike = '{ "potyro-rooms":1,"type":"leave","member":{"id":"x","name":"y"}}';
    a.ws.send(lookalike);
    const got = await b.next();
    expect(got.data).toBe(lookalike);
    expect(isServerEvent(got.data)).toBe(false);
  });

  it("relays a binary frame that starts with the reserved bytes: only text frames are events", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    a.ws.send(Buffer.from('{"potyro-rooms":1,"type":"leave"}'));
    const got = await b.next();
    expect(got.binary).toBe(true);
    expect(a.ws.readyState).toBe(a.ws.OPEN);
  });
});

describe("presence", () => {
  it("welcomes a newcomer with itself, everyone else oldest first, and the limits", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room, "?name=Ana"));
    const b = await join(url(room, "?name=Bo"));
    const c = await join(url(room, "?name=Cy"));

    expect(a.welcome).toMatchObject({ "potyro-rooms": 1, type: "welcome", room, you: { name: "Ana" }, members: [] });
    expect(c.welcome.members).toEqual([a.welcome.you, b.welcome.you]);
    expect(c.welcome.you.name).toBe("Cy");
    expect(c.welcome.limits).toEqual({
      messageBytes: ROOM_LIMITS.messageBytes,
      membersPerRoom: ROOM_LIMITS.membersPerRoom,
      messagesPerSecond: ROOM_LIMITS.messagesPerSecond,
      bytesPerSecond: ROOM_LIMITS.bytesPerSecond,
      idleMs: ROOM_LIMITS.idleMs,
    });
    const ids = new Set([a.welcome.you.id, b.welcome.you.id, c.welcome.you.id]);
    expect(ids.size).toBe(3);
  });

  it("tells the others when someone joins and when they leave", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room, "?name=Ana"));
    const b = await join(url(room, "?name=Bo"));
    expect(await a.nextEvent()).toEqual({ "potyro-rooms": 1, type: "join", member: b.welcome.you });
    b.ws.close();
    expect(await a.nextEvent()).toEqual({ "potyro-rooms": 1, type: "leave", member: b.welcome.you });
  });

  it("starts every server frame with the exact prefix, so isServerEvent is the whole test", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await connect(url(room));
    const first = await a.next();
    expect(first.binary).toBe(false);
    expect((first.data as string).startsWith('{"potyro-rooms":1,')).toBe(true);
    expect(isServerEvent(first.data)).toBe(true);
  });

  it("cleans the display name and allows none", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room, `?name=${encodeURIComponent("  Ana\u0000\u202e\n  Maria  " + "x".repeat(80))}`));
    expect(a.welcome.you.name.startsWith("Ana Maria x")).toBe(true);
    expect(Array.from(a.welcome.you.name)).toHaveLength(40);
    const b = await join(url(room));
    expect(b.welcome.you.name).toBe("");
  });
});

describe("refusals", () => {
  it.each([
    ["too short", "abc"],
    ["bad characters", "a".repeat(21) + "!"],
    ["too long", "a".repeat(65)],
  ])("closes a room id that is %s with 4001", async (_what, id) => {
    const { url } = await relay();
    const c = await connect(url(encodeURIComponent(id)));
    expect(await c.closed).toEqual({ code: CLOSE.badRoomId, reason: "bad room id" });
  });

  it("closes a path that is not /rooms/<id> with 4001", async () => {
    const { port } = await relay();
    const c = await connect(`ws://127.0.0.1:${port}/elsewhere/${newRoomId()}/more`);
    expect((await c.closed).code).toBe(CLOSE.badRoomId);
  });

  it("accepts the id without the /rooms prefix, as a proxy that strips it would pass it", async () => {
    const { port } = await relay();
    const c = await join(`ws://127.0.0.1:${port}/${newRoomId()}`);
    expect(c.welcome.type).toBe("welcome");
  });

  it("refuses an origin not on the list with HTTP 403, and allows one that is, or none", async () => {
    const { url } = await relay({ origins: ["https://potyro.app", "https://localhost"] });
    const room = newRoomId();
    await expect(connect(url(room), { origin: "https://evil.example" })).rejects.toThrow("HTTP 403");
    await expect(join(url(room), { origin: "https://localhost" })).resolves.toBeTruthy();
    await expect(join(url(room), {})).resolves.toBeTruthy();
  });

  it("allows any origin when configured with *", async () => {
    const { url } = await relay({ origins: "*" });
    await expect(join(url(newRoomId()), { origin: "https://anything.example" })).resolves.toBeTruthy();
  });

  it("closes the member past membersPerRoom with 4002, and the room still works", async () => {
    const { url } = await relay({ limits: { membersPerRoom: 2 } });
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    const c = await connect(url(room));
    expect(await c.closed).toEqual({ code: CLOSE.roomFull, reason: "room full" });
    expect(await silent(a)).toBe(true); // no join or leave for someone who never got in
    b.ws.send("still here");
    expect((await a.next()).data).toBe("still here");
  });

  it("closes an address past roomsPerAddress with 4003, counting the proxy's own (last) X-Forwarded-For entry", async () => {
    const { url } = await relay({ limits: { roomsPerAddress: 2 } });
    const as = (first: string) => ({ origin: "https://potyro.app", "x-forwarded-for": `${first}, 203.0.113.7` });
    await join(url(newRoomId()), as("1.1.1.1"));
    const second = newRoomId();
    await join(url(second), as("2.2.2.2"));
    await join(url(second), as("3.3.3.3")); // the same room again is not another room
    const third = await connect(url(newRoomId()), as("4.4.4.4"));
    expect(await third.closed).toEqual({ code: CLOSE.tooManyRooms, reason: "too many rooms from this address" });
    // another address is not affected
    await expect(join(url(newRoomId()), { origin: "https://potyro.app", "x-forwarded-for": "203.0.113.7, 198.51.100.1" })).resolves.toBeTruthy();
  });

  it("closes an address past connectionsPerAddress with 4003", async () => {
    const { url } = await relay({ limits: { connectionsPerAddress: 2 } });
    const room = newRoomId();
    await join(url(room));
    await join(url(room));
    const third = await connect(url(room));
    expect((await third.closed).code).toBe(CLOSE.tooManyRooms);
  });

  it("frees an address's rooms when it leaves them", async () => {
    const { url } = await relay({ limits: { roomsPerAddress: 1 } });
    const a = await join(url(newRoomId()));
    a.ws.close();
    await a.closed;
    await expect(join(url(newRoomId()))).resolves.toBeTruthy();
  });

  it("closes a message over messageBytes with 1009 and relays none of it", async () => {
    const { url } = await relay({ limits: { messageBytes: 1024 } });
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    a.ws.send("x".repeat(1024)); // exactly the limit is fine
    expect(((await b.next()).data as string).length).toBe(1024);
    a.ws.send(Buffer.alloc(1025));
    expect((await a.closed).code).toBe(CLOSE.tooBig);
    expect(await b.nextEvent()).toMatchObject({ type: "leave", member: a.welcome.you });
    expect(b.pending()).toEqual([]);
  });

  it("closes a member over messagesPerSecond with 4004, after relaying what fit in the burst", async () => {
    const { url } = await relay({ limits: { messagesPerSecond: 5, messageBurst: 5 } });
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    for (let i = 0; i < 12; i++) a.ws.send(`m${i}`);
    expect(await a.closed).toEqual({ code: CLOSE.tooFast, reason: "too many messages" });
    const got: string[] = [];
    for (;;) {
      const f = await b.next();
      if (isServerEvent(f.data)) break; // the leave
      got.push(String(f.data));
    }
    expect(got).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });

  it("closes a member over bytesPerSecond with 4004", async () => {
    const { url } = await relay({ limits: { bytesPerSecond: 1000, byteBurst: 2000 } });
    const room = newRoomId();
    const a = await join(url(room));
    await join(url(room));
    await a.nextEvent();
    for (let i = 0; i < 3; i++) a.ws.send(Buffer.alloc(900));
    expect((await a.closed).code).toBe(CLOSE.tooFast);
  });

  it("lets a steady sender under the rate go on", async () => {
    const { url } = await relay({ limits: { messagesPerSecond: 50, messageBurst: 5 } });
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    for (let i = 0; i < 10; i++) {
      a.ws.send(`m${i}`);
      await new Promise((r) => setTimeout(r, 40));
    }
    for (let i = 0; i < 10; i++) expect((await b.next()).data).toBe(`m${i}`);
    expect(a.ws.readyState).toBe(a.ws.OPEN);
  });

  it("closes a member's text frame that starts with the reserved prefix with 4005 and relays nothing", async () => {
    const { url } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await a.nextEvent();
    a.ws.send('{"potyro-rooms":1,"type":"leave","member":{"id":"forged","name":""}}');
    expect(await a.closed).toEqual({ code: CLOSE.reservedPrefix, reason: "reserved prefix" });
    expect(await b.nextEvent()).toEqual({ "potyro-rooms": 1, type: "leave", member: a.welcome.you });
  });

  it("closes newcomers with 1013 when the relay is at its connection or room limit", async () => {
    const { url } = await relay({ limits: { connections: 2, rooms: 1 } });
    const room = newRoomId();
    await join(url(room));
    const other = await connect(url(newRoomId()));
    expect(await other.closed).toEqual({ code: CLOSE.busy, reason: "relay busy, try again later" });
    await join(url(room));
    const third = await connect(url(room));
    expect((await third.closed).code).toBe(CLOSE.busy);
  });

  it("closes a member that cannot keep up with 4006 instead of queueing for it", async () => {
    const { url } = await relay({
      limits: { bufferedBytes: 256 * 1024, bytesPerSecond: 1e9, byteBurst: 1e9, messagesPerSecond: 1e6, messageBurst: 1e6 },
    });
    const room = newRoomId();
    const a = await join(url(room));
    const slow = await join(url(room));
    const watcher = await join(url(room));
    await a.nextEvent();
    await a.nextEvent();
    await slow.nextEvent();
    // Stop reading: the kernel's buffers fill, then the relay's queue for this member grows.
    (slow.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    const chunk = Buffer.alloc(60 * 1024);
    let left = false;
    void (async () => {
      // The watcher gets the chunks too; it is waiting for the slow member's leave among them.
      for (;;) {
        const f = await watcher.next(20_000);
        if (isServerEvent(f.data)) return void (left = (JSON.parse(f.data) as { member: { id: string } }).member.id === slow.welcome.you.id);
      }
    })();
    for (let i = 0; i < 2000 && !left; i++) {
      a.ws.send(chunk);
      if (i % 20 === 0) await new Promise((r) => setTimeout(r, 5));
    }
    await expect.poll(() => left, { timeout: 10_000 }).toBe(true);
    // The fast sender is not penalised for the slow one.
    expect(a.ws.readyState).toBe(a.ws.OPEN);
    (slow.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    expect((await slow.closed).code).toBe(CLOSE.tooSlow);
  }, 30_000);
});

describe("lifetime", () => {
  it("forgets a room when its last member leaves", async () => {
    const { url, relay: r } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    expect(r.stats()).toEqual({ rooms: 1, connections: 2 });
    a.ws.close();
    b.ws.close();
    await a.closed;
    await b.closed;
    await expect.poll(() => r.stats()).toEqual({ rooms: 0, connections: 0 });
    const again = await join(url(room));
    expect(again.welcome.members).toEqual([]);
  });

  it("closes a room nobody has sent anything in for idleMs with 4007", async () => {
    const { url } = await relay({ limits: { idleMs: 300 } });
    const quiet = newRoomId();
    const busy = newRoomId();
    const a = await join(url(quiet));
    const b = await join(url(quiet));
    const x = await join(url(busy));
    const timer = setInterval(() => x.ws.send("tick"), 50);
    try {
      expect(await a.closed).toEqual({ code: CLOSE.idle, reason: "room idle" });
      expect((await b.closed).code).toBe(CLOSE.idle);
      expect(x.ws.readyState).toBe(x.ws.OPEN);
    } finally {
      clearInterval(timer);
    }
  });

  it("pings members, and drops one that stops answering", async () => {
    const { url } = await relay({ limits: { pingMs: 100 } });
    const room = newRoomId();
    const a = await join(url(room));
    let pings = 0;
    a.ws.on("ping", () => pings++);
    // A client that does not answer pings: ws answers them unless told not to.
    const deaf = await connect(url(room), { origin: "https://potyro.app" }, { autoPong: false });
    const welcome = await deaf.nextEvent();
    expect(welcome.type).toBe("welcome");
    await a.nextEvent(); // its join
    const leave = await a.nextEvent(2000);
    expect(leave).toMatchObject({ type: "leave" });
    expect(pings).toBeGreaterThan(0);
    expect(a.ws.readyState).toBe(a.ws.OPEN);
  });

  it("closes every member with 1001 when it shuts down", async () => {
    const { url, relay: r } = await relay();
    const room = newRoomId();
    const a = await join(url(room));
    const b = await join(url(room));
    await r.close();
    expect(await a.closed).toEqual({ code: CLOSE.goingAway, reason: "relay restarting" });
    expect((await b.closed).code).toBe(CLOSE.goingAway);
  });
});

describe("the HTTP side", () => {
  it("answers health on /rooms/health and /health, and nothing else", async () => {
    const { port } = await relay();
    for (const path of ["/rooms/health", "/health"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true, rooms: 0, connections: 0 });
    }
    expect((await fetch(`http://127.0.0.1:${port}/rooms/${newRoomId()}`)).status).toBe(426);
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
  });
});
