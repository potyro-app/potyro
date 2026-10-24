// The Studio's model turns, with no screen attached (#261: split out of studio.tsx).
//
// Three things the conversation asks of a model — make an app, change one, repair one — each
// answered as an OUTCOME the conversation can say in a sentence, never as an exception that means
// "something went wrong somewhere". Which model answers is the engine the person chose; every path
// goes through the same contract, so changing engine changes the model and nothing else.

import { joinForModel, unpackCandidate, unpackOrThrow } from "./joined-app.js";
import { plural, t } from "@lingui/core/macro";
import type { AppShape } from "@potyro/runtime";
import { fmt } from "@potyro/i18n";
import type { ConversationEntry, GiveUp, PlatformRequest } from "@potyro/generator/agent";
import { SYSTEM_PROMPT, appLanguage, buildUserMessage, buildRepairInstruction, extractSource, guardedModify, looksLikeApp, questionIn, type Language, type ModifyContext } from "@potyro/generator/backends";
import { backendFor, modifyTurn } from "./model-turn.js";
import { generateViaCli } from "./generate-client.js";
import { modifyLoopRefusal, startModify } from "./start-modify.js";
import { createLoopRefusal, startCreate } from "./start-create.js";
import { loadTrustedModule } from "./trusted-loader.js";
import type { ModuleSource } from "./package-modules.js";
import { engineLabel, type EngineConfig } from "./engines.js";
import { currentLocale } from "./locale.js";

/** What a turn came to. `summary` is what the conversation says happened. */
export type Outcome =
  /** `platformRequest`: the rest needs something Potyro itself lacks — a request the person may send (#263). */
  /** `modules`: the app's own modules, every one, when the change edited any of them (#448). */
  | { kind: "source"; source: string; summary: string; notDone?: string[]; platformRequest?: PlatformRequest; modules?: Record<string, string> }
  /** It was rewritten rather than edited, and lost what `loss` names. Never saved without asking. */
  | { kind: "loss"; source: string; summary: string; loss: string; modules?: Record<string, string> }
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
  if (result.kind === "stopped") return { kind: "failed", text: t`Stopped. Nothing was changed.` };
  if (result.kind === "error") {
    const detail = result.error instanceof Error ? result.error.message : String(result.error);
    return { kind: "failed", text: t`I couldn't make this change: something went wrong while working on it. Try again in a moment.`, detail };
  }
  const cause = result.cause ?? "none";
  const text =
    cause === "candidates"
      ? t`I couldn't make this change: every version I tried failed the app's own checks. Try asking for a smaller step, or say it another way.`
      : cause === "repeated"
        ? t`I couldn't make this change: I kept coming back to the same answer without finding one that works. Try saying it another way, or ask for a smaller step.`
        : cause === "steps"
          ? t`I couldn't make this change: I ran out of tries before finding a version that works. Try asking for a smaller step.`
          : cause === "engine"
            ? t`I couldn't start on this change: the engine chosen in Engine Settings can't change apps. Choose OpenRouter there, with your own key.`
            : // The one-turn guard (`guardedModify`): what came back could not be applied to the app.
              t`I couldn't make this change: what came back wasn't a change I could apply to the app. Try saying it another way.`;
  return { kind: "failed", text, detail: result.reason };
}

/**
 * A new app that could not be made, as the person reads it (#262 phase 3) — `notChanged`'s words for
 * a create. The loop's own reason stays as `detail`, folded away under the card.
 */
export function notMade(result: { kind: "failed"; reason: string; cause: GiveUp } | { kind: "stopped" }): Extract<Outcome, { kind: "failed" }> {
  if (result.kind === "stopped") return { kind: "failed", text: t`Stopped. Nothing was changed.` };
  const text =
    result.cause === "candidates"
      ? t`I couldn't make this app: every version I tried failed the app's own checks. Try describing a smaller app, or say it another way.`
      : result.cause === "repeated"
        ? t`I couldn't make this app: I kept coming back to the same answer without finding one that works. Try saying it another way.`
        : result.cause === "engine"
          ? notChanged(result).text
          : t`I couldn't make this app: I ran out of tries before finding a version that works. Try describing a smaller app.`;
  return { kind: "failed", text, detail: result.reason };
}

/** A request that is not the app's to change — an answer, said as one. */
const notTheApps = (text: string): Extract<Outcome, { kind: "refusal" }> => ({ kind: "refusal", text: t`I didn't change the app: this isn't something it can change. ${text}` });

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

/** What a turn that changed the app says it did. */
const appliedEdits = (n: number): string => plural(n, { one: "Applied # edit.", other: "Applied # edits." });

