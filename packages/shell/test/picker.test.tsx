// @vitest-environment happy-dom
// The picker replaces `ctx.ui.pick`'s numbered text prompt. What matters is the contract app code
// relies on: pick() resolves with the chosen item, resolves null when dismissed, and never strands a
// promise — plus the search that makes a long exercise library usable one-handed.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PickerHost, Picker } from "../src/picker.js";

const items = [{ name: "Bench press" }, { name: "Squat" }, { name: "Deadlift" }];
const label = (e: unknown) => String((e as { name: string }).name);

afterEach(cleanup);

describe("Picker", () => {
  it("resolves with the chosen item", async () => {
    const host = new PickerHost();
    render(<Picker host={host} />);
    const promise = host.pick(items, { label });
    await screen.findByText("Squat");
    fireEvent.click(screen.getByText("Squat"));
    await expect(promise).resolves.toEqual({ name: "Squat" });
  });

  it("filters as you type, and Enter takes the first match", async () => {
    const host = new PickerHost();
    render(<Picker host={host} />);
    const promise = host.pick(items, { label });
    const search = await screen.findByLabelText("Filter the list");
    fireEvent.change(search, { target: { value: "dead" } });
    await waitFor(() => expect(screen.queryByText("Bench press")).toBeNull());
    fireEvent.keyDown(search, { key: "Enter" });
    await expect(promise).resolves.toEqual({ name: "Deadlift" });
  });

  it("resolves null when cancelled", async () => {
    const host = new PickerHost();
    render(<Picker host={host} />);
    const promise = host.pick(items, { label });
    fireEvent.click(await screen.findByText("Cancel"));
    await expect(promise).resolves.toBeNull();
  });

  it("multi-select returns every chosen item", async () => {
    const host = new PickerHost();
    render(<Picker host={host} />);
    const promise = host.pick(items, { label, multi: true });
    fireEvent.click(await screen.findByText("Bench press"));
    fireEvent.click(screen.getByText("Deadlift"));
    fireEvent.click(screen.getByText(/^Add/));
    await expect(promise).resolves.toEqual([{ name: "Bench press" }, { name: "Deadlift" }]);
  });

  // A stranded promise would hang app code forever — the action would simply never continue.
  it("settles the previous request when a second one opens", async () => {
    const host = new PickerHost();
    render(<Picker host={host} />);
    const first = host.pick(items, { label });
    const second = host.pick([{ name: "Row" }], { label });
    await expect(first).resolves.toBeNull();
    fireEvent.click(await screen.findByText("Row"));
    await expect(second).resolves.toEqual({ name: "Row" });
  });

  it("renders nothing when idle", () => {
    const host = new PickerHost();
    const { container } = render(<Picker host={host} />);
    expect(container.innerHTML).toBe("");
  });
});
