// The Studio's model turns, with no screen attached (#261: split out of studio.tsx).
//
// Three things the conversation asks of a model — make an app, change one, repair one — each
// answered as an OUTCOME the conversation can say in a sentence, never as an exception that means
// "something went wrong somewhere". Which model answers is the engine the person chose; every path
// goes through the same contract, so changing engine changes the model and nothing else.

import type { AppShape } from "@potyro/runtime";
import { SYSTEM_PROMPT, buildUserMessage, buildRepairInstruction, extractSource, guardedModify, looksLikeApp, questionIn } from "@potyro/generator/backends";
import { backendFor, modifyTurn } from "./model-turn.js";
import { generateViaCli } from "./generate-client.js";
import { modifyLoopRefusal, startModify } from "./start-modify.js";
import { loadTrustedModule } from "./trusted-loader.js";
import { engineLabel, type EngineConfig } from "./engines.js";

/** What a turn came to. `summary` is what the conversation says happened. */
export type Outcome =
  | { kind: "source"; source: string; summary: string; notDone?: string[] }
  /** It was rewritten rather than edited, and lost what `loss` names. Never saved without asking. */
  | { kind: "loss"; source: string; summary: string; loss: string }
  | { kind: "question"; text: string }
  /** Not the app's to change — an answer, not a failure. */
  | { kind: "refusal"; text: string }
  | { kind: "failed"; text: string };

