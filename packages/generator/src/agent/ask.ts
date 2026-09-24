// Ask (#213): a model works on an app's data for the person, in the app's own shape.
//
// "Find dog-friendly places near here", "make me a push/pull/legs block": the answer should land in
// the app as records, not as a chatbot artefact in some other format. Every app already declares its
// data, so the model is shown that declaration and given one way to answer, `propose_records`, whose
// rows are checked against the entities' fields exactly as a save would check them. A proposal that
// does not fit goes back to the model with the reasons; one that fits ends the loop. Nothing here
// writes: the shell shows the proposal and the person accepts it.
//
// THE MODEL SEES STRUCTURE, NEVER RECORDS. This loop runs on a cloud engine, and the rule from
// app-tools.ts holds: record values only ever reach a model on this device. So nothing in this file
// takes a store, a runtime or a row — `describeStructure` reads the definition alone. The price is
// that the model cannot link to a record that already exists or know what is already there; the
// shell de-duplicates against the person's records, locally, after the proposal comes back.

import { fieldValueProblem, humanizeKey, type AppDefinition, type Field } from "karta";
import type { ChatEngine, ChatMessage } from "../chat-backend.js";
import { runTool, toolSpecs, type AgentTool } from "./tools.js";

/** One record the model proposes. `ref` names it inside the proposal, so another row can link to it. */
export interface ProposedRow {
  entity: string;
  ref: string;
  values: Record<string, unknown>;
}

export interface Proposal {
  /** One or two sentences for the person: what this is. */
  summary: string;
  rows: ProposedRow[];
}

export type AskStep =
  | { kind: "thinking" }
  | { kind: "proposal"; ok: boolean; detail: string };

export type AskOutcome =
  | { kind: "proposal"; proposal: Proposal }
  /** The model answered in words: a question back, or why it cannot do this in this app. */
  | { kind: "answer"; text: string }
  | { kind: "failed"; reason: string }
  | { kind: "stopped" };

/** A relation value inside a proposal: `@` and the ref of another proposed row. */
const REF = /^@(.+)$/;
/** More than this is not a proposal a person can review. */
const MAX_ROWS = 200;
const DEFAULT_MAX_STEPS = 5;

/** Field types a model cannot fill: a photo it does not have, a person it cannot see. */
const UNSETTABLE = new Set<Field["type"]>(["media", "member"]);

const labelOf = (key: string, field: Field): string => field.label ?? humanizeKey(key);

function describeField(key: string, field: Field): string {
  const rules: string[] = [];
  switch (field.type) {
    case "text":
    case "url":
    case "richtext":
    case "boolean":
      rules.push(field.type === "richtext" ? "text" : field.type);
      break;
    case "number":
      rules.push(field.integer ? "whole number" : "number");
      if (field.min != null) rules.push(`min ${field.min}`);
      if (field.max != null) rules.push(`max ${field.max}`);
      if (field.unit) rules.push(`in ${field.unit}`);
      break;
    case "money":
      rules.push(`money as whole minor units, ${field.currency ?? "EUR"} (4200 means 42.00)`);
      break;
    case "enum":
      rules.push(`one of: ${field.options.join(", ")}`);
      break;
    case "tags":
      rules.push(field.options?.length ? `list of tags, from: ${field.options.join(", ")}` : "list of tags (strings)");
      break;
    case "datetime":
      rules.push(field.precision === "minute" ? "date and time, ISO 8601" : "date, ISO 8601 (YYYY-MM-DD)");
      break;
    case "duration":
      rules.push(`number of ${field.unit ?? "ms"}`);
      break;
    case "geo":
      rules.push('place: { "lat": number, "lng": number, "label"?: string }');
      break;
    case "relation":
      rules.push(`relation to ${field.to}${field.many ? " (a list)" : ""}: "@<ref>" of a ${field.to} row in this same proposal`);
      break;
    case "list": {
      const sub = Object.entries(field.of).map(([k, f]) => describeField(k, f)).join("; ");
      rules.push(`list of rows, each { ${sub} }`);
      break;
    }
    default:
      rules.push(field.type);
  }
  if (field.required) rules.push(field.default !== undefined ? "required, has a default" : "required");
  if (field.help) rules.push(`hint: ${field.help}`);
  const label = labelOf(key, field);
  return `${key}${label !== key ? ` ("${label}")` : ""}: ${rules.join(", ")}`;
}

