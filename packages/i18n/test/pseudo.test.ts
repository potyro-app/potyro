import { describe, expect, it } from "vitest";
import { accent, pseudoMessage, pseudoMessages, PSEUDO_CLOSE, PSEUDO_OPEN } from "../src/pseudo.js";

describe("pseudo-language", () => {
  it("accents every ASCII letter and nothing else", () => {
    expect(accent("Find an app")).toBe("Ƒîñð åñ åþþ");
    expect(/[A-Za-z]/.test(accent("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"))).toBe(false);
    expect(accent("1, 2 — <0>…</0> #")).toBe("1, 2 — <0>…</0> #");
  });

  it("brackets and pads a message by about a third", () => {
    const out = pseudoMessage("Find an app") as string[];
    expect(out[0]).toBe(PSEUDO_OPEN);
    expect(out.join("")).toBe(`${PSEUDO_OPEN}Ƒîñð åñ åþþ ····${PSEUDO_CLOSE}`);
  });

  it("keeps placeholders and accents plural branches", () => {
    const compiled = [["0", "plural", { one: ["#", " message"], other: ["#", " messages"] }]];
    const out = pseudoMessage(compiled) as unknown[];
    expect(out[1]).toEqual(["0", "plural", { one: ["#", " ɱéššåĝé"], other: ["#", " ɱéššåĝéš"] }]);
    const withName = pseudoMessage(["Actions for ", ["0"]]) as unknown[];
    expect(withName.slice(1, 3)).toEqual(["Åçţîöñš ƒöŕ ", ["0"]]);
  });

  it("converts a whole catalog", () => {
    const out = pseudoMessages({ a: "Open", b: ["Hi ", ["name"]] });
    expect(Object.keys(out)).toEqual(["a", "b"]);
    expect((out.a as string[]).join("")).toContain("Öþéñ");
  });
});
