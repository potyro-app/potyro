// A record that only one site mentions gets one more, dedicated search (#213).
//
// One source is weak evidence, and a stale one is how a bar in another town became "a vegetarian
// restaurant in Cuneo": a single directory page, repeated. But real places are often only on one of
// the pages a first search happened to return. The difference shows when you look for them on
// purpose: a real one turns up elsewhere; a stale listing does not. So each single-source record is
// searched for by name and its own details, the pages found join what was retrieved, and the
// record's sources are counted again. Nothing is asked of the model but the searching.

import type { AppDefinition } from "karta";
import type { ChatEngine } from "../chat-backend.js";
import { nameOfRow, verifyRow, type Retrieved, type Trust } from "./evidence.js";

/** Short, identifying details to search with: the text values that are not the name. */
function details(def: AppDefinition, row: { entity: string; values: Record<string, unknown> }): string {
  const by = def.entities[row.entity]?.displayField;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(row.values)) {
    if (k === by) continue;
    const label = typeof v === "object" && v !== null && typeof (v as { label?: unknown }).label === "string" ? (v as { label: string }).label : v;
    if (typeof label === "string" && label.length <= 60) parts.push(label);
    if (parts.length >= 2) break;
  }
  return parts.join(", ");
}

export async function corroborate(deps: {
  engine: ChatEngine;
  model?: string;
  definition: AppDefinition;
  rows: Array<{ entity: string; ref: string; values: Record<string, unknown>; evidence?: unknown; general?: unknown }>;
  trust: Record<string, Trust>;
  retrieved: Retrieved;
  signal?: AbortSignal;
}): Promise<Record<string, Trust>> {
  const single = deps.rows.filter((r) => deps.trust[r.ref]?.status === "single").slice(0, 6);
  if (!single.length || deps.signal?.aborted) return deps.trust;
  const lines = single.map((r) => `- ${nameOfRow(deps.definition, r.entity, r.values) ?? r.ref}${details(deps.definition, r) ? ` (${details(deps.definition, r)})` : ""}`);
  try {
    const res = await deps.engine.chat.completions.create({
      ...(deps.model ? { model: deps.model } : {}),
      messages: [
        {
          role: "user",
          content:
            "Search the web for each of these, one search each, by its exact name and details, to find pages about it. " +
            `Reply only "done".\n${lines.join("\n")}`,
        },
      ],
      serverTools: [{ type: "openrouter:web_search", parameters: { max_results: 5, max_uses: single.length } }],
      temperature: 0,
    });
    for (const c of res.choices[0]?.message.citations ?? []) deps.retrieved.add(c.url, [c.title, c.content].filter(Boolean).join("\n"));
  } catch {
    return deps.trust;
  }
  const out = { ...deps.trust };
  for (const row of single) {
    const again = verifyRow(deps.definition, row, deps.retrieved);
    out[row.ref] = again.status === "unsupported" ? out[row.ref]! : { ...again, issues: [...out[row.ref]!.issues] };
  }
  return out;
}
