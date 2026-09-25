// Ask's source requests over the native HTTP plugin (#213), driven with a fake plugin.
//
// Why native at all: a browser refuses a cross-origin request the API did not opt into (CORS), and
// most APIs never opt in, since they expect a server to call them. The Android app's own HTTP stack
// has no such rule, so there Ask can reach any API the person has a key for. What must NOT change on
// the way: GET only, a redirect is refused rather than followed, and a slow API times out.

import { describe, expect, it } from "vitest";
import { fetchOver, type HttpPlugin } from "../src/native-http.js";

function fakePlugin(reply: { status: number; headers?: Record<string, string>; data: unknown }) {
  const calls: Array<Record<string, unknown>> = [];
  const plugin: HttpPlugin = {
    request: async (o) => (calls.push(o as unknown as Record<string, unknown>), { status: reply.status, headers: reply.headers ?? {}, data: reply.data, url: o.url }),
  };
  return { plugin, calls };
}

describe("fetchOver (native HTTP for Ask's sources)", () => {
  it("sends a GET with the headers given, refusing redirects, with timeouts, and answers like fetch", async () => {
    const { plugin, calls } = fakePlugin({ status: 200, headers: { "Content-Type": "application/json" }, data: '[{"name":"Dog Beach"}]' });
    const res = await fetchOver(plugin)("https://api.places.test/v1/search?q=dog", { method: "GET", headers: new Headers({ "X-Api-Key": "k1" }) });
    expect(calls[0]).toMatchObject({ url: "https://api.places.test/v1/search?q=dog", method: "GET", headers: { "x-api-key": "k1" }, disableRedirects: true, responseType: "text" });
    expect(calls[0]!.connectTimeout).toBeGreaterThan(0);
    expect(calls[0]!.readTimeout).toBeGreaterThan(0);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('[{"name":"Dog Beach"}]');
  });

  it("hands back text even when the plugin already parsed the JSON", async () => {
    const { plugin } = fakePlugin({ status: 200, data: [{ name: "Bark Park" }] });
    expect(await (await fetchOver(plugin)("https://x.test/", {})).text()).toBe('[{"name":"Bark Park"}]');
  });

  it("refuses a redirect instead of following it", async () => {
    const { plugin } = fakePlugin({ status: 302, headers: { Location: "https://evil.test/" }, data: "" });
    await expect(fetchOver(plugin)("https://api.places.test/v1/x", {})).rejects.toThrow(/redirect/i);
  });

  it("refuses anything but GET", async () => {
    const { plugin, calls } = fakePlugin({ status: 200, data: "" });
    await expect(fetchOver(plugin)("https://x.test/", { method: "POST" })).rejects.toThrow(/GET/);
    expect(calls).toHaveLength(0);
  });

  it("gives up when asked to stop, even though the plugin cannot be cancelled", async () => {
    const plugin: HttpPlugin = { request: () => new Promise(() => undefined) };
    const stop = new AbortController();
    const pending = fetchOver(plugin)("https://slow.test/", { signal: stop.signal });
    stop.abort();
    await expect(pending).rejects.toThrow();
  });
});
