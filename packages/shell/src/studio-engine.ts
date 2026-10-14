// The Studio's model turns, with no screen attached (#261: split out of studio.tsx).
//
// Three things the conversation asks of a model — make an app, change one, repair one — each
// answered as an OUTCOME the conversation can say in a sentence, never as an exception that means
// "something went wrong somewhere". Which model answers is the engine the person chose; every path
// goes through the same contract, so changing engine changes the model and nothing else.

import type { AppShape } from "@potyro/runtime";
import { t } from "@lingui/core/macro";
import type { ConversationEntry, GiveUp, PlatformRequest } from "@potyro/generator/agent";
import { SYSTEM_PROMPT, appLanguage, buildUserMessage, buildRepairInstruction, extractSource, guardedModify, looksLikeApp, questionIn, type Language, type ModifyContext } from "@potyro/generator/backends";
import { backendFor, modifyTurn } from "./model-turn.js";
import { generateViaCli } from "./generate-client.js";
import { modifyLoopRefusal, startModify } from "./start-modify.js";
import { loadTrustedModule } from "./trusted-loader.js";
import type { ModuleSource } from "./package-modules.js";
import { engineLabel, type EngineConfig } from "./engines.js";
import { currentLocale } from "./locale.js";

/** What a turn came to. `summary` is what the conversation says happened. */
export type Outcome =
  /** `platformRequest`: the rest needs something Potyro itself lacks — a request the person may send (#263). */
  | { kind: "source"; source: string; summary: string; notDone?: string[]; platformRequest?: PlatformRequest }
  /** It was rewritten rather than edited, and lost what `loss` names. Never saved without asking. */
  | { kind: "loss"; source: string; summary: string; loss: string }
  | { kind: "question"; text: string }
  /** Not the app's to change — an answer, not a failure. */
  | { kind: "refusal"; text: string }
  /** Nothing could be done: it needs something Potyro itself lacks. The request is in the person's words (#263). */
  | { kind: "platform"; text: string; request: PlatformRequest }
  /** `text` is for the person; `detail`, when there is one, is what a developer needs to see why. */
  | { kind: "failed"; text: string; detail?: string; platformRequest?: PlatformRequest };

/**
 * A change that could not be made, as the person reads it (#266 follow-up).
 *
 * The loop's own reasons — "the model repeated itself (the reply repeats the previous one word for
 * word; 3 candidates failed the check, 0 replies were not a change)" — are a developer's: they went
 * on the card verbatim, to people who never write code. The card now says in plain words what
 * happened and what to try; the loop's words are kept as `detail`, shown folded away under it.
 */
export function notChanged(result: { kind: "failed"; reason: string; cause?: GiveUp } | { kind: "stopped" } | { kind: "error"; error: unknown }): Extract<Outcome, { kind: "failed" }> {
  if (result.kind === "stopped") return { kind: "failed", text: "Stopped. Nothing was changed." };
  if (result.kind === "error") {
    const detail = result.error instanceof Error ? result.error.message : String(result.error);
    return { kind: "failed", text: "I couldn't make this change: something went wrong while working on it. Try again in a moment.", detail };
  }
  const text = {
    candidates: "I couldn't make this change: every version I tried failed the app's own checks. Try asking for a smaller step, or say it another way.",
    repeated: "I couldn't make this change: I kept coming back to the same answer without finding one that works. Try saying it another way, or ask for a smaller step.",
    steps: "I couldn't make this change: I ran out of tries before finding a version that works. Try asking for a smaller step.",
    engine: "I couldn't start on this change: the engine chosen in Engine Settings can't change apps. Choose OpenRouter there, with your own key.",
    // The one-turn guard (`guardedModify`): what came back could not be applied to the app.
    none: "I couldn't make this change: what came back wasn't a change I could apply to the app. Try saying it another way.",
  }[result.cause ?? "none"];
  return { kind: "failed", text, detail: result.reason };
}

/** A request that is not the app's to change — an answer, said as one. */
const notTheApps = (text: string): Extract<Outcome, { kind: "refusal" }> => ({ kind: "refusal", text: `I didn't change the app: this isn't something it can change. ${text}` });

