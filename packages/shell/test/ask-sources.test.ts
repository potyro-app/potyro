// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDefinition } from "karta";
import { memoryVault, type SecretVault } from "@karta/identity";
import { keyStore, listMySources, makeSourceFetcher, removeMySource, resolveSources, saveMySource, type PersonSource } from "../src/ask-sources.js";

// Data sources for Ask (#213), the part that holds keys. The rules under test:
//   - a key lives in the secret vault, and when there is none, in memory for this page only —
//     never in localStorage;
//   - a key is attached by the host, only to the source's own endpoint (an app's source) or to an
//     origin the person allowed (their own), and never appears in what the model reads back;
//   - requests are GET, without cookies, and a redirect is refused rather than followed.

const KEY = "sk-live-7f3a9c";

const DEF = {
  id: "places",
  name: "Places",
  entities: {},
  pages: [],
  sources: {
    places: { label: "Places search", endpoint: "https://api.example.com/v1/", docs: "https://docs.example.com/places", auth: { header: "X-Api-Key" } },
    osm: { label: "Overpass", endpoint: "https://overpass.example.org/api/" },
  },
} as unknown as AppDefinition;

function recorder(body = '{"ok":true}', init: ResponseInit = { status: 200, headers: { "content-type": "application/json" } }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(body, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

beforeEach(() => localStorage.clear());

describe("keyStore", () => {
  it("keeps a key in the vault when there is one, and nowhere in localStorage", async () => {
    const vault = memoryVault();
    const keys = keyStore(vault);
    expect(await keys.set("k1", KEY)).toBe("vault");
    expect(await keys.get("k1")).toBe(KEY);
    expect(vault.map.size).toBe(1);
    expect(JSON.stringify({ ...localStorage })).not.toContain(KEY);
  });

  it("without a vault, keeps it in memory for this page only — never localStorage", async () => {
    const none: SecretVault = { available: async () => false, get: async () => null, set: async () => { throw new Error("no"); }, remove: async () => undefined };
    const keys = keyStore(none);
    expect(await keys.set("k1", KEY)).toBe("session");
    expect(await keys.get("k1")).toBe(KEY);
    expect(JSON.stringify({ ...localStorage })).not.toContain(KEY);
    expect(await keyStore(none).get("k1")).toBeNull();
  });
});

describe("the person's own sources", () => {
  it("are saved without their keys", () => {
    saveMySource({ id: "brave", label: "Brave search", endpoint: "https://api.search.example/", origins: [] });
    expect(listMySources().map((s) => s.label)).toEqual(["Brave search"]);
    removeMySource("brave");
    expect(listMySources()).toEqual([]);
  });
});

describe("resolveSources", () => {
  it("offers an app's source that needs a key only once the person gave one", async () => {
    const keys = keyStore(memoryVault());
    let out = await resolveSources(DEF, "places", [], keys);
    expect(out.usable.map((s) => s.ask.id)).toEqual(["app:osm"]);
    expect(out.needKey.map((s) => s.ask.id)).toEqual(["app:places"]);
    await keys.set(out.needKey[0]!.keyId, KEY);
    out = await resolveSources(DEF, "places", [], keys);
    expect(out.usable.map((s) => s.ask.id).sort()).toEqual(["app:osm", "app:places"]);
  });

  it("never puts a key in what the model is told", async () => {
    const keys = keyStore(memoryVault());
    const mine: PersonSource = { id: "w", label: "Weather", endpoint: "https://weather.example/", origins: ["https://weather.example"], auth: { query: "appid" } };
    await keys.set("karta:source-key:app:places:places", KEY);
    await keys.set("karta:source-key:mine:w", KEY);
    const out = await resolveSources(DEF, "places", [mine], keys);
    expect(JSON.stringify(out.usable.map((s) => s.ask))).not.toContain(KEY);
  });
});

describe("makeSourceFetcher", () => {
  async function setup(mine: PersonSource[] = [], confirm = async () => false) {
    const keys = keyStore(memoryVault());
    await keys.set("karta:source-key:app:places:places", KEY);
    for (const m of mine) await keys.set(`karta:source-key:mine:${m.id}`, KEY);
    const { usable } = await resolveSources(DEF, "places", mine, keys);
    const rec = recorder(`{"echo":"https://api.example.com/v1/x?key=${KEY}"}`);
    const allowed: string[] = [];
    const fetchSource = makeSourceFetcher({ sources: usable, keys, fetch: rec.fetchImpl, confirmOrigin: confirm, onAllowed: (_id, o) => allowed.push(o) });
    return { fetchSource, rec, allowed };
  }

  it("sends an app source's key, as declared, to its endpoint, GET without cookies or redirects", async () => {
    const { fetchSource, rec } = await setup();
    const res = await fetchSource({ source: "app:places", kind: "data", url: "search?q=dog" });
    expect(res.ok).toBe(true);
    expect(rec.calls[0]!.url).toBe("https://api.example.com/v1/search?q=dog");
    expect(headerOf(rec.calls[0]!.init, "X-Api-Key")).toBe(KEY);
    expect(rec.calls[0]!.init.method ?? "GET").toBe("GET");
    expect(rec.calls[0]!.init.credentials).toBe("omit");
    expect(rec.calls[0]!.init.redirect).toBe("error");
  });

  it("scrubs the key from what comes back", async () => {
    const { fetchSource } = await setup();
    const res = await fetchSource({ source: "app:places", kind: "data", url: "x" });
    expect(res.detail).not.toContain(KEY);
  });

  it("refuses a URL outside an app source's endpoint, without fetching", async () => {
    const { fetchSource, rec } = await setup();
    for (const url of ["https://evil.example/steal", "https://api.example.com/v2/other", "http://api.example.com/v1/x", "../admin"]) {
      const res = await fetchSource({ source: "app:places", kind: "data", url });
      expect(res.ok, url).toBe(false);
    }
    expect(rec.calls).toHaveLength(0);
  });

  it("asks the person before sending their own source's request to a new origin, and remembers a yes", async () => {
    const mine: PersonSource = { id: "g", label: "Maps", docs: "https://developers.example.com/maps", origins: [], auth: { header: "Authorization", prefix: "Bearer " } };
    const asked: string[] = [];
    let answer = false;
    const { fetchSource, rec, allowed } = await setup([mine], async (_s, origin) => (asked.push(origin), answer));
    expect((await fetchSource({ source: "mine:g", kind: "data", url: "https://maps.example.com/v1/places" })).ok).toBe(false);
    expect(rec.calls).toHaveLength(0);
    answer = true;
    expect((await fetchSource({ source: "mine:g", kind: "data", url: "https://maps.example.com/v1/places" })).ok).toBe(true);
    expect(headerOf(rec.calls[0]!.init, "Authorization")).toBe(`Bearer ${KEY}`);
    expect(allowed).toEqual(["https://maps.example.com"]);
    expect(asked).toEqual(["https://maps.example.com", "https://maps.example.com"]);
    await fetchSource({ source: "mine:g", kind: "data", url: "https://maps.example.com/v1/other" });
    expect(asked).toHaveLength(2);
  });

  it("reads docs without any key", async () => {
    const { fetchSource, rec } = await setup();
    await fetchSource({ source: "app:places", kind: "docs" });
    expect(rec.calls[0]!.url).toBe("https://docs.example.com/places");
    expect(headerOf(rec.calls[0]!.init, "X-Api-Key")).toBeNull();
  });

  it("reports a failed request as a result the model can read", async () => {
    const keys = keyStore(memoryVault());
    const { usable } = await resolveSources(DEF, "places", [], keys);
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const fetchSource = makeSourceFetcher({ sources: usable, keys, fetch: failing, confirmOrigin: async () => false, onAllowed: () => undefined });
    const res = await fetchSource({ source: "app:osm", kind: "data", url: "interpreter?data=x" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/Failed to fetch/);
  });
});
