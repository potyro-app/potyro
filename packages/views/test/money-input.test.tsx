// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MoneyField } from "potyro";
import { FieldInput, FieldValue, MoneyTotal } from "../src/index.js";

// Typing and showing money (KA-26, #66). The value handed back is always whole minor units — that
// is the point: a float in a shared ledger drifts between copies and cannot be recovered.

afterEach(cleanup);

const euros: MoneyField = { type: "money", currency: "EUR", label: "Amount" };
const runtime = { definition: { entities: { expense: { label: "Expense", fields: { amount: euros } } } } } as never;

describe("typing an amount", () => {
  it("hands back whole minor units, whichever way it was written", () => {
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={euros} value={null} onChange={onChange} />);
    const box = screen.getByLabelText("Amount");

    fireEvent.change(box, { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(4200);
    fireEvent.change(box, { target: { value: "42,50" } });
    expect(onChange).toHaveBeenLastCalledWith(4250);
    fireEvent.change(box, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("shows the currency beside the box and asks the phone for a decimal keypad", () => {
    render(<FieldInput runtime={runtime} field={euros} value={4200} onChange={() => {}} />);
    expect(screen.getByText("€")).toBeTruthy();
    expect(screen.getByLabelText("Amount").getAttribute("inputmode")).toBe("decimal");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("42.00");
  });

  it("leaves half-typed text alone, and tidies it when the field is left", () => {
    // Re-formatting under the cursor is how a field fights the person using it.
    const onChange = vi.fn();
    render(<FieldInput runtime={runtime} field={euros} value={null} onChange={onChange} />);
    const box = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "42." } });
    expect(box.value).toBe("42.");
    fireEvent.blur(box);
    expect(box.value).toBe("42.00");
  });
});

describe("showing an amount", () => {
  it("writes it as money, not as a count of cents", () => {
    render(<FieldValue runtime={runtime} entity="expense" fieldKey="amount" value={4200} />);
    expect(screen.getByText(/42[.,]00/)).toBeTruthy();
    expect(screen.queryByText("4200")).toBeNull();
  });
});

describe("the total under a list", () => {
  it("adds the rows as integers and names them by the entity's own word", () => {
    render(
      <MoneyTotal
        field={euros}
        rows={[{ amount: 4200 }, { amount: 1850 }, { amount: 2450 }]}
        valueKey="amount"
        noun="Expense"
      />,
    );
    expect(screen.getByText("3 expenses")).toBeTruthy();
    expect(screen.getByText(/85[.,]00/)).toBeTruthy();
  });

  it("says nothing when no row carries an amount", () => {
    const { container } = render(<MoneyTotal field={euros} rows={[{}, {}]} valueKey="amount" noun="Expense" />);
    expect(container.textContent).toBe("");
  });
});
