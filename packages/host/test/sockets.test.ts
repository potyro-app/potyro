// `ctx.caps.network.socket` / `.room` mediation (docs/28): the host allow-list, the consent asked once,
// a refusal's code, the per-app limit, the size and buffer limits, closing on leave and when hidden,
// and the rooms envelope — against the in-memory socket server (no network).

import { describe, expect, it } from "vitest";
import { FakeCapabilities, createFakeSockets, type FakeSocketsOptions } from "@potyro/capabilities";
import type { Caps, PermissionManifest, Room, Socket, SocketClose, SocketData } from "potyro";
import { mediateCaps, openSocketsOf, permittedHosts, retireAppSockets, roomsAllowed, socketHostAllowed, SOCKET_LIMITS, type UiBridge } from "../src/index.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await tick(2);
  }
}

interface Setup {
  caps: Caps;
  fake: ReturnType<typeof createFakeSockets>;
  asked: string[];
  owner: object;
  /** Another pass's ctx for the same app: a new `mediateCaps`, the same owner. */
  again(): Caps;
}

function setup(o: { trusted?: boolean; permissions?: PermissionManifest; answer?: boolean | (() => boolean); fake?: FakeSocketsOptions } = {}): Setup {
  const fake = createFakeSockets(o.fake);
  const asked: string[] = [];
  const ui: UiBridge = {
    toast: () => {},
    confirm: async (msg) => {
      asked.push(msg);
      return typeof o.answer === "function" ? o.answer() : (o.answer ?? true);
    },
    prompt: async () => null,
    pick: async () => null,
  };
  const owner = {};
  const platform = new FakeCapabilities({ sockets: fake.cap });
  const make = () => mediateCaps({ caps: platform, provenance: o.trusted ? "trusted" : "untrusted", permissions: o.permissions ?? {}, ui, appName: "Price Board", owner });
  return { caps: make(), fake, asked, owner, again: make };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return String((e as { code?: string }).code ?? `no code: ${(e as Error).message}`);
  }
}

const collect = (s: Socket) => {
  const got: SocketData[] = [];
  const closes: SocketClose[] = [];
  s.onMessage((d) => got.push(d));
  s.onClose((c) => closes.push(c));
  return { got, closes };
};

describe("what a manifest allows", () => {
  it("names hosts for fetch and socket alike; rooms only when it says so", () => {
    const u = (s: string) => new URL(s);
    expect(permittedHosts(undefined)).toEqual([]);
    expect(permittedHosts(true)).toBe("any");
    expect(permittedHosts({})).toBe("any");
    expect(permittedHosts({ rooms: true })).toEqual([]);
    expect(socketHostAllowed({ hosts: ["stream.binance.com"] }, u("wss://stream.binance.com:9443/ws"))).toBe(true);
    expect(socketHostAllowed({ hosts: ["stream.binance.com:443"] }, u("wss://stream.binance.com:9443/ws"))).toBe(false);
    expect(socketHostAllowed({ hosts: ["stream.binance.com"] }, u("wss://evil.example/ws"))).toBe(false);
    expect(socketHostAllowed({ rooms: true }, u("wss://anything.example/"))).toBe(false);
    expect(roomsAllowed({ rooms: true })).toBe(true);
    expect(roomsAllowed({ hosts: ["a.example"] })).toBe(false);
    expect(roomsAllowed(true)).toBe(true);
    expect(roomsAllowed(undefined)).toBe(false);
  });

  it("`{ rooms: true }` alone gives fetch no host at all", async () => {
    const { caps } = setup({ permissions: { network: { rooms: true } } });
    await expect(caps.network!.fetch("https://api.example.test/x")).rejects.toThrow(/Permission denied/);
  });
});

describe("a trusted app", () => {
  it("connects anywhere without a question, and text and bytes go both ways", async () => {
    const { caps, asked, fake } = setup({ trusted: true });
    const s = await caps.network!.socket("wss://echo.test/live");
    expect(s.readyState).toBe("open");
    const { got } = collect(s);
    await s.send("hello");
    await s.send(new Uint8Array([1, 2, 255]));
    await until(() => got.length === 2);
    expect(got[0]).toBe("hello");
    expect(got[1]).toBeInstanceOf(Uint8Array);
    expect(Array.from(got[1] as Uint8Array)).toEqual([1, 2, 255]);
    expect(asked).toEqual([]);
    expect(fake.connections[0]!.received).toEqual(["hello", new Uint8Array([1, 2, 255])]);
  });

  it("holds what arrives before onMessage, and hands it to the first callback", async () => {
    const { caps, fake } = setup({ trusted: true });
    fake.serve("push.test", (c) => c.send("first"));
    const s = await caps.network!.socket("wss://push.test/");
    await tick(5);
    const got: SocketData[] = [];
    s.onMessage((d) => got.push(d));
    await until(() => got.length === 1);
    expect(got).toEqual(["first"]);
  });
});

