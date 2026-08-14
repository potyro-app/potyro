// The three things the fixing agent could never do: replay what the person did, look at the app the
// runtime actually resolved, and check the shape of the data.
//
// `query_data` is deliberately shape-only. A huge share of "it doesn't work" is not a code bug —
// the map is empty because no record has coordinates — and that is answerable from counts alone.
// Karta apps hold someone's medications and finances; sending their rows to a cloud model to answer
// "how many are empty?" would be a betrayal for no diagnostic gain. Raw values require BOTH an
// explicit per-app grant and an on-device engine, decided by the caller, never by this module.

import { replayCase, replayPassed, type Case, type ReplayTarget } from "@karta/runtime";
import type { AgentTool } from "./tools.js";

export interface InvestigationDeps {
  source: string;
  target: ReplayTarget;
  theCase: Case;
  records: (entity: string) => Promise<unknown[]>;
  /** True only when the user granted it AND the engine runs on-device. Decided by the caller. */
  allowRawRecords: boolean;
}

const NO_ARGS = { type: "object", properties: {} } as const;

function shapeOf(rows: unknown[]): string {
  if (!rows.length) return "0 records";
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r as Record<string, unknown>)) keys.add(k);
  const lines = [...keys].map((k) => {
    const empty = rows.filter((r) => {
      const v = (r as Record<string, unknown>)[k];
      return v === null || v === undefined || v === "";
    }).length;
    return `  ${k}: ${rows.length - empty} set, ${empty} empty`;
  });
  return [`${rows.length} records`, ...lines].join("\n");
}

export function buildAppTools(deps: InvestigationDeps): AgentTool[] {
  return [
    {
      name: "replay_case",
      description:
        "Replay what the user did, step by step, and report what actually happened. Use this FIRST, and again after any change, to see whether the reported problem is real and whether it is fixed.",
      parameters: NO_ARGS,
      run: async () => {
        const report = await replayCase(deps.target, deps.theCase);
        const lines = report.outcomes.map((o) => `${o.ok ? "ok" : "FAILED"}: ${o.detail}`);
        const head = report.expectation ? `The user expected: ${report.expectation}` : "No expectation recorded.";
        return { ok: replayPassed(report), detail: [head, ...lines].join("\n") };
      },
    },
    {
      name: "inspect_app",
      description:
        "List the pages the app actually has, with each page's view type and entity. Use this when a step reports that a page does not exist.",
      parameters: NO_ARGS,
      run: async () => ({
        ok: true,
        detail: deps.target.definition.pages
          .map((p) => `${p.id} (${p.view.type}${p.view.entity ? ` of ${p.view.entity}` : ""})`)
          .join("\n"),
      }),
    },
    {
      name: "query_data",
      description:
        "How many records an entity has and how many have each field filled in. A page that opens but shows nothing is usually a data problem, not a code problem. Returns counts only, never the user's own values.",
      parameters: { type: "object", properties: { entity: { type: "string" } }, required: ["entity"] },
      run: async (args) => {
        const entity = String(args.entity ?? "");
        const rows = await deps.records(entity);
        if (deps.allowRawRecords) return { ok: true, detail: JSON.stringify(rows, null, 2).slice(0, 4000) };
        return { ok: true, detail: shapeOf(rows) };
      },
    },
  ];
}
