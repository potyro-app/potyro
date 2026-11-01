// A made demo link says whether it opens on sample records (docs/24 §3): what the share sheet then
// tells the person. An inline link too long with its records is made without them, and says so.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_INLINE_CHARS } from "../src/demo-link.js";

const BIG = new Uint8Array(MAX_INLINE_CHARS).map((_, i) => (i * 7919) % 251);
const SMALL = new Uint8Array([1, 2, 3, 4]);
const demo = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/demo-package.js", () => ({ demoPackageFor: async () => demo.value }));

const app = { id: "groceries", name: "Groceries", source: "" } as never;
const at = { serviceUp: async () => false, origin: "https://potyro.app", pathname: "/" };
const seed = { item: [{ name: "Milk" }] };

let makeDemoLink: typeof import("../src/demo-share.js").makeDemoLink;
beforeAll(async () => {
  ({ makeDemoLink } = await import("../src/demo-share.js"));
}, 60_000); // the first import compiles the share path

afterEach(() => vi.unstubAllGlobals());

describe("a made demo link and its sample records", () => {
  it("hosted, it opens on them when the package has them, and empty when it has none", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    const host = async () => "https://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv";
    demo.value = { zip: SMALL, entities: ["item"], seed, credit: { name: "Groceries" }, pictures: false };
    expect(await makeDemoLink(app, { ...at, serviceUp: async () => true, host })).toMatchObject({ hosted: true, samples: true });
    demo.value = { zip: SMALL, entities: ["item"], credit: { name: "Watering" }, pictures: false };
    expect(await makeDemoLink(app, { ...at, serviceUp: async () => true, host })).toMatchObject({ hosted: true, samples: false });
  });

  it("inline, it carries them when they fit", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    demo.value = { zip: SMALL, bare: SMALL, entities: ["item"], seed, credit: { name: "Groceries" }, pictures: false };
    expect(await makeDemoLink(app, at)).toMatchObject({ hosted: false, samples: true });
  });

  it("inline and too long with them, it is made without them and says it opens empty", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    demo.value = { zip: BIG, bare: SMALL, entities: ["item"], seed, credit: { name: "Groceries" }, pictures: false };
    expect(await makeDemoLink(app, at)).toMatchObject({ hosted: false, samples: false });
  });
});
