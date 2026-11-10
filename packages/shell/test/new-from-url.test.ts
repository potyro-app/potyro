// `?new=<words>` (#53): the words always reach the Studio's box; the app is made from them without
// another press only when the browser says the visit came from the site's own page.

import { describe, expect, it } from "vitest";
import { readNewFromUrl } from "../src/new-from-url.js";

const SITE = "https://potyro.com/";

describe("words arriving in the address", () => {
  it("is nothing when the address carries none", () => {
    expect(readNewFromUrl("", SITE, SITE)).toBeNull();
    expect(readNewFromUrl("?user=split", SITE, SITE)).toBeNull();
  });

  it("starts at once for a visit from the site", () => {
    expect(readNewFromUrl("?new=A%20countdown%20to%20the%20wedding", "https://potyro.com/", SITE)).toEqual({ text: "A countdown to the wedding", start: true });
  });

  it.each([
    ["no referrer at all: a typed address, a privacy setting, a link in a chat", ""],
    ["another site", "https://example.org/"],
    ["a look-alike of the site's name", "https://potyro.com.example.org/"],
    ["the site's name inside another address", "https://example.org/?https://potyro.com/"],
    ["the site over plain http", "http://potyro.com/"],
    ["another port of the site's host", "https://potyro.com:8443/"],
    ["the app itself", "https://potyro.app/"],
    ["something that is not an address", "potyro.com"],
  ])("only fills the box for %s", (_why, referrer) => {
    expect(readNewFromUrl("?new=make%20me%20an%20app", referrer, SITE)).toEqual({ text: "make me an app", start: false });
  });

  it("never starts on nothing, wherever it came from", () => {
    expect(readNewFromUrl("?new=", SITE, SITE)).toEqual({ text: "", start: false });
    expect(readNewFromUrl("?new=%20%20", SITE, SITE)).toEqual({ text: "", start: false });
  });

  it("follows the site the build names, not a fixed one", () => {
    expect(readNewFromUrl("?new=x", "http://localhost:4191/apps/", "http://localhost:4191/")).toMatchObject({ start: true });
    expect(readNewFromUrl("?new=x", "https://potyro.com/", "http://localhost:4191/")).toMatchObject({ start: false });
  });
});
