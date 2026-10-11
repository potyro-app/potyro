// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReplayReport } from "@potyro/runtime";
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

  it("renders an expect step with a neutral marker and no pass/fail attribute", () => {
    // An `expect` step is the user's own words, not a check the replay ran — it can't fail, and
    // the expectation already leads the report above. Marking it ✓ next to steps that genuinely
    // can pass or fail reads as "your expectation was met", so it gets neither the checkmark nor
    // `data-ok`.
    const withNote: ReplayReport = {
      ...report,
      outcomes: [...report.outcomes, { step: { kind: "expect", note: "here I expected the map to open" }, ok: true, detail: "here I expected the map to open" }],
    };
    const { container } = render(<CaseReport report={withNote} onClose={() => {}} />);
    const steps = container.querySelectorAll(".k-case-step");
    expect(steps).toHaveLength(3);
    const expectStep = steps[2]!;
    expect(expectStep.hasAttribute("data-ok")).toBe(false);
    expect(expectStep.textContent).not.toContain("✓");
    expect(expectStep.textContent).toContain("here I expected the map to open");
  });

  it("shows no lost-steps warning when nothing was dropped", () => {
    const { container } = render(<CaseReport report={report} lostSteps={0} onClose={() => {}} />);
    expect(container.querySelector(".k-case-lost")).toBeNull();
  });

  it("warns in plain language when part of the recording was lost", () => {
    render(<CaseReport report={report} lostSteps={2} onClose={() => {}} />);
    expect(screen.getByText(/2 steps could not be captured/)).toBeTruthy();
  });
});
