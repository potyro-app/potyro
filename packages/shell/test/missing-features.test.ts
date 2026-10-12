// What a shared app reached for that the sealed box lacks, in plain words (#271). The messages are
// QuickJS's own, as the sealed box says them, and V8's, as the person's own apps would.
import { describe, expect, it } from "vitest";
import { describeMissing, missingFeature, missingFeatures } from "../src/missing-features.js";

describe("naming what is missing", () => {
  it("a missing global, as QuickJS and V8 say it", () => {
    expect(missingFeature(new ReferenceError("'Intl' is not defined"))?.words).toBe("date and number formatting (Intl)");
    expect(missingFeature(new ReferenceError("Intl is not defined"))?.words).toBe("date and number formatting (Intl)");
    expect(missingFeature("computed day.month: 'TextEncoder' is not defined")?.words).toBe("turning text into bytes (TextEncoder)");
    expect(missingFeature(new ReferenceError("'document' is not defined"))?.words).toBe("a full web page (document)");
  });

  it("a member of a missing global reached through globalThis, or called", () => {
    expect(missingFeature(new TypeError("cannot read property 'DateTimeFormat' of undefined"))?.name).toBe("Intl");
    expect(missingFeature(new TypeError("Cannot read properties of undefined (reading 'NumberFormat')"))?.name).toBe("Intl");
    expect(missingFeature(new TypeError("Intl.DateTimeFormat is not a constructor"))?.name).toBe("Intl");
    expect(missingFeature(new TypeError("globalThis.structuredClone is not a function"))?.name).toBe("structuredClone");
  });

  it("a library's start message, as the sealed box wraps it, names the feature too", () => {
    const wrapped = new Error("chart.js 4.4.1 needs a full web page to work ('window' is not defined). Apps in the sealed box do not get one, so this app can only run as yours.");
    expect(missingFeature(wrapped)?.name).toBe("window");
  });

  it("the app's own mistakes are not a missing feature", () => {
    expect(missingFeature(new ReferenceError("'totl' is not defined"))).toBeUndefined();
    expect(missingFeature(new TypeError("cannot read property 'length' of undefined"))).toBeUndefined();
    expect(missingFeature(new Error("boom"))).toBeUndefined();
  });

  it("each feature once, and a sentence a person can read", () => {
    const found = missingFeatures(["'Intl' is not defined", "cannot read property 'Collator' of undefined", "'URL' is not defined", "boom"]);
    expect(found.map((f) => f.name)).toEqual(["Intl", "URL"]);
    expect(describeMissing(found)).toBe("It uses features shared apps don’t have yet: date and number formatting (Intl) and reading web addresses (URL).");
    expect(describeMissing(found.slice(0, 1))).toBe("It uses a feature shared apps don’t have yet: date and number formatting (Intl).");
    expect(describeMissing([])).toBe("");
  });
});
