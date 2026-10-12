// Loading a candidate must not keep it forever (#262).
//
// The eval loads every candidate the model sends — to check it, to read its shape, to run it — and
// each load used to IMPORT a freshly written module. Node never releases an imported module, and each
// one carries its own bundled copy of potyro (about 6 MB), so the paid `--run` eval reached a 4 GB
// heap and died at case 46 of 51. A loaded candidate must be garbage once nothing refers to it.

import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadApp } from "../src/score.js";
import { smokeApp } from "../src/smoke.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const heapMb = (): number => {
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1e6;
};

const examples = fileURLToPath(new URL("../../../examples/", import.meta.url));
const recipes = readFileSync(`${examples}recipes.app.tsx`, "utf8");

describe("loading many candidates", () => {
  it("releases each one: thirty distinct loads and runs grow the heap by far less than one copy each", async () => {
    // Warm up: the first load pulls in esbuild, potyro and React once, for good.
    await smokeApp((await loadApp(`${recipes}\n// warm`, examples)) as never);
    const before = heapMb();
    const quiet = console.warn;
    console.warn = () => {};
    try {
      for (let i = 0; i < 30; i++) await smokeApp((await loadApp(`${recipes}\n// candidate ${i}`, examples)) as never);
    } finally {
      console.warn = quiet;
    }
    // Retaining them all was ~6 MB a load (~190 MB here).
    expect(heapMb() - before).toBeLessThan(40);
  }, 120_000);

  it("still loads the app with its live functions and the harness's React", async () => {
    const app = (await loadApp(recipes, examples)) as unknown as { id: string; __potyroApp?: boolean; entities: Record<string, { computed?: Record<string, unknown> }> };
    expect(app.__potyroApp).toBe(true);
    expect(typeof app.entities.recipe!.computed!.calories).toBe("function");
  });
});
