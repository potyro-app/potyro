// @vitest-environment happy-dom
//
// Sending a request to the Potyro team (#263): exactly the request and the app's structure, never
// its records; and until the relay is reachable, kept on the device to send later.

import { beforeEach, describe, expect, it } from "vitest";
import { REQUEST_FORMAT } from "@potyro/platform-requests";
import { buildRequest, deviceId, savedRequests, sendPlatformRequest, sendSaved } from "../src/platform-requests.js";

const SOURCE = [
  'import { defineApp } from "potyro";',
  "export default defineApp({",
  '  id: "plants", name: "Plants", version: "1.0.0", schemaVersion: 1,',
  '  entities: { plant: { label: "Plant", fields: { name: { type: "text" } }, computed: { shout: (p) => p.name.toUpperCase() } } },',
  '  pages: [{ id: "all", title: "Plants", view: { type: "list", entity: "plant" } }],',
  "});",
].join("\n");
const ask = { id: "req-1", title: "Scan barcodes", body: "I wanted to scan the barcode on a pot." };

const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => globalThis.localStorage.clear());

describe("what is sent", () => {
  it("the request, the app's structure with functions as markers, its name and language — nothing else", async () => {
    const p = await buildRequest(ask, { source: SOURCE, app: "Plants", language: "pl" });
    expect(p).toEqual({
      format: REQUEST_FORMAT,
      id: "req-1",
      device: deviceId(),
      title: "Scan barcodes",
      body: "I wanted to scan the barcode on a pot.",
      structure: expect.stringContaining('"plant"'),
      app: "Plants",
      language: "pl",
    });
    expect(p.structure).toContain("(a function)");
    expect(p.structure).not.toContain("toUpperCase");
  });

  it("the device id is kept, so the relay's limit sees one device", () => {
    expect(deviceId()).toBe(deviceId());
    expect(deviceId()).toMatch(/^[\w-]{8,}$/);
  });
});

describe("sending", () => {
  it("sent: the relay filed it", async () => {
    const p = await buildRequest(ask, { source: SOURCE, language: "en" });
    const r = await sendPlatformRequest(p, "plants", { fetch: answer(201, { ok: true, issue: 12, url: "https://github.com/potyro-app/potyro/issues/12" }) });
    expect(r).toEqual({ state: "sent", url: "https://github.com/potyro-app/potyro/issues/12" });
    expect(savedRequests()).toEqual([]);
  });

  it("not reachable, or not a relay at all: saved to send later", async () => {
    const p = await buildRequest(ask, { source: SOURCE, language: "en" });
    // An Apache that does not proxy it yet answers with the site's index.html, 200.
    const notRelay = (async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    expect(await sendPlatformRequest(p, "plants", { fetch: notRelay })).toEqual({ state: "saved" });
    expect(await sendPlatformRequest({ ...p, id: "req-2" }, "plants", { fetch: async () => Promise.reject(new TypeError("offline")) })).toEqual({ state: "saved" });
    expect(await sendPlatformRequest({ ...p, id: "req-3" }, "plants", { fetch: answer(429, { ok: false }) })).toEqual({ state: "saved" });
    expect(savedRequests().map((s) => [s.chatId, s.payload.id])).toEqual([
      ["plants", "req-1"],
      ["plants", "req-2"],
      ["plants", "req-3"],
    ]);
  });

  it("refused as malformed: not kept, since sending it again cannot help", async () => {
    const p = await buildRequest(ask, { source: SOURCE, language: "en" });
    expect(await sendPlatformRequest(p, "plants", { fetch: answer(400, { ok: false, error: "title is empty" }) })).toEqual({ state: "refused" });
    expect(savedRequests()).toEqual([]);
  });

  it("the saved ones go when the relay is back, each said once", async () => {
    const p = await buildRequest(ask, { source: SOURCE, language: "en" });
    await sendPlatformRequest(p, "plants", { fetch: async () => Promise.reject(new TypeError("offline")) });
    await sendPlatformRequest(p, "plants", { fetch: async () => Promise.reject(new TypeError("offline")) });
    expect(savedRequests()).toHaveLength(1);
    const sent: Array<[string, string]> = [];
    await sendSaved((chatId, payload) => void sent.push([chatId, payload.id]), { fetch: answer(201, { ok: true, url: "u" }) });
    expect(sent).toEqual([["plants", "req-1"]]);
    expect(savedRequests()).toEqual([]);
  });
});
