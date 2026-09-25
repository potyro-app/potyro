import { describe, expect, it } from "vitest";
import type { AppDefinition } from "karta";
import type { ReviewRow } from "../src/ask-apply.js";
import { defaultApproval, trustLabel, valuesToSave } from "../src/ask-verdicts.js";

// What the review starts with, per proposed record (#213). The person decides; these are only the
// defaults, and every one says why. Nothing here knows what the app is about.

const DEF = {
  id: "p",
  name: "P",
  entities: { place: { displayField: "name", fields: { name: { type: "text", required: true }, where: { type: "geo", required: true }, hours: { type: "text" }, note: { type: "text" } } } },
  pages: [],
} as unknown as AppDefinition;

const row = (trust?: ReviewRow["trust"], extra: Partial<ReviewRow> = {}): ReviewRow => ({
  entity: "place",
  ref: "r",
  values: { name: "Ninføød", where: { lat: 44.39, lng: 7.55, label: "Via Busca 3b" }, hours: "12:00–15:00", note: "vegan" },
  duplicate: false,
  notes: [],
  ...(trust ? { trust } : {}),
  ...extra,
});
const src = (host: string) => ({ url: `https://${host}/x`, host, quote: "Ninføød…" });

describe("defaultApproval", () => {
  it("approves what two sites confirm, general knowledge, and what the device made itself", () => {
    expect(defaultApproval(DEF, row({ status: "corroborated", sources: [src("a.it"), src("b.it")], issues: [] })).approved).toBe(true);
    expect(defaultApproval(DEF, row({ status: "general", sources: [], issues: [] })).approved).toBe(true);
    expect(defaultApproval(DEF, row()).approved).toBe(true);
  });

  it("holds back one-site records, unconfirmed and disputed ones, and duplicates — saying why", () => {
    const single = defaultApproval(DEF, row({ status: "single", sources: [src("cambiamenu.it")], issues: [] }));
    expect(single).toEqual({ approved: false, reason: expect.stringMatching(/only cambiamenu\.it/i) });
    expect(defaultApproval(DEF, row({ status: "unsupported", sources: [], issues: ["No page that was read mentions “X”."] }))).toEqual({ approved: false, reason: expect.stringMatching(/No page/) });
    expect(defaultApproval(DEF, row({ status: "contradicted", sources: [src("a.it")], issues: [] })).approved).toBe(false);
    expect(defaultApproval(DEF, row(undefined, { duplicate: true }))).toEqual({ approved: false, reason: expect.stringMatching(/already/i) });
  });

  it("holds back a record whose required value is disputed, since saving it would drop that value", () => {
    const t = { status: "corroborated" as const, sources: [src("a.it"), src("b.it")], issues: [], fieldIssues: { where: { kind: "contradicted" as const, why: "Sources place it in Mondovì." } } };
    expect(defaultApproval(DEF, row(t))).toEqual({ approved: false, reason: expect.stringMatching(/Mondovì/) });
    expect(defaultApproval(DEF, row(t), new Set(["where"])).approved).toBe(true);
  });
});

describe("valuesToSave", () => {
  const t = {
    status: "corroborated" as const,
    sources: [src("a.it"), src("b.it")],
    issues: [],
    fieldIssues: { hours: { kind: "contradicted" as const, why: "12:30–14:30 per two sites." }, note: { kind: "unsupported" as const, why: "Not stated." } },
  };

  it("drops disputed values unless kept; keeps unconfirmed ones", () => {
    expect(valuesToSave(row(t), new Set())).toEqual({ name: "Ninføød", where: { lat: 44.39, lng: 7.55, label: "Via Busca 3b" }, note: "vegan" });
    expect(valuesToSave(row(t), new Set(["hours"])).hours).toBe("12:00–15:00");
  });
});

describe("trustLabel", () => {
  it("says in a few words how far it was confirmed", () => {
    expect(trustLabel(row({ status: "corroborated", sources: [src("a.it"), src("b.it"), src("c.it")], issues: [] }))).toEqual({ text: "3 sources", tone: "good" });
    expect(trustLabel(row({ status: "single", sources: [src("cambiamenu.it")], issues: [] }))).toEqual({ text: "Only cambiamenu.it", tone: "warn" });
    expect(trustLabel(row({ status: "general", sources: [], issues: [] }))).toEqual({ text: "General knowledge", tone: "neutral" });
    expect(trustLabel(row({ status: "unsupported", sources: [], issues: [] }))).toEqual({ text: "Not confirmed", tone: "bad" });
    expect(trustLabel(row({ status: "contradicted", sources: [], issues: [] }))).toEqual({ text: "Disputed", tone: "bad" });
    expect(trustLabel(row(undefined, { duplicate: true }))).toEqual({ text: "Already in your app", tone: "neutral" });
  });
});
