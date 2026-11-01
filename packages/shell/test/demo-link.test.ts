// Demo links (docs/24): what the link carries, how it is read back, and what is never in it.
import { describe, expect, it } from "vitest";
import { readAppPackage } from "@potyro/store";
import { fromBase64Url, inlineDemoLink, MAX_INLINE_CHARS, readDemoLink, siteBase, toBase64Url } from "../src/demo-link.js";
import { demoSeed, packDemo } from "../src/demo-package.js";
import { shareCounts, shareEvent } from "../src/share-events.js";

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({ id: "groceries", name: "Groceries", entities: {}, pages: [] } as never);
`;

describe("demo link encoding", () => {
  it("base64url round-trips any bytes, with nothing a URL would mangle", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 131) % 256);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it("reads an inline link back from the fragment", () => {
    const zip = new Uint8Array([80, 75, 3, 4, 9, 9]);
    const link = inlineDemoLink(zip, "https://apps.example", "/")!;
    const url = new URL(link);
    expect(url.pathname).toBe("/");
    const read = readDemoLink(url.pathname, url.hash);
    expect(read).toEqual({ kind: "inline", zip });
  });

  it("reads a hosted link: the id from the path, the key from the fragment", () => {
    expect(readDemoLink("/s/AbCdEfGhIjKlMnOpQrStUv", "#k=secret")).toEqual({ kind: "hosted", id: "AbCdEfGhIjKlMnOpQrStUv", key: "secret" });
    // without its key it is not a link this device can open
    expect(readDemoLink("/s/AbCdEfGhIjKlMnOpQrStUv", "")).toBeNull();
    expect(readDemoLink("/", "#join=xyz")).toBeNull();
    expect(readDemoLink("/s/../../etc", "#k=x")).toBeNull();
  });

  it("is refused when it would be too long to send", () => {
    expect(inlineDemoLink(new Uint8Array(MAX_INLINE_CHARS), "https://a.example", "/")).toBeNull();
  });

  it("knows the site's base under a hosted link", () => {
    expect(siteBase("/s/abc")).toBe("/");
    expect(siteBase("/potyro/s/abc/")).toBe("/potyro/");
    expect(siteBase("/")).toBe("/");
    expect(siteBase("/potyro")).toBe("/potyro/");
  });
});

describe("the demo package", () => {
  it("carries the app's own sample records, never with store fields or a person's id", async () => {
    const seed = await demoSeed("groceries", ["item", "aisle"]);
    expect(seed?.item?.length).toBeGreaterThan(3);
    expect(seed?.aisle?.length).toBeGreaterThan(0);
    for (const row of [...seed!.item!, ...seed!.aisle!]) {
      expect(row).not.toHaveProperty("createdAt");
      expect(row).not.toHaveProperty("updatedAt");
      expect(typeof row.id).toBe("string");
    }
    // relations still point at rows that came with it
    const aisles = new Set(seed!.aisle!.map((a) => a.id));
    for (const item of seed!.item!) expect(aisles.has(item.aisle)).toBe(true);
  });

  it("names nobody: Split's sample expenses come without a payer, which the app reads as the viewer", async () => {
    const seed = await demoSeed("split", ["group", "expense"]);
    expect(seed?.group?.map((g) => g.name)).toEqual(["Lisbon weekend", "Flat"]);
    expect(seed?.expense?.length).toBe(13);
    expect(seed?.expense?.some((e) => "paidBy" in e)).toBe(false);
    // The itemized dinner keeps its receipt as the file it shipped with.
    expect(seed?.expense?.find((e) => e.description === "Tasca da Esquina")?.receipt).toEqual({ file: "receipts/tasca-da-esquina.webp" });
  });

  it("an app without sample data of its own comes empty", async () => {
    expect(await demoSeed("someones-own-app", ["thing"])).toBeUndefined();
  });

  it("an app added from a package carries the seed its package came with, for the entities it keeps", async () => {
    const kept = { checkin: [{ date: "2026-09-21", hours: 7.25 }], gone: [{ x: 1 }] };
    expect(await demoSeed("mood-sleep", ["checkin"], kept)).toEqual({ checkin: [{ date: "2026-09-21", hours: 7.25 }] });
    expect(await demoSeed("mood-sleep", ["checkin"], { checkin: [] })).toBeUndefined();
  });

  it("with the app's definition at hand, only the rows its write gate takes travel — a required field missing is fine", async () => {
    const kept = { checkin: [{ date: "2026-09-21", hours: 7.25 }, { date: "2026-09-22", hours: 30 }, { hours: 6 }] };
    const defined = { checkin: { fields: { date: { type: "datetime", required: true }, hours: { type: "number", min: 0, max: 24 } } } } as never;
    expect(await demoSeed("mood-sleep", ["checkin"], kept, defined)).toEqual({ checkin: [{ date: "2026-09-21", hours: 7.25 }, { hours: 6 }] });
    expect(kept.checkin).toHaveLength(3);
  });

  it("a demo link of an app added from a package opens on the package's seed (Sleep & Mood, Notes…)", async () => {
    const source = `import { defineApp } from "potyro";
