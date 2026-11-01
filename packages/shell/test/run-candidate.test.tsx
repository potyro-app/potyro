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
import { regressionGate } from "@potyro/generator/backends";
import { activeFailureListeners } from "@potyro/host";

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
  it("says which entities the app it ran keeps — never the records it made up to run it on (#486)", async () => {
    const app = defineApp({
      id: "notes-seed",
      name: "Notes",
      version: "1.0.0",
      schemaVersion: 1,
      entities: { note: { label: "Note", displayField: "title", fields: { title: { type: "text", required: true }, done: { type: "boolean" } } } },
      pages: [{ id: "all", title: "All", view: { type: "list", entity: "note", display: { primary: "title" } } }],
    } as never);
    const report = await runCandidate("", { compose: direct(app), settleMs: 400 });
    expect(report.errors).toEqual([]);
    expect(Object.keys(report.entities ?? {})).toEqual(["note"]);
    expect(report.entities?.note?.fields.title).toMatchObject({ type: "text", required: true });
    // The run's own rows ("title 1") stay in the run: nothing of them comes back.
    expect(JSON.stringify(report)).not.toContain("title 1");
    expect(report).not.toHaveProperty("seed");
  });

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

describe("the Studio's gate is a regression gate (#262)", () => {
  // The source string picks the app: the original already has a failing computed; the candidate keeps
  // it and adds a field — or adds a crashing page.
  const broken = (_r: never, ctx: never) => (ctx as unknown as { nutrition: { lookup(): number } }).nutrition.lookup();
  const apps: Record<string, PotyroApp> = {
    original: notes({ kcal: broken }),
    "adds-a-field": notes({ kcal: broken }),
    "adds-a-crash": notes({ kcal: broken, custom: () => { throw new Error("no steps"); } }),
  };
  const compose = (source: string, store: MemoryStore) => direct(apps[source]!)(source, store);

  it("accepts a change that leaves the app's own failure as it was, and says it was already there", async () => {
    quiet();
    const gate = regressionGate((s) => runCandidate(s, { compose, settleMs: 300 }), "original");
    const { report, preexisting } = await gate("adds-a-field");
    expect(report.errors).toEqual([]);
    expect(preexisting.errors.join("\n")).toMatch(/computed note\.kcal/);
  });

  it("blocks only what the change broke", async () => {
    quiet();
    const gate = regressionGate((s) => runCandidate(s, { compose, settleMs: 300 }), "original");
    const { report } = await gate("adds-a-crash");
    expect(report.errors).toEqual(['page "board" crashed while showing: no steps']);
  });
});

describe("running many candidates (#262: the --run eval died of a leak)", () => {
  it("disposes every app, removes every off-screen page and listener, and gives the console back", async () => {
    quiet();
    const warn = console.warn;
    const error = console.error;
    const disposed: number[] = [];
    const bodyBefore = document.body.childElementCount;
    for (let i = 0; i < 25; i++) {
      await runCandidate("", {
        settleMs: 50,
        compose: async (src, store) => {
          const composed = await direct(notes({ custom: () => createElement("p", null, "board") }))(src, store);
          const dispose = composed.loaded.dispose?.bind(composed.loaded);
          composed.loaded.dispose = () => {
            disposed.push(i);
            dispose?.();
          };
          return composed;
        },
      });
    }
    expect(disposed).toHaveLength(25);
    expect(document.body.childElementCount).toBe(bodyBefore);
    expect(activeFailureListeners()).toBe(0);
    expect(console.warn).toBe(warn);
    expect(console.error).toBe(error);
  });
});
