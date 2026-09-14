// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { UiHost } from "../src/ui-host.js";
import { createUiBridge } from "../src/ui-bridge.js";

// The store behind ctx.ui's questions (#112): a question settles with its answer; a second question
// answers the first as dismissed rather than stranding it; progress bars come and go.

describe("UiHost", () => {
  it("settles a sheet with the chosen id, and a second question dismisses the first", async () => {
    const host = new UiHost();
    const first = host.sheet({ items: [{ id: 1, label: "One" }] });
    const second = host.menu({ items: [{ id: "b", label: "B" }] });
    expect(await first).toBeNull();
    const open = host.get();
    expect(open?.kind).toBe("menu");
    open!.settle("b");
    expect(await second).toBe("b");
    expect(host.get()).toBeNull();
  });

  it("tracks progress bars until done", () => {
    const host = new UiHost();
    const a = host.progress("Importing");
    a.update(0.25, "1 of 4");
    expect(host.getBars()).toEqual([{ id: 1, label: "Importing", fraction: 0.25, detail: "1 of 4" }]);
    a.update(7);
    expect(host.getBars()[0]!.fraction).toBe(1);
    a.done();
    expect(host.getBars()).toEqual([]);
  });

  it("is what the bridge hands ctx when there is one, and absent when headless", () => {
    const host = new UiHost();
    expect(createUiBridge(() => {}, undefined, undefined, host).form).toBe(host.form);
    expect(createUiBridge(() => {}).form).toBeUndefined();
  });
});
