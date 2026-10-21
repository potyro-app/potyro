import { describe, expect, it } from "vitest";
import { compare, currencyFor, parseAmount, parseMoney, perShown, type Item } from "../compare.js";

const item = (price: number | null, amount: number | null, unit: Item["unit"], name?: string): Item => ({ price, amount, unit, name });

describe("a price per unit", () => {
  it("is shown per 100 g, per 100 ml or per piece, in whole minor units", () => {
    expect(perShown({ price: 499, amount: 500, unit: "ml" })).toBe(100); // €4.99 / 500 ml → €1.00 per 100 ml
    expect(perShown({ price: 849, amount: 1, unit: "l" })).toBe(85); // €8.49 / l → €0.85 per 100 ml
    expect(perShown({ price: 300, amount: 1.5, unit: "kg" })).toBe(20); // €3.00 / 1.5 kg → €0.20 per 100 g
    expect(perShown({ price: 240, amount: 6, unit: "pcs" })).toBe(40); // €0.40 each
  });
});

describe("which is cheaper", () => {
  it("compares 1.5 kg with 500 g, converting the units", () => {
    const v = compare([item(300, 1.5, "kg"), item(120, 500, "g")]);
    expect(v.winner).toBe(0); // €0.20 vs €0.24 per 100 g
    expect(v.saving).toBe(17);
    expect(v.order).toEqual([0, 1]);
  });

  it("compares 0.33 l with 750 ml", () => {
    const v = compare([item(99, 0.33, "l"), item(199, 750, "ml")]);
    expect(v.winner).toBe(1); // €0.30 vs €0.265 per 100 ml
    expect(v.saving).toBe(12);
  });

  it("calls the same price the same, within half a percent", () => {
    expect(compare([item(200, 1, "kg"), item(100, 500, "g")])).toMatchObject({ winner: expect.any(Number), saving: 0 });
    expect(compare([item(1000, 1, "kg"), item(1003, 1, "kg")]).saving).toBe(0);
    expect(compare([item(1000, 1, "kg"), item(1010, 1, "kg")])).toMatchObject({ winner: 0, saving: 1 });
  });

  it("has no answer while one item is empty, and says why", () => {
    expect(compare([item(300, 1.5, "kg"), item(null, null, "g")])).toMatchObject({ winner: null, saving: 0, reason: "incomplete", order: [0] });
    expect(compare([item(300, 0, "kg"), item(120, 500, "g")]).reason).toBe("incomplete");
  });

  it("refuses to compare a weight with a volume or a count", () => {
    expect(compare([item(300, 1, "kg"), item(300, 1, "l")]).reason).toBe("kinds");
    expect(compare([item(300, 1, "kg"), item(300, 6, "pcs")]).reason).toBe("kinds");
  });

  it("ranks three, the saving against the runner-up", () => {
    const v = compare([item(500, 1, "kg"), item(200, 500, "g"), item(90, 300, "g")]);
    expect(v.order).toEqual([2, 1, 0]); // 0.30, 0.40, 0.50 per 100 g
    expect(v.winner).toBe(2);
    expect(v.saving).toBe(25);
  });

  it("a free item wins outright", () => {
    expect(compare([item(0, 1, "kg"), item(100, 1, "kg")])).toMatchObject({ winner: 0, saving: 100 });
  });
});

describe("what is typed", () => {
  it("reads money with a comma or a dot, as whole minor units", () => {
    expect(parseMoney("4,99")).toBe(499);
    expect(parseMoney("4.99")).toBe(499);
    expect(parseMoney(" 12 ")).toBe(1200);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNull();
  });

  it("reads an amount, and refuses zero", () => {
    expect(parseAmount("1,5")).toBe(1.5);
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("guesses the currency from where the person is", () => {
    expect(currencyFor("pt-BR")).toBe("BRL");
    expect(currencyFor("pl-PL")).toBe("PLN");
    expect(currencyFor("en-US")).toBe("USD");
    expect(currencyFor("en-GB")).toBe("GBP");
    expect(currencyFor("de-CH")).toBe("CHF");
    expect(currencyFor("de-DE")).toBe("EUR");
    expect(currencyFor("en")).toBe("EUR");
  });
});
