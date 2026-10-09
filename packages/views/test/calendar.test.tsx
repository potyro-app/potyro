// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { CalendarView } from "../src/calendar.js";

// Renders the calendar view against a real (DirectHost) runtime — proving the view resolves its
// `date`/`title` bindings through the runtime and places events on the right month grid.

const fixtureApp = defineApp({
  id: "cal-fixture",
  name: "Cal Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    ev: {
      label: "Event",
      displayField: "name",
      fields: { name: { type: "text", required: true }, at: { type: "datetime" } },
    },
  },
  pages: [{ id: "cal", title: "Schedule", view: { type: "calendar", entity: "ev", date: "at", title: "name" } }],
});

async function makeRuntime(seedAt: Date): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("cal-fixture");
  await store.insert("ev", { name: "Water Fern", at: seedAt });

  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: fixtureApp });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

afterEach(cleanup);

const noop = () => {};

describe("CalendarView", () => {
  it("places an event on its day in the current month, and hides it when navigating away", async () => {
    const now = new Date();
    const seedAt = new Date(now.getFullYear(), now.getMonth(), 10, 12, 0, 0); // 10th of the current month
    const runtime = await makeRuntime(seedAt);

    render(<CalendarView runtime={runtime} pageId="cal" params={{}} setParam={noop} navigate={noop} />);

    // Event resolves + renders on the current month grid.
    const event = await screen.findByText("Water Fern");
    expect(event).toBeTruthy();
    const cell = event.closest(".k-cal-cell");
    expect(cell?.getAttribute("data-in-month")).toBe("true");
    expect(cell?.querySelector(".k-cal-daynum")?.textContent).toBe("10");

    // Navigating to the next month drops it (month filtering works).
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.queryByText("Water Fern")).toBeNull();
  });

  it("shows an empty affordance when nothing is scheduled", async () => {
    const runtime = await makeRuntime(new Date(1990, 0, 1)); // far in the past → not in current month
    render(<CalendarView runtime={runtime} pageId="cal" params={{}} setParam={noop} navigate={noop} />);
    expect(await screen.findByText("Nothing scheduled this month.")).toBeTruthy();
  });
});
