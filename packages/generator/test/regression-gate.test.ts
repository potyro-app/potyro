// The run gate blocks only what a change BREAKS (#262).
//
// The first version judged a candidate by every failure its run reported. An app that already had
// one — an example whose computed read something its sample records lacked — could then never be
// changed: asked to add a 1–5 rating to recipes, the model said seven to ten times that the failures
// were the app's own and untouched, and the gate refused it each time (paid eval, 3/3 → 0/3). The
// gate now runs the app as first shown once, and only what is new in the candidate counts.

import { describe, expect, it } from "vitest";
import { describeRun, regressionGate, type RunReport } from "../src/run-report.js";

const report = (errors: string[], warnings: string[] = []): RunReport => ({ errors, warnings, ran: "2 pages" });

describe("regressionGate", () => {
  it("runs the original once, however many candidates it judges", async () => {
    const ran: string[] = [];
    const gate = regressionGate(async (src) => (ran.push(src), report([])), "ORIGINAL");
    await gate("a");
    await gate("b");
    await gate("c");
    expect(ran.filter((s) => s === "ORIGINAL")).toHaveLength(1);
    expect(ran).toHaveLength(4);
  });

  it("does not hold a failure the original already had against the candidate — ids and numbers aside", async () => {
    const gate = regressionGate(
      async (src) =>
        src === "ORIGINAL"
          ? report(["computed recipe.calories: no ingredient for record 4f2a91c0e7"], ['page "ready" showed none of the sample records'])
          : report(["computed recipe.calories: no ingredient for record 88b1d0aa31"], ['page "ready" showed none of the sample records']),
      "ORIGINAL",
    );
    const { report: introduced, preexisting } = await gate("candidate");
    expect(introduced.errors).toEqual([]);
    expect(introduced.warnings).toEqual([]);
    expect(preexisting.errors).toHaveLength(1);
    expect(preexisting.warnings).toHaveLength(1);
  });

  it("blocks what the candidate adds, and names what was already failing as context", async () => {
    const gate = regressionGate(
      async (src) => (src === "ORIGINAL" ? report(["computed recipe.calories: old"]) : report(["computed recipe.calories: old", "action recipe.rate: ctx.stars is not a function"])),
      "ORIGINAL",
    );
    const gated = await gate("candidate");
    expect(gated.report.errors).toEqual(["action recipe.rate: ctx.stars is not a function"]);
    const words = describeRun(gated.report, gated.preexisting);
    expect(words).toContain("ctx.stars is not a function");
    expect(words).toMatch(/already failing before this change[^\n]*not caused by it/i);
    expect(words).toContain("computed recipe.calories: old");
  });

  it("treats an original that cannot run as having no failures, rather than failing every candidate", async () => {
    const gate = regressionGate(async (src) => {
      if (src === "ORIGINAL") throw new Error("no DOM");
      return report(["boom"]);
    }, "ORIGINAL");
    expect((await gate("candidate")).report.errors).toEqual(["boom"]);
  });

  it("does not warn about a NEW page that matches no sample records; does warn about a page that stopped showing them", async () => {
    const gate = regressionGate(
      async (src) =>
        src === "ORIGINAL"
          ? { errors: [], warnings: [], ran: "2 pages", pages: ["all", "today"] }
          : {
              errors: [],
              warnings: ['page "favourites" showed none of the sample records — a filter that can never match?', 'page "today" showed none of the sample records — a filter that can never match?'],
              ran: "3 pages",
              pages: ["all", "today", "favourites"],
            },
      "ORIGINAL",
    );
    const { report } = await gate("candidate");
    expect(report.warnings).toEqual(['page "today" showed none of the sample records — a filter that can never match?']);
  });

  it("keeps a warning about a new page when the original's pages are unknown", async () => {
    const gate = regressionGate(async (src) => (src === "ORIGINAL" ? report([]) : report([], ['page "favourites" showed nothing at all'])), "ORIGINAL");
    expect((await gate("candidate")).report.warnings).toEqual(['page "favourites" showed nothing at all']);
  });
});
