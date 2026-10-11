// @vitest-environment happy-dom
//
// Running a candidate before the modify loop accepts it (#262): what threw while its logic ran, and
// what its pages did when they were actually mounted. Composed DIRECT here through the test seam —
// the real path is the isolate, which needs the browser's esbuild-WASM; what is under test is what
// the run does with a runtime, which is the same at both provenances.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { defineApp, type PotyroApp } from "potyro";
import { FakeCapabilities } from "@potyro/capabilities";
import type { MemoryStore } from "@potyro/store";
import { compose } from "../src/compose.js";
import { createNavBridge } from "../src/ui-bridge.js";
import { runCandidate } from "../src/run-candidate.js";

afterEach(() => vi.restoreAllMocks());

const direct = (app: PotyroApp) => (_source: string, store: MemoryStore) =>
  compose({
    provenance: "trusted",
    app,
    store,
    caps: new FakeCapabilities(),
    ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
    nav: createNavBridge(() => {}),
  });

function notes(over: { kcal?: (r: never, ctx: never) => unknown; custom?: () => unknown } = {}): PotyroApp {
  return defineApp({
    id: "notes-check",
    name: "Notes",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      note: {
        label: "Note",
        displayField: "title",
        fields: { title: { type: "text", required: true } },
        ...(over.kcal ? { computed: { kcal: over.kcal } } : {}),
      },
    },
    pages: [
      { id: "all", title: "All", view: { type: "list", entity: "note", display: { primary: "title" } } },
      ...(over.custom ? [{ id: "board", title: "Board", view: { type: "custom", entity: "note", render: over.custom } }] : []),
    ],
  } as never);
}

const quiet = () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
};

describe("runCandidate", () => {
  it("passes an app whose logic runs and whose pages show their records", async () => {
    const report = await runCandidate("", { compose: direct(notes()), settleMs: 400 });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ran).toContain("3 records");
    expect(report.ran).toContain("1 page rendered");
  });

  it("reports a computed that throws, though the page still loads", async () => {
    quiet();
    const report = await runCandidate("", {
      compose: direct(notes({ kcal: (_r, ctx) => (ctx as unknown as { nutrition: { lookup(): number } }).nutrition.lookup() })),
      settleMs: 400,
    });
    expect(report.errors.join("\n")).toMatch(/computed note\.kcal/);
  });

  it("reports a page that crashes when it is mounted", async () => {
    quiet();
    const report = await runCandidate("", {
      compose: direct(
        notes({
          custom: () => {
            throw new Error("cannot read properties of undefined (reading 'steps')");
          },
        }),
      ),
      settleMs: 400,
    });
    expect(report.errors).toContain(`page "board" crashed while showing: cannot read properties of undefined (reading 'steps')`);
  });

  it("points out a page that shows nothing at all", async () => {
    const report = await runCandidate("", { compose: direct(notes({ custom: () => createElement("div") })), settleMs: 400 });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toContain('page "board" showed nothing at all');
  });
});
