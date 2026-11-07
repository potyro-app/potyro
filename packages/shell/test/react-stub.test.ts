// The isolate's React stub must export every public name React exports (isolate-stubs/react.ts).
//
// An app's custom view may import any of them; the stub is only there so the view is dead code in
// the QuickJS bundle, never a reason the app fails to bundle. The first `useLayoutEffect` in an
// app made the Add dialog say "Build failed" with nothing else (2026-11-07) — this pins the list to
// the React that is installed, so the next hook React adds is caught here, not by a person.

import { describe, expect, it } from "vitest";
import * as React from "react";
import * as stub from "../src/isolate-stubs/react.js";

const PUBLIC = (name: string): boolean => !/^(__|unstable_|experimental_|default$)/.test(name);

describe("the isolate's React stub", () => {
  it("exports every public name of the installed React", () => {
    const real = Object.keys(React).filter(PUBLIC).sort();
    const missing = real.filter((name) => !(name in stub));
    expect(missing).toEqual([]);
  });

  it("exports the jsx runtime's names too", () => {
    for (const name of ["jsx", "jsxs", "Fragment"]) expect(name in stub).toBe(true);
  });

  it("stands in harmlessly: hooks give their initial value and effects do nothing", () => {
    expect(stub.useState(3)[0]).toBe(3);
    expect(stub.useReducer(() => 0, 7)[0]).toBe(7);
    expect(stub.useMemo(() => "m")).toBe("m");
    expect(stub.useLayoutEffect()).toBeUndefined();
    expect(stub.useContext(stub.createContext("c"))).toBe("c");
  });
});
