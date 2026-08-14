// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReplayReport } from "@karta/runtime";
import { CaseReport } from "../src/case-report.js";

afterEach(cleanup);

const report: ReplayReport = {
  caseId: "case-1",
  title: "",
  expectation: "here I expected the map to open",
  outcomes: [
    { step: { kind: "open", page: "all" }, ok: true, detail: 'opened "all" — 3 records' },
    {
      step: { kind: "open", page: "map" },
      ok: false,
      detail: 'no page "map" in this app — it has: all. Tapping here goes nowhere.',
    },
  ],
};

describe("CaseReport", () => {
  it("leads with the user's own expectation", () => {
    render(<CaseReport report={report} onClose={() => {}} />);
    expect(screen.getByText(/here I expected the map to open/)).toBeTruthy();
  });

  it("reports every step, marking the one that goes nowhere", () => {
    const { container } = render(<CaseReport report={report} onClose={() => {}} />);
    const steps = container.querySelectorAll(".k-case-step");
    expect(steps).toHaveLength(2);
    expect(steps[0]!.getAttribute("data-ok")).toBe("true");
    expect(steps[1]!.getAttribute("data-ok")).toBe("false");
    expect(steps[1]!.textContent).toContain("no page \"map\" in this app");
  });

  it("omits the expectation line when the case carries no note", () => {
    const { container } = render(<CaseReport report={{ ...report, expectation: null }} onClose={() => {}} />);
    expect(container.querySelector(".k-case-expect")).toBeNull();
  });

  it("calls onClose when Close is clicked", () => {
    const onClose = vi.fn();
    render(<CaseReport report={report} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
