// What the person decides about an app's live connections (docs/28 §3, §5, §6): turning a target off
// in Edit tile (its connections end at once, and the next try is refused without a question), a
// device on their home network for an app that declared `hosts: ["local"]` (they give the address,
// the question names it, it is remembered), and how long a connection may stay while Potyro is hidden.

import { describe, expect, it } from "vitest";
import { FakeCapabilities, HIDDEN_KEEP_MAX_MS, createFakeSockets, parseLocalAddress, type FakeSocketsOptions } from "@potyro/capabilities";
import type { Caps, PermissionManifest, Socket, SocketClose } from "potyro";
import { keepWhileHiddenMs, mediateCaps, openSocketsOf, retireAppSockets, type UiBridge } from "../src/index.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await tick(2);
  }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return String((e as { code?: string }).code ?? `no code: ${(e as Error).message}`);
  }
}

const closesOf = (s: Socket) => {
  const closes: SocketClose[] = [];
  s.onClose((c) => closes.push(c));
  return closes;
};

function setup(o: { trusted?: boolean; permissions?: PermissionManifest; typed?: Array<string | null>; answer?: boolean; fake?: FakeSocketsOptions } = {}) {
  const fake = createFakeSockets(o.fake);
  const asked: string[] = [];
  const details: string[] = [];
  const prompted: string[] = [];
  const typed = [...(o.typed ?? [])];
  const ui: UiBridge = {
    toast: () => {},
    confirm: async (msg, opts) => {
      asked.push(msg);
      details.push(opts?.detail ?? "");
      return o.answer ?? true;
    },
    prompt: async (msg) => {
      prompted.push(msg);
      return typed.length ? typed.shift()! : null;
    },
    pick: async () => null,
  };
  const owner = {};
  const platform = new FakeCapabilities({ sockets: fake.cap });
  const make = (): Caps => mediateCaps({ caps: platform, provenance: o.trusted ? "trusted" : "untrusted", permissions: o.permissions ?? {}, ui, appName: "Lights", owner });
  return { caps: make(), again: make, fake, asked, details, prompted, owner };
}

describe("turning a connection off (Edit tile)", () => {
  it("ends that target's open connections at once with why off, and refuses the next without asking", async () => {
    const { caps, fake, asked, owner } = setup({ permissions: { network: { hosts: ["a.test", "b.test"], rooms: true } } });
    const a = await caps.network!.socket("wss://a.test/x");
    const b = await caps.network!.socket("wss://b.test/y");
    const room = await caps.network!.room("room-for-tests-0000000000");
    const [ca, cb, cr] = [closesOf(a), closesOf(b), closesOf(room)];
    expect(asked).toHaveLength(3);

    fake.turnOff("a.test");
    expect(ca).toEqual([{ code: 1000, reason: "turned off in Edit tile", why: "off" }]);
    expect(cb).toEqual([]);
    expect(openSocketsOf(owner)).toBe(2);
    await until(() => fake.connections[0]!.closed);
    expect(await codeOf(caps.network!.socket("wss://a.test/again"))).toBe("off");
    expect(asked).toHaveLength(3); // nobody asked

    fake.turnOff("rooms");
    expect(cr[0]?.why).toBe("off");
    expect(await codeOf(caps.network!.room("room-for-tests-0000000000"))).toBe("off");

    // On again: it opens without a question (the switch is the answer).
    fake.turnOn("a.test");
    expect((await caps.network!.socket("wss://a.test/back")).readyState).toBe("open");
    expect(asked).toHaveLength(3);
  });

  it("listens once per app however many passes make a ctx, and stops when the app is closed", async () => {
    const { caps, again, fake, owner } = setup({ permissions: { network: { hosts: ["a.test"] } } });
    again();
    again();
    const s = await caps.network!.socket("wss://a.test/x");
    const closes = closesOf(s);
    fake.turnOff("a.test");
    expect(closes).toHaveLength(1);
    retireAppSockets(owner);
    fake.turnOn("a.test");
    fake.turnOff("a.test"); // nothing left to hear it
    expect(closes).toHaveLength(1);
  });
});