export interface StudioEngine {
  create(brief: string): Promise<Outcome>;
  modify(source: string, before: AppShape, instruction: string): Promise<Outcome>;
  /** Repair from the validator's own words, through the same gate as a modify. */
  repair(source: string, issues: string[]): Promise<{ source: string; summary: string; loss: string | null }>;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A turn that came back as a question — thrown past the edit guard, caught as an outcome. */
class Asked extends Error {
  constructor(readonly question: string) {
    super(question);
  }
}

/** The modify loop says `ASK:`, a create says `QUESTION:`; either, at the head of a reply that is not an app. */
function askedIn(reply: string): string | null {
  return questionIn(reply.replace(/^([\s*`_]*)ASK:/, "$1QUESTION:"));
}

/** The shape a repair is judged against. A source that does not load has no shape to lose. */
export async function shapeOrEmpty(src: string): Promise<AppShape> {
  try {
    const app = await loadTrustedModule(src);
    return { pages: app.pages, entities: app.entities };
  } catch {
    return { pages: [], entities: {} };
  }
}

export function studioEngine(engine: EngineConfig, progress: (text: string | null) => void): StudioEngine {
  const label = engineLabel(engine);
  const isCli = engine.engine === "cli";

  /**
   * A cloud generation is one long request that says nothing until it is done. With no visible
   * clock that is indistinguishable from a hang, so in-browser engines get a heartbeat; `claude -p`
   * reports its own seconds.
   */
  const ticking = async <T,>(verb: string, work: () => Promise<T>): Promise<T> => {
    if (isCli) return work();
    const text = `${verb} via ${label}`;
    const started = Date.now();
    progress(`${text}… 0s`);
    const timer = setInterval(() => progress(`${text}… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  };

  /**
   * One raw model turn, for a modify or a repair. Returns the REPLY: `guardedModify` reads it.
   *
   * A reply that is a question is not a change and not a failure: the one-turn guard would call it
   * "an explanation instead of a change", so it is taken out here, before the guard sees it, and
   * comes back to the conversation as the question it is.
   */
  const attempt = async (source: string, instruction: string): Promise<string> => {
    const reply = await modifyTurn({
      engine,
      source,
      instruction,
      onProgress: (text, secs) => {
        if (secs === undefined) progress(text);
        else if (isCli) progress(`Changing it via ${label}… ${secs}s`);
      },
    });
    const question = askedIn(reply);
    if (question) throw new Asked(question);
    return reply;
  };

  const describeNotDone = (applied: string, notDone: readonly string[] | undefined): string =>
    notDone?.length ? `${applied} Not done yet: ${notDone.join("; ")}` : applied;

  const create = async (brief: string): Promise<Outcome> => {
    try {
      const reply = await ticking("Making it", async () => {
        if (isCli) {
          // `system` travels separately so the dev endpoint passes it as the system prompt, replacing
          // Claude Code's own — the same setup the eval harness measures.
          return extractSource(
            await generateViaCli({ system: SYSTEM_PROMPT, prompt: buildUserMessage({ id: "studio", description: brief }), onProgress: (secs) => progress(`Making it via ${label}… ${secs}s`) }),
          );
        }
        return (await backendFor(engine, progress)).generate({ id: "studio", description: brief });
      });
      const question = questionIn(reply);
      if (question) return { kind: "question", text: question };
      // A reply that is not an app says so here; passed to the bundler, prose reads as a syntax
      // error in the middle of an English sentence.
      if (!looksLikeApp(reply)) return { kind: "failed", text: "The model answered with an explanation instead of an app. Try again, or say it another way." };
      return { kind: "source", source: reply, summary: "" };
    } catch (e) {
      return { kind: "failed", text: `Could not make it: ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  const modify = async (source: string, before: AppShape, instruction: string): Promise<Outcome> => {
    try {
      // A chat engine drives the modify LOOP (#131): the model looks declarations up and checks a
      // candidate before sending it, and every candidate must compile, validate and keep the app's
      // shape. Other engines keep the one-turn guard.
      if (!modifyLoopRefusal(engine)) {
        const result = await startModify({
          source,
          instruction,
          before,
          engine,
          onStep: (step) => {
            if (step.kind === "thinking") progress(`Thinking via ${label}…`);
            else if (step.kind === "tool") progress(`${step.name}: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
            else if (step.kind === "candidate") progress(step.passed ? "A change passed the check." : `A change was turned back: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
            else progress(`Asked to try again: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
          },
        });
        if (result.kind === "diagnosis") return { kind: "refusal", text: `Not changed — this is not the app's to change: ${result.text}` };
        if (result.kind === "question") return { kind: "question", text: result.text };
        if (result.kind === "failed") return { kind: "failed", text: `Not changed — ${result.reason}` };
        if (result.kind === "stopped") return { kind: "failed", text: "Not changed — stopped." };
        const applied = result.via === "edits" ? `Applied ${plural(result.applied, "edit")}.` : "The model sent the whole file back instead of edits.";
        return { kind: "source", source: result.source, summary: describeNotDone(applied, result.notDone), notDone: result.notDone };
      }
      const result = await ticking("Changing it", () =>
        guardedModify({
          attempt: (instr) => attempt(source, instr),
          shapeOf: async (src) => {
            const app = await loadTrustedModule(src);
            return { pages: app.pages, entities: app.entities };
          },
          before,
          instruction,
          source,
        }),
      );
      // An answer, not a failure: red reads as "retry me", which is how the same wrong edit gets
      // asked for five times.
      if (result.kind === "diagnosis") return { kind: "refusal", text: `Not changed — this is not the app's to change: ${result.text}` };
      if (result.kind === "failed") return { kind: "failed", text: `Not changed — ${result.reason}` };
      const applied =
        result.via === "edits" ? `Applied ${plural(result.applied, "edit")}.` : "The model sent the whole file back instead of edits. Check that nothing else changed.";
      const summary = describeNotDone(applied, result.notDone);
      if (result.loss !== null) return { kind: "loss", source: result.source, summary, loss: result.loss };
      return { kind: "source", source: result.source, summary, notDone: result.notDone };
    } catch (e) {
      if (e instanceof Asked) return { kind: "question", text: e.question };
      return { kind: "failed", text: `Not changed — ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  const repair = (source: string, issues: string[]): Promise<{ source: string; summary: string; loss: string | null }> =>
    ticking("Fixing it", async () => {
      const result = await guardedModify({
        attempt: (instr) => attempt(source, instr),
        shapeOf: shapeOrEmpty,
        before: await shapeOrEmpty(source),
        instruction: buildRepairInstruction(issues),
        source,
      });
      if (result.kind === "diagnosis") throw new Error(`the repair was declined: ${result.text}`);
      if (result.kind === "failed") throw new Error(`the repair could not be applied: ${result.reason}`);
      return { source: result.source, summary: `Repaired with ${result.via === "edits" ? plural(result.applied, "edit") : "the whole file"}.`, loss: result.loss };
    });

  return { create, modify, repair };
}
