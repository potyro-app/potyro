// The create loop (#262 phase 3): "make me an app" on the same footing as "change this app".
//
// A create used to be one model call with no tools and one repair round after the fact. Here it gets
// what the modify loop has (modify-loop.ts): the passages from the release's corpus that speak to the
// request in the first message, `lookup` / `example` / `search_corpus` / `read`, a `check` that
// validates and runs a whole candidate app, and a gate every candidate must pass — it compiles,
// validates and, when the caller can run it, runs on sample records without throwing. A new app has
// no original to be compared with, so the run is judged on its own: an error blocks, a warning does
// not. On a fresh app a page that shows none of the sample records is usually the sample's fault, not
// the app's, and holding a first app back for it costs a whole call.
//
// The research (docs/19 §4 item 7, F2: Agentless; Olausson et al., "Is self-repair a silver
// bullet?") says that at equal cost several independent first attempts, filtered by the gate, beat
// one attempt repaired step by step. So a create makes up to `drafts` (default 2) INDEPENDENT first
// drafts — each its own conversation, the later one not seeing the earlier — and keeps the better by
// the gate. The second draft is made only when the first did not pass: the gate cannot rank two apps
// that both pass, so a second passing draft would be paid for and thrown away.
//
// A first draft is ONE call with the tools off — the single-shot create plus the corpus passages. The
// first paid run gave every draft the tools, and the model spent them looking things up before it
// had written anything: two to ten calls a case, 3–5× the cost of one call, and three apps lost to
// the step budget — one of them after its own `check` had passed. So the tools come on only for the
// repair, where there is a problem to look into; an app the model's `check` passed is kept even if
// the calls run out before it is sent; and the loop never gives up while it holds an app that
// validates (one whose run threw is kept, with what the run found said beside it). When no draft passes,
// the one with the fewest problems is repaired in its own conversation; a chain with two candidates
// turned back starts again from the request with a note of what was turned back (F2), and a model
// that repeats itself has the repeat taken out (F1) — then, the second time, that chain is over.
//
// The rest is the modify loop's vocabulary: QUESTION: (or ASK:) before building keeps the question
// flow of #261 — the first draft that asks ends the loop with the question, the Studio shows it, and
// the answer comes back in the next request; NEEDS-PLATFORM: when the request needs something Potyro
// lacks (#263), offered where the loop has evidence; the person's language (#301) in the opening
// message; thinking hard for the one turn after the loop got stuck (#280); a step budget for the whole
// loop, and a candidate budget of its own.

import type { ChatEngine, ChatMessage, ToolCallOnMessage } from "../chat-backend.js";
import { readEditsOrFile } from "../guarded-modify.js";
import { describeEditFailures } from "../edits.js";
import { buildUserMessage, extractSource, looksLikeApp, questionIn } from "../prompt.js";
import { primeCorpus, type Corpus } from "../corpus.js";
import type { Language } from "../language.js";
import { describeRun, runSafely, type RunReport } from "../run-report.js";
import { runTool, toolSpecs, type AgentTool } from "./tools.js";
import type { LoopStep } from "./loop.js";
import { describeToolTurn, freshStartNote, oneLine, toolTurnSignature, type TurnedBack } from "./loop-recovery.js";
import { repeatsItself, type GiveUp } from "./modify-loop.js";
import { NEEDS_PLATFORM, askAfterGiveUp, platformLineIn, platformOffer, platformSignal, writePlatformRequest, type PlatformRequest } from "./platform-request.js";

