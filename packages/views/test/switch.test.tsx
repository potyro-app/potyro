// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Switch, SwitchRow } from "../src/switch.js";

// A boolean is a switch (#97): a real button with role="switch", so the whole row toggles, Space
// toggles, and assistive tech reads its state.

afterEach(cleanup);

describe("SwitchRow", () => {
  it("is one switch, named by its label, that toggles from anywhere on the row", () => {
    const onChange = vi.fn();
    render(<SwitchRow label="Needs direct sun" help="Put it on the sill" checked={false} onChange={onChange} required />);
    const row = screen.getByRole("switch", { name: /Needs direct sun/ });
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(row.textContent).toContain("Put it on the sill");
    fireEvent.click(screen.getByText("Put it on the sill")); // the help text is on the row too
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects the value it is given", () => {
    const { rerender } = render(<SwitchRow label="Active" checked={true} onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: "Active" }).getAttribute("aria-checked")).toBe("true");
    rerender(<SwitchRow label="Active" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: "Active" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("Switch", () => {
  it("is the toggle alone, labelled for those who cannot see it", () => {
    const onChange = vi.fn();
    render(<Switch label="Open now" checked={true} onChange={onChange} />);
    const s = screen.getByRole("switch", { name: "Open now" });
    expect(s.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(s);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
