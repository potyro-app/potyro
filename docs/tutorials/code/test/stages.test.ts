// Every stage of every tutorial's app, as the tutorial shows it: it is a valid app (`defineApp`
// throws when it is not), and `potyro pack` packs it with a full description of what it keeps — the
// two things a reader does with it before anything else.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync, strFromU8 } from "fflate";
// @ts-expect-error — a plain JS module, no types
import { pack } from "../../../../packages/schema/cli/pack.mjs";

const here = join(import.meta.dirname, "..");
const stages = readdirSync(here)
  .filter((d) => /^\d\d-/.test(d))
  .flatMap((tutorial) =>
    readdirSync(join(here, tutorial))
      .filter((s) => statSync(join(here, tutorial, s)).isDirectory())
      .map((stage) => join(tutorial, stage)),
  );

describe("the tutorials' code", () => {
  it("has stages to check", () => expect(stages.length).toBeGreaterThan(0));

  it.each(stages)("%s is a valid app and packs", async (stage) => {
    const dir = join(here, stage);
    const source = readdirSync(dir).find((n) => /\.app\.tsx?$/.test(n))!;
    const app = (await import(join(dir, source))).default;
    expect(app.__potyroApp).toBe(true);

    const out = join(tmpdir(), `tutorial-${stage.replace(/\W+/g, "-")}.zip`);
    const zip = await pack(["-o", out], { cwd: dir, log: () => {}, warn: (m: string) => { throw new Error(m); } });
    const manifest = JSON.parse(strFromU8(unzipSync(readFileSync(zip))["manifest.json"]!));
    expect(manifest.app.id).toBe(app.id);
  });
});
