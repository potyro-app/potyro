// What the modify eval measures about the LOOP, beyond whether the change landed (#277, docs/19 F9).
//
// A rate is read with its denominator: 48/51 is 94%, and the 95% interval around it is 84–98%, so a
// change of one or two cases is noise. Every headline rate is printed with its Wilson interval.
// And a give-up is not one number: the loop gives up because the model repeated itself, because
// every candidate failed the check, or because the steps ran out — three different problems with
// three different fixes, so they are counted apart. Calls, tokens and cost per case say what a
// change costs, and on which candidate the result passed says whether late candidates earn their
// keep (F2's question).
//
// Node-free and model-free, so the parts are tested with scripted engines (test/loop-eval.test.ts)
// and the runner (scripts/run-modify-edits-eval.ts) only wires them.

import type { ChatEngine, ChatRequest, ChatResponse } from "./chat-backend.js";
import type { GiveUp, ModifyLoopOutcome } from "./agent/modify-loop.js";
import type { LoopStep } from "./agent/loop.js";

/** The Wilson score interval for k successes out of n, at 95% by default. Null when n is 0. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** "48/51 (94%, 95% CI 84–98%)": the count, the rate and how far it can be trusted, together. */
export function rate(k: number, n: number): string {
  const w = wilson(k, n);
  if (!w) return `${k}/${n} (—)`;
  const pc = (x: number) => Math.round(x * 100);
  return `${k}/${n} (${pc(k / n)}%, 95% CI ${pc(w.lo)}–${pc(w.hi)}%)`;
}

/** What the model calls of one case cost, as the provider reported it. */
export interface Meter {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** US dollars. */
  cost: number;
  /** Calls whose response carried no cost: the total is then a floor, and the report says so. */
  unpriced: number;
}

export const newMeter = (): Meter => ({ calls: 0, promptTokens: 0, completionTokens: 0, cost: 0, unpriced: 0 });

/** The engine, counting every call into `meter`; `onReply` sees each reply that is prose, not a tool call. */
export function meteredEngine(engine: ChatEngine, meter: Meter, onReply?: (text: string) => void): ChatEngine {
  return {
    chat: {
      completions: {
        create: async (req: ChatRequest): Promise<ChatResponse> => {
          const res = await engine.chat.completions.create(req);
          meter.calls += 1;
          meter.promptTokens += res.usage?.promptTokens ?? 0;
          meter.completionTokens += res.usage?.completionTokens ?? 0;
          if (typeof res.usage?.cost === "number") meter.cost += res.usage.cost;
          else meter.unpriced += 1;
          const m = res.choices[0]?.message;
          if (m && !m.tool_calls?.length) onReply?.(m.content);
          return res;
        },
      },
    },
  };
}

/**
 * A gate that wrongly refuses every candidate, the way #276's did: the app's check threw for a
 * reason outside the change (a library that needs a full web page), so even the right change could
 * never pass. The case it is used on measures what the loop does at a dead end it did not cause —
 * repeat, ask, or say so — not whether the change lands.
 */
export function refusingCheck(check: (source: string) => Promise<string[]>, error: string): (source: string) => Promise<string[]> {
  return async (source) => {
    await check(source);
    throw new Error(error);
  };
}

/** Read from the loop's steps: how many candidates, on which one it passed, how many repeats. */
export interface StepTrace {
  candidates: number;
  /** The candidate number the result passed on; null when nothing passed. */
  passedOn: number | null;
  repeats: number;
  /** Fresh chains started after two candidates were turned back (#278). */
  restarts?: number;
  /** Calls to `read_conversation`: older requests the model chose to read (#279). */
  conversationReads?: number;
}