/**
 * The app's data shape, in words a model can fill: its entities, their fields and the rules on them.
 * Built from the definition ALONE — see the file header. Fields Ask cannot fill are left out.
 */
export function describeStructure(def: AppDefinition): string {
  const lines = [`App: ${def.name}`];
  for (const [key, entity] of Object.entries(def.entities)) {
    lines.push("", `entity ${key}${entity.label ? ` ("${entity.label}")` : ""}${entity.displayField ? `, named by ${entity.displayField}` : ""}`);
    for (const [fk, field] of Object.entries(entity.fields)) {
      if (UNSETTABLE.has(field.type)) continue;
      lines.push(`  - ${describeField(fk, field)}`);
    }
    const computed = Object.keys(entity.computed ?? {});
    if (computed.length) lines.push(`  computed by the app, never set: ${computed.join(", ")}`);
  }
  return lines.join("\n");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Why a relation value does not point at a row of `to` in this proposal, or null. */
function relationProblem(value: unknown, to: string, many: boolean, refs: Map<string, string>, label: string): string | null {
  const values = many ? (Array.isArray(value) ? value : [value]) : [value];
  if (!many && Array.isArray(value)) return `${label} takes one "@ref", not a list.`;
  for (const v of values) {
    const m = typeof v === "string" ? REF.exec(v) : null;
    if (!m) return `${label}: ${JSON.stringify(v)} is not "@<ref>". Existing records cannot be linked; link to a ${to} row you propose.`;
    const entity = refs.get(m[1]!);
    if (entity !== to) return `${label}: ${v} is ${entity ? `a ${entity}` : "not a ref in this proposal"}; it must be a ${to} row you propose.`;
  }
  return null;
}

/**
 * Do these rows fit the app? Every problem at once, so the model can fix them in one go.
 *
 * The value rules are the store's own (`fieldValueProblem`, write mode) — a proposal is held to what
 * a save would be. On top of them: the entity exists, no undeclared field, required fields present,
 * nothing Ask cannot set, and relations point inside the proposal.
 */
export function checkProposedRows(def: AppDefinition, rows: ProposedRow[]): { ok: true; rows: ProposedRow[] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!rows.length) problems.push("The proposal has no rows.");
  if (rows.length > MAX_ROWS) problems.push(`At most ${MAX_ROWS} rows in one proposal.`);

  const refs = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.ref !== "string" || !row.ref) problems.push("Every row needs a ref.");
    else if (refs.has(row.ref)) problems.push(`The ref "${row.ref}" is used twice.`);
    else refs.set(row.ref, row.entity);
  }

  rows.forEach((row, i) => {
    const at = `Row ${i + 1} (${row.ref})`;
    const entity = def.entities[row.entity];
    if (!entity) {
      problems.push(`${at}: this app has no entity "${row.entity}". It has: ${Object.keys(def.entities).join(", ")}.`);
      return;
    }
    const values = isObject(row.values) ? row.values : {};
    for (const [key, value] of Object.entries(values)) {
      const field = entity.fields[key];
      if (!field) {
        problems.push(`${at}: ${row.entity} has no field "${key}".`);
        continue;
      }
      const label = labelOf(key, field);
      if (UNSETTABLE.has(field.type)) {
        problems.push(`${at}: ${label} (${key}) cannot be set here; leave it out.`);
        continue;
      }
      const problem =
        field.type === "relation"
          ? relationProblem(value, field.to, Boolean(field.many), refs, label)
          : fieldValueProblem(field, value, "write", label);
      if (problem) problems.push(`${at}: ${problem}`);
    }
    for (const [key, field] of Object.entries(entity.fields)) {
      if (!field.required || field.default !== undefined || UNSETTABLE.has(field.type)) continue;
      const v = values[key];
      if (v == null || v === "") problems.push(`${at}: ${labelOf(key, field)} (${key}) is required.`);
    }
  });

  return problems.length ? { ok: false, problems } : { ok: true, rows };
}

