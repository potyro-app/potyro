// The second check on what Ask proposes (#213): does the retrieved text actually SAY what the record
// says? The mechanical check (evidence.ts) proves a quote came from a real page and names the record;
// it cannot see that the page calls it "a bar and pizzeria in Pianfei" while the record says "a
// vegetarian restaurant in Cuneo". A model can, if it reads nothing but those pages.
//
// So this model gets no web and no knowledge task: the records that have sources, and for each, the
// text of its sources. It returns, per record, supported / unsupported / contradicted, naming the
// fields. Records it cannot judge (general knowledge, nothing retrieved) are left as they are, and a
// check that fails leaves the mechanical verdict standing, with a note — never a silent pass.

import type { AppDefinition } from "potyro";
import type { ChatEngine } from "../chat-backend.js";
import { hostOf, normText, type FieldIssue, type Retrieved, type Trust } from "./evidence.js";

/** Enough of each page to judge by, without handing over whole sites. */
const WINDOW = 2400;

interface Verdict {
  ref: string;
  verdict: "supported" | "unsupported" | "contradicted";
  problems?: Array<{ field?: string; kind?: string; why?: string }>;
}

const SYSTEM = [
  "You check records against source texts. Use ONLY the texts given with each record, never your own knowledge.",
  "For each record decide:",
  "- supported: every factual claim in its values is stated or clearly implied by its texts;",
  "- contradicted: a text says something incompatible with a value (another town, another kind of thing, another date,",
  "  author, price, number...);",
  "- unsupported: it is contradicted nowhere, but some factual claim is not in the texts.",
  "Judge only specific factual claims about this particular thing, the kind a source would state: what and where it",
  "is, its town or address, dates and times, prices, people (author, artist), years, numbers, and what its description",
  "says. Do NOT report as missing: general knowledge (nutrition, what category a common thing is), values the app uses",
  "to organise (status, tags, lists, order), the person's own values (stock, ratings, whether they did it), formatting,",
  "or empty values. For each problem name the field, say whether the texts CONTRADICT the value or just do not state",
  "it, and say why in one short sentence, quoting the text when it disagrees. Call `verdicts` once, with every record.",
].join("\n");

/** Around the quote in a page: the part that was read, at most WINDOW characters. */
function excerpt(text: string, quote: string): string {
  if (text.length <= WINDOW) return text;
  const at = text.toLowerCase().indexOf(quote.slice(0, 40).toLowerCase());
  const start = Math.max(0, (at < 0 ? 0 : at) - WINDOW / 3);
  return `…${text.slice(start, start + WINDOW)}…`;
}

/** A record's values as claims: geo reduced to its label, the empty left out. */
function claims(def: AppDefinition, entity: string, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const f = def.entities[entity]?.fields[k];
    if (f?.type === "geo") {
      const label = (v as { label?: unknown }).label;
      if (typeof label === "string" && label) out[k] = label;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export async function verifyClaims(deps: {
  engine: ChatEngine;
  model?: string;
  definition: AppDefinition;
  rows: Array<{ entity: string; ref: string; values: Record<string, unknown> }>;
  trust: Record<string, Trust>;
  retrieved: Retrieved;
  signal?: AbortSignal;
}): Promise<Record<string, Trust>> {
  const out: Record<string, Trust> = { ...deps.trust };
  const judged = deps.rows.filter((r) => {
    const t = deps.trust[r.ref];
    return t && (t.status === "single" || t.status === "corroborated") && t.sources.length > 0;
  });
  if (!judged.length) return out;

  const records = judged.map((r) => ({
    ref: r.ref,
    kind: deps.definition.entities[r.entity]?.label ?? r.entity,
    record: claims(deps.definition, r.entity, r.values),
    texts: deps.trust[r.ref]!.sources.map((s) => {
      const page = deps.retrieved.textOf(s.url);
      return { site: s.host, text: excerpt(page?.text ?? s.quote, s.quote) };
    }),
  }));

  let verdicts: Verdict[] | null = null;
  try {
    const res = await deps.engine.chat.completions.create({
      ...(deps.model ? { model: deps.model } : {}),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(records, null, 1) },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "verdicts",
            description: "One verdict per record.",
            parameters: {
              type: "object",
              properties: {
                verdicts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      ref: { type: "string" },
                      verdict: { type: "string", enum: ["supported", "unsupported", "contradicted"] },
                      problems: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: { field: { type: "string" }, kind: { type: "string", enum: ["contradicted", "unsupported"] }, why: { type: "string" } },
                        },
                      },
                    },
                    required: ["ref", "verdict"],
                  },
                },
              },
              required: ["verdicts"],
            },
          },
        },
      ],
      tool_choice: "auto",
      temperature: 0,
    });
    const call = res.choices[0]?.message.tool_calls?.find((c) => c.function.name === "verdicts");
    const args = call ? (JSON.parse(call.function.arguments || "{}") as { verdicts?: unknown }) : {};
    const list = typeof args.verdicts === "string" ? (JSON.parse(args.verdicts) as unknown) : args.verdicts;
    if (Array.isArray(list)) verdicts = list as Verdict[];
  } catch {
    verdicts = null;
  }

  if (!verdicts) {
    for (const r of judged) out[r.ref] = { ...out[r.ref]!, issues: [...out[r.ref]!.issues, "Its details could not be double-checked against its sources."] };
    return out;
  }

  const fields = (ref: string) => Object.keys(judged.find((r) => r.ref === ref)?.values ?? {});
  // The field that says WHICH thing this is. If the sources do not support that, nothing else about
  // the record holds: a concert on a date no page gives is not "partly" confirmed.
  const identity = (ref: string) => {
    const row = judged.find((r) => r.ref === ref);
    return row ? deps.definition.entities[row.entity]?.displayField : undefined;
  };
  for (const v of verdicts) {
    const before = out[v.ref];
    if (!before || v.verdict === "supported" || !fields(v.ref).length) continue;
    const fieldIssues: Record<string, FieldIssue> = { ...(before.fieldIssues ?? {}) };
    const loose: string[] = [];
    for (const p of v.problems ?? []) {
      const kind: FieldIssue["kind"] = p.kind === "contradicted" || (p.kind !== "unsupported" && v.verdict === "contradicted") ? "contradicted" : "unsupported";
      const why = typeof p.why === "string" && p.why.trim() ? p.why.trim() : kind === "contradicted" ? "Its sources say otherwise." : "Not in its sources.";
      const field = typeof p.field === "string" ? fields(v.ref).find((k) => normText(k) === normText(p.field!)) : undefined;
      if (field) fieldIssues[field] = { kind, why };
      else loose.push(why);
    }
    // The record's status is about the THING: only a problem with what identifies it changes it.
    const id = identity(v.ref);
    const aboutIdentity = id !== undefined ? fieldIssues[id] : undefined;
    out[v.ref] = {
      ...before,
      ...(aboutIdentity ? { status: aboutIdentity.kind === "contradicted" ? "contradicted" : "unsupported" } : {}),
      issues: [...before.issues, ...loose],
      ...(Object.keys(fieldIssues).length ? { fieldIssues } : {}),
    };
  }
  return out;
}