describe("a sealed app", () => {
  it("is refused an undeclared host with a code, and nobody is asked", async () => {
    const { caps, asked, fake } = setup({ permissions: { network: { hosts: ["stream.binance.com"] } } });
    expect(await codeOf(caps.network!.socket("wss://evil.example/ws"))).toBe("not-allowed-host");
    expect(await codeOf(caps.network!.room())).toBe("not-allowed-host");
    expect(asked).toEqual([]);
    expect(fake.connections).toHaveLength(0);
  });

  it("with no network permission at all is refused the same way", async () => {
    const { caps, asked } = setup({ permissions: {} });
    expect(await codeOf(caps.network!.socket("wss://stream.binance.com/ws"))).toBe("not-allowed-host");
    expect(asked).toEqual([]);
  });

  it("asks once, naming the host — two connects at once ask one question — and the answer is kept", async () => {
    const { caps, asked, fake, again } = setup({ permissions: { network: { hosts: ["stream.binance.com"] } } });
    const [a, b] = await Promise.all([caps.network!.socket("wss://stream.binance.com:9443/ws/btc"), caps.network!.socket("wss://stream.binance.com:9443/ws/eth")]);
    expect(asked).toEqual(["“Price Board” wants a live connection to stream.binance.com:9443."]);
    expect(fake.allowedTargets.has("stream.binance.com:9443")).toBe(true);
    a.close();
    b.close();
    // The next pass of the same app: not asked again.
    await again().network!.socket("wss://stream.binance.com:9443/ws/sol");
    expect(asked).toHaveLength(1);
  });

  it("Not now refuses this one with \"denied\", and asks again next time", async () => {
    let yes = false;
    const { caps, asked, fake } = setup({ permissions: { network: { hosts: ["stream.binance.com"] } }, answer: () => yes });
    expect(await codeOf(caps.network!.socket("wss://stream.binance.com/ws"))).toBe("denied");
    expect(fake.connections).toHaveLength(0);
    yes = true;
    await caps.network!.socket("wss://stream.binance.com/ws");
    expect(asked).toHaveLength(2);
  });

  it("joins rooms only with rooms: true, and the question says Potyro's rooms", async () => {
    const { caps, asked } = setup({ permissions: { network: { rooms: true } } });
    const room = await caps.network!.room("A".repeat(22));
    expect(room.id).toBe("A".repeat(22));
    expect(asked).toEqual(["“Price Board” wants a live connection to Potyro’s rooms."]);
    expect(await codeOf(caps.network!.socket("wss://stream.binance.com/ws"))).toBe("not-allowed-host");
  });
});

describe("limits", () => {
  it(`at most ${SOCKET_LIMITS.perApp} connections an app, counting the ones opening; closing one frees a place`, async () => {
    const { caps, owner } = setup({ trusted: true });
    const open = await Promise.all(Array.from({ length: SOCKET_LIMITS.perApp }, (_, i) => caps.network!.socket(`wss://echo.test/${i}`)));
    expect(openSocketsOf(owner)).toBe(SOCKET_LIMITS.perApp);
    expect(await codeOf(caps.network!.socket("wss://echo.test/one-more"))).toBe("too-many");
    const { closes } = collect(open[0]!);
    open[0]!.close();
    await until(() => closes.length === 1);
    expect(closes[0]).toMatchObject({ why: "app", code: 1000 });
    expect(open[0]!.readyState).toBe("closed");
    await caps.network!.socket("wss://echo.test/now-fits");
  });

  it("refuses a message over 1 MiB, a send while the buffer is full, and a send after close", async () => {
    const { caps, fake } = setup({ trusted: true });
    const s = await caps.network!.socket("wss://echo.test/");
    expect(await codeOf(s.send(new Uint8Array(SOCKET_LIMITS.messageBytes + 1)))).toBe("too-big");
    expect(await codeOf(s.send("é".repeat(SOCKET_LIMITS.messageBytes / 2 + 1)))).toBe("too-big");
    fake.buffered = SOCKET_LIMITS.sendBufferBytes;
    expect(await codeOf(s.send("x"))).toBe("full");
    fake.buffered = 0;
    expect(await codeOf(s.send("x"))).toBe("resolved");
    s.close();
    expect(await codeOf(s.send("x"))).toBe("closed");
  });

  it("closes a connection whose server sends one message over 1 MiB, and says why", async () => {
    const { caps, fake } = setup({ trusted: true });
    fake.serve("big.test", (c) => c.send(new Uint8Array(SOCKET_LIMITS.messageBytes + 1)));
    const s = await caps.network!.socket("wss://big.test/");
    const { got, closes } = collect(s);
    await until(() => closes.length === 1);
    expect(closes[0]).toMatchObject({ code: 1009, why: "too-big" });
    expect(got).toEqual([]);
  });

  it("closes, rather than holding without end, what an app that never listens is sent", async () => {
    const { caps, fake } = setup({ trusted: true });
    fake.serve("flood.test", (c) => {
      for (let i = 0; i < 20; i++) c.send(new Uint8Array(SOCKET_LIMITS.receiveBufferBytes / 10));
    });
    const s = await caps.network!.socket("wss://flood.test/");
    const closes: SocketClose[] = [];
    s.onClose((c) => closes.push(c));
    await until(() => closes.length === 1);
    expect(closes[0]!.why).toBe("slow");
  });
});