export interface StudioEngine {
  create(brief: string): Promise<Outcome>;
  /**
   * `context`: where the change was aimed — the part of the app the person pointed at (#284).
   * `earlier`: what was said before this request (#279) — the loop's recap and `read_conversation`.
   */
  modify(source: string, before: AppShape, instruction: string, context?: ModifyContext, earlier?: readonly ConversationEntry[]): Promise<Outcome>;
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
export async function shapeOrEmpty(src: string, modules?: ModuleSource): Promise<AppShape> {
  try {
    const app = await loadTrustedModule(src, modules);
    return { pages: app.pages, entities: app.entities };
  } catch {
    return { pages: [], entities: {} };
  }
}

/**
 * `modules`: the libraries and own modules of the app being changed (#266, #258), when it has any.
 * `language`: the person's (#301) — the model replies in it and writes a new app's words in it; a
 * change keeps the app's own language for its words. Read once, when the engine is made.
 */
export function studioEngine(
  engine: EngineConfig,
  progress: (text: string | null) => void,
  modules?: ModuleSource,
  language: Language = currentLocale(),
): StudioEngine {
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
  const attempt = async (source: string, instruction: string, ctx?: ModifyContext): Promise<string> => {
    const reply = await modifyTurn({
      engine,
      source,
      instruction,
      ctx: { ...ctx, ...languageOf(source) },
      onProgress: (text, secs) => {
        if (secs === undefined) progress(text);
        else if (isCli) progress(`Changing it via ${label}… ${secs}s`);
      },
    });
    const question = askedIn(reply);
    if (question) throw new Asked(question);
    return reply;
  };

  /** Which language to answer in, and which the app's words are in (read off the source until #302 declares it). */
  const languageOf = (source: string): ModifyContext => ({ language: { person: language, app: appLanguage(source) } });

  const describeNotDone = (applied: string, notDone: readonly string[] | undefined): string =>
    notDone?.length ? `${applied} Not done yet: ${notDone.join("; ")}` : applied;

  const create = async (brief: string): Promise<Outcome> => {
    try {
      const reply = await ticking("Making it", async () => {
        if (isCli) {
          // `system` travels separately so the dev endpoint passes it as the system prompt, replacing
          // Claude Code's own — the same setup the eval harness measures.
          return extractSource(
            await generateViaCli({ system: SYSTEM_PROMPT, prompt: buildUserMessage({ id: "studio", description: brief, language }), onProgress: (secs) => progress(`Making it via ${label}… ${secs}s`) }),
          );
        }
        return (await backendFor(engine, progress)).generate({ id: "studio", description: brief, language });
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

  const modify = async (source: string, before: AppShape, instruction: string, context?: ModifyContext, earlier?: readonly ConversationEntry[]): Promise<Outcome> => {
    try {
      // A chat engine drives the modify LOOP (#131): the model looks declarations up and checks a
      // candidate before sending it, and every candidate must compile, validate and keep the app's
      // shape. Other engines keep the one-turn guard.
      if (!modifyLoopRefusal(engine)) {
        const result = await startModify({
          modules,
          source,
          instruction,
          context,
          before,
          engine,
          language,
          ...(earlier?.length ? { conversation: earlier } : {}),
          onStep: (step) => {
            if (step.kind === "thinking") progress(`Thinking via ${label}…`);
            else if (step.kind === "tool") progress(`${step.name}: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
            else if (step.kind === "candidate") progress(step.passed ? "A change passed the check." : `A change was turned back: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
            else progress(`Asked to try again: ${step.detail.split("\n")[0]!.slice(0, 80)}`);
          },
        });
        if (result.kind === "diagnosis") return notTheApps(result.text);
        if (result.kind === "question") return { kind: "question", text: result.text };
        if (result.kind === "platform") {
          return { kind: "platform", text: t`I didn't change the app: what you asked for needs something Potyro can't do yet.`, request: result.request };
        }
        if (result.kind === "failed") return { ...notChanged(result), ...(result.platformRequest ? { platformRequest: result.platformRequest } : {}) };
        if (result.kind === "stopped") return notChanged(result);
        const applied = result.via === "edits" ? `Applied ${plural(result.applied, "edit")}.` : "The model sent the whole file back instead of edits.";
        return {
          kind: "source",
          source: result.source,
          summary: describeNotDone(applied, result.notDone),
          notDone: result.notDone,
          ...(result.platformRequest ? { platformRequest: result.platformRequest } : {}),
        };
      }
      const result = await ticking("Changing it", () =>
        guardedModify({
          attempt: (instr) => attempt(source, instr, context),
          shapeOf: async (src) => {
            const app = await loadTrustedModule(src, modules);
            return { pages: app.pages, entities: app.entities };
          },
          before,
          instruction,
          source,
        }),
      );
      // An answer, not a failure: red reads as "retry me", which is how the same wrong edit gets
      // asked for five times.
      if (result.kind === "diagnosis") return notTheApps(result.text);
      if (result.kind === "failed") return notChanged(result);
      const applied =
        result.via === "edits" ? `Applied ${plural(result.applied, "edit")}.` : "The model sent the whole file back instead of edits. Check that nothing else changed.";
      const summary = describeNotDone(applied, result.notDone);
      if (result.loss !== null) return { kind: "loss", source: result.source, summary, loss: result.loss };
      return { kind: "source", source: result.source, summary, notDone: result.notDone };
    } catch (e) {
      if (e instanceof Asked) return { kind: "question", text: e.question };
      return notChanged({ kind: "error", error: e });
    }
  };

  const repair = (source: string, issues: string[]): Promise<{ source: string; summary: string; loss: string | null }> =>
    ticking("Fixing it", async () => {
      const result = await guardedModify({
        attempt: (instr) => attempt(source, instr),
        shapeOf: (src) => shapeOrEmpty(src, modules),
        before: await shapeOrEmpty(source, modules),
        instruction: buildRepairInstruction(issues),
        source,
      });
      if (result.kind === "diagnosis") throw new Error(`the repair was declined: ${result.text}`);
      if (result.kind === "failed") throw new Error(`the repair could not be applied: ${result.reason}`);
      return { source: result.source, summary: `Repaired with ${result.via === "edits" ? plural(result.applied, "edit") : "the whole file"}.`, loss: result.loss };
    });

  return { create, modify, repair };
}