describe("a device on the home network (hosts: [\"local\"])", () => {
  const perms: PermissionManifest = { network: { hosts: ["local"] } };
  const local = { pageProtocol: "https:", deps: { local: async () => ({ protocol: "", bufferedAmount: 0, send: () => {}, close: () => {} }) } } satisfies FakeSocketsOptions;

  it("asks for the address, names it in the question, connects there and remembers it", async () => {
    const { caps, fake, asked, prompted } = setup({ permissions: perms, typed: ["192.168.1.20"], fake: { pageProtocol: "http:" } });
    const s = await caps.network!.socket("ws://local:8123/api/websocket");
    expect(prompted).toEqual(["“Lights” wants to connect to a device on your home network."]);
    expect(asked).toEqual(["“Lights” wants a live connection to 192.168.1.20 on your home network."]);
    expect(s.url).toBe("ws://192.168.1.20:8123/api/websocket");
    expect(fake.connections[0]!.host).toBe("192.168.1.20:8123");
    expect(fake.allowedTargets.has("local:192.168.1.20")).toBe(true);
    // Next time: neither question.
    await caps.network!.socket("ws://local:8123/again");
    expect(prompted).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("the port the person types wins; an address off the home network is asked again; cancel is Not now", async () => {
    const a = setup({ permissions: perms, typed: ["8.8.8.8", "homeassistant.local:9000"], fake: { pageProtocol: "http:" } });
    const s = await a.caps.network!.socket("ws://local:8123/api");
    expect(a.prompted).toHaveLength(2);
    expect(a.prompted[1]).toBe("“8.8.8.8” is not an address on your home network.");
    expect(s.url).toBe("ws://homeassistant.local:9000/api");

    const b = setup({ permissions: perms, typed: [null], fake: { pageProtocol: "http:" } });
    expect(await codeOf(b.caps.network!.socket("ws://local:8123/"))).toBe("denied");
    expect(b.asked).toEqual([]);
    expect(b.fake.connections).toHaveLength(0);
    expect(openSocketsOf(b.owner)).toBe(0);
  });

  it("two connects at once ask for the address once", async () => {
    const { caps, prompted, asked } = setup({ permissions: perms, typed: ["10.0.0.5"], fake: { pageProtocol: "http:" } });
    const [x, y] = await Promise.all([caps.network!.socket("ws://local:80/a"), caps.network!.socket("ws://local:80/b")]);
    expect([x.url, y.url]).toEqual(["ws://10.0.0.5/a", "ws://10.0.0.5/b"]);
    expect(prompted).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("an https web page: ws:// is refused before anyone is asked; wss:// asks, and the question says the web's limit", async () => {
    const web = setup({ permissions: perms, typed: ["192.168.1.20"], fake: { pageProtocol: "https:" } });
    expect(await codeOf(web.caps.network!.socket("ws://local:8123/"))).toBe("insecure");
    expect(web.prompted).toEqual([]);
    await web.caps.network!.socket("wss://local:8123/");
    expect(web.details[0]).toMatch(/In a browser it connects only if the device offers a secure \(wss:\/\/\) connection/);
  });

  it("the Android app (its local plugin): ws:// works and the question says nothing about the web", async () => {
    const app = setup({ permissions: perms, typed: ["192.168.1.20"], fake: local });
    const s = await app.caps.network!.socket("ws://local:8123/");
    expect(s.readyState).toBe("open");
    expect(app.details[0]).not.toMatch(/browser/);
  });

  it("a shared app without \"local\" cannot reach it; a turned-off device is refused without a question", async () => {
    const none = setup({ permissions: { network: { hosts: ["a.test"] } }, fake: { pageProtocol: "http:" } });
    expect(await codeOf(none.caps.network!.socket("ws://local:8123/"))).toBe("not-allowed-host");
    expect(await codeOf(none.caps.network!.socket("ws://192.168.1.20:8123/"))).toBe("not-allowed-host");

    const off = setup({ permissions: perms, fake: { pageProtocol: "http:", localAddress: "192.168.1.20", allowed: ["local:192.168.1.20"] } });
    off.fake.turnOff("local:192.168.1.20");
    expect(await codeOf(off.caps.network!.socket("ws://local:8123/"))).toBe("off");
    expect(off.prompted).toEqual([]);
    expect(off.asked).toEqual([]);
  });

  it("a trusted app is asked only for the address, which is remembered", async () => {
    const { caps, fake, asked, prompted } = setup({ trusted: true, typed: ["192.168.1.30"], fake: { pageProtocol: "http:" } });
    const s = await caps.network!.socket("ws://local:8123/");
    expect(s.url).toBe("ws://192.168.1.30:8123/");
    expect(prompted).toHaveLength(1);
    expect(asked).toEqual([]);
    expect(fake.allowedTargets.has("local:192.168.1.30")).toBe(true);
  });

  it("reads what the person typed as a local address, or nothing", () => {
    expect(parseLocalAddress(" 192.168.1.20 ")).toBe("192.168.1.20");
    expect(parseLocalAddress("192.168.1.20:8123")).toBe("192.168.1.20:8123");
    expect(parseLocalAddress("HomeAssistant.local")).toBe("homeassistant.local");
    expect(parseLocalAddress("ws://10.1.2.3:80/")).toBe("10.1.2.3");
    expect(parseLocalAddress("fd00::1")).toBe("[fd00::1]");
    expect(parseLocalAddress("[fe80::1]:8080")).toBe("[fe80::1]:8080");
    for (const bad of ["", "8.8.8.8", "example.com", "local", "192.168.1.20/path", "me@192.168.1.20", "172.32.0.1", "a b"]) expect(parseLocalAddress(bad)).toBeNull();
  });
});

describe("keepWhileHidden", () => {
  it("reads seconds and minutes, holds them to 15 minutes, and refuses anything else", () => {
    expect(keepWhileHiddenMs(undefined)).toBeUndefined();
    expect(keepWhileHiddenMs("90s")).toBe(90_000);
    expect(keepWhileHiddenMs("5m")).toBe(300_000);
    expect(() => keepWhileHiddenMs("2h")).toThrow(TypeError);
    expect(() => keepWhileHiddenMs(5)).toThrow(TypeError);
    expect(keepWhileHiddenMs("600m")).toBe(HIDDEN_KEEP_MAX_MS);
  });

  it("a connection that asked for longer outlives the default; the others close on time", async () => {
    const listeners: Array<() => void> = [];
    const doc = { hidden: false, addEventListener: (_: "visibilitychange", fn: () => void) => void listeners.push(fn) };
    const { caps } = setup({ trusted: true, fake: { deps: { doc, hiddenCloseMs: 30 } } });
    const quick = closesOf(await caps.network!.socket("wss://echo.test/a"));
    const chat = closesOf(await caps.network!.socket("wss://echo.test/b", { keepWhileHidden: "0.15s" as never }));
    const room = closesOf(await caps.network!.room("room-for-tests-0000000000", { keepWhileHidden: "0.15s" as never }));
    doc.hidden = true;
    listeners.forEach((f) => f());
    await until(() => quick.length === 1);
    expect(quick[0]!.why).toBe("hidden");
    expect(chat).toEqual([]);
    expect(room).toEqual([]);
    await until(() => chat.length === 1 && room.length === 1);
    expect(chat[0]!.why).toBe("hidden");
  });

  it("coming back in time keeps a long one too", async () => {
    const listeners: Array<() => void> = [];
    const doc = { hidden: false, addEventListener: (_: "visibilitychange", fn: () => void) => void listeners.push(fn) };
    const { caps } = setup({ trusted: true, fake: { deps: { doc, hiddenCloseMs: 20 } } });
    const chat = closesOf(await caps.network!.socket("wss://echo.test/b", { keepWhileHidden: "0.1s" as never }));
    doc.hidden = true;
    listeners.forEach((f) => f());
    await tick(50);
    doc.hidden = false;
    listeners.forEach((f) => f());
    await tick(120);
    expect(chat).toEqual([]);
  });

  it("a bad value is the app's bug: a TypeError, nothing opened", async () => {
    const { caps, fake } = setup({ trusted: true });
    await expect(caps.network!.socket("wss://echo.test/", { keepWhileHidden: "forever" as never })).rejects.toThrow(TypeError);
    expect(fake.connections).toHaveLength(0);
  });
});
