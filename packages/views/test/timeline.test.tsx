// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { TimelineView, groupTimeline, whenText } from "../src/timeline.js";

// The timeline (#110): records by date under headings — "Today", "This week", a month — newest first
// unless told otherwise, each card a list row's content with its date beside it.

const NOW = new Date(2026, 8, 9, 12, 0); // Wednesday 9 September 2026
const at = (month: number, day: number, hour = 9) => new Date(2026, month, day, hour, 30);
const e = (id: string, date: Date) => ({ row: id, date });

describe("groupTimeline", () => {
  const entries = [e("a", at(8, 9)), e("b", at(8, 8)), e("c", at(8, 5)), e("d", at(7, 30)), e("e", at(7, 12)), e("f", new Date(2025, 11, 31))];

  it("groups by day with Today and Yesterday, newest first", () => {
    const g = groupTimeline(entries, "day", "first", NOW);
    expect(g.map((x) => x.entries.map((y) => y.row))).toEqual([["a"], ["b"], ["c"], ["d"], ["e"], ["f"]]);
    expect(g[0]!.heading).toBe("Today");
    expect(g[1]!.heading).toBe("Yesterday");
    expect(g[5]!.heading).toMatch(/2025$/);
  });

  it("groups by Monday-started weeks: This week, Last week, then a range", () => {
    const g = groupTimeline(entries, "week", "first", NOW);
    expect(g.map((x) => [x.heading, x.entries.map((y) => y.row)])).toEqual([
      ["This week", ["a", "b"]],
      ["Last week", ["c"]],
      [expect.stringMatching(/24.*30/), ["d"]],
      [expect.stringMatching(/10.*16/), ["e"]],
      [expect.stringMatching(/29.*4.*2025|Dec 29.*2025/), ["f"]],
    ]);
  });

  it("groups by month, and oldest first when asked", () => {
    const g = groupTimeline(entries, "month", "last", NOW);
    expect(g.map((x) => x.entries.map((y) => y.row))).toEqual([["f"], ["e", "d"], ["c", "b", "a"]]);
    expect(g[2]!.heading).toBe("This month");
    expect(g[0]!.heading).toMatch(/December 2025/);
  });
});

describe("whenText", () => {
  it("gives the time under a day heading, and the day (with a time when the field has one) otherwise", () => {
    expect(whenText(at(8, 9), "day", false, NOW)).toBe("");
    expect(whenText(at(8, 9), "day", true, NOW)).toMatch(/9:30/);
    expect(whenText(at(8, 8), "week", false, NOW)).toBe("Yesterday");
    expect(whenText(at(8, 9), "week", true, NOW)).toMatch(/^Today \d/);
    expect(whenText(at(8, 5), "week", false, NOW)).toMatch(/Sat/);
  });
});

async function makeRuntime(def: PotyroApp, n: number): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open(def.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const loaded = await createHost().load({ kind: "module", app: def });
  const runtime = createRuntime({ app: loaded, host: createHost(), store, caps: new FakeCapabilities(), ui, nav });
  for (let i = 0; i < n; i++) await runtime.ctx.create("entry", { text: `Entry ${i + 1}`, at: new Date(2026, 8, 9 - i, 8), mood: i % 2 ? "rough" : "good" });
  return runtime;
}

const journal = (view: Record<string, unknown> = {}): PotyroApp =>
  defineApp({
    id: "journal",
    name: "Journal",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      entry: {
        fields: {
          text: { type: "text", required: true },
          at: { type: "datetime" },
          mood: { type: "enum", options: ["good", "rough"], colors: { good: "green", rough: "grey" } },
        },
      },
    },
    pages: [{ id: "p", title: "P", view: { type: "timeline", entity: "entry", date: "at", color: "mood", display: { primary: "text" }, ...view } }],
  } as never);

afterEach(cleanup);

describe("the timeline view", () => {
  it("renders cards under their headings with a coloured dot, and a card opens its record", async () => {
    const runtime = await makeRuntime(journal({ groupBy: "month" }), 3);
    const opened: string[] = [];
    render(<TimelineView runtime={runtime} pageId="p" params={{}} setParam={() => {}} navigate={() => {}} onEdit={(_, id) => opened.push(id)} />);
    await screen.findByText("Entry 1");
    const month = screen.getByRole("region", { name: /, 3$/ });
    expect([...month.querySelectorAll(".k-primary")].map((x) => x.textContent)).toEqual(["Entry 1", "Entry 2", "Entry 3"]);
    const items = month.querySelectorAll<HTMLElement>(".k-tl-item");
    expect(items[0]!.style.getPropertyValue("--swatch")).toContain("145");
    // Grey has no swatch, so the dot says so rather than borrowing the accent.
    expect(items[1]!.hasAttribute("data-grey")).toBe(true);
    fireEvent.click(within(month).getByText("Entry 2"));
    expect(opened).toHaveLength(1);
  });

  it("says when there is nothing, in the app's words", async () => {
    const runtime = await makeRuntime(journal({ emptyText: "No entries yet." }), 0);
    render(<TimelineView runtime={runtime} pageId="p" params={{}} setParam={() => {}} navigate={() => {}} />);
    expect(await screen.findByText("No entries yet.")).toBeTruthy();
  });
});
