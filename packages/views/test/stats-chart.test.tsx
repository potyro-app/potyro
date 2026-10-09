// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { StatsView, compareText } from "../src/stats.js";
import { ChartView, niceMax } from "../src/chart.js";

// Stats tiles and a bar chart (#109): figures and comparisons in words, a chart with its numbers in a
// table, an empty series saying so, and a series that throws saying that instead.

const app = (view: Record<string, unknown>): PotyroApp =>
  defineApp({
    id: "runs",
    name: "Runs",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { run: { fields: { km: { type: "number", unit: "km" }, week: { type: "number" } } } },
    pages: [{ id: "p", title: "P", view: { entity: "run", ...view } }],
  } as never);

async function makeRuntime(def: PotyroApp): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open(def.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: def });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  for (const [km, week] of [[5, 1], [7, 2], [3.5, 2], [1200, 2]]) await runtime.ctx.create("run", { km, week });
  return runtime;
}

const props = (runtime: PotyroRuntime) => ({ runtime, pageId: "p", params: {}, setParam: () => {}, navigate: () => {} });

afterEach(cleanup);

describe("compareText", () => {
  it("says more, less or the same, as a difference or a percent", () => {
    expect(compareText(4, 3, "last week")).toEqual({ dir: "up", text: "1 more than last week" });
    expect(compareText(58, 59, "last week", "difference", "min")).toEqual({ dir: "down", text: "1 min less than last week" });
    expect(compareText(94, 100, "last month", "percent")).toEqual({ dir: "down", text: "6% less than last month" });
    expect(compareText(5, 5, "last week", "percent")).toEqual({ dir: "same", text: "same as last week" });
    // Nothing to take a percentage of: the difference instead.
    expect(compareText(3, 0, "last week", "percent")).toEqual({ dir: "up", text: "3 more than last week" });
  });
});

describe("niceMax", () => {
  it("rounds the axis up to three or four gridlines, whole steps for whole numbers", () => {
    expect(niceMax(5, true)).toEqual({ top: 6, step: 2 });
    expect(niceMax(3, true)).toEqual({ top: 3, step: 1 });
    expect(niceMax(2, true)).toEqual({ top: 2, step: 1 });
    expect(niceMax(7)).toEqual({ top: 7.5, step: 2.5 });
    expect(niceMax(12480)).toEqual({ top: 15000, step: 5000 });
    expect(niceMax(0)).toEqual({ top: 1, step: 1 });
  });
});

describe("stats", () => {
  it("renders op and value tiles with units, and the comparison with an arrow and words", async () => {
    const runtime = await makeRuntime(
      app({
        type: "stats",
        items: [
          { label: "Runs", op: "count" },
          { label: "Distance", op: "sum", field: "km" },
          {
            label: "This week",
            unit: "runs",
            value: (rows: { week: number }[]) => rows.filter((r) => r.week === 2).length,
            compare: { value: (rows: { week: number }[]) => rows.filter((r) => r.week === 1).length, label: "last week" },
          },
          { label: "Broken", value: () => { throw new Error("nope"); } },
        ],
      }),
    );
    render(<StatsView {...props(runtime)} />);
    const tiles = await screen.findAllByRole("listitem");
    expect(tiles.map((t) => t.querySelector(".k-stat-value")?.textContent)).toEqual(["4", "1,215.5 km", "3 runs", "–"]);
    expect(tiles[2]!.querySelector(".k-stat-compare")?.textContent).toBe("▲ 2 runs more than last week");
    // One broken figure shows a dash with the reason, and its neighbours still render.
    expect(tiles[3]!.querySelector(".k-stat-value")?.getAttribute("title")).toBe("nope");
  });
});

describe("chart", () => {
  it("draws a bar per point, labels the latest, and carries the numbers in a table", async () => {
    const runtime = await makeRuntime(
      app({ type: "chart", title: "Km per week", series: (rows: { km: number; week: number }[]) => [1, 2].map((w) => ({ label: `W${w}`, value: rows.filter((r) => r.week === w).length, text: `${w} wk` })) }),
    );
    const { container } = render(<ChartView {...props(runtime)} />);
    await waitFor(() => expect(container.querySelectorAll(".k-chart-bar")).toHaveLength(2));
    expect(container.querySelector(".k-chart-latest")?.textContent).toBe("3");
    const table = screen.getByRole("table", { name: "Km per week" });
    expect([...table.querySelectorAll("tbody tr")].map((r) => r.textContent)).toEqual(["W11 wk", "W22 wk"]);

    const plot = screen.getByRole("img", { name: /Km per week: 2 bars/ });
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(container.querySelector(".k-chart-tip")?.textContent).toBe("W2 · 2 wk");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(container.querySelector(".k-chart-tip")?.textContent).toBe("W1 · 1 wk");
    fireEvent.click(container.querySelectorAll(".k-chart-hit")[0]!);
    expect(container.querySelector(".k-chart-tip")).toBeNull();
  });

  it("says when there is nothing to chart, and says why when the series throws", async () => {
    const empty = await makeRuntime(app({ type: "chart", title: "Empty", series: () => [], emptyText: "No runs yet." }));
    render(<ChartView {...props(empty)} />);
    expect(await screen.findByText("No runs yet.")).toBeTruthy();
    cleanup();
    const broken = await makeRuntime(app({ type: "chart", series: () => { throw new Error("bad fold"); } }));
    render(<ChartView {...props(broken)} />);
    expect((await screen.findByRole("status")).textContent).toBe("This chart could not be worked out: bad fold");
  });
});
