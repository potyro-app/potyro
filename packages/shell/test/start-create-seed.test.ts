// A new app made through the create loop keeps sample records (#486): the ones the loop asked the
// model for once the app passed its run, each row checked against the entities that run loaded — never
// the run's own made-up rows. A candidate whose run threw is given no entities to ask with; a reply
// with fewer than two rows that fit is no seed: the app opens on an empty copy.
import { describe, expect, it, vi } from "vitest";
import type { CreateLoopDeps, CreateLoopOutcome } from "@potyro/generator/agent";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const loop = vi.hoisted(() => ({ ends: async (_deps: CreateLoopDeps): Promise<CreateLoopOutcome> => ({ kind: "stopped" }) }));
vi.mock("@potyro/generator/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@potyro/generator/agent")>()),
  runCreateLoop: (deps: CreateLoopDeps) => loop.ends(deps),
}));
const runs = vi.hoisted(() => new Map<string, { errors: string[]; warnings: string[]; ran: string; entities?: Record<string, unknown> }>());
vi.mock("../src/run-candidate.js", () => ({ runCandidate: async (source: string) => runs.get(source) }));

const { startCreate } = await import("../src/start-create.js");

const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
const BOOKS = { book: { label: "Book", fields: { title: { type: "text", required: true }, status: { type: "enum", options: ["reading", "done"] } } } };
const source = (n: number, samples?: Record<string, unknown>): Extract<CreateLoopOutcome, { kind: "source" }> => ({
  kind: "source",
  source: `APP ${n}`,
  warnings: [],
  draft: 1,
  candidate: n,
  ...(samples ? { samples } : {}),
});

describe("the create loop's app and its sample records", () => {
  it("asks with the entities of a candidate that passed its run, and keeps the rows that fit them", async () => {
    runs.set("APP 1", { errors: ["it threw"], warnings: [], ran: "", entities: BOOKS });
    runs.set("APP 2", { errors: [], warnings: [], ran: "3 records", entities: BOOKS });
    const asked: unknown[] = [];
    const seen: unknown[] = [];
    loop.ends = async (deps) => {
      seen.push(await deps.run!("APP 1"), await deps.run!("APP 2"));
      asked.push(await deps.samples!("APP 1"), await deps.samples!("APP 2"));
      return source(2, {
        book: [
          { id: "book-1", title: "The Left Hand of Darkness", status: "reading" },
          { id: "book-2", title: "Piranesi", status: "done" },
          { id: "book-3", title: "Dune", status: "abandoned" },
        ],
      });
    };
    const out = await startCreate({ brief: "a reading tracker", engine });
    expect(asked).toEqual([undefined, BOOKS]);
    expect(out).toEqual({
      kind: "source",
      source: "APP 2",
      warnings: [],
      draft: 1,
      candidate: 2,
      seed: { book: [{ id: "book-1", title: "The Left Hand of Darkness", status: "reading" }, { id: "book-2", title: "Piranesi", status: "done" }] },
    });
    // The loop's own reports carry no entities: the run's, nothing more.
    expect(seen.every((r) => !("entities" in (r as object)))).toBe(true);
  });

  it("has none when fewer than two rows fit, or the reply was not rows", async () => {
    runs.set("APP 3", { errors: [], warnings: [], ran: "", entities: BOOKS });
    loop.ends = async (deps) => {
      await deps.run!("APP 3");
      return source(3, { book: [{ title: "Piranesi" }, { title: 7 }] });
    };
    const one = await startCreate({ brief: "a reading tracker", engine });
    expect(one.kind).toBe("source");
    expect(one).not.toHaveProperty("seed");
    expect(one).not.toHaveProperty("samples");
    loop.ends = async (deps) => {
      await deps.run!("APP 3");
      return source(3, { book: "Piranesi" });
    };
    expect(await startCreate({ brief: "a reading tracker", engine })).not.toHaveProperty("seed");
  });

  it("an app the loop never ran has none, whatever the model wrote", async () => {
    loop.ends = async () => source(4, { book: [{ title: "Piranesi" }, { title: "Dune" }] });
    expect(await startCreate({ brief: "a reading tracker", engine })).not.toHaveProperty("seed");
  });
});
