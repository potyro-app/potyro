// @vitest-environment happy-dom
//
// One app's live connections (docs/28): the person's answer is kept per app and per host on this
// device (never in the app's own storage), deleting the app forgets it, and the question names the
// host — or Potyro's rooms — in the person's language.

import { beforeEach, describe, expect, it } from "vitest";
import { createFakeSockets } from "@potyro/capabilities";
import { setLocale } from "@potyro/i18n";
import { appSockets, forgetSocketStanding, socketConsentWords, socketStanding } from "../src/app-sockets.js";

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
});