export function stepTracer(): { onStep: (s: LoopStep) => void; read: () => StepTrace } {
  const t: StepTrace = { candidates: 0, passedOn: null, repeats: 0, restarts: 0, conversationReads: 0 };
  return {
    onStep: (s) => {
      if (s.kind === "candidate") {
        if (typeof s.n === "number") t.candidates = Math.max(t.candidates, s.n);
        if (s.passed) t.passedOn = s.n ?? t.candidates;
      }
      if (s.kind === "unusable" && s.repeat) t.repeats += 1;
      if (s.kind === "unusable" && s.restart) t.restarts = (t.restarts ?? 0) + 1;
      if (s.kind === "tool" && s.name === "read_conversation") t.conversationReads = (t.conversationReads ?? 0) + 1;
    },
    read: () => ({ ...t }),
  };
}

/** One case, as the loop ended it. */
export interface LoopRecord extends StepTrace {
  ended: ModifyLoopOutcome["kind"];
  cause: GiveUp | null;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  /** Calls that carried no cost. */
  unpriced?: number;
}

export interface LoopSummary {
  cases: number;
  gaveUp: Record<GiveUp, number>;
  asked: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  /** Calls that carried no cost: `cost` is then a floor. */
  unpriced: number;
  costPerCase: number;
  tokensPerCase: number;
  repeatsSeen: number;
  restarts: number;
  /** Calls to `read_conversation` in all, and the cases that made at least one (#279). */
  conversationReads: number;
  readTheConversation: number;
  /** Results that passed, by the candidate they passed on. */
  passedOn: { "1": number; "2": number; "3": number; "4+": number };
}

export function summarizeLoop(records: readonly LoopRecord[]): LoopSummary {
  const gaveUp: Record<GiveUp, number> = { repeated: 0, candidates: 0, steps: 0, engine: 0 };
  const passedOn = { "1": 0, "2": 0, "3": 0, "4+": 0 };
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let cost = 0;
  let repeatsSeen = 0;
  let asked = 0;
  let unpriced = 0;
  let restarts = 0;
  let conversationReads = 0;
  let readTheConversation = 0;
  for (const r of records) {
    conversationReads += r.conversationReads ?? 0;
    if (r.conversationReads) readTheConversation += 1;
    if (r.ended === "failed" && r.cause) gaveUp[r.cause] += 1;
    if (r.ended === "question") asked += 1;
    calls += r.calls;
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    cost += r.cost;
    unpriced += r.unpriced ?? 0;
    repeatsSeen += r.repeats;
    restarts += r.restarts ?? 0;
    if (r.passedOn !== null) passedOn[r.passedOn >= 4 ? "4+" : (String(r.passedOn) as "1" | "2" | "3")] += 1;
  }
  const n = records.length;
  return {
    cases: n,
    gaveUp,
    asked,
    calls,
    promptTokens,
    completionTokens,
    cost,
    unpriced,
    costPerCase: n ? cost / n : 0,
    tokensPerCase: n ? (promptTokens + completionTokens) / n : 0,
    repeatsSeen,
    restarts,
    conversationReads,
    readTheConversation,
    passedOn,
  };
}

/**
 * Engines with no model behind them, so the loop's half of the harness is proven without a key:
 *
 * `scripted-loop`: one `lookup`, then an edit every corpus app can take (a comment above
 * `defineApp`), sent again unchanged if refused. Every ordinary case must come back valid on its
 * first candidate (landed false: the edit is not the change), and a case behind a refusing gate
 * must give up with cause `repeated`.
 *
 * `scripted-loop-tools`: a different `lookup` on every call, never a change. Every case must give
 * up with cause `steps`.
 *
 * Usage is reported from the text's length (4 characters a token) at DeepSeek V4 Flash's list price,
 * so the token and cost columns have something to add up; they are not a model's numbers.
 */
export type ScriptedLoopKind = "scripted-loop" | "scripted-loop-tools" | "scripted-loop-language" | "scripted-loop-conversation";

