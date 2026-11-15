// The candidate run's AI passes (#74): every action that asks `ctx.caps.ai` for a structured answer
// is run again on the answers a real model gives and an app's author does not imagine.
//
// A generated action photographed a wine label, asked `extract` for its grape and country, and wrote
// them into fields with fixed options. It passed every gate — the run had no AI and no camera, so the
// action stopped at its first line — and then failed in the person's hands twice: the label had no
// grape, and the grape it had was not an option. Here the run's AI is a stand-in
// (`StandInAi`, @potyro/capabilities) that answers the schema an action asks for, three ways:
// plausibly (the smoke run's own pass), with everything optional missing, and with every free text a
// string no list holds. What throws, or is refused by the store, comes back naming the action, the
// answer and the cause.
//
// No model is called and nothing leaves the device: the answers are made from the schema alone.
//
// A form's fill buttons (#81) are run here too, each once on a new record's draft and once on a
// sample record's: what one throws, a value it returns that its field refuses, and a key it returns
// that is no field all come back naming the button — and one that reads a structured answer gets the
// same awkward answers an action does. A fill saves nothing, so nothing else would ever run it.
//
// Budget: only an action that asked for a structured answer on its first run gets more runs, and
// only the passes whose answer would differ. A page's own buttons are not part of the smoke run, so
// each is tried once here; one that never asks the AI is left unjudged, as it was before.

import { actionInfo, plainWords, type AppDefinition, type FieldRefusal, type Id, type ValueIssue } from "potyro";
import { actionFailure, type FillOutcome } from "@potyro/host";
import { AI_ANSWER_PASSES, UNLISTED_TEXT, answerSchema, type AiAnswer, type AiAnswerPass, type StandInAi } from "@potyro/capabilities";
import type { PotyroRuntime } from "@potyro/runtime";
import { paramsForPage, seededInput, type SmokeOptions } from "@potyro/generator/backends";

/** The passes after the first, in the order they are tried. */
const EXTRA_PASSES = AI_ANSWER_PASSES.filter((p) => p !== "plausible");
/** One run of one action. Past this it waits on something nobody here answers. */
const ACTION_MS = 3_000;
/** Every extra run together: the passes never take the run's whole budget (RUN_WALL_CLOCK_MS). */
const PASSES_MS = 10_000;
const MAX_KEYS = 4;

export interface AnswerRun {
  /** What failed under an answer, in words for the model. */
  errors: string[];
  /** What was tried, for the run's "ran" line; null when no action asked the AI for anything. */
  note: string | null;
}

export interface AnswerPasses {
  /** For the smoke run: notes which entity actions asked the stand-in for a structured answer. */
  aroundAction: NonNullable<SmokeOptions["aroundAction"]>;
  /** The extra passes, on the records the run seeded. Call after the pages rendered: actions write. */
  run(def: AppDefinition, runtime: PotyroRuntime): Promise<AnswerRun>;
}

const MAX_OPTIONS = 12;

/** What a field takes, from the rule a value broke — in a developer's words: this is read by the model. */
function takes(issue: ValueIssue): string {
  switch (issue.rule) {
    case "options": {
      const shown = issue.options.slice(0, MAX_OPTIONS).map((o) => JSON.stringify(o)).join(", ");
      return `one of ${shown}${issue.options.length > MAX_OPTIONS ? ` (and ${issue.options.length - MAX_OPTIONS} more)` : ""}`;
    }
    case "min":
      return `a number of at least ${issue.bound}`;
    case "max":
      return `a number of at most ${issue.bound}`;
    case "row":
      return `rows whose ${issue.key} is ${takes(issue.issue)}`;
    case "record":
      return issue.many ? "a list of record ids" : "a record id";
    case "person":
    case "member":
      return issue.many ? "a list of people's ids" : "a person's id";
    case "text":
      return "a string";
    case "number":
      return "a finite number";
    case "whole":
      return "a whole number";
    case "amount":
      return "an amount of money";
    case "yesNo":
      return "true or false";
    case "tags":
      return "a list of strings";
    case "date":
      return "a date";
    case "place":
      return "a place: { lat, lng }";
    case "media":
      return "what ctx.media.put returned";
    case "file":
      return "a file of the app's folder";
    case "list":
      return "a list of rows";
  }
}

