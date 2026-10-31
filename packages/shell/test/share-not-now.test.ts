// The share service saying "not now" (429, or 503 when full): a limit for the day on this network, or
// on what the whole service keeps — never "the link is damaged" (docs/16 "Limits per address").
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_INLINE_CHARS } from "../src/demo-link.js";

// A demo too big to travel inside a link: only a hosted link could carry it.
const BIG = new Uint8Array(MAX_INLINE_CHARS).map((_, i) => (i * 7919) % 251);
vi.mock("../src/demo-package.js", () => ({
  demoPackageFor: async () => ({ zip: BIG, entities: [], credit: { name: "Groceries" }, accent: undefined, icon: undefined }),
}));

const page = (href: string) => {
  const u = new URL(href);
  return { protocol: u.protocol, host: u.host, origin: u.origin, pathname: u.pathname };
};

const answering = (status: number, code: string, retryAfter = "3600") => {
  vi.stubGlobal("location", page("https://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv"));
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: false, code, error: "Too many …" }), { status, headers: { "content-type": "application/json", "retry-after": retryAfter } }));
};

afterEach(() => vi.unstubAllGlobals());

describe("opening a hosted link past the day's limit", () => {
  it("is a TooManyError carrying the service's code and when to try again", async () => {
    const { fetchHostedPackage, GoneError, TooManyError } = await import("../src/share-service.js");
    answering(429, "too-many-opens", "5400");
    const e = await fetchHostedPackage("AbCdEfGhIjKlMnOpQrStUv", "k").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TooManyError);
    expect(e).not.toBeInstanceOf(GoneError);
    expect(e).toMatchObject({ status: 429, code: "too-many-opens", retryAfter: 5400 });
  });

  it("tells the person to try again later or on another network, with Try again — not that the link is damaged", async () => {
    const { loadDemoPackage, DemoRetryError, LinkGoneError } = await import("../src/demo.js");
    answering(429, "too-many-opens");
    const e = await loadDemoPackage({ kind: "hosted", id: "AbCdEfGhIjKlMnOpQrStUv", key: "k" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DemoRetryError);
    expect(e).not.toBeInstanceOf(LinkGoneError);
    expect((e as Error).message).toBe("Too many apps were opened from this network today. Try again tomorrow, or on another network.");
    expect((e as Error).message).not.toMatch(/damaged/);
  }, 60_000); // demo.tsx brings the whole shell with it
});

describe("making a hosted link past the day's limit", () => {
  it("hostDemo says why the service would not take it", async () => {
    const { hostDemo, TooManyError } = await import("../src/share-service.js");
    answering(429, "too-many-links");
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    const e = await hostDemo({ appId: "groceries", zip: new Uint8Array([1, 2, 3]), meta: { title: "Groceries", description: "", lang: "en" } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TooManyError);
    expect(e).toMatchObject({ code: "too-many-links" });
  });

  it("says so in the share sheet when no link carrying the app would fit either", async () => {
    const { makeDemoLink } = await import("../src/demo-share.js");
    const { TooManyError } = await import("../src/share-service.js");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = { id: "groceries", name: "Groceries", source: "" } as never;
    const tooMany = (code: string) => () => Promise.reject(new TooManyError(429, code, 3600));
    await expect(makeDemoLink(app, { serviceUp: async () => true, host: tooMany("too-many-links"), origin: "https://potyro.app", pathname: "/" })).rejects.toThrow(
      "Too many links were made from this network today. Try again tomorrow, or on another network.",
    );
    await expect(makeDemoLink(app, { serviceUp: async () => true, host: tooMany("full-today"), origin: "https://potyro.app", pathname: "/" })).rejects.toThrow(
      "Potyro cannot keep more links today. Try again tomorrow.",
    );
    // Another failure keeps the old sentence: the app is too big for a link of its own.
    await expect(makeDemoLink(app, { serviceUp: async () => true, host: () => Promise.reject(new Error("boom")), origin: "https://potyro.app", pathname: "/" })).rejects.toThrow(/too big to fit in a link/);
  });
});
