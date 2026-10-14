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

import { t, plural } from "@lingui/core/macro";
import { humanizeKey, type AppDefinition } from "potyro";
import type { ReviewRow } from "./ask-apply.js";

export type Tone = "good" | "warn" | "bad" | "neutral";

/** The one site a single-source row names, or "one site" when it named none. */
const oneSite = (host: string | undefined): string =>
  host ?? t({ message: "one site", comment: "Ask review: stands in for a website's name when none is known" });

export function defaultApproval(def: AppDefinition, row: ReviewRow, kept: ReadonlySet<string> = new Set()): { approved: boolean; reason?: string } {
  if (row.duplicate) return { approved: false, reason: t`Already in your app.` };
  const trust = row.trust;
  if (trust?.status === "single") {
    const site = oneSite(trust.sources[0]?.host);
    return { approved: false, reason: t`Only ${site} mentions it; nothing else confirmed it.` };
  }
  // `issues` and `why` are the generator's own sentences about what was read (verify-claims.ts).
  if (trust?.status === "unsupported") return { approved: false, reason: trust.issues[0] ?? t`Nothing that was read supports it.` };
  if (trust?.status === "contradicted") {
    const why = Object.values(trust.fieldIssues ?? {}).find((f) => f.kind === "contradicted")?.why;
    return { approved: false, reason: why ?? trust.issues[0] ?? t`Its sources say otherwise.` };
  }
  for (const [key, issue] of Object.entries(trust?.fieldIssues ?? {})) {
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
  if (row.duplicate) return { text: t`Already in your app`, tone: "neutral" };
  const trust = row.trust;
  switch (trust?.status) {
    case "corroborated": {
      const via = trust.sources.find((x) => x.via)?.via;
      const text = via
        ? t({ message: `From ${via}`, comment: "Ask review: where a proposed record was confirmed, e.g. From Wikidata" })
        : plural(trust.sources.length, { one: "# source", other: "# sources" });
      return { text, tone: "good" };
    }
    case "single": {
      const site = oneSite(trust.sources[0]?.host);
      return { text: t({ message: `Only ${site}`, comment: "Ask review: only this one website mentions the record" }), tone: "warn" };
    }
    case "general":
      return { text: t`General knowledge`, tone: "neutral" };
    case "unsupported":
      return { text: t`Not confirmed`, tone: "bad" };
    case "contradicted":
      return { text: t({ message: "Disputed", comment: "Ask review: the sources disagree about this record" }), tone: "bad" };
    default:
      return { text: t({ message: "New", comment: "Ask review: a proposed record, not checked against anything" }), tone: "neutral" };
  }
}
