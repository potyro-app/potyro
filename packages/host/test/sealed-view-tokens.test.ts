// The theme a sealed screen is given (#267, #463): readTokens reads every custom property that
// reaches where the view sits. The engines' own lists of them cannot be trusted — Gecko's names an
// overridden property twice and drops as many others (`:root{--p0…--p29}` under an element setting
// `--p3;--p7;--p11;--p20` inline lists --p20,--p11,--p7,--p3,--p29…--p3 again…--p4: no --p0–--p2) —
// so here the computed style lists names the way an engine does, and its values are the truth.
// That the frame then paints with them, in Chromium and Firefox, is e2e/sealed-views-sandbox.spec.ts.

import { describe, expect, it } from "vitest";
import { readTokens } from "../src/realm/index.js";

type Decl = Record<string, string>;

/** A CSSStyleDeclaration-like list: indexed names, a length, getPropertyValue. */
function declaration(names: string[], values: Decl, extra: Record<string, string> = {}) {
  const d: Record<string | number, unknown> = { length: names.length, getPropertyValue: (n: string) => values[n] ?? "", ...extra };
  names.forEach((n, i) => (d[i] = n));
  return d;
}

const rule = (decl: Decl, nested?: unknown[]) => ({ style: declaration(Object.keys(decl), decl), ...(nested ? { cssRules: nested } : {}) });

/** An element whose computed style has `values`, but lists only `listed`, in a page with `sheets`. */
function element(values: Decl, listed: string[], sheets: unknown[], inline: Decl = {}) {
  const cs = declaration(listed, values, { colorScheme: "light", fontFamily: "Inter", color: "rgb(35, 31, 32)" });
  const doc = { styleSheets: sheets, defaultView: { getComputedStyle: () => cs } } as unknown;
  return { ownerDocument: doc, style: declaration(Object.keys(inline), inline), parentElement: null } as unknown as Element;
}

const values: Decl = { "--ink": "#231f20", "--surface": "#fff", "--line": "#e5e2dd", "--hue": "85", "--accent": "#e8b53c" };

describe("the theme a sealed screen is given", () => {
  it("carries what Gecko's list leaves out: the root's tokens under an element that overrides some", () => {
    // Gecko: --hue and --accent overridden on the app → listed twice, the root's first three gone.
    const geckoList = ["--accent", "--hue", "--accent", "--hue", "--line"];
    const sheets = [{ cssRules: [rule({ "--ink": "#231f20", "--surface": "#fff", "--line": "#e5e2dd", "--hue": "0", "--accent": "#000" })] }];
    const t = readTokens(element(values, geckoList, sheets, { "--hue": "85", "--accent": "#e8b53c" }));
    expect(t).toMatchObject(values);
    expect(t).toMatchObject({ "color-scheme": "light", "font-family": "Inter", color: "rgb(35, 31, 32)" });
  });

  it("finds names declared inside @media, @layer and nesting, and in an engine that lists none", () => {
    const sheets = [{ cssRules: [rule({ "--ink": "#231f20" }), { cssRules: [rule({ "--surface": "#fff" }), { cssRules: [rule({ "--line": "#e5e2dd" })] }] }] }];
    const t = readTokens(element({ "--ink": "#231f20", "--surface": "#fff", "--line": "#e5e2dd" }, [], sheets));
    expect(t).toMatchObject({ "--ink": "#231f20", "--surface": "#fff", "--line": "#e5e2dd" });
  });

  it("takes each value from where the view sits, and leaves out a name that does not reach it", () => {
    const sheets = [{ cssRules: [rule({ "--ink": "#000", "--only-elsewhere": "1" })] }];
    const t = readTokens(element({ "--ink": "#231f20" }, [], sheets));
    expect(t["--ink"]).toBe("#231f20");
    expect(t).not.toHaveProperty("--only-elsewhere");
  });

  it("skips a sheet it may not read", () => {
    const closed = {
      get cssRules(): never {
        throw new Error("SecurityError");
      },
    };
    const t = readTokens(element({ "--ink": "#231f20" }, [], [closed, { cssRules: [rule({ "--ink": "x" })] }]));
    expect(t["--ink"]).toBe("#231f20");
  });
});