export type CreateLoopOutcome =
  | {
      kind: "source";
      source: string;
      /** What the model said beside the app, if anything. */
      rationale?: string;
      /** What the run found that looks wrong but did not hold the app back (a page that showed nothing). */
      warnings: string[];
      /** What Potyro itself would need for the rest, written for the Potyro team (#263). */
      platformRequest?: PlatformRequest;
      /** Which independent first draft's conversation it came from, and which candidate it was — counted from 1. */
      draft: number;
      candidate: number;
    }
  /** It asked before building (#261): show the question; the answer comes back with the next request. */
  | { kind: "question"; text: string }
  /** Nothing could be built: it needs something Potyro itself lacks (#263). `said` is the model's marker line. */
  | { kind: "platform"; request: PlatformRequest; said: string }
  /**
   * It gave up. `best` is the candidate with the fewest problems, if there was one — it FAILED the
   * gate: the eval scores it, the Studio does not keep it.
   */
  | { kind: "failed"; reason: string; cause: GiveUp; best?: string; platformRequest?: PlatformRequest }
  | { kind: "stopped" };

export interface CreateLoopDeps {
  engine: ChatEngine;
  model?: string;
  tools: AgentTool[];
  system: string;
  /** What the person asked for — everything said since the app last changed, questions and answers included. */
  brief: string;
  /** The person's language (#301): the app's words and any question are written in it. English when absent. */
  language?: Language;
  /** Bundle + validate a candidate: the validator's issues, or [] when well-formed. Throws when it does not compile. */
  check: (source: string) => Promise<string[]>;
  /** Run a candidate that passed the check on sample records. Without it the gate stops at compile + validate. */
  run?: (source: string) => Promise<RunReport>;
  /** The release's corpus: the passages that speak to the request go into the first message. */
  corpus?: () => Promise<Corpus>;
  /** Independent first drafts, at most (default 2). 1 is one draft, repaired. */
  drafts?: number;
  /** Model calls in all, across every draft. */
  maxSteps?: number;
  /** Candidates that may fail the gate before the loop gives up. Tool reads do not count. */
  maxCandidates?: number;
  /** Model calls one first draft may spend before it has to send an app (one more than the draft, for a reply that was not one). */
  draftSteps?: number;
  /** Think hard for the one turn after the loop got stuck (#280). */
  escalate?: boolean;
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
}

export const DEFAULT_DRAFTS = 2;
const DEFAULT_MAX_STEPS = 10;
const DEFAULT_MAX_CANDIDATES = 4;
const DEFAULT_DRAFT_STEPS = 2;
/** Calls a draft that was sent to the tools (an unlooked NEEDS-PLATFORM) gets to look with. */
const LOOK_STEPS = 3;
/** The first draft is written as the single-shot create was (chat-backend's GENERATE_TEMPERATURE). */
const FIRST_TEMPERATURE = 0.2;
/** A later draft is sampled wider, so it is a different attempt and not the same one again. */
const LATER_TEMPERATURE = 0.7;
/** A repair keeps the shape it has, as every edit turn does. */
const REPAIR_TEMPERATURE = 0.1;
/** Candidates turned back in one chain before it is started again from the request. */
const RESTART_AFTER = 2;
/** The same tool call with the same arguments this many times in a row is the model going round. */
const TOOL_REPEAT = 3;
/** The tools whose use makes a NEEDS-PLATFORM informed. */
const DISCOVERY = new Set(["lookup", "check", "example", "search_corpus", "read"]);

/** One conversation: a first draft's, then — if it is the best of them — its repair. */
interface Chain {
  draft: number;
  messages: ChatMessage[];
  temperature: number;
  /** The app as the model last sent it in full: what its edits apply to. Null before the first. */
  base: string | null;
  /** Candidates turned back in this chain. */
  refused: number;
  repeats: number;
  previousReply: string | null;
  previousReplyAt: number;
  previousAnswer: string;
  toolStreak: { sig: string; count: number; at: number; tried: string; answer: string } | null;
  looked: boolean;
  nudged: boolean;
  /** Tools offered (`tool_choice: "auto"`). Off for a first draft: it is one call, the app itself. */
  tools: boolean;
}

/** What a chain came to once it stopped calling tools. */
type Reply =
  | { kind: "candidate"; text: string; source: string; rationale?: string; via: "whole-file" | "edits"; applied: number }
  | { kind: "question"; text: string }
  | { kind: "platform"; said: string }
  | { kind: "repeated"; why: string }
  | { kind: "spent" }
  | { kind: "stopped" };

