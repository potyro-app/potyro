import { describe, expect, it } from "vitest";
import { LIMITS, REQUEST_FORMAT, issueBody, normalizeTitle, readPayload, type PlatformRequestPayload } from "../src/request.ts";

const good: PlatformRequestPayload = {
  format: REQUEST_FORMAT,
  id: "req-1",
  device: "dev-1",
  title: "Scan barcodes",
  body: "I wanted to scan the barcode on a pot.",
  structure: '{ "entities": {} }',
  app: "Plants",
  language: "en",
};

describe("readPayload: what the relay accepts", () => {
  it("a well-formed request", () => {
    expect(readPayload(good)).toEqual({ ok: true, payload: good });
  });
  it("trims, and folds the title to one line", () => {
    const r = readPayload({ ...good, title: "  Scan\nbarcodes  ", body: "  words  " });
    expect(r.ok && r.payload.title).toBe("Scan barcodes");
    expect(r.ok && r.payload.body).toBe("words");
  });
  it("refuses what is not one, saying why", () => {
    for (const bad of [null, "x", { ...good, format: "other" }, { ...good, title: "" }, { ...good, body: 5 }, { ...good, device: "" }, { ...good, id: "" }]) {
      const r = readPayload(bad);
      expect(r.ok).toBe(false);
    }
  });
  it("refuses what is too long, rather than cutting a person's words", () => {
    expect(readPayload({ ...good, title: "x".repeat(LIMITS.title + 1) }).ok).toBe(false);
    expect(readPayload({ ...good, body: "x".repeat(LIMITS.body + 1) }).ok).toBe(false);
    expect(readPayload({ ...good, structure: "x".repeat(LIMITS.structure + 1) }).ok).toBe(false);
  });
  it("drops anything it does not know, so nothing else travels", () => {
    const r = readPayload({ ...good, records: [{ name: "Ana" }] });
    expect(r.ok && "records" in r.payload).toBe(false);
  });
});

describe("normalizeTitle: duplicates grouped", () => {
  it("is blind to case, accents, punctuation, word order, plurals and filler", () => {
    expect(normalizeTitle("Scan barcodes!")).toBe(normalizeTitle("scan a Barcode"));
    expect(normalizeTitle("Bluetooth heart-rate strap")).toBe(normalizeTitle("heart rate strap (Bluetooth)"));
    expect(normalizeTitle("Câmera")).toBe(normalizeTitle("camera"));
  });
  it("keeps different requests apart", () => {
    expect(normalizeTitle("Scan barcodes")).not.toBe(normalizeTitle("Send text messages"));
  });
});

describe("issueBody: what lands on GitHub", () => {
  it("quotes the person's words, marks them untrusted, and folds the structure away", () => {
    const body = issueBody({ ...good, body: "line one\nline two" });
    expect(body).toMatch(/untrusted/i);
    expect(body).toContain("> line one\n> line two");
    expect(body).toContain("<details>");
    expect(body).toContain('{ "entities": {} }');
    // Never who sent it.
    expect(body).not.toContain("dev-1");
  });
  it("cannot be broken out of: a fence in the structure does not end the block", () => {
    const body = issueBody({ ...good, structure: "```\n# heading\n```" });
    const fences = body.match(/^````/gm) ?? [];
    expect(fences.length).toBe(2);
  });
});