const refused = (r: FieldRefusal): string => `its write to ${r.entity}.${r.field} is refused — ${r.field} takes ${takes(r.issue)}`;

/**
 * What is wrong with what a form's fill returned (#81), or null: a value its field does not take —
 * the form leaves it out and the person reads why — and a key that is no field, which the form drops.
 */
export function fillProblem(entity: string, outcome: FillOutcome): string | null {
  const said = [
    ...outcome.refused.map((r) => `the value it returns for ${r.entity}.${r.field} is refused — ${r.field} takes ${takes(r.issue)}`),
    ...(outcome.unknown.length
      ? [`it returns ${outcome.unknown.slice(0, MAX_KEYS).map((k) => JSON.stringify(k)).join(", ")}${outcome.unknown.length > MAX_KEYS ? ` and ${outcome.unknown.length - MAX_KEYS} more` : ""}, which ${outcome.unknown.length === 1 ? "is no field" : "are no fields"} of ${entity} — a fill returns values by field key, and the rest is dropped`]
      : []),
  ];
  return said.length ? said.join("; ") : null;
}

/** A new record's form, as a fill finds it: every field empty but for what the form starts with. */
function blankDraft(fields: Record<string, { type?: string; default?: unknown }> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields ?? {})) {
    const d = field.default;
    if (d !== undefined && typeof d !== "function" && d !== "__potyro_fn__") out[key] = d;
    else if (field.type === "list" || field.type === "tags") out[key] = [];
    else if (field.type === "boolean") out[key] = false;
  }
  return out;
}

/** A record as its edit form holds it: its relations as ids. */
function editDraft(fields: Record<string, { type?: string }> | undefined, record: Record<string, unknown>): Record<string, unknown> {
  const id = (v: unknown): unknown => (v && typeof v === "object" ? (v as { id?: unknown }).id : v);
  const out: Record<string, unknown> = { id: record.id };
  for (const [key, field] of Object.entries(fields ?? {})) {
    const v = record[key];
    out[key] = field.type === "relation" ? (Array.isArray(v) ? v.map(id) : id(v)) : v;
  }
  return out;
}

/**
 * Why a run failed, sorted the way the host sorts it (`actionFailure`, #76): a refused write names
 * the field and what it takes, from the refusal's own data; a call the runner cut short is `slow`;
 * anything else is the developer's line — the error's class and message.
 */
function causeOf(e: unknown): { slow: boolean; cause: string } {
  const failure = actionFailure(e);
  if (failure.kind === "refused") return { slow: false, cause: refused(failure.refusal) };
  if (failure.kind === "stopped" && failure.why === "slow") return { slow: true, cause: "it was stopped for running too long" };
  return { slow: false, cause: failure.detail };
}

/** "grape, country" — a few keys by name, the rest counted. */
function keys(paths: readonly string[]): string {
  const names = [...new Set(paths.map((p) => p.replace(/\[\]/g, "")))];
  const shown = names.slice(0, MAX_KEYS).join(", ");
  return names.length > MAX_KEYS ? `${shown} and ${names.length - MAX_KEYS} more` : shown;
}

/** The answer an action was given, as the condition it failed under. */
function when(pass: AiAnswerPass, answers: readonly AiAnswer[]): string {
  if (pass === "missing") return `when the AI finds no ${keys(answers.flatMap((a) => a.missing))} (it answers null, or an empty list)`;
  if (pass === "unlisted") return `when the AI answers ${keys(answers.flatMap((a) => a.unlisted))} with text that is in no list ("${UNLISTED_TEXT}")`;
  return "when the AI answers every key it was asked for";
}

/** Every fixed list of the app, by field key: what a plausible answer for that key is taken from. */
export function listedValues(def: AppDefinition): (key: string) => readonly string[] | undefined {
  const lists = new Map<string, readonly string[]>();
  const note = (fields: Record<string, unknown> | undefined): void => {
    for (const [key, field] of Object.entries(fields ?? {})) {
      const f = field as { type?: string; options?: unknown; of?: Record<string, unknown> };
      if (f.type === "enum" && Array.isArray(f.options) && f.options.length && !lists.has(key.toLowerCase())) lists.set(key.toLowerCase(), f.options.map(String));
      if (f.type === "list") note(f.of);
    }
  };
  for (const entity of Object.values(def.entities ?? {})) note(entity.fields as Record<string, unknown>);
  return (key) => lists.get(key.toLowerCase());
}

