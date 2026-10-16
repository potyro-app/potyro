// Which sites count as Potyro when apps move between them (move-origins.ts). Every decision the two
// sides of a move make about a message rests on this, so a look-alike must never pass.

import { describe, expect, it } from "vitest";
import { isPotyroOrigin, knownOrigins, newHomeFor, originOf } from "../src/move-origins.js";

const prod = { dev: false };
const dev = { dev: true };

describe("Potyro origins", () => {
  it("knows the public sites exactly", () => {
    expect(isPotyroOrigin("https://potyro.app", prod)).toBe(true);
    expect(isPotyroOrigin("https://apps.vaz.io", prod)).toBe(true);
  });

  it("refuses look-alikes, other schemes and opaque origins", () => {
    for (const o of [
      "https://potyro.app.evil.test",
      "https://evilpotyro.app",
      "http://potyro.app",
      "https://potyro.app:444",
      "https://apps.vaz.io.evil.test",
      "null",
      "",
      "file://",
      "https://potyro.app/",
    ]) {
      expect(isPotyroOrigin(o, prod), o).toBe(false);
    }
  });

  it("counts localhost on any port only on a dev server", () => {
    expect(isPotyroOrigin("http://localhost:5173", prod)).toBe(false);
    expect(isPotyroOrigin("http://localhost:5173", dev)).toBe(true);
    expect(isPotyroOrigin("http://127.0.0.1:6001", dev)).toBe(true);
    expect(isPotyroOrigin("http://localhost.evil.test:5173", dev)).toBe(false);
    expect(isPotyroOrigin("http://evil.test", dev)).toBe(false);
  });

  it("takes extra origins from the build, exactly", () => {
    const env = { dev: false, extra: "https://potyro.example.org, not a url, https://x.test/path" };
    expect(isPotyroOrigin("https://potyro.example.org", env)).toBe(true);
    expect(isPotyroOrigin("https://x.test", env)).toBe(false);
    expect(knownOrigins(env)).toContain("https://potyro.example.org");
  });

  it("reads an origin only from an http(s) URL", () => {
    expect(originOf("https://potyro.app/?move=x")).toBe("https://potyro.app");
    expect(originOf("javascript:alert(1)")).toBeNull();
  });
});

describe("the new home", () => {
  it("is potyro.app for apps.vaz.io, and nothing for potyro.app itself", () => {
    expect(newHomeFor("https://apps.vaz.io", prod)).toBe("https://potyro.app");
    expect(newHomeFor("https://potyro.app", prod)).toBeNull();
  });

  it("can be set by a dev server, but only to a Potyro origin and never to itself", () => {
    expect(newHomeFor("http://localhost:5001", { ...dev, devNewHome: "http://localhost:5002" })).toBe("http://localhost:5002");
    expect(newHomeFor("http://localhost:5001", { ...dev, devNewHome: "https://evil.test" })).toBeNull();
    expect(newHomeFor("http://localhost:5001", { ...dev, devNewHome: "http://localhost:5001" })).toBeNull();
    // Outside dev the override is not read at all.
    expect(newHomeFor("https://potyro.app", { ...prod, devNewHome: "https://apps.vaz.io" })).toBeNull();
  });

  it("can be named by the build, and is still checked", () => {
    expect(newHomeFor("https://old.example", { ...prod, configured: "https://potyro.app/" })).toBe("https://potyro.app");
    expect(newHomeFor("https://old.example", { ...prod, configured: "https://evil.test" })).toBeNull();
  });
});
