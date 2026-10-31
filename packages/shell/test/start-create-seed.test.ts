// A new app made through the create loop keeps the sample records its run passed on (#486): what its
// demo link opens on. A candidate whose run threw keeps none, even when the loop ends with it.
import { describe, expect, it, vi } from "vitest";
import type { CreateLoopDeps, CreateLoopOutcome } from "@potyro/generator/agent";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const loop = vi.hoisted(() => ({ ends: async (_deps: CreateLoopDeps): Promise<CreateLoopOutcome> => ({ kind: "stopped" }) }));
vi.mock("@potyro/generator/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@potyro/generator/agent")>()),
  runCreateLoop: (deps: CreateLoopDeps) => loop.ends(deps),
}));
const runs = vi.hoisted(() => new Map<string, { errors: string[]; warnings: string[]; ran: string; seed?: Record<string, Array<Record<string, unknown>>> }>());
vi.mock("../src/run-candidate.js", () => ({ runCandidate: async (source: string) => runs.get(source) }));

const { startCreate } = await import("../src/start-create.js");

const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
const SAMPLE = { book: [{ id: "b1", title: "title 1" }] };
const source = (n: number): Extract<CreateLoopOutcome, { kind: "source" }> => ({ kind: "source", source: `APP ${n}`, warnings: [], draft: 1, candidate: n });

describe("the create loop's app and its sample records", () => {
  it("a candidate that passed its run keeps the records it ran on; the loop never sees them", async () => {
    runs.set("APP 1", { errors: ["it threw"], warnings: [], ran: "" });
    runs.set("APP 2", { errors: [], warnings: [], ran: "3 records", seed: SAMPLE });
    const seen: unknown[] = [];
    loop.ends = async (deps) => {
      seen.push(await deps.run!("APP 1"), await deps.run!("APP 2"));
      return source(2);
    };
    const out = await startCreate({ brief: "a reading tracker", engine });
    expect(out).toMatchObject({ kind: "source", source: "APP 2", seed: SAMPLE });
    expect(seen.every((r) => !("seed" in (r as object)))).toBe(true);
  });

  it("an app kept although its run threw has none", async () => {
    loop.ends = async (deps) => {
      await deps.run!("APP 1");
      return source(1);
    };
    const out = await startCreate({ brief: "a reading tracker", engine });
    expect(out.kind).toBe("source");
    expect("seed" in out).toBe(false);
  });

  it("an app the loop never ran has none", async () => {
    loop.ends = async () => source(3);
    expect("seed" in (await startCreate({ brief: "a reading tracker", engine }))).toBe(false);
  });
});