describe("failures carry a code the app can word", () => {
  it("offline, refused, unreachable, insecure", async () => {
    const { caps, fake } = setup({ trusted: true, fake: { deps: { connectTimeoutMs: 30 } } });
    fake.serve("no.test", "refuse");
    fake.serve("silent.test", "unreachable");
    expect(await codeOf(caps.network!.socket("wss://no.test/"))).toBe("refused");
    expect(await codeOf(caps.network!.socket("wss://silent.test/"))).toBe("unreachable");
    expect(await codeOf(caps.network!.socket("ws://plain.example/"))).toBe("insecure");
    fake.setOnline(false);
    expect(await codeOf(caps.network!.socket("wss://echo.test/"))).toBe("offline");
  });

  it("a device with no socket support answers offline, and a bad address is a TypeError", async () => {
    const caps = mediateCaps({ caps: new FakeCapabilities(), provenance: "trusted", permissions: {}, ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null }, appName: "X" });
    expect(await codeOf(caps.network!.socket("wss://echo.test/"))).toBe("offline");
    await expect(caps.network!.socket("https://echo.test/")).rejects.toBeInstanceOf(TypeError);
    await expect(caps.network!.socket("not a url")).rejects.toBeInstanceOf(TypeError);
  });

  it("ws:// reaches the device itself, and a page served over http (development)", async () => {
    const { caps } = setup({ trusted: true });
    await caps.network!.socket("ws://127.0.0.1:8123/api/websocket");
    const dev = setup({ trusted: true, fake: { pageProtocol: "http:" } });
    await dev.caps.network!.socket("ws://192.168.1.20:8123/api/websocket");
  });
});