/** The gate's verdict. `rank` orders failures: what kind (3 does not compile … 0 passed), then how many. */
interface Verdict {
  problem: string | null;
  rank: readonly [number, number];
  warnings: string[];
  passed: string;
}

/** A candidate the gate turned back, kept to pick the best of them. */
interface Tried {
  chain: Chain;
  text: string;
  source: string;
  problem: string;
  rank: readonly [number, number];
  /** Which candidate it was, counted from 1. */
  n: number;
}

const better = (a: Tried, b: Tried): number => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1];

async function firstMessage(deps: CreateLoopDeps): Promise<string> {
  const parts = [buildUserMessage({ id: "studio", description: deps.brief, ...(deps.language ? { language: deps.language } : {}) })];
  if (deps.corpus) {
    // A corpus that cannot be loaded leaves the first message as the single-shot create's: it is a help, never a requirement.
    const primed = await deps
      .corpus()
      .then((c) => primeCorpus(c, deps.brief, "", deps.language))
      .catch(() => "");
    if (primed) parts.push(primed);
  }
  return parts.join("\n\n");
}

/** The note that replaces a rolled-back repeat — the modify loop's (`rollbackNote`), in a create's terms. */
function createRollbackNote(r: TurnedBack): string {
  return [
    `You already did this: ${r.tried}`,
    `What came back: ${r.reason}`,
    "Sending it again will not work, so it has been taken out of this conversation. Do something different:",
    "- build the app another way, as the whole file in one ```ts block;",
    `- or, if only the person can tell you what they want, reply with "QUESTION:" and one short question about what they want, in their words;`,
    `- or, if it needs something Potyro itself does not offer yet, build what the app can do and add a line "${NEEDS_PLATFORM} <what Potyro would need>" — or reply with only that line if nothing can be built.`,
  ].join("\n");
}

const UNUSABLE = 'That was not an app. Reply with the whole app in one ```ts block — or, if one answer would change which app to build, with one line "QUESTION: <it, in plain words>".';

/** The candidate a reply holds: edits against the app as last sent in full, or a whole file. */
function readCandidate(base: string | null, text: string): ReturnType<typeof readEditsOrFile> {
  const read = readEditsOrFile(base ?? "", text);
  // Before the first whole file there is nothing for edits to apply to.
  if (base === null && read.kind !== "whole-file") return { kind: "unusable", text };
  return read;
}

/** Compile + validate, then — when the caller can — a run on sample records. Only an error holds a new app back. */
async function gate(deps: CreateLoopDeps, source: string): Promise<Verdict> {
  let issues: string[];
  try {
    issues = await deps.check(source);
  } catch (e) {
    return { problem: `The app does not compile: ${e instanceof Error ? e.message : String(e)}`, rank: [3, 1], warnings: [], passed: "" };
  }
  if (issues.length) return { problem: `The app failed validation:\n${issues.map((i) => `- ${i}`).join("\n")}`, rank: [2, issues.length], warnings: [], passed: "" };
  if (!deps.run) return { problem: null, rank: [0, 0], warnings: [], passed: "compiles and validates" };
  const report = await runSafely(deps.run, source);
  if (report.errors.length) {
    return { problem: `It compiles and validates, but it breaks when it runs. ${describeRun(report)}`, rank: [1, report.errors.length], warnings: report.warnings, passed: "" };
  }
  const looks = report.warnings.length ? `; looks wrong but is kept: ${report.warnings.map((w) => oneLine(w, 120)).join("; ")}` : "";
  return { problem: null, rank: [0, report.warnings.length], warnings: report.warnings, passed: `compiles, validates and runs (${report.ran || "nothing to run"})${looks}` };
}