export default defineApp({ id: "mood-sleep", name: "Sleep & Mood", version: "1.0.0", schemaVersion: 1, entities: { checkin: { fields: { date: { type: "date" } } } }, pages: [{ id: "all", title: "All", view: { type: "list", entity: "checkin" } }] });
`;
    const { demoPackageFor } = await import("../src/demo-package.js");
    // Where its definition cannot be read (here: no bundler outside a browser), the seed goes as kept.
    const demo = await demoPackageFor({ id: "mood-sleep", name: "Sleep & Mood", source, updatedAt: "2026-10-16", seed: { checkin: [{ date: "2026-09-21" }] } }, { entitiesOf: async () => undefined });
    expect(readAppPackage(demo.zip).seed).toEqual({ checkin: [{ date: "2026-09-21" }] });
    // And the app without them, for an inline link that would be too long with them.
    expect(demo.bare).toBeDefined();
    expect(readAppPackage(demo.bare!).seed).toBeUndefined();
  });

  it("fits a kept seed to the app as it is now when the link is made (#486), and leaves the kept one as it is", async () => {
    const source = `import { defineApp } from "potyro";
export default defineApp({ id: "watering", name: "Watering", version: "1.0.0", schemaVersion: 1, entities: { plant: { fields: { name: { type: "text" }, light: { type: "enum", options: ["shade"] } } } }, pages: [{ id: "all", title: "All", view: { type: "list", entity: "plant" } }] });
`;
    const kept = { plant: [{ id: "p1", name: "Monstera", light: "shade" }, { id: "p2", name: "Lemon tree", light: "sun" }] };
    const app = { id: "watering", name: "Watering", source, updatedAt: "2026-10-31", seed: kept };
    const entities = { plant: { fields: { name: { type: "text" }, light: { type: "enum", options: ["shade"] } } } } as never;
    const { demoPackageFor, linkHasSamples } = await import("../src/demo-package.js");
    const demo = await demoPackageFor(app, { entitiesOf: async () => entities });
    expect(readAppPackage(demo.zip).seed).toEqual({ plant: [kept.plant[0]] });
    expect(demo.seed).toEqual({ plant: [kept.plant[0]] });
    expect(app.seed).toEqual({ plant: [{ id: "p1", name: "Monstera", light: "shade" }, { id: "p2", name: "Lemon tree", light: "sun" }] });
    // A version none of whose rows fits opens empty, and the sheet can say so before the link is made.
    const none = await demoPackageFor(app, { entitiesOf: async () => ({ plant: { fields: { light: { type: "enum", options: ["bright"] } } } }) as never });
    expect(none.seed).toBeUndefined();
    expect(await linkHasSamples({ id: "watering", name: "Watering", source: "other", updatedAt: "2026-10-31" })).toBe(false);
  });

  it("packs the source, its own modules, shipped files, demo records and credit — never library bytes", () => {
    const zip = packDemo({
      app: { id: "groceries", name: "Groceries", source: SOURCE, lock: undefined },
      entities: ["item"],
      code: [
        { path: ".src/plan.ts", data: new TextEncoder().encode("export const x = 1;") },
        { path: ".modules/sha-abc.js", data: new TextEncoder().encode("library bytes") },
      ],
      files: [{ path: "levels.json", data: new TextEncoder().encode("[1,2]"), mime: "application/json" }],
      seed: { item: [{ id: "1", name: "Apples" }] },
      credit: { name: "Groceries", by: "Ana" },
    });
    const pkg = readAppPackage(zip);
    expect(pkg.source).toBe(SOURCE);
    expect(pkg.modules.map((m) => m.path)).toEqual(["plan.ts"]);
    expect(pkg.files.map((f) => f.path)).toEqual(["levels.json"]);
    expect(pkg.seed).toEqual({ item: [{ id: "1", name: "Apples" }] });
    expect(pkg.credit).toEqual({ name: "Groceries", by: "Ana" });
  });
});

describe("share events", () => {
  it("count on this device and say so with a DOM event, carrying nothing but the kind", () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: Storage; dispatchEvent?: (e: Event) => boolean };
    const before = { ls: g.localStorage, de: g.dispatchEvent };
    const seen: unknown[] = [];
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    g.dispatchEvent = (e: Event) => (seen.push((e as CustomEvent).detail), true);
    try {
      shareEvent("demo-opened");
      shareEvent("demo-opened");
      shareEvent("demo-kept");
      expect(shareCounts()).toEqual({ "demo-opened": 2, "demo-kept": 1 });
      expect(seen).toEqual([{ event: "demo-opened" }, { event: "demo-opened" }, { event: "demo-kept" }]);
    } finally {
      g.localStorage = before.ls;
      g.dispatchEvent = before.de;
    }
  });
});