/** Seconds on the heartbeat, in the person's language ("12s"). */
const seconds = (n: number): string => fmt.number(n, { style: "unit", unit: "second", unitDisplay: "narrow" });

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
  const ticking = async <T,>(line: (elapsed: string) => string, work: () => Promise<T>): Promise<T> => {
    if (isCli) return work();
    const started = Date.now();
    progress(line(seconds(0)));
    const timer = setInterval(() => progress(line(seconds(Math.round((Date.now() - started) / 1000)))), 1000);
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
        else if (isCli) {
          const elapsed = seconds(secs);
          progress(t`Changing it via ${label} · ${elapsed}`);
        }
      },
    });
    const question = askedIn(reply);
    if (question) throw new Asked(question);
    return reply;
  };

  /** Which language to answer in, and which the app's words are in (read off the source until #302 declares it). */
  const languageOf = (source: string): ModifyContext => ({ language: { person: language, app: appLanguage(source) } });

  // Said to the person only: nothing parses this line (the model's own `Not done:` is read from its reply).
  const describeNotDone = (applied: string, notDone: readonly string[] | undefined): string => {
    if (!notDone?.length) return applied;
    const parts = notDone.join("; ");
    return t`${applied} Not done yet: ${parts}`;
  };

  const create = async (brief: string): Promise<Outcome> => {
    // A chat engine drives the create LOOP (#262 phase 3): the corpus in the first message, tools,
    // and every candidate checked and run — up to two independent first drafts, the better kept.
    // Other engines keep the one call below.
    if (!createLoopRefusal(engine)) {
      try {
        // A first draft is one long call that says nothing until it is done, so the heartbeat runs
        // while the model writes; what the loop does in between (a tool, a check) is said instead.
        let doing: ((elapsed: string) => string) | null = null;
        const result = await ticking(
          (elapsed) => doing?.(elapsed) ?? t`Making it via ${label} · ${elapsed}`,
          () =>
            startCreate({
              brief,
              engine,
              language,
              onStep: (step) => {
                if (step.kind === "thinking") {
                  doing = null;
                  return;
                }
                // The tool's own name and arguments are code, not words: they stay as the loop wrote them.
                const first = step.detail.split("\n")[0]!.slice(0, 80);
                const line = step.kind === "tool" ? `${step.name}: ${first}` : step.kind === "candidate" && step.passed ? t`Checking it` : t`Asked to try again: ${first}`;
                doing = () => line;
                progress(line);
              },
            }),
        );
        if (result.kind === "question") return { kind: "question", text: result.text };
        if (result.kind === "platform") {
          return { kind: "platform", text: t`I didn't make the app: what you asked for needs something Potyro can't do yet.`, request: result.request };
        }
        if (result.kind === "failed") return { ...notMade(result), ...(result.platformRequest ? { platformRequest: result.platformRequest } : {}) };
        if (result.kind === "stopped") return notMade(result);
        return { kind: "source", source: result.source, summary: "", ...(result.platformRequest ? { platformRequest: result.platformRequest } : {}) };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return { kind: "failed", text: t`Could not make it: ${reason}` };
      }
    }
    try {
      const reply = await ticking((elapsed) => t`Making it via ${label} · ${elapsed}`, async () => {
        if (isCli) {
          // `system` travels separately so the dev endpoint passes it as the system prompt, replacing
          // Claude Code's own — the same setup the eval harness measures.
          return extractSource(
            await generateViaCli({ system: SYSTEM_PROMPT, prompt: buildUserMessage({ id: "studio", description: brief, language }), onProgress: (secs) => {
                const elapsed = seconds(secs);
                progress(t`Making it via ${label} · ${elapsed}`);
              },
            }),
          );
        }
        return (await backendFor(engine, progress)).generate({ id: "studio", description: brief, language });
      });
      const question = questionIn(reply);
      if (question) return { kind: "question", text: question };
      // A reply that is not an app says so here; passed to the bundler, prose reads as a syntax
      // error in the middle of an English sentence.
      if (!looksLikeApp(reply)) return { kind: "failed", text: t`The model answered with an explanation instead of an app. Try again, or say it another way.` };
      return { kind: "source", source: reply, summary: "" };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return { kind: "failed", text: t`Could not make it: ${reason}` };
    }
  };

  const modify = async (source: string, before: AppShape, instruction: string, context?: ModifyContext, earlier?: readonly ConversationEntry[]): Promise<Outcome> => {
    try {
      // An app with modules of its own is shown as its files, one text (#448); what comes back is split
      // into them again. Lines pointed at are counted in the entry, one line below its marker there.
      const joined = await joinForModel(source, modules);
      const shown = joined?.text ?? source;
      const aimed = joined && context?.pointedAt?.lines ? { ...context, pointedAt: { ...context.pointedAt, lines: [context.pointedAt.lines[0] + 1, context.pointedAt.lines[1] + 1] as const } } : context;
      /** What came back, as the entry and the modules it changed; a broken text is a failure to say. */
      const files = async (text: string): Promise<{ source: string; modules?: Record<string, string> } | Outcome> => {
        const u = await unpackCandidate(text, joined, modules);
        if (!u.ok) return notChanged({ kind: "error", error: new Error(u.problem) });
        return { source: u.source, ...(u.changed ? { modules: u.changed } : {}) };
      };
      // A chat engine drives the modify LOOP (#131): the model looks declarations up and checks a
      // candidate before sending it, and every candidate must compile, validate and keep the app's
      // shape. Other engines keep the one-turn guard.
      if (!modifyLoopRefusal(engine)) {
        const result = await startModify({
          modules,
          joined,
          source: shown,
          instruction,
          context: aimed,
          before,
          engine,
          language,
          ...(earlier?.length ? { conversation: earlier } : {}),
          onStep: (step) => {
            if (step.kind === "thinking") return progress(t`Thinking via ${label}`);
            // The tool's own name and arguments are code, not words: they stay as the loop wrote them.
            const first = step.detail.split("\n")[0]!.slice(0, 80);
            if (step.kind === "tool") progress(`${step.name}: ${first}`);
            else if (step.kind === "candidate") progress(step.passed ? t`A change passed the check.` : t`A change was turned back: ${first}`);
            else progress(t`Asked to try again: ${first}`);
          },
        });
        if (result.kind === "diagnosis") return notTheApps(result.text);
        if (result.kind === "question") return { kind: "question", text: result.text };
        if (result.kind === "platform") {
          return { kind: "platform", text: t`I didn't change the app: what you asked for needs something Potyro can't do yet.`, request: result.request };
        }
        if (result.kind === "failed") return { ...notChanged(result), ...(result.platformRequest ? { platformRequest: result.platformRequest } : {}) };
        if (result.kind === "stopped") return notChanged(result);
        const applied = result.via === "edits" ? appliedEdits(result.applied) : t`The model sent the whole file back instead of edits.`;
        const got = await files(result.source);
        if ("kind" in got) return got;
        return {
          kind: "source",
          ...got,
          summary: describeNotDone(applied, result.notDone),
          notDone: result.notDone,
          ...(result.platformRequest ? { platformRequest: result.platformRequest } : {}),
        };
      }
      const result = await ticking((elapsed) => t`Changing it via ${label} · ${elapsed}`, () =>
        guardedModify({
          attempt: (instr) => attempt(shown, instr, aimed),
          shapeOf: async (text) => {
            const u = await unpackOrThrow(text, joined, modules);
            const app = await loadTrustedModule(u.source, u.modules);
            return { pages: app.pages, entities: app.entities };
          },
          before,
          instruction,
          source: shown,
        }),
      );
      // An answer, not a failure: red reads as "retry me", which is how the same wrong edit gets
      // asked for five times.
      if (result.kind === "diagnosis") return notTheApps(result.text);
      if (result.kind === "failed") return notChanged(result);
      const applied =
        result.via === "edits" ? appliedEdits(result.applied) : t`The model sent the whole file back instead of edits. Check that nothing else changed.`;
      const summary = describeNotDone(applied, result.notDone);
      const got = await files(result.source);
      if ("kind" in got) return got;
      if (result.loss !== null) return { kind: "loss", ...got, summary, loss: result.loss };
      return { kind: "source", ...got, summary, notDone: result.notDone };
    } catch (e) {
      if (e instanceof Asked) return { kind: "question", text: e.question };
      return notChanged({ kind: "error", error: e });
    }
  };

  const repair = (source: string, issues: string[]): Promise<{ source: string; summary: string; loss: string | null }> =>
    ticking((elapsed) => t`Fixing it via ${label} · ${elapsed}`, async () => {
      const result = await guardedModify({
        attempt: (instr) => attempt(source, instr),
        shapeOf: (src) => shapeOrEmpty(src, modules),
        before: await shapeOrEmpty(source, modules),
        instruction: buildRepairInstruction(issues),
        source,
      });
      // These reach the conversation after "Could not fix it:".
      if (result.kind === "diagnosis") {
        const why = result.text;
        throw new Error(t`the repair was declined: ${why}`);
      }
      if (result.kind === "failed") {
        const why = result.reason;
        throw new Error(t`the repair could not be applied: ${why}`);
      }
      const summary =
        result.via === "edits" ? plural(result.applied, { one: "Repaired with # edit.", other: "Repaired with # edits." }) : t`Repaired with the whole file.`;
      return { source: result.source, summary, loss: result.loss };
    });

  return { create, modify, repair };
}
