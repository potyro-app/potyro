// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FixPanel } from "../src/fix-panel.js";
import type { LoopOutcome, LoopStep } from "@karta/generator/agent";

// Six renders in one file; without this they stack in the same DOM and `getByText` starts matching
// a previous case's output. `case-report.test.tsx` does the same.
afterEach(cleanup);

// Each outcome has to read as a different thing. A stop is not a failure; "cannot reproduce" is
// neither success nor failure; an unverified last attempt must never look applyable.
const cases: Array<[LoopOutcome, RegExp, boolean]> = [
  [{ kind: "question", text: "which city?", transcript: [] }, /which city\?/, false],
  [{ kind: "diagnosis", text: "the host map ignores it" }, /host map ignores it/, false],
  [{ kind: "no-repro", detail: "every step ok" }, /could not reproduce|still works/i, false],
  [{ kind: "stopped", lastAttempt: "SRC" }, /stopped/i, false],
  [{ kind: "exhausted", reason: "gave up after 8 steps", lastAttempt: "SRC" }, /gave up/, false],
  [{ kind: "fix", source: "SRC", rationale: "moved the page id" }, /moved the page id/, true],
];

describe("FixPanel outcomes", () => {
  for (const [outcome, text, applyable] of cases) {
    it(`renders ${outcome.kind} distinctly, apply=${applyable}`, () => {
      render(<FixPanel outcome={outcome} steps={[]} onApply={() => {}} onAnswer={() => {}} onStop={() => {}} onClose={() => {}} />);
      expect(screen.getByText(text)).toBeTruthy();
      expect(Boolean(screen.queryByRole("button", { name: /apply/i }))).toBe(applyable);
    });
  }

  // The one that matters: a candidate that FAILED replay is on `lastAttempt`. Showing it is fine;
  // offering to apply it would hand the user an unverified fix, which is the whole thing this
  // feature exists to prevent.
  it("never offers to apply an unverified last attempt", () => {
    render(
      <FixPanel
        outcome={{ kind: "exhausted", reason: "gave up after 8 steps", lastAttempt: "UNVERIFIED" }}
        steps={[]}
        onApply={() => {}}
        onAnswer={() => {}}
        onStop={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });

  // Same guard on `stopped` — its `lastAttempt` is exactly as unverified as `exhausted`'s.
  it("never offers to apply a stopped run's last attempt either", () => {
    render(
      <FixPanel
        outcome={{ kind: "stopped", lastAttempt: "UNVERIFIED" }}
        steps={[]}
        onApply={() => {}}
        onAnswer={() => {}}
        onStop={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });
});

describe("FixPanel — live step feed", () => {
  const steps: LoopStep[] = [
    { kind: "thinking" },
    { kind: "tool", name: "replay_case", ok: true, detail: "3 steps ok" },
    { kind: "tool", name: "query_data", ok: false, detail: "no such entity" },
    { kind: "candidate", passed: false, detail: "still fails" },
    { kind: "unusable", detail: "wrote prose instead of an app" },
  ];

  it("shows each step kind, naming the tool and whether it succeeded", () => {
    render(<FixPanel outcome={undefined} steps={steps} onApply={() => {}} onAnswer={() => {}} onStop={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/replay_case/)).toBeTruthy();
    expect(screen.getByText(/query_data/)).toBeTruthy();
    expect(screen.getByText(/still fails/)).toBeTruthy();
    expect(screen.getByText(/wrote prose instead of an app/)).toBeTruthy();
  });

  it("marks a successful tool call and a failed one differently", () => {
    const { container } = render(
      <FixPanel outcome={undefined} steps={steps} onApply={() => {}} onAnswer={() => {}} onStop={() => {}} onClose={() => {}} />,
    );
    const toolSteps = container.querySelectorAll('[data-kind="tool"]');
    expect(toolSteps).toHaveLength(2);
    expect(toolSteps[0]!.getAttribute("data-ok")).toBe("true");
    expect(toolSteps[1]!.getAttribute("data-ok")).toBe("false");
  });
});

describe("FixPanel — Stop", () => {
  it("shows a Stop button while there is no outcome yet, wired to onStop", () => {
    const onStop = vi.fn();
    render(<FixPanel outcome={undefined} steps={[]} onApply={() => {}} onAnswer={() => {}} onStop={onStop} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("has no Stop button once an outcome has landed — there is nothing left to stop", () => {
    render(
      <FixPanel
        outcome={{ kind: "no-repro", detail: "every step ok" }}
        steps={[]}
        onApply={() => {}}
        onAnswer={() => {}}
        onStop={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});

describe("FixPanel — question", () => {
  it("answering appends the reply text via onAnswer", () => {
    const onAnswer = vi.fn();
    render(
      <FixPanel
        outcome={{ kind: "question", text: "which city?", transcript: [] }}
        steps={[]}
        onApply={() => {}}
        onAnswer={onAnswer}
        onStop={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /answer/i }), { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: /send|answer|reply/i }));
    expect(onAnswer).toHaveBeenCalledWith("Paris");
  });
});

describe("FixPanel — Apply", () => {
  it("Apply calls onApply with the fix's own verified source, not anything else on screen", () => {
    const onApply = vi.fn();
    render(
      <FixPanel
        outcome={{ kind: "fix", source: "VERIFIED-SOURCE", rationale: "moved the page id" }}
        steps={[]}
        onApply={onApply}
        onAnswer={() => {}}
        onStop={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith("VERIFIED-SOURCE");
  });
});

describe("FixPanel — Close", () => {
  it("calls onClose when Close is clicked", () => {
    const onClose = vi.fn();
    render(
      <FixPanel
        outcome={{ kind: "diagnosis", text: "the host map ignores it" }}
        steps={[]}
        onApply={() => {}}
        onAnswer={() => {}}
        onStop={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
