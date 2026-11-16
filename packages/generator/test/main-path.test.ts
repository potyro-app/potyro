import { describe, expect, it } from "vitest";
import { MAIN_PATH_PROMPTS, featurePlacement, summarizeMainPath } from "../src/main-path.js";
import { scoreSource } from "../src/score.js";
import { loadCorpus } from "../src/load-corpus.js";
import { appFiles, exampleFromCorpus } from "../src/corpus.js";

// Where the feature a request names sits in the app that was made (#78): the create eval's scenario
// and its checker, on fixture apps. No model is called here; `eval:cli -- --corpus main-path` is the
// paid run, and is not run by any test.

const USES = MAIN_PATH_PROMPTS[0]!.uses;

/** A wine cellar; each fixture says where the label scan is. */
const app = (o: { fill?: string; actions?: string; pages: string; top?: string; wineryFill?: string }): string => `import { defineApp, type Ctx } from "potyro";

/** Reads a label: the camera, then the AI. */
async function readLabel(ctx: Ctx): Promise<{ name?: string; vintage?: number } | null> {
  const photo = await takePicture(ctx);
  if (!photo || !ctx.caps.ai) return null;
  return ctx.caps.ai.extract({ image: photo, instructions: "Read this wine label.", schema: { name: "string", vintage: "number" } });
}
const takePicture = async (ctx: Ctx): Promise<Blob | null> => (ctx.caps.camera ? ctx.caps.camera.capture({ source: "camera" }) : null);
${o.top ?? ""}
export default defineApp({
  id: "cellar",
  name: "Cellar",
  version: "1.0.0",
  schemaVersion: 1,
  capabilities: ["camera", "ai"],
  entities: {
    winery: {
      fields: { name: { type: "text", label: "Name", required: true } },${o.wineryFill ?? ""}
    },
    bottle: {
      label: "Bottle",
      displayField: "name",
      fields: {
        name: { type: "text", label: "Name", required: true },
        vintage: { type: "number", label: "Vintage" },
      },${o.fill ?? ""}${o.actions ?? ""}
    },
  },
  pages: [${o.pages}],
});
`;

const LIST = `{ id: "cellar", title: "Cellar", view: { type: "list", entity: "bottle" } }`;
const WINERIES = `{ id: "wineries", title: "Wineries", view: { type: "list", entity: "winery" } }`;
const FILL = `\n      fill: [{ label: "Scan label", icon: "camera", description: "Reads the label with AI", run: async (_draft, ctx) => readLabel(ctx) }],`;
const SCAN_ACTION = `{ label: "Scan a bottle", icon: "camera", run: async (ctx) => { const read = await readLabel(ctx); if (read?.name) await ctx.data.create("bottle", read); } }`;
const OTHER_ACTION = `{ label: "Sort", run: async (ctx) => { ctx.ui.toast("Sorted"); } }`;

