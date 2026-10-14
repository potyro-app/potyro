import { describe, expect, it } from "vitest";
import { buildCorpus, exampleFromCorpus, inCorpus, primeCorpus, primeGroups, readCorpus, searchCorpus, type Corpus } from "../src/corpus.js";
import { collectCatalogWords, collectCorpusFiles } from "../src/corpus-files.js";
import { CORPUS } from "../src/corpus.generated.js";
import { loadCorpus } from "../src/load-corpus.js";

// The corpus is what the model can read about how real apps are built (#262). These tests are its
// no-drift guarantee (like reference.test.ts) and pin what the search and read tools answer.

const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n");

const small: Corpus = buildCorpus([
  { path: "examples/notes.app.ts", text: 'export default defineApp({ id: "notes", entities: { note: { fields: { body: text() } } } });' },
  {
    path: "apps/big/big.app.tsx",
    text: lines(700, (i) => (i === 300 ? '  const plan = await ctx.files.read("plan.json");' : `  // line ${i}, long enough to make a big app`)),
  },
  { path: "docs/04-app-module-api.md", text: "# ctx\n\nctx.files reads the app's own folder.\n\nctx.caps.camera takes a photo." },
]);

describe("corpus sources", () => {
  it("takes example and personal app modules, the API docs and the schema types — nothing else", () => {
    for (const p of ["examples/recipes.app.tsx", "apps/piano/piano.app.tsx", "apps/piano/plan.ts", "apps/piano/README.md", "docs/04-app-module-api.md", "packages/schema/src/types/ctx.ts"]) {
      expect(inCorpus(p), p).toBe(true);
    }
    for (const p of ["examples/test/recipes.test.ts", "apps/piano/vitest.config.ts", "apps/piano/test/plan.test.ts", "docs/16-ci.md", "packages/schema/src/index.ts", "apps/piano/dist/piano.potyro-app.zip"]) {
      expect(inCorpus(p), p).toBe(false);
    }
  });

  it("is up to date with the repository (run `pnpm --filter @potyro/generator gen:corpus`)", () => {
    const fresh = buildCorpus(collectCorpusFiles(), collectCatalogWords());
    expect(CORPUS.files.map((f) => f.path)).toEqual(fresh.files.map((f) => f.path));
    expect(CORPUS.version).toBe(fresh.version);
  });

  it("has a version that changes with any file's text", () => {
    const a = buildCorpus([{ path: "x", text: "1" }]);
    expect(buildCorpus([{ path: "x", text: "1" }]).version).toBe(a.version);
    expect(buildCorpus([{ path: "x", text: "2" }]).version).not.toBe(a.version);
  });

  it("loads lazily as the same corpus", async () => {
    expect((await loadCorpus()).version).toBe(CORPUS.version);
  });
});

describe("searchCorpus", () => {
  it("returns the passage that has every term, with its path and lines", () => {
    const out = searchCorpus(small, "ctx.files read");
    expect(out).toContain("apps/big/big.app.tsx:");
    expect(out).toContain('ctx.files.read("plan.json")');
  });

  it("puts a passage with all the terms first", () => {
    const out = searchCorpus(small, "camera photo");
    expect(out.startsWith("--- docs/04-app-module-api.md")).toBe(true);
  });

  it("says plainly when nothing matches", () => {
    expect(searchCorpus(small, "bluetooth")).toMatch(/Nothing .* mentions "bluetooth"/);
  });

  it("stays within its cap on the real corpus", () => {
    expect(searchCorpus(CORPUS, "custom view").length).toBeLessThan(6500);
  });
});

describe("readCorpus", () => {
  it("shows a file from a line, and how to continue", () => {
    const out = readCorpus(small, "apps/big/big.app.tsx", 290);
    expect(out).toContain("ctx.files.read");
    expect(out).toMatch(/lines 290-489 of 700; read\("apps\/big\/big.app.tsx", 490\) continues/);
  });

  it("names the files it has when the path is wrong", () => {
    expect(readCorpus(small, "big.app.tsx")).toContain("apps/big/big.app.tsx");
  });
});

