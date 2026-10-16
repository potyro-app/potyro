// @vitest-environment happy-dom
//
// One app's live connections (docs/28): the person's answer is kept per app and per host on this
// device (never in the app's own storage), deleting the app forgets it, and the question names the
// host — or Potyro's rooms — in the person's language.

import { beforeEach, describe, expect, it } from "vitest";
import { createFakeSockets } from "@potyro/capabilities";
import { setLocale } from "@potyro/i18n";
import { appSockets, forgetSocketStanding, localAddressWords, setSocketSwitch, socketConsentWords, socketStanding, socketSwitches } from "../src/app-sockets.js";

beforeEach(async () => {
  localStorage.clear();
  await setLocale("en");
});

describe("app sockets", () => {
  it("keeps the person's answer per app and host, and forgets it when the app goes", () => {
    const page = createFakeSockets().cap;
    const prices = appSockets(page, "prices", "wss://apps.test/rooms")!;
    const other = appSockets(page, "other", "wss://apps.test/rooms")!;
    expect(prices.allowed!({ host: "stream.binance.com" })).toBe(false);
    prices.allow!({ host: "Stream.Binance.com" });
    prices.allow!({ rooms: true });
    expect(prices.allowed!({ host: "stream.binance.com" })).toBe(true);
    expect(prices.allowed!({ rooms: true })).toBe(true);
    expect(other.allowed!({ host: "stream.binance.com" })).toBe(false);
    expect(socketStanding("prices")).toEqual(["stream.binance.com", "rooms"]);
    forgetSocketStanding("prices");
    expect(prices.allowed!({ host: "stream.binance.com" })).toBe(false);
  });

  it("is the page's connections, with this app's rooms address", () => {
    const fake = createFakeSockets();
    const caps = appSockets(fake.cap, "prices", "wss://apps.test/rooms/")!;
    expect(caps.roomsUrl).toBe("wss://apps.test/rooms");
    expect(appSockets(null, "prices")).toBeNull();
  });

  it("asks in words that name the host, or Potyro's rooms, in the person's language", async () => {
    const host = socketConsentWords("Price Board", { host: "stream.binance.com" });
    expect(host.message).toBe("“Price Board” wants a live connection to stream.binance.com.");
    expect(host.detail).toContain("Potyro closes the connection when you leave the app.");
    expect([host.ok, host.cancel]).toEqual(["Allow", "Not now"]);
    expect(socketConsentWords("Draw", { rooms: true }).message).toBe("“Draw” wants a live connection to Potyro’s rooms.");
    await setLocale("pl");
    expect(socketConsentWords("Price Board", { host: "stream.binance.com" }).message).toBe("„Price Board” chce połączyć się na żywo z stream.binance.com.");
    await setLocale("pt-BR");
    expect(socketConsentWords("Draw", { rooms: true }).message).toBe("“Draw” quer uma conexão ao vivo com as salas do Potyro.");
  });

  it("reads the answer kept before Edit tile had switches", () => {
    localStorage.setItem("potyro:sockets:old", JSON.stringify(["stream.binance.com", "rooms"]));
    expect(socketStanding("old")).toEqual(["stream.binance.com", "rooms"]);
    expect(socketSwitches("old").map((s) => [s.key, s.on])).toEqual([
      ["stream.binance.com", true],
      ["rooms", true],
    ]);
  });

  it("Edit tile's switches: off refuses and tells the host at once, on again allows, forget asks again", () => {
    const page = createFakeSockets().cap;
    const caps = appSockets(page, "prices", "wss://apps.test/rooms")!;
    const other = appSockets(page, "other", "wss://apps.test/rooms")!;
    caps.allow!({ host: "stream.binance.com" });
    caps.allow!({ rooms: true });
    const heard: unknown[] = [];
    const heardOther: unknown[] = [];
    const stop = caps.onTurnedOff!((t) => heard.push(t));
    other.onTurnedOff!((t) => heardOther.push(t));

    setSocketSwitch("prices", "stream.binance.com", "off");
    expect(heard).toEqual([{ host: "stream.binance.com" }]);
    expect(heardOther).toEqual([]);
    expect(caps.allowed!({ host: "stream.binance.com" })).toBe(false);
    expect(caps.turnedOff!({ host: "stream.binance.com" })).toBe(true);
    // Still listed, so it can be turned on again.
    expect(socketSwitches("prices").map((s) => [s.key, s.on])).toEqual([
      ["rooms", true],
      ["stream.binance.com", false],
    ]);

    setSocketSwitch("prices", "stream.binance.com", "on");
    expect(caps.allowed!({ host: "stream.binance.com" })).toBe(true);
    expect(caps.turnedOff!({ host: "stream.binance.com" })).toBe(false);
    expect(heard).toHaveLength(1);

    setSocketSwitch("prices", "rooms", "forget");
    expect(heard).toEqual([{ host: "stream.binance.com" }, { rooms: true }]);
    expect(caps.allowed!({ rooms: true })).toBe(false);
    expect(caps.turnedOff!({ rooms: true })).toBe(false);
    stop();
    setSocketSwitch("prices", "stream.binance.com", "off");
    expect(heard).toHaveLength(2);
  });

  it("remembers one home device per app, on or off, until it is forgotten", () => {
    const caps = appSockets(createFakeSockets().cap, "lights", "wss://apps.test/rooms")!;
    expect(caps.localAddress!()).toBeUndefined();
    caps.allow!({ local: "192.168.1.20" });
    expect(caps.localAddress!()).toBe("192.168.1.20");
    expect(caps.allowed!({ local: "192.168.1.20" })).toBe(true);
    setSocketSwitch("lights", "local:192.168.1.20", "off");
    expect(caps.localAddress!()).toBe("192.168.1.20");
    expect(caps.turnedOff!({ local: "192.168.1.20" })).toBe(true);
    caps.allow!({ local: "10.0.0.7:8123" });
    expect(socketSwitches("lights").map((s) => s.key)).toEqual(["local:10.0.0.7:8123"]);
    setSocketSwitch("lights", "local:10.0.0.7:8123", "forget");
    expect(caps.localAddress!()).toBeUndefined();
  });

  it("words a home device by the address the person gave, and the web's limit when there is one", async () => {
    const w = socketConsentWords("Lights", { local: "192.168.1.20" }, { secureOnly: true });
    expect(w.message).toBe("“Lights” wants a live connection to 192.168.1.20 on your home network.");
    expect(w.detail).toContain("In a browser it connects only if the device offers a secure (wss://) connection");
    expect(socketConsentWords("Lights", { local: "192.168.1.20" }).detail).not.toContain("browser");
    expect(localAddressWords("Lights", null)).toBe("“Lights” wants to connect to a device on your home network. What is its address? For example 192.168.1.20 or homeassistant.local");
    expect(localAddressWords("Lights", "example.com")).toMatch(/^“example\.com” is not an address on your home network\. “Lights” wants/);
    await setLocale("de");
    expect(socketConsentWords("Lights", { local: "192.168.1.20" }).message).not.toContain("wants");
  });
});
