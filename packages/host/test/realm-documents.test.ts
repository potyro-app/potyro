import { describe, expect, it } from "vitest";
import { NO_DNS_PREFETCH, realmDocument, viewDocument } from "../src/realm/frame.js";
import { REALM_CSP } from "../src/realm/protocol.js";

// What every realm frame's document carries before any script (docs/31 §10, docs/22 §10.5). The
// browser-level proof of what the DNS line stops, and of what it does not, is the opt-in probe
// `e2e/dns-prefetch-probe-sandbox.spec.ts`.

const RUNTIME = `window.__viewRuntime = "</script><script>escaped";`;
const DOCUMENTS = [
  { name: "the logic frame's document", html: realmDocument() },
  { name: "a view frame's document", html: viewDocument(RUNTIME) },
];

describe("the realm frames' documents", () => {
  it("writes the DNS switch as the off value both engines keep", () => {
    expect(NO_DNS_PREFETCH).toBe(`<meta http-equiv="x-dns-prefetch-control" content="off">`);
  });

  for (const { name, html } of DOCUMENTS) {
    describe(name, () => {
      const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

      it("switches DNS prefetch off once, in the head", () => {
        expect(head).toContain(NO_DNS_PREFETCH);
        expect(html.split("x-dns-prefetch-control").length - 1).toBe(1);
      });

      it("carries the realm CSP in the head", () => {
        expect(head).toContain(`<meta http-equiv="Content-Security-Policy" content="${REALM_CSP}">`);
      });

      it("has both before its first script, so no code runs in a document without them", () => {
        const firstScript = html.indexOf("<script");
        expect(firstScript).toBeGreaterThan(-1);
        expect(html.indexOf(NO_DNS_PREFETCH)).toBeLessThan(firstScript);
        expect(html.indexOf("Content-Security-Policy")).toBeLessThan(firstScript);
      });
    });
  }

  it("keeps an inlined runtime from closing its own script element", () => {
    const html = viewDocument(RUNTIME);
    expect(html).not.toContain(`"</script><script>escaped"`);
    expect(html).toContain(`<\\/script><script>escaped`);
  });
});
