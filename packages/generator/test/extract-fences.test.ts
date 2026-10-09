// Getting the code out of a model's reply.
//
// This cost a user a working app. The extractors accepted ```ts and ```typescript and nothing else,
// so a reply fenced ```tsx — which is what a model reaches for the moment an app has a custom view,
// and what the bundler itself calls the file — matched nothing at all. The ENTIRE reply, prose and
// fence markers included, was then handed to esbuild, which reported a syntax error partway through
// an English sentence:
//
//     gen.app.tsx:1:37: ERROR: Expected ";" but found ":"
//
// Nothing about that points at the real problem, and the app could not be repaired by asking again
// because the next reply was fenced the same way.

import { describe, expect, it } from "vitest";
import { extractSource, looksLikeApp, parseModifyReply } from "../src/prompt.js";

const APP = `import { defineApp } from "potyro";\nexport default defineApp({ id: "x", name: "X" });`;
const fenced = (tag: string, body = APP) => "Here is the updated app:\n```" + tag + "\n" + body + "\n```\n";

describe("extractSource", () => {
  for (const tag of ["ts", "tsx", "typescript", "jsx", "js", "javascript", ""]) {
    it(`unwraps a \`\`\`${tag || "(none)"} block`, () => {
      const out = extractSource(fenced(tag));
      expect(out.split("\n")[0]).toBe('import { defineApp } from "potyro";');
      expect(out).not.toContain("Here is the updated app");
      expect(out).not.toContain("```");
    });
  }

  it("takes the whole file, not an illustrative snippet", () => {
    const reply =
      "First, the bit that changed:\n```ts\nconst x = 1;\n```\nAnd the whole file:\n```tsx\n" + APP + "\n```\n";
    expect(extractSource(reply)).toContain("defineApp");
    expect(extractSource(reply)).not.toContain("const x = 1");
  });

  it("still yields code when the reply was cut off before the closing fence", () => {
    expect(extractSource("Here:\n```tsx\n" + APP)).toContain("defineApp");
  });

  it("leaves an unfenced reply alone", () => {
    expect(extractSource(APP)).toBe(APP);
  });
});

describe("parseModifyReply", () => {
  it("unwraps a ```tsx block and keeps the prose as the rationale", () => {
    const r = parseModifyReply(fenced("tsx"));
    expect(r.kind).toBe("source");
    if (r.kind !== "source") throw new Error("unreachable");
    expect(r.source.split("\n")[0]).toBe('import { defineApp } from "potyro";');
    expect(r.source).not.toContain("```");
    expect(r.rationale).toBe("Here is the updated app:");
  });
});

describe("looksLikeApp", () => {
  it("tells an app from an explanation, so the failure can be reported in words", () => {
    expect(looksLikeApp(APP)).toBe(true);
    expect(looksLikeApp("I've updated the app to support groups:")).toBe(false);
  });
});