type Outcome = { kind: "ok" } | { kind: "threw"; cause: string } | { kind: "stuck"; cause: string };

export function createAnswerPasses(ai: StandInAi, opts: { actionMs?: number } = {}): AnswerPasses {
  const actionMs = opts.actionMs ?? ACTION_MS;
  /** Entity actions that asked for a structured answer in the smoke run, and why each failed, if it did. */
  const asked: Array<{ entity: string; key: string; schemas: Array<Record<string, unknown>>; cause?: string }> = [];

  /** Whether `pass` would answer any of these schemas differently from the plausible pass. */
  const differs = (schemas: ReadonlyArray<Record<string, unknown>>, pass: AiAnswerPass): boolean =>
    schemas.some((s) => {
      const a = answerSchema(s, pass);
      return pass === "missing" ? a.missing.length > 0 : a.unlisted.length > 0;
    });

  const attempt = async (pass: AiAnswerPass, call: () => Promise<void>, left: number): Promise<Outcome> => {
    ai.reset();
    ai.pass = pass;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stuck = new Promise<Outcome>((resolve) => {
      const wait = Math.max(0, Math.min(actionMs, left));
      timer = setTimeout(() => resolve({ kind: "stuck", cause: `it was still running after ${Math.round(wait / 100) / 10}s` }), wait);
    });
    const done = call().then(
      (): Outcome => ({ kind: "ok" }),
      (e): Outcome => {
        const { slow, cause } = causeOf(e);
        return slow ? { kind: "stuck", cause } : { kind: "threw", cause };
      },
    );
    try {
      return await Promise.race([done, stuck]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async aroundAction(action, run) {
      ai.reset();
      ai.pass = "plausible";
      let cause: string | undefined;
      try {
        await run();
      } catch (e) {
        cause = causeOf(e).cause;
        throw e;
      } finally {
        if (ai.schemas.length) asked.push({ entity: action.entity, key: action.key, schemas: [...ai.schemas], ...(cause === undefined ? {} : { cause }) });
      }
    },

    async run(def, runtime) {
      const errors: string[] = [];
      const deadline = Date.now() + PASSES_MS;
      /** Actions that read a structured answer, and the runs they were given beyond their first. */
      let read = 0;
      let again = 0;
      let gaveUp = false;

      const ids: Record<string, Id[]> = {};
      const first: Record<string, Record<string, unknown> | undefined> = {};
      const refresh = async (): Promise<void> => {
        for (const entity of Object.keys(def.entities ?? {})) {
          const rows = await runtime.ctx.query(entity).catch(() => []);
          ids[entity] = rows.map((r) => r.id);
          first[entity] = rows[0] as Record<string, unknown> | undefined;
        }
      };

      /** The extra passes of one action; `plausible` is why its first run failed, when it did. */
      const extra = async (name: string, schemas: ReadonlyArray<Record<string, unknown>>, plausible: string | undefined, call: (n: number) => Promise<void>): Promise<void> => {
        read++;
        for (const [n, pass] of EXTRA_PASSES.entries()) {
          if (gaveUp || !differs(schemas, pass)) continue;
          const left = deadline - Date.now();
          if (left <= 0) {
            gaveUp = true;
            return;
          }
          again++;
          const outcome = await attempt(pass, () => call(n + 1), left);
          if (outcome.kind === "ok") continue;
          // Whatever answered last is what it failed on; an action that stopped before asking is
          // described by the answer it would have been given.
          const given = ai.answers.length ? ai.answers : schemas.map((s) => answerSchema(s, pass));
          if (outcome.kind === "stuck") {
            // The box may still be inside that call: nothing more can be trusted to run in it.
            gaveUp = true;
            errors.push(`${name} does not finish ${when(pass, given)}: ${outcome.cause}`);
            return;
          }
          // The same failure as on a plausible answer is not this answer's doing, and is said already.
          if (outcome.cause === plausible) continue;
          errors.push(`${name} fails ${when(pass, given)}: ${outcome.cause}`);
        }
      };

      // ---- entity actions the smoke run saw asking ----
      for (const a of asked) {
        if (gaveUp) break;
        await refresh();
        const entity = def.entities?.[a.entity];
        const label = actionInfo(entity, a.key)?.label ?? a.key;
        const own = ids[a.entity] ?? [];
        if (!own.length) continue;
        await extra(`the "${label}" action (${a.entity}.${a.key})`, a.schemas, a.cause, (n) =>
          // A record the earlier passes did not write to, while there is one.
          runtime.core.runAction(a.entity, a.key, own[n % own.length]!, seededInput(entity, a.key, ids)),
        );
      }

      // ---- a page's own buttons: not in the smoke run, so each is tried once ----
      for (const page of def.pages ?? []) {
        for (const [index, action] of (page.actions ?? []).entries()) {
          if (gaveUp) break;
          const left = deadline - Date.now();
          if (left <= 0) {
            gaveUp = true;
            break;
          }
          await refresh();
          const call = () => runtime.core.runPageAction(page.id, index, paramsForPage(def, page.id, ids, (e) => first[e]));
          const outcome = await attempt("plausible", call, left);
          const schemas = [...ai.schemas];
          if (outcome.kind === "stuck") {
            gaveUp = true;
            break;
          }
          // It never asked the AI for an answer: not this pass's to judge.
          if (!schemas.length) continue;
          const name = `the "${plainWords(action.label) || `#${index + 1}`}" button of page "${page.id}"`;
          if (outcome.kind === "threw") errors.push(`${name} fails ${when("plausible", ai.answers)}: ${outcome.cause}`);
          await extra(name, schemas, outcome.kind === "threw" ? outcome.cause : undefined, call);
        }
      }

      // ---- a form's fill buttons (#81): nothing else runs them ----
      let fills = 0;
      for (const [entityKey, entity] of Object.entries(def.entities ?? {})) {
        for (const [index, fill] of (entity.fill ?? []).entries()) {
          if (gaveUp) break;
          await refresh();
          const fields = entity.fields as Record<string, { type?: string; default?: unknown }>;
          const name = `the "${plainWords(fill.label) || `#${index + 1}`}" fill button of the ${entityKey} form`;
          const sample = first[entityKey];
          /** One run: on a new record's draft, or (odd `n`, when there is a record) on a sample record's. */
          const call = async (n: number): Promise<void> => {
            const draft = n % 2 === 1 && sample ? editDraft(fields, sample) : blankDraft(fields);
            const problem = fillProblem(entityKey, await runtime.core.runFill(entityKey, index, draft));
            if (problem) throw new Error(problem);
          };
          fills++;
          const schemas: Array<Record<string, unknown>> = [];
          const causes = new Set<string>();
          // Both forms it sits on: adding (every field empty) and editing (a record's values).
          for (const n of sample ? [0, 1] : [0]) {
            const left = deadline - Date.now();
            if (left <= 0) {
              gaveUp = true;
              break;
            }
            const outcome = await attempt("plausible", () => call(n), left);
            if (!schemas.length) schemas.push(...ai.schemas);
            if (outcome.kind === "ok") continue;
            const asked = ai.answers.length ? ` ${when("plausible", ai.answers)}` : "";
            if (outcome.kind === "stuck") {
              gaveUp = true;
              errors.push(`${name} does not finish${asked}: ${outcome.cause}`);
              break;
            }
            if (!causes.has(outcome.cause)) errors.push(`${name} fails${asked}${n === 1 ? " on the edit form" : ""}: ${outcome.cause}`);
            causes.add(outcome.cause);
          }
          if (gaveUp || !schemas.length) continue;
          await extra(name, schemas, [...causes][0], () => call(0));
        }
      }

      if (!read) return { errors, note: fills ? `${fills} form fill button${fills === 1 ? " was" : "s were"} run on a new and a sample record` : null };
      const what = `the AI was a stand-in — ${read} action${read === 1 ? "" : "s"} read an answer from it${fills ? ` (${fills} form fill button${fills === 1 ? "" : "s"} among what ran)` : ""}`;
      const more = again ? `${what}, and ran again with everything optional missing and with text in no list (${again} more run${again === 1 ? "" : "s"})` : what;
      return { errors, note: gaveUp ? `${more}; not every answer was tried: time ran out` : more };
    },
  };
}