export async function runCreateLoop(deps: CreateLoopDeps): Promise<CreateLoopOutcome> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxCandidates = deps.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const drafts = Math.max(1, Math.min(Math.floor(deps.drafts ?? DEFAULT_DRAFTS), maxCandidates));
  const draftSteps = Math.max(1, deps.draftSteps ?? DEFAULT_DRAFT_STEPS);
  const specs = toolSpecs(deps.tools);
  const opening = await firstMessage(deps);

  let steps = 0;
  let candidates = 0;
  /** The next model call thinks hard: the loop just rolled a repeat back or started afresh. */
  let stuck = false;
  const tried: Tried[] = [];
  const turnedBack: TurnedBack[] = [];
  /** Every candidate the gate turned back, with why: sent again, in any chain, it is a repeat. */
  const refused = new Map<string, TurnedBack>();
  /** How each first draft that sent no app ended: says why the loop gave up when none did. */
  const ends: Array<Reply["kind"]> = [];
  let platformSeen: string | null = null;
  let offered = false;
  let last: Chain | null = null;

  const chainFor = (draft: number, note = ""): Chain => ({
    draft,
    messages: [
      { role: "system", content: deps.system },
      { role: "user", content: `${opening}${note}` },
    ],
    temperature: draft === 1 && !note ? FIRST_TEMPERATURE : LATER_TEMPERATURE,
    base: null,
    refused: 0,
    repeats: 0,
    previousReply: null,
    previousReplyAt: -1,
    previousAnswer: "",
    toolStreak: null,
    looked: false,
    // A first draft is one call, tools off; a fresh start in the repair has them.
    tools: Boolean(note),
    nudged: false,
  });
  /** Apps the model's own `check` passed, latest last: kept, so a chain that runs out of calls after one does not lose it. */
  const checked: string[] = [];

  /** The offer to append beside a failure that names something Potyro lacks — once in the loop. */
  const offerFor = (text: string): string => {
    const signal = platformSignal(text);
    if (!signal) return "";
    platformSeen ??= signal;
    if (offered) return "";
    offered = true;
    deps.onStep?.({ kind: "unusable", detail: `offered NEEDS-PLATFORM: ${signal}` });
    return `\n\n${platformOffer(signal)}`;
  };
  const request = (chain: Chain, seed: string): Promise<PlatformRequest> =>
    writePlatformRequest({ engine: deps.engine, ...(deps.model ? { model: deps.model } : {}), messages: chain.messages, tools: specs, seed, ...(deps.language ? { language: deps.language } : {}) });

  const gaveUp = async (cause: GiveUp, why: string): Promise<CreateLoopOutcome> => {
    // Never give up while an app that validates exists. First, one the model's own `check` passed
    // but that it never got round to sending (the paid eval lost three apps that way)…
    for (const source of [...checked].reverse()) {
      if (refused.has(source)) continue;
      const verdict = await gate(deps, source);
      if (verdict.problem === null) {
        candidates += 1;
        deps.onStep?.({ kind: "candidate", passed: true, n: candidates, draft: last?.draft ?? 1, detail: `${verdict.passed} — the app its own check passed` });
        return { kind: "source", source, warnings: verdict.warnings, draft: last?.draft ?? 1, candidate: candidates };
      }
    }
    const best = [...tried].sort(better)[0];
    // …then the best candidate, when it validates and only its run found something: the app is
    // kept, and what the run found is said beside it rather than the whole app thrown away.
    if (best && best.rank[0] <= 1) {
      deps.onStep?.({ kind: "candidate", passed: true, n: best.n, draft: best.chain.draft, detail: `${why} — keeping the candidate that validates` });
      return { kind: "source", source: best.source, warnings: [oneLine(best.problem, 600)], draft: best.chain.draft, candidate: best.n };
    }
    const platformRequest =
      platformSeen && last && !deps.signal?.aborted
        ? await askAfterGiveUp({ engine: deps.engine, model: deps.model, messages: last.messages, tools: specs, signal: platformSeen, language: deps.language })
        : null;
    return { kind: "failed", reason: why, cause, ...(best ? { best: best.source } : {}), ...(platformRequest ? { platformRequest } : {}) };
  };

  /** The model repeated itself in this chain (#278, F1): the first time it is taken out; the second, the chain is over. */
  const repeat = (chain: Chain, why: string, back: TurnedBack, rollbackTo: number): Reply | null => {
    chain.repeats += 1;
    if (chain.repeats >= 2) {
      deps.onStep?.({ kind: "unusable", detail: why, repeat: true });
      return { kind: "repeated", why };
    }
    deps.onStep?.({ kind: "unusable", detail: `${why} — taken out, and asked for something different`, repeat: true });
    if (rollbackTo >= 0) chain.messages.splice(rollbackTo);
    chain.messages.push({ role: "user", content: createRollbackNote(back) });
    stuck = true;
    chain.previousReplyAt = -1;
    chain.toolStreak = null;
    return null;
  };

  /** Tool calls run, their answers go back; a repeat of the same calls is rolled back. Null to go on. */
  const toolTurn = async (chain: Chain, text: string, calls: ToolCallOnMessage[]): Promise<Reply | null> => {
    const sig = toolTurnSignature(calls);
    if (chain.toolStreak?.sig === sig) chain.toolStreak.count += 1;
    else chain.toolStreak = { sig, count: 1, at: chain.messages.length, tried: describeToolTurn(calls), answer: "" };
    const streak = chain.toolStreak;
    if (streak.count >= TOOL_REPEAT) {
      return repeat(
        chain,
        `the same tool call ${TOOL_REPEAT} times in a row (${streak.tried})`,
        { tried: `${streak.tried}, ${TOOL_REPEAT} times in a row`, reason: `the same answer each time: ${streak.answer || "(nothing)"}` },
        streak.at,
      );
    }
    chain.messages.push({ role: "assistant", content: text, tool_calls: calls });
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const result = await runTool(deps.tools, { id: c.id, name: c.function.name, args });
      if (DISCOVERY.has(result.name)) chain.looked = true;
      if (result.name === "check" && result.ok) {
        const source = extractSource(String(args.source ?? ""));
        if (looksLikeApp(source)) checked.push(source);
      }
      if (streak.count === 1) streak.answer = oneLine(`${streak.answer} ${result.detail}`, 200);
      deps.onStep?.({ kind: "tool", name: result.name, ok: result.ok, detail: result.detail });
      chain.messages.push({ role: "tool", tool_call_id: c.id, content: `${result.detail}${offerFor(result.detail)}` });
      if (deps.signal?.aborted) return { kind: "stopped" };
    }
    return null;
  };

  /** A reply that is not a tool call: a question, a platform marker, a candidate — or something sent back. Null to go on. */
  const replyTurn = (chain: Chain, text: string): Reply | null => {
    const head = text.trimStart();
    // The modify loop says ASK:, a create says QUESTION: — either, at the head of a reply that is not an app.
    const question = questionIn(text.replace(/^([\s*`_]*)ASK:/, "$1QUESTION:"));
    if (question) return { kind: "question", text: question };
    if (head.startsWith(NEEDS_PLATFORM) && !looksLikeApp(text)) {
      const said = head.slice(NEEDS_PLATFORM.length).split(/^```/m)[0]!.trim();
      // An uninformed "Potyro can't" is sent to the tools once; said again after looking, it is the answer.
      if (!chain.looked && !chain.nudged) {
        chain.nudged = true;
        chain.tools = true;
        deps.onStep?.({ kind: "unusable", detail: `said Potyro lacks it without looking: ${said}` });
        chain.messages.push({ role: "assistant", content: text });
        chain.messages.push({
          role: "user",
          content:
            "Before answering NEEDS-PLATFORM, use the tools: call `lookup` on the type, option or ctx member you believe is missing, and " +
            "`search_corpus` for how a real app does it. Then answer again — with the app if they show a way, or with NEEDS-PLATFORM quoting what they returned.",
        });
        return null;
      }
      chain.messages.push({ role: "assistant", content: text });
      return { kind: "platform", said };
    }

    const repeated = repeatsItself(text, chain.previousReply);
    if (repeated) {
      const same = chain.previousReply !== null && text.trim() === chain.previousReply.trim();
      const end = repeat(
        chain,
        repeated,
        { tried: oneLine(text) || "the same app", reason: same ? chain.previousAnswer || "nothing usable" : "the reply said the same line over and over, with nothing else" },
        same ? chain.previousReplyAt : -1,
      );
      chain.previousReply = text;
      return end;
    }
    chain.previousReply = text;
    chain.previousReplyAt = chain.messages.length;

    const read = readCandidate(chain.base, text);
    if (read.kind === "unusable" || read.kind === "no-match") {
      deps.onStep?.({ kind: "unusable", detail: read.kind === "no-match" ? describeEditFailures(read.failures) : text.trim() || "(empty reply)" });
      chain.messages.push({ role: "assistant", content: text });
      chain.messages.push({
        role: "user",
        content:
          read.kind === "no-match"
            ? `Your edits could not be applied:\n${describeEditFailures(read.failures)}\nSend the whole corrected app in one \`\`\`ts block, or edits whose SEARCH blocks copy the version you last sent in full exactly.`
            : UNUSABLE,
      });
      chain.previousAnswer = read.kind === "no-match" ? oneLine(`the edits could not be applied: ${describeEditFailures(read.failures)}`, 240) : "it was not an app";
      return null;
    }
    if (read.kind === "whole-file") chain.base = read.source;
    const seen = refused.get(read.source);
    if (seen) return repeat(chain, "the app is one that was already turned back", seen, -1);
    return {
      kind: "candidate",
      text,
      source: read.source,
      ...(read.rationale ? { rationale: read.rationale } : {}),
      via: read.kind,
      applied: read.kind === "edits" ? read.applied : 0,
    };
  };

  /** Model calls in one chain until it sends something to judge, or ends — at most `limit` of them. */
  const advance = async (chain: Chain, limit: number): Promise<Reply> => {
    last = chain;
    for (let spent = 0; spent < limit && steps < maxSteps; spent += 1) {
      if (deps.signal?.aborted) return { kind: "stopped" };
      deps.onStep?.({ kind: "thinking" });
      const escalated = Boolean(deps.escalate && stuck);
      stuck = false;
      steps += 1;
      const res = await deps.engine.chat.completions.create({
        ...(deps.model ? { model: deps.model } : {}),
        messages: chain.messages,
        tools: specs,
        tool_choice: chain.tools ? "auto" : "none",
        temperature: chain.temperature,
        ...(escalated ? { reasoning: "high" as const } : {}),
      });
      const choice = res.choices[0]?.message;
      const calls = choice?.tool_calls ?? [];
      const text = choice?.content ?? "";
      if (calls.length) {
        const end = await toolTurn(chain, text, calls);
        if (end) return end;
        continue;
      }
      chain.toolStreak = null;
      const end = replyTurn(chain, text);
      if (end) return end;
    }
    return deps.signal?.aborted ? { kind: "stopped" } : { kind: "spent" };
  };

  /** Run the gate on a candidate. The outcome when it passed; null, with it kept among the tried, when not. */
  const judge = async (chain: Chain, reply: Extract<Reply, { kind: "candidate" }>): Promise<CreateLoopOutcome | null> => {
    candidates += 1;
    const verdict = await gate(deps, reply.source);
    deps.onStep?.({ kind: "candidate", passed: verdict.problem === null, n: candidates, draft: chain.draft, detail: verdict.problem ?? verdict.passed });
    if (verdict.problem === null) {
      const seed = platformLineIn(reply.rationale ?? reply.text);
      return {
        kind: "source",
        source: reply.source,
        ...(reply.rationale ? { rationale: reply.rationale } : {}),
        warnings: verdict.warnings,
        draft: chain.draft,
        candidate: candidates,
        ...(seed ? { platformRequest: await request(chain, seed) } : {}),
      };
    }
    const back = { tried: oneLine(reply.rationale ?? "") || (reply.via === "edits" ? `a correction of ${reply.applied} edit${reply.applied === 1 ? "" : "s"}` : "an app"), reason: oneLine(verdict.problem, 240) };
    refused.set(reply.source, back);
    turnedBack.push(back);
    chain.refused += 1;
    tried.push({ chain, text: reply.text, source: reply.source, problem: `${verdict.problem}${offerFor(verdict.problem)}`, rank: verdict.rank, n: candidates });
    return null;
  };

  /** What a reply that is not a candidate ends the loop with, or null when the loop goes on without it. */
  const ending = async (chain: Chain, reply: Reply): Promise<CreateLoopOutcome | null> => {
    if (reply.kind === "stopped") return { kind: "stopped" };
    if (reply.kind === "question") return { kind: "question", text: reply.text };
    if (reply.kind === "platform") return { kind: "platform", request: await request(chain, reply.said), said: reply.said };
    return null;
  };

  // ---- the first drafts: independent, each in its own conversation; the next only when none passed ----
  for (let d = 1; d <= drafts; d += 1) {
    if (steps >= maxSteps || candidates >= maxCandidates) break;
    const chain = chainFor(d);
    let reply = await advance(chain, Math.min(draftSteps, maxSteps - steps));
    // A draft sent to the tools before saying "Potyro can't" gets the calls to look with.
    if (reply.kind === "spent" && chain.nudged) reply = await advance(chain, Math.min(LOOK_STEPS, maxSteps - steps));
    const end = await ending(chain, reply);
    if (end) return end;
    if (reply.kind !== "candidate") {
      ends.push(reply.kind);
      continue;
    }
    const passed = await judge(chain, reply);
    if (passed) return passed;
  }

  const budget = (): string => `${candidates} candidate${candidates === 1 ? "" : "s"} failed the check in ${steps} model call${steps === 1 ? "" : "s"}`;
  const best = [...tried].sort(better)[0];
  if (!best) return gaveUp(ends.includes("repeated") ? "repeated" : "steps", `no draft sent an app (${ends.join(", ") || "no steps left"})`);
  if (candidates >= maxCandidates) return gaveUp("candidates", `${budget()} — the candidate budget is spent`);

  // ---- the repair: the draft with the fewest problems, in its own conversation ----
  let chain = best.chain;
  const sendBack = (c: Chain, text: string, problem: string): void => {
    c.messages.push({ role: "assistant", content: text });
    c.messages.push({
      role: "user",
      content:
        `${problem}\n\nSend the corrected app: the whole file in one \`\`\`ts block, or SEARCH/REPLACE edits against the version you last sent in full. ` +
        "If you are unsure whether an option exists, `lookup` it; if you are unsure whether the app validates, `check` it before sending.",
    });
    c.previousAnswer = oneLine(problem, 240);
    c.temperature = REPAIR_TEMPERATURE;
    c.tools = true;
  };
  sendBack(chain, best.text, best.problem);
  while (candidates < maxCandidates && steps < maxSteps) {
    const reply = await advance(chain, maxSteps - steps);
    const end = await ending(chain, reply);
    if (end) return end;
    if (reply.kind === "repeated") return gaveUp("repeated", `the model repeated itself twice (${reply.why}; ${budget()})`);
    if (reply.kind !== "candidate") break;
    const passed = await judge(chain, reply);
    if (passed) return passed;
    if (candidates >= maxCandidates) return gaveUp("candidates", `${budget()} — the candidate budget is spent`);
    const problem = tried.at(-1)!.problem;
    if (chain.refused >= RESTART_AFTER) {
      // F2: a chain with two candidates turned back is not extended; it starts again from the request,
      // with one line per attempt. The steps and candidates already spent stay spent.
      chain = chainFor(chain.draft, `\n\n${freshStartNote(turnedBack)}`);
      stuck = true;
      deps.onStep?.({ kind: "unusable", detail: "starting again from the request, with a note of what was turned back", restart: true });
      continue;
    }
    sendBack(chain, reply.text, problem);
  }
  if (deps.signal?.aborted) return { kind: "stopped" };
  return gaveUp("steps", `gave up after ${steps} model call${steps === 1 ? "" : "s"} (${budget()})`);
}
