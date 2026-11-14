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
// Budget: only an action that asked for a structured answer on its first run gets more runs, and
// only the passes whose answer would differ. A page's own buttons are not part of the smoke run, so
// each is tried once here; one that never asks the AI is left unjudged, as it was before.

import { actionInfo, plainWords, type AppDefinition, type Id } from "potyro";
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

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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

type Outcome = { kind: "ok" } | { kind: "threw"; cause: string } | { kind: "stuck" };

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
      timer = setTimeout(() => resolve({ kind: "stuck" }), Math.max(0, Math.min(actionMs, left)));
    });
    const done = call().then(
      (): Outcome => ({ kind: "ok" }),
      (e): Outcome => ({ kind: "threw", cause: message(e) }),
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
        cause = message(e);
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
            errors.push(`${name} does not finish ${when(pass, given)}: it was still running after ${Math.round(Math.min(actionMs, left) / 100) / 10}s`);
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

      if (!read) return { errors, note: null };
      const what = `the AI was a stand-in — ${read} action${read === 1 ? "" : "s"} read an answer from it`;
      const more = again ? `${what}, and ran again with everything optional missing and with text in no list (${again} more run${again === 1 ? "" : "s"})` : what;
      return { errors, note: gaveUp ? `${more}; not every answer was tried: time ran out` : more };
    },
  };
}
