// When what the person asked for needs something Potyro itself does not offer yet (#263).
//
// The loop used to end such a request at NOT-IN-APP: the person reached a dead end and the Potyro
// team never heard of it. Now the model can answer `NEEDS-PLATFORM:` — alone, or beside the part of
// the change it could make and its `Not done:` lines — and the Studio offers to send a request to
// the team, in the person's words.
//
// Two rules from the research (docs/19 F5, F7):
//   - the HARNESS decides when to offer it. Models abstain late and rarely raise anything on their
//     own, so the marker is offered where the loop has evidence: on a repeat it rolled back
//     (loop-recovery.ts), and when a check, a run or a lookup names something Potyro lacks — a ctx
//     member that is not there, a library that needs a full web page, a name nothing declares
//     (`platformSignal`). Never in the ladder every request reads.
//   - the request is WRITTEN in one last call with the tools off (`tool_choice: "none"`, as opencode
//     does at its step limit): what the person was trying to do, what Potyro would need, what the
//     app would do with it — plain words, in the person's language, no code.
//
// `appStructure` is what is sent beside the request: the app's declaration as data, with every
// function and every piece of code as a marker. Never the person's records — they are not in the
// source — and never the code itself.

import type { ChatEngine, ChatMessage } from "../chat-backend.js";
import type { ToolSpec } from "./tools.js";
import { LANGUAGE_NAMES, type Language } from "../language.js";
import { CODE, FN, readSourceWords } from "../source-words.js";

/** The marker: at the head of a reply when nothing could be done, or on a line of the prose beside edits. */
export const NEEDS_PLATFORM = "NEEDS-PLATFORM:";

/** A request to the Potyro team, in the person's words. */
export interface PlatformRequest {
  /** One line, the request in short. */
  title: string;
  /** What they were trying to do, what Potyro would need, and what the app would do with it. */
  body: string;
}

const MAX_TITLE = 80;
const MAX_BODY = 1500;

const SIGNALS: ReadonlyArray<[RegExp, (m: RegExpExecArray) => string]> = [
  [/Nothing in the potyro module is called "([^"]+)"/, (m) => `nothing in Potyro is called "${m[1]}"`],
  [/([\w@./-]+(?: [\d.]+)?) needs a full web page/i, (m) => `${m[1]} needs a full web page, which Potyro's sealed box does not give it`],
  [/\b(ctx(?:\.[A-Za-z_$][\w$]*)+)(?:\(\))? (?:is not a function|is undefined|is not defined|is not available[^\n]*|does not exist)/, (m) => `${m[1]} is not there`],
  [/Cannot read propert(?:y|ies) of undefined \(reading '(\w+)'\)[^\n]*\bctx\b|\bctx\b[^\n]*Cannot read propert(?:y|ies) of undefined \(reading '(\w+)'\)/, (m) => `ctx has no ${m[1] ?? m[2]}`],
];

/** What, in a failure, says Potyro itself lacks something — or null when the failure is the change's own. */
export function platformSignal(text: string): string | null {
  for (const [re, say] of SIGNALS) {
    const m = re.exec(text);
    if (m) return say(m);
  }
  return null;
}

/** The note that offers the marker, once, beside the failure that suggested it. */
export function platformOffer(signal: string): string {
  return [
    `This looks like something Potyro itself does not offer yet (${signal}).`,
    "If the person's request needs it, do not give up on the request and do not work around it with something that only pretends:",
    `- do what the app CAN do with edits, list the rest under "Not done:", and add a line "${NEEDS_PLATFORM} <what Potyro would need, in a sentence>";`,
    `- or, if no part of it can be done, reply with only "${NEEDS_PLATFORM} <what Potyro would need>".`,
    "The person can then send a request to the Potyro team. If Potyro does have a way, use it instead.",
  ].join("\n");
}

