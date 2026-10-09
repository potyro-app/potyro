// What Ask's review starts with, per proposed record (#213): approved or not, and why; which values
// would be saved; and a few words on how far it was confirmed. Only defaults — the person decides —
// and nothing here knows what the app is about: it reads the trust the generator computed from what
// was actually retrieved (packages/generator/src/agent/evidence.ts, verify-claims.ts).
//
//   approved   two or more sites confirm it; general knowledge; a record the device made itself
//   held back  one site only; not confirmed; disputed; already in the app; or a required value its
//              sources dispute (saving it would mean saving without that value)
//
// A disputed value is left out of what is saved unless the person keeps it; an unconfirmed one is
// saved, and shown with its note.

import { humanizeKey, type AppDefinition } from "potyro";
import type { ReviewRow } from "./ask-apply.js";

export type Tone = "good" | "warn" | "bad" | "neutral";

export function defaultApproval(def: AppDefinition, row: ReviewRow, kept: ReadonlySet<string> = new Set()): { approved: boolean; reason?: string } {
  if (row.duplicate) return { approved: false, reason: "Already in your app." };
  const t = row.trust;
  if (t?.status === "single") return { approved: false, reason: `Only ${t.sources[0]?.host ?? "one site"} mentions it; nothing else confirmed it.` };
  if (t?.status === "unsupported") return { approved: false, reason: t.issues[0] ?? "Nothing that was read supports it." };
  if (t?.status === "contradicted") {
    const why = Object.values(t.fieldIssues ?? {}).find((f) => f.kind === "contradicted")?.why;
    return { approved: false, reason: why ?? t.issues[0] ?? "Its sources say otherwise." };
  }
  for (const [key, issue] of Object.entries(t?.fieldIssues ?? {})) {
    const field = def.entities[row.entity]?.fields[key];
    if (issue.kind === "contradicted" && field?.required && !kept.has(key)) return { approved: false, reason: `${field.label ?? humanizeKey(key)}: ${issue.why}` };
  }
  return { approved: true };
}

/** The values that would be saved: disputed ones left out, unless the person keeps them. */
export function valuesToSave(row: ReviewRow, kept: ReadonlySet<string>): Record<string, unknown> {
  const out = { ...row.values };
  for (const [key, issue] of Object.entries(row.trust?.fieldIssues ?? {})) if (issue.kind === "contradicted" && !kept.has(key)) delete out[key];
  return out;
}

export function trustLabel(row: ReviewRow): { text: string; tone: Tone } {
  if (row.duplicate) return { text: "Already in your app", tone: "neutral" };
  const t = row.trust;
  switch (t?.status) {
    case "corroborated": {
      const via = t.sources.find((x) => x.via)?.via;
      return { text: via ? `From ${via}` : `${t.sources.length} sources`, tone: "good" };
    }
    case "single":
      return { text: `Only ${t.sources[0]?.host ?? "one site"}`, tone: "warn" };
    case "general":
      return { text: "General knowledge", tone: "neutral" };
    case "unsupported":
      return { text: "Not confirmed", tone: "bad" };
    case "contradicted":
      return { text: "Disputed", tone: "bad" };
    default:
      return { text: "New", tone: "neutral" };
  }
}