describe("Potyro closes them", () => {
  it("when the person leaves the app: every connection hears why: left", async () => {
    const { caps, fake } = setup({ trusted: true });
    const a = collect(await caps.network!.socket("wss://echo.test/a"));
    const b = collect(await caps.network!.socket("wss://echo.test/b"));
    fake.cap.closeAll("left");
    expect(a.closes[0]).toMatchObject({ why: "left", code: 1001 });
    expect(b.closes[0]).toMatchObject({ why: "left" });
    expect(fake.cap.openCount).toBe(0);
    await until(() => fake.connections.every((c) => c.closed));
  });

  it("when the person leaves while one is still opening: it never opens behind their back", async () => {
    const { caps, fake, owner } = setup({ trusted: true });
    const opening = caps.network!.socket("wss://echo.test/slow");
    const silent = setup({ trusted: true, fake: { deps: { connectTimeoutMs: 60_000 } } });
    silent.fake.serve("silent.test", "unreachable");
    const waiting = silent.caps.network!.socket("wss://silent.test/");
    await tick(); // the first is still connecting; the second never answers
    fake.cap.closeAll("left");
    silent.fake.cap.closeAll("left");
    expect(await codeOf(opening)).toBe("refused");
    expect(await codeOf(waiting)).toBe("refused");
    await tick(10);
    expect(fake.connections.every((c) => c.closed)).toBe(true);
    expect(silent.fake.connections.every((c) => c.closed)).toBe(true);
    expect(fake.cap.openCount + silent.fake.cap.openCount).toBe(0);
    expect(openSocketsOf(owner)).toBe(0);
  });

  it("when the page has been hidden a while — and not when it comes back in time", async () => {
    const listeners: Array<() => void> = [];
    const doc = { hidden: false, addEventListener: (_: "visibilitychange", fn: () => void) => void listeners.push(fn) };
    const { caps } = setup({ trusted: true, fake: { deps: { doc, hiddenCloseMs: 40 } } });
    const s = collect(await caps.network!.socket("wss://echo.test/"));
    doc.hidden = true;
    listeners.forEach((f) => f());
    await tick(10);
    doc.hidden = false;
    listeners.forEach((f) => f());
    await tick(60);
    expect(s.closes).toEqual([]);
    doc.hidden = true;
    listeners.forEach((f) => f());
    await until(() => s.closes.length === 1);
    expect(s.closes[0]!.why).toBe("hidden");
  });

  it("once the app is closed, what it held ends and a late retry of its own opens nothing", async () => {
    const { caps, fake, owner } = setup({ trusted: true });
    const s = collect(await caps.network!.socket("wss://echo.test/"));
    retireAppSockets(owner);
    expect(s.closes[0]).toMatchObject({ why: "left" });
    expect(await codeOf(caps.network!.socket("wss://echo.test/again"))).toBe("refused");
    expect(fake.connections).toHaveLength(1);
    expect(openSocketsOf(owner)).toBe(0);
  });

  it("nothing opens while Potyro is in the background: hidden, and the first try after coming back opens", async () => {
    const doc = { hidden: true, addEventListener: () => {} };
    const { caps, fake } = setup({ trusted: true, fake: { deps: { doc } } });
    expect(await codeOf(caps.network!.socket("wss://echo.test/"))).toBe("hidden");
    expect(await codeOf(caps.network!.room("room-for-tests-0000000000"))).toBe("hidden");
    expect(fake.connections).toHaveLength(0);
    expect(fake.cap.openCount).toBe(0);
    doc.hidden = false;
    const s = await caps.network!.socket("wss://echo.test/");
    expect(s.readyState).toBe("open");
  });

  it("the server closing says server, with its code and reason; a drop says network", async () => {
    const { caps, fake } = setup({ trusted: true });
    const a = collect(await caps.network!.socket("wss://echo.test/a"));
    const b = collect(await caps.network!.socket("wss://echo.test/b"));
    fake.connections[0]!.end(4000, "bye");
    fake.connections[1]!.drop();
    await until(() => a.closes.length === 1 && b.closes.length === 1);
    expect(a.closes[0]).toEqual({ code: 4000, reason: "bye", why: "server" });
    expect(b.closes[0]).toMatchObject({ code: 1006, why: "network" });
  });
});

describe("rooms", () => {
  it("presence and peer messages arrive typed; your own never come back; members stay current", async () => {
    const { caps, fake } = setup({ trusted: true });
    const id = "room-for-tests-0000000000";
    const bo = fake.joinRoom(id, "Bo");
    const room: Room = await caps.network!.room(id, { name: "Ana" });
    expect(room.me.name).toBe("Ana");
    expect(room.members.map((m) => m.name)).toEqual(["Bo"]);
    const got: SocketData[] = [];
    const presence: string[] = [];
    room.onMessage((d) => got.push(d));
    room.onPresence((e) => presence.push(`${e.type} ${e.member.name}`));

    bo.send("hi from Bo");
    await room.send("hi from Ana");
    const cy = fake.joinRoom(id, "Cy");
    await until(() => got.length === 1 && presence.length === 1);
    expect(got).toEqual(["hi from Bo"]);
    expect(presence).toEqual(["join Cy"]);
    expect(room.members.map((m) => m.name)).toEqual(["Bo", "Cy"]);
    await until(() => bo.received.includes("hi from Ana"));
    cy.leave();
    await until(() => presence.length === 2);
    expect(presence[1]).toBe("leave Cy");
    expect(room.members.map((m) => m.name)).toEqual(["Bo"]);
    // Bo heard Ana join, through the envelope.
    expect(bo.received.some((d) => typeof d === "string" && d.includes('"type":"join"') && d.includes("Ana"))).toBe(true);
  });

  it("makes an id when given none, refuses a bad one, and an app cannot forge the envelope", async () => {
    const { caps } = setup({ trusted: true });
    const room = await caps.network!.room();
    expect(room.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await expect(caps.network!.room("short")).rejects.toBeInstanceOf(TypeError);
    await expect(room.send('{"potyro-rooms":1,"type":"join"}')).rejects.toBeInstanceOf(TypeError);
  });

  it("a build with no rooms relay says unreachable", async () => {
    const { caps } = setup({ trusted: true, fake: { roomsUrl: null } });
    expect(await codeOf(caps.network!.room())).toBe("unreachable");
  });
});