describe("exampleFromCorpus", () => {
  it("returns a small app whole", () => {
    expect(exampleFromCorpus(small, "defineApp")).toContain("(whole file)");
  });

  it("returns a big app around the feature, with a pointer to the rest", () => {
    const out = exampleFromCorpus(small, "ctx.files")!;
    expect(out).toContain('ctx.files.read("plan.json")');
    expect(out).toContain('read("apps/big/big.app.tsx")');
    expect(out).not.toContain("// line 10,");
  });

  it("is undefined when no app uses it", () => {
    expect(exampleFromCorpus(small, "ctx.bluetooth")).toBeUndefined();
  });
});

describe("primeCorpus — retrieval done by the harness before the first turn (#262)", () => {
  const corpus = buildCorpus([
    { path: "examples/recipes.app.tsx", text: 'export default defineApp({ id: "recipes", entities: { recipe: { fields: { rating: { type: "number", min: 1, max: 5 } } } } });' },
    { path: "examples/places.app.ts", text: 'export default defineApp({ id: "places", pages: [{ id: "map", view: { type: "map", entity: "place", camera: { lat: 1, lng: 2 } } }] });' },
    { path: "docs/04-app-module-api.md", text: "## Map camera\n\nA map view takes `camera` to open on a place. The camera can be a function of ctx." },
    { path: "packages/schema/src/types/app.ts", text: "export interface MapView { camera?: Dynamic<MapCamera>; }" },
  ]);
  const editing = 'export default defineApp({ id: "trips", pages: [{ id: "all", view: { type: "list", entity: "trip" } }] });';

  it("puts the passages that answer the request first, from at most two files, with their paths", () => {
    const out = primeCorpus(corpus, "open the map on the camera position of the selected place", editing);
    expect(out).toContain("docs/04-app-module-api.md");
    expect(out).toContain("examples/places.app.ts");
    expect(out).not.toContain("recipes.app.tsx");
    expect((out.match(/^--- /gm) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("never offers the app being edited back to itself", () => {
    const self = 'export default defineApp({ id: "recipes", entities: {} });';
    expect(primeCorpus(corpus, "add a rating to recipes", self)).not.toContain("recipes.app.tsx");
  });

  it("is empty when nothing in the corpus speaks to the request", () => {
    expect(primeCorpus(corpus, "bluetooth heart-rate pairing", editing)).toBe("");
  });

  describe("a request in another language (#306 follow-up)", () => {
    const multi = buildCorpus(
      [
        ...corpus.files,
        // Words in two languages, under packages/ so priming never quotes it: what teaches "mapa".
        { path: "packages/demo/trips.app.ts", text: 'export default defineApp({ id: "tripsx", pages: [{ id: "m", title: { en: "Map", pl: "Mapa" } }], entities: { place: { label: { en: "Place", pl: "Miejsce" }, fields: { camera: { type: "text", label: { en: "Camera", pl: "Kamera" } } } } } });' },
      ],
      [["pl", "Pozycja", "Position"]],
    );

    it("primes a Polish request with what the English one gets", () => {
      const en = primeCorpus(multi, "open the map on the camera position of the selected place", editing, "en");
      const pl = primeCorpus(multi, "otwórz mapę na pozycji kamery wybranego miejsca", editing, "pl");
      expect(en).toContain("examples/places.app.ts");
      expect(pl).toContain("examples/places.app.ts");
    });

    it("reads a request's language off it when the loop was not told", () => {
      expect(primeGroups(multi, "otwórz mapę na pozycji kamery wybranego miejsca", editing).some((g) => g.includes("map"))).toBe(true);
    });

    it("matches an English request word for word, even where a word looks like another language's", () => {
      expect(primeGroups(multi, "open the map on the camera position", editing, "en").every((g) => g.length === 1)).toBe(true);
    });

    it("learns the words of the app being edited, even one written only in Polish", () => {
      const polish = 'export default defineApp({ id: "mine", entities: { item: { fields: { rating: { type: "number", label: "Ocena" } } } } });';
      expect(primeGroups(multi, "dodaj ocenę do przepisów", polish, "pl")[1]).toEqual(["ocenę", "rating"]);
    });
  });

  it("stays small", () => {
    expect(primeCorpus(CORPUS, "a custom view with a canvas that draws the week", editing).length).toBeLessThan(3500);
  });
});
