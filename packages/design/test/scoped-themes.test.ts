// An app's own theme (#423): the designer's dark tokens, and the light values of the same tokens,
// also as classes — so one element can wear a theme while the page keeps its own.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scopedThemes } from "../scripts/tokens.mjs";

const source = readFileSync(new URL("../source/potyro-tokens.css", import.meta.url), "utf8");
const generated = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");

const block = (css: string, selector: string): string => {
  const i = css.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("\n}", i));
};
const names = (body: string): string[] => [...body.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]!).sort();

describe("scopedThemes", () => {
  it("carries the dark block's every token, with the same values", () => {
    const out = scopedThemes(source);
    const dark = block(out, ".k-theme-dark");
    const darkRoot = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/.exec(source)![1]!;
    expect(names(dark)).toEqual(names(darkRoot));
    expect(dark).toContain("--bg: #1c1b1c;");
    expect(dark).toContain("color-scheme: dark;");
  });

  it("gives the light class the light value of each of those tokens", () => {
    const out = scopedThemes(source);
    const light = block(out, ".k-theme-light");
    const dark = block(out, ".k-theme-dark");
    const lightNames = names(light);
    for (const n of names(dark)) if (n !== "--shadow-float" || lightNames.includes(n)) expect(lightNames, n).toContain(n);
    expect(light).toContain("--bg: #ffffff;");
    expect(light).toContain("--ink: #231f20;");
    expect(light).toContain("color-scheme: light;");
  });

  it("is in the generated tokens.css", () => {
    expect(generated).toContain(".k-theme-dark {");
    expect(generated).toContain(".k-theme-light {");
  });
});
