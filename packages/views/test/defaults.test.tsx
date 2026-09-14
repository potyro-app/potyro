// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createDefaults } from "../src/record-form.js";

// KA-25: a function default is evaluated by the host, where the function lives. For an untrusted app
// the definition carries the sentinel string, and a form or quick action that read it directly
// started the field as "__karta_fn__".

const runtimeWith = (fields: Record<string, unknown>, callFieldDefault = vi.fn(async () => "from-host")) =>
  ({
    definition: { entities: { e: { fields } } },
    ctx: { scope: {} },
    core: { app: { callFieldDefault } },
  }) as never;

describe("createDefaults", () => {
  it("asks the host for a sentinel or function default, and keeps static ones and presets", async () => {
    const call = vi.fn(async (_e: string, key: string) => (key === "at" ? new Date(0) : "Ana"));
    const values = await createDefaults(
      runtimeWith({ at: { type: "datetime", default: "__karta_fn__" }, who: { type: "text", default: () => "x" }, n: { type: "number", default: 2 }, done: { type: "boolean" }, title: { type: "text" } }, call),
      "e",
      { title: "preset" },
    );
    expect(values).toEqual({ at: new Date(0), who: "Ana", n: 2, done: false, title: "preset" });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("starts a field empty when its default throws, instead of failing the form", async () => {
    const values = await createDefaults(runtimeWith({ at: { type: "datetime", default: "__karta_fn__" } }, vi.fn(async () => { throw new Error("boom"); })), "e");
    expect(values).toEqual({ at: undefined });
  });
});
