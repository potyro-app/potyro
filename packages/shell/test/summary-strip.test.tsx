// @vitest-environment happy-dom
//
// A page that summarises nothing must not pay for a query.
//
// The strip runs the page query itself, deliberately, so its totals track the filter chips exactly.
// But it ran that query on EVERY page, summary or no summary — a second full read of every record on
// every change, for a strip that then rendered nothing. On a synced list of ninety items that is the
// difference between one full re-read per change and two.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryStrip } from "../src/summary-strip.js";
import type { PotyroRuntime } from "@potyro/runtime";

afterEach(cleanup);

function runtimeWith(summary: unknown, queried: { count: number }): PotyroRuntime {
  return {
    definition: {
      pages: [{ id: "all", title: "All", view: { type: "list", entity: "item" }, ...(summary ? { summary } : {}) }],
      entities: { item: { label: "Item", fields: {} } },
    },
    usePageQuery: () => {
      queried.count++;
      return { rows: [], loading: false };
    },
    ctx: {},
    core: { app: { callSummary: async () => ({ text: "0" }) } },
  } as unknown as PotyroRuntime;
}

describe("the summary strip", () => {
  it("runs no query for a page that declares no summary", () => {
    const queried = { count: 0 };
    render(<SummaryStrip runtime={runtimeWith(undefined, queried)} pageId="all" params={{}} />);

    expect(queried.count).toBe(0);
    expect(screen.queryByLabelText("Summary")).toBeNull();
  });

  it("still runs one for a page that does", async () => {
    const queried = { count: 0 };
    const summary = [{ label: "Items", count: true }];
    render(<SummaryStrip runtime={runtimeWith(summary, queried)} pageId="all" params={{}} />);

    expect(queried.count).toBe(1);
    await vi.waitFor(() => expect(screen.getByLabelText("Summary")).toBeTruthy());
  });
});