/** The marker's words on a line of the prose (markdown dressing allowed), or null. */
export function platformLineIn(prose: string): string | null {
  const m = /^[\s*_`>#-]*NEEDS-PLATFORM:[\s*_`]*(.+?)\s*$/m.exec(prose);
  return m ? m[1]!.replace(/[*_`]+$/, "").trim() || null : null;
}

const flat = (text: string): string =>
  text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The final call's answer as a request; the model's own marker words when it did not keep the format. */
export function readPlatformRequest(reply: string, seed: string): PlatformRequest {
  const text = flat(reply.replace(new RegExp(`^\\s*${NEEDS_PLATFORM}\\s*`), ""));
  const titled = /^\s*(?:\*\*)?TITLE:(?:\*\*)?\s*(.+)\n?([\s\S]*)$/i.exec(text);
  if (titled && titled[1]!.trim()) {
    const body = titled[2]!.trim() || seed.trim();
    return { title: clip(titled[1]!.trim(), MAX_TITLE), body: clip(body, MAX_BODY) };
  }
  const words = flat(text || seed);
  const first = words.split(/(?<=[.!?])\s|\n/)[0] ?? words;
  return { title: clip(first.trim(), MAX_TITLE), body: clip(words, MAX_BODY) };
}

/** The instruction for the last call: the request, written for the Potyro team, in the person's words. */
export function platformRequestPrompt(seed: string, language?: Language): string {
  const lang = LANGUAGE_NAMES[language ?? "en"];
  return [
    "Stop working on the app. Write a short request to the Potyro team instead — the people who make Potyro itself.",
    `You said Potyro would need: ${seed}`,
    `Write it in ${lang}, in plain words the person would use — no code, no names from the app's source, no ctx or field names.`,
    "Say what the person was trying to do, what Potyro is missing for it, and what their app would do with it. Never include any of their records or personal details.",
    "Answer in exactly this form and nothing else:",
    "TITLE: <the request in a few words>",
    "<two to four sentences>",
  ].join("\n");
}

export interface WriteRequestDeps {
  engine: ChatEngine;
  model?: string;
  /** The conversation so far: the request is written knowing what was tried. */
  messages: readonly ChatMessage[];
  /**
   * The loop's tools, declared but switched off: a conversation that holds tool calls needs them
   * declared, and the engine sends `tool_choice` only beside tools.
   */
  tools?: ToolSpec[];
  /** What the model said Potyro would need, with the marker. */
  seed: string;
  language?: Language;
}

/** One last call, tools off, that writes the request. The model's own words when the call fails. */
export async function writePlatformRequest(deps: WriteRequestDeps): Promise<PlatformRequest> {
  try {
    const res = await deps.engine.chat.completions.create({
      ...(deps.model ? { model: deps.model } : {}),
      messages: [...deps.messages, { role: "user", content: platformRequestPrompt(deps.seed, deps.language) }],
      ...(deps.tools?.length ? { tools: deps.tools } : {}),
      tool_choice: "none",
      temperature: 0.1,
    });
    return readPlatformRequest(res.choices[0]?.message?.content ?? "", deps.seed);
  } catch {
    return readPlatformRequest("", deps.seed);
  }
}

export interface GiveUpDeps {
  engine: ChatEngine;
  model?: string;
  messages: readonly ChatMessage[];
  /** What named something Potyro lacks, earlier in the loop. */
  signal: string;
  /** As `WriteRequestDeps.tools`: declared, switched off. */
  tools?: ToolSpec[];
  language?: Language;
}

/**
 * The loop gave up after a failure named something Potyro lacks: one last call, tools off, asks
 * whether that is what stood in the way and, if it is, writes the request (docs/19 F7). Null when
 * the model says it is not, or the call fails — the give-up is then said as it always was.
 */
export async function askAfterGiveUp(deps: GiveUpDeps): Promise<PlatformRequest | null> {
  const lang = LANGUAGE_NAMES[deps.language ?? "en"];
  const ask = [
    "You could not make this change, and you are not going to try again.",
    `Earlier, something suggested Potyro itself does not offer what it needs: ${deps.signal}.`,
    "If that — or something else Potyro itself lacks — is what stood in the way, answer in exactly this form and nothing else,",
    `in ${lang}, in plain words the person would use, with no code and none of their records or personal details:`,
    "NEEDS-PLATFORM",
    "TITLE: <the request in a few words>",
    "<two to four sentences: what the person was trying to do, what Potyro is missing, what their app would do with it>",
    "If it is not something Potyro lacks, answer only: NO",
  ].join("\n");
  try {
    const res = await deps.engine.chat.completions.create({
      ...(deps.model ? { model: deps.model } : {}),
      messages: [...deps.messages, { role: "user", content: ask }],
      ...(deps.tools?.length ? { tools: deps.tools } : {}),
      tool_choice: "none",
      temperature: 0.1,
    });
    const reply = (res.choices[0]?.message?.content ?? "").trim();
    if (!/^[\s*_`]*NEEDS-PLATFORM\b/.test(reply)) return null;
    return readPlatformRequest(reply.replace(/^[\s*_`]*NEEDS-PLATFORM:?[\s*_`]*/, ""), deps.signal);
  } catch {
    return null;
  }
}

/** The structure, at most: a declaration this long is cut, never the request. */
const MAX_STRUCTURE = 24_000;

/**
 * The app's declaration as data — entities, fields, pages, views — with functions and code as
 * markers, as JSON. Empty when the source holds no `defineApp({...})`.
 */
export async function appStructure(source: string): Promise<string> {
  const sw = await readSourceWords(source).catch(() => null);
  if (!sw) return "";
  const json = JSON.stringify(sw.data, (_key, value: unknown) => (value === FN ? "(a function)" : value === CODE ? "(code)" : value), 2);
  return json.length > MAX_STRUCTURE ? `${json.slice(0, MAX_STRUCTURE)}\n… (cut: the rest of the app's structure is longer than this)` : json;
}