export const ASK_SYSTEM_PROMPT = [
  "You add data to a person's app. The app's structure is below; its records are not shown to you.",
  "Answer by calling `propose_records` with every row at once. Each row is { entity, ref, values }:",
  "- `ref` is a short name you choose, unique in the proposal;",
  "- `values` uses the field keys exactly, and each value must follow that field's rule;",
  '- a relation holds "@" plus the ref of another row in the same proposal; existing records cannot be linked.',
  "Leave out fields you have no good value for, unless they are required.",
  "The person reviews the proposal before anything is saved. If the tool reports problems, fix all of them and call it again.",
  "If the request cannot be done with this app's fields, or you need to know something first, reply in plain words instead,",
  "briefly, in the language the person wrote in.",
].join("\n");

export interface AskLoopDeps {
  engine: ChatEngine;
  model?: string;
  definition: AppDefinition;
  /** What the person asked, in their words. */
  request: string;
  maxSteps?: number;
  onStep?: (step: AskStep) => void;
  signal?: AbortSignal;
}

function proposeTool(def: AppDefinition, accept: (p: Proposal) => void): AgentTool {
  return {
    name: "propose_records",
    description: "Propose records to add to the app. The person reviews them before anything is saved.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences for the person: what you are proposing." },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { entity: { type: "string" }, ref: { type: "string" }, values: { type: "object" } },
            required: ["entity", "ref", "values"],
          },
        },
      },
      required: ["summary", "rows"],
    },
    run: async (args) => {
      const rows = (Array.isArray(args.rows) ? args.rows : []) as ProposedRow[];
      const checked = checkProposedRows(def, rows);
      if (!checked.ok) return { ok: false, detail: `Not saved, fix these and call again:\n${checked.problems.map((p) => `- ${p}`).join("\n")}` };
      accept({ summary: typeof args.summary === "string" ? args.summary : "", rows: checked.rows });
      return { ok: true, detail: `${rows.length} row${rows.length === 1 ? "" : "s"} proposed.` };
    },
  };
}

/** Run Ask until the model proposes rows that fit, answers in words, or runs out of steps. */
export async function runAskLoop(deps: AskLoopDeps): Promise<AskOutcome> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  let accepted: Proposal | null = null;
  const tools = [proposeTool(deps.definition, (p) => (accepted = p))];
  const messages: ChatMessage[] = [
    { role: "system", content: `${ASK_SYSTEM_PROMPT}\n\n${describeStructure(deps.definition)}` },
    { role: "user", content: deps.request },
  ];

  for (let step = 0; step < maxSteps; step += 1) {
    if (deps.signal?.aborted) return { kind: "stopped" };
    deps.onStep?.({ kind: "thinking" });
    const res = await deps.engine.chat.completions.create({
      ...(deps.model ? { model: deps.model } : {}),
      messages,
      tools: toolSpecs(tools),
      tool_choice: "auto",
      temperature: 0.2,
    });
    if (deps.signal?.aborted) return { kind: "stopped" };
    const choice = res.choices[0]?.message;
    const calls = choice?.tool_calls ?? [];
    const text = choice?.content ?? "";

    if (!calls.length) {
      if (text.trim()) return { kind: "answer", text: text.trim() };
      messages.push({ role: "assistant", content: text }, { role: "user", content: "Call `propose_records`, or reply in words." });
      continue;
    }

    messages.push({ role: "assistant", content: text, tool_calls: calls });
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const result = await runTool(tools, { id: c.id, name: c.function.name, args });
      deps.onStep?.({ kind: "proposal", ok: result.ok, detail: result.detail });
      messages.push({ role: "tool", tool_call_id: c.id, content: result.detail });
      if (accepted) return { kind: "proposal", proposal: accepted };
    }
  }
  return { kind: "failed", reason: `No proposal that fits this app after ${maxSteps} tries.` };
}