describe("where the feature a request names sits (#78)", () => {
  it("the main record's form fills from the photo: on the main path, through two helpers", async () => {
    const source = app({ fill: FILL, pages: LIST });
    expect(await featurePlacement(source, USES)).toEqual({ where: "form-fill", onMainPath: true, mainEntity: "bottle", found: ["bottle.fill[0]"] });
  });

  it("that shape is a real app: it compiles and validates", async () => {
    const score = await scoreSource(app({ fill: FILL, pages: LIST }));
    expect(score.errors).toEqual([]);
    expect(score.validates).toBe(true);
  }, 60_000);

  it("a fill named by reference, and one written as a method, are read the same", async () => {
    const byName = app({ top: "const scan = async (_d: unknown, ctx: Ctx) => readLabel(ctx);\n", fill: `\n      fill: [{ label: "Scan label", run: scan }],`, pages: LIST });
    const method = app({ fill: `\n      fill: [{ label: "Scan label", async run(_draft, ctx) { return readLabel(ctx); } }],`, pages: LIST });
    for (const source of [byName, method]) expect(await featurePlacement(source, USES)).toMatchObject({ where: "form-fill", onMainPath: true });
  });

  it("the first page's first button makes the record from the photo: on the main path", async () => {
    const source = app({ pages: `{ id: "cellar", title: "Cellar", actions: [${SCAN_ACTION}], view: { type: "list", entity: "bottle" } }` });
    expect(await featurePlacement(source, USES)).toEqual({ where: "first-page-action", onMainPath: true, mainEntity: "bottle", found: ["pages[0].actions[0]"] });
  });

  it("a later button of the first page is on the main path only when the page makes it its primary action or its add", async () => {
    const later = (extra: string): string => app({ pages: `{ id: "cellar", title: "Cellar",${extra} actions: [${OTHER_ACTION}, ${SCAN_ACTION}], view: { type: "list", entity: "bottle" } }` });
    expect(await featurePlacement(later(""), USES)).toMatchObject({ where: "first-page-button", onMainPath: false, found: ["pages[0].actions[1]"] });
    expect(await featurePlacement(later(" primaryAction: 1,"), USES)).toMatchObject({ where: "first-page-action", onMainPath: true });
    expect(await featurePlacement(later(" add: 1,"), USES)).toMatchObject({ where: "first-page-action", onMainPath: true });
  });

  it("the first page is the app's own view and it takes the picture: on the main path", async () => {
    const source = app({
      top: `function Scanner({ ctx }: { ctx: Ctx }) { return <button onClick={() => void readLabel(ctx)}>Scan</button>; }\n`,
      pages: `{ id: "scan", title: "Scan", view: { type: "custom", entity: "bottle", render: (props) => <Scanner ctx={props.ctx} /> } }, ${LIST}`,
    });
    expect(await featurePlacement(source, USES)).toMatchObject({ where: "first-page-view", onMainPath: true, found: ["pages[0].view"] });
  });

  // The app #78 was opened on: a plain form, and the scan on the saved record.
  it("only on a saved record's action: NOT on the main path", async () => {
    const source = app({ actions: `\n      actions: { scan: { label: "Scan label", run: async (r, ctx) => { const read = await readLabel(ctx); if (read) await ctx.data.update("bottle", r.id, read); } } },`, pages: LIST });
    expect(await featurePlacement(source, USES)).toEqual({ where: "elsewhere", onMainPath: false, mainEntity: "bottle", found: ["bottle.actions.scan"] });
  });

  it("on another page, or on another kind of record's form: NOT on the main path", async () => {
    const otherPage = app({ pages: `${LIST}, { id: "scan", title: "Scan", actions: [${SCAN_ACTION}], view: { type: "list", entity: "bottle" } }` });
    expect(await featurePlacement(otherPage, USES)).toMatchObject({ where: "elsewhere", onMainPath: false, found: ["pages[1].actions[0]"] });
    const otherForm = app({ wineryFill: `\n      fill: [{ label: "Scan", run: async (_d, ctx) => readLabel(ctx) }],`, pages: LIST });
    expect(await featurePlacement(otherForm, USES)).toMatchObject({ where: "elsewhere", onMainPath: false, mainEntity: "bottle", found: ["winery.fill[0]"] });
  });

  it("the main record is the one the FIRST page shows, wherever it is declared", async () => {
    const source = app({ wineryFill: `\n      fill: [{ label: "Scan", run: async (_d, ctx) => readLabel(ctx) }],`, pages: `${WINERIES}, ${LIST}` });
    expect(await featurePlacement(source, USES)).toMatchObject({ where: "form-fill", onMainPath: true, mainEntity: "winery" });
  });

  it("a camera icon on a button that takes no picture is not the feature", async () => {
    const source = app({ fill: `\n      fill: [{ label: "Scan label", icon: "camera", run: async () => ({ name: "A bottle" }) }],`, pages: `{ id: "cellar", title: "Cellar", icon: "camera", view: { type: "list", entity: "bottle" } }` });
    expect(await featurePlacement(source, USES)).toEqual({ where: "absent", onMainPath: false, mainEntity: "bottle", found: [] });
  });

  it("in several places, the best one is named and all are listed", async () => {
    const source = app({ fill: FILL, actions: `\n      actions: { rescan: async (r, ctx) => { await readLabel(ctx); } },`, pages: LIST });
    expect(await featurePlacement(source, USES)).toMatchObject({ where: "form-fill", onMainPath: true, found: ["bottle.fill[0]", "bottle.actions.rescan"] });
  });

  it("a source that is not an app is not judged", async () => {
    expect(await featurePlacement("this is not code {", USES)).toBeNull();
    expect(await featurePlacement("export const x = 1;", USES)).toBeNull();
  });

  it("summarises a run: how many on the main path, and where the rest are", async () => {
    const checks = await Promise.all([
      featurePlacement(app({ fill: FILL, pages: LIST }), USES),
      featurePlacement(app({ pages: `${LIST}, { id: "scan", title: "Scan", actions: [${SCAN_ACTION}], view: { type: "list", entity: "bottle" } }` }), USES),
      featurePlacement(app({ pages: LIST }), USES),
      featurePlacement("nope {", USES),
    ]);
    expect(summarizeMainPath(checks)).toEqual({ checked: 3, onMainPath: 1, where: { "form-fill": 1, "first-page-action": 0, "first-page-view": 0, "first-page-button": 0, elsewhere: 1, absent: 1 } });
  });
});

describe("the scenario's requests", () => {
  it("each names its feature and what its code must reach, with an id of its own", () => {
    expect(new Set(MAIN_PATH_PROMPTS.map((p) => p.id)).size).toBe(MAIN_PATH_PROMPTS.length);
    for (const p of MAIN_PATH_PROMPTS) {
      expect(p.feature.length, p.id).toBeGreaterThan(10);
      expect(() => new RegExp(p.uses, "i"), p.id).not.toThrow();
      expect(p.tags, p.id).toContain("main-path");
    }
    // The request the issue was opened on, word for word.
    expect(MAIN_PATH_PROMPTS[0]!.description).toBe("an app where I take a photo of a wine bottle and it extracts the details");
  });
});

describe("the corpus has the shape to copy (#78)", () => {
  it("an app whose form starts a record from a photo, and `example` finds it by `fill`", async () => {
    const corpus = await loadCorpus();
    const withFill = appFiles(corpus).filter((f) => /^\s*fill\s*:\s*\[/m.test(f.text));
    expect(withFill.map((f) => f.path)).toContain("apps/poster-event/poster-event.app.ts");
    // What its button runs takes the picture and reads it: the module beside it, in the corpus too.
    const read = corpus.files.find((f) => f.path === "apps/poster-event/read.ts")!;
    expect(read.text).toMatch(/export async function fillFromPoster/);
    expect(read.text).toMatch(/ctx\.caps\.camera\.capture/);
    expect(exampleFromCorpus(corpus, "fill:")).toMatch(/^--- apps\/poster-event\/poster-event\.app\.ts/);
  });
});