/**
 * `scripted-loop-language` (#301): one `lookup`, then an edit that renames the app, with the new
 * name and the explanation in the languages the FIRST MESSAGE asked for — read from its language
 * line, so a run where the line never reached the model writes English and the language columns say
 * so. With `--language pl` every case must report its new label and its reply in Polish.
 */
/**
 * `scripted-loop-conversation` (#279): `read_conversation` first when the loop offers it (a recap
 * that left requests out), `lookup` otherwise, then the same edit as `scripted-loop`. With
 * `--conversation both` the conversation cases whose history is longer than the recap must report a
 * read; with `--conversation recap` or `none`, none may.
 */
export const SCRIPTED_LOOP_KINDS: readonly ScriptedLoopKind[] = ["scripted-loop", "scripted-loop-tools", "scripted-loop-language", "scripted-loop-conversation"];

const SCRIPTED_EDIT = "Marking the app.\n```ts\n<<<<<<< SEARCH\nexport default defineApp({\n=======\n// edited by the eval\nexport default defineApp({\n>>>>>>> REPLACE\n```\n";

/** What the language engine writes, by the language's English name as the instruction says it. */
const SCRIPTED_WORDS: Readonly<Record<string, { name: string; reply: string }>> = {
  English: { name: "My notes from home", reply: "Renaming the app so that it is my own." },
  Polish: { name: "Moje notatki z domu", reply: "Zmieniam nazwę aplikacji, żeby było widać, że jest moja." },
  "Brazilian Portuguese": { name: "Minhas anotações de casa", reply: "Mudo o nome do app pra mostrar que ele é meu." },
};

/**
 * The rename the language engine sends: against the app's top-level `name:` line, as the first
 * message showed it — a plain name, or a one-line map of them (an example app in six languages, #303).
 */
function scriptedLanguageEdit(first: string): string {
  const person = /reply to the person in ([A-Z][a-z]+(?: [A-Z][a-z]+)?):/.exec(first)?.[1] ?? "English";
  const app = /The app's own words are in ([A-Z][a-z]+(?: [A-Z][a-z]+)?):/.exec(first)?.[1] ?? person;
  const line = /^ {2}name: (?:"[^"\n]*"|\{[^\n]*\}),$/m.exec(first)?.[0];
  if (!line) return SCRIPTED_EDIT;
  const reply = (SCRIPTED_WORDS[person] ?? SCRIPTED_WORDS.English!).reply;
  const name = (SCRIPTED_WORDS[app] ?? SCRIPTED_WORDS.English!).name;
  return `${reply}\n\`\`\`ts\n<<<<<<< SEARCH\n${line}\n=======\n  name: "${name}",\n>>>>>>> REPLACE\n\`\`\`\n`;
}

export function scriptedLoopEngine(kind: ScriptedLoopKind): ChatEngine {
  let n = 0;
  return {
    chat: {
      completions: {
        create: async (req) => {
          n += 1;
          const lookup = kind === "scripted-loop-tools" || n === 1;
          const first = req.messages.find((m) => m.role === "user")?.content ?? "";
          const edit = kind === "scripted-loop-language" ? scriptedLanguageEdit(first) : SCRIPTED_EDIT;
          const reads = kind === "scripted-loop-conversation" && (req.tools ?? []).some((t) => t.function.name === "read_conversation");
          const tool = reads ? { name: "read_conversation", arguments: "{}" } : { name: "lookup", arguments: JSON.stringify({ query: kind === "scripted-loop-tools" ? `step ${n}` : "defineApp" }) };
          const message = lookup ? { content: "", tool_calls: [{ id: `t${n}`, type: "function" as const, function: tool }] } : { content: edit };
          const promptTokens = Math.ceil(req.messages.reduce((k, m) => k + m.content.length, 0) / 4);
          const completionTokens = Math.ceil((message.content.length || 40) / 4);
          return { choices: [{ message }], usage: { promptTokens, completionTokens, cost: (promptTokens * 0.14 + completionTokens * 0.28) / 1e6 } };
        },
      },
    },
  };
}
