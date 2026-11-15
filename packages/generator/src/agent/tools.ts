// What the agent can DO, as opposed to what it can say.
//
// The fixing agent's core problem is that it cannot see the app it is editing: it gets a source
// file and a sentence, guesses, and reports success. Tools are the fix — it can replay what the
// user did, look at the resolved app, and check the shape of the data before proposing anything.
//
// Every failure here comes back as a RESULT, never as a thrown error. A hallucinated tool name or
// a tool that throws is information the model can act on; an exception ends the loop and puts us
// back to guessing.

import type { ChatMessage } from "../chat-backend.js";

/** The JSON-Schema-shaped description a model needs to call a tool. */
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  /** Correlates a result back to the call the model made. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  ok: boolean;
  /** What happened, in words the model (and a person reading the transcript) can use. */
  detail: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<{ ok: boolean; detail: string }>;
}

export function toolSpecs(tools: AgentTool[]): ToolSpec[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function runTool(tools: AgentTool[], call: ToolCall): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    const known = tools.map((t) => t.name).join(", ");
    return { id: call.id, name: call.name, ok: false, detail: `unknown tool "${call.name}" — you can call: ${known}` };
  }
  try {
    const { ok, detail } = await tool.run(call.args);
    return { id: call.id, name: call.name, ok, detail };
  } catch (e) {
    return { id: call.id, name: call.name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ---- ask_person (#75): a question is a tool with choices, and the run waits for the answer ------
//
// A question used to be a marker that ENDED the run: the answer started a new one from a recap, and
// what the model had looked up before asking was gone. As a tool call it pauses the run instead. The
// loop that sees the call returns a `question` outcome holding the transcript and the call's id; the
// answer goes back as that call's result (`resumeWith`) and the same conversation continues. The
// loops intercept the call — the tool's own `run` is only what a caller that does not gets.

export const ASK_PERSON = "ask_person";
/** Questions one request may ask. One more gets `ASK_LIMIT_NOTE` back instead of a pause. */
export const MAX_QUESTIONS = 2;
const MIN_ASK_OPTIONS = 2;
const MAX_ASK_OPTIONS = 4;
/** A choice is a button's label: longer than this, it is cut. */
const MAX_OPTION_CHARS = 80;

/** What a question after the last one allowed is answered with — as the tool's result, or the next message. */
export const ASK_LIMIT_NOTE =
  `You have already asked ${MAX_QUESTIONS} questions about this request, and the person answered them. Do not ask again: ` +
  "go on with your best reading of what they want, and list what you guessed under `Assumed:` in the prose before the block.";

/** A second question in the same turn: only the first one is put to the person. */
export const ONE_QUESTION_NOTE = "One question at a time: this one was not asked. If you still need it after the answer to the other, ask it then.";

/** A question as the person is shown it. */
export interface PersonQuestion {
  question: string;
  /** Two to four short answers to tap, or none. */
  options: string[];
  /** Whether an answer of their own is also welcome. Always true when there are no options. */
  allowOther: boolean;
}

/** `ask_person`'s arguments as a question, or null when there is no question in them. */
export function readAsk(args: Record<string, unknown>): PersonQuestion | null {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) return null;
  const listed = Array.isArray(args.options) ? args.options : [];
  const distinct = [...new Set(listed.filter((o): o is string => typeof o === "string").map((o) => o.replace(/\s+/g, " ").trim().slice(0, MAX_OPTION_CHARS)).filter(Boolean))];
  // One choice is no choice: the question is then asked open.
  const options = distinct.length >= MIN_ASK_OPTIONS ? distinct.slice(0, MAX_ASK_OPTIONS) : [];
  return { question, options, allowOther: options.length === 0 || args.allow_other !== false };
}

export const askPersonTool: AgentTool = {
  name: ASK_PERSON,
  description:
    "Ask the person ONE question and wait for their answer; it comes back as this call's result and you go on from here. " +
    "Only when the possible answers would lead to different apps or different data and neither the request nor the conversation settles it. " +
    `Give the likely answers as \`options\` (${MIN_ASK_OPTIONS} to ${MAX_ASK_OPTIONS} short ones, in the person's words) whenever there are a few; they are shown as buttons. ` +
    `At most ${MAX_QUESTIONS} questions per request. Never ask what the request already says, or a question whose answers lead to the same app.`,
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question, in plain words, in the person's language" },
      options: { type: "array", items: { type: "string" }, minItems: MIN_ASK_OPTIONS, maxItems: MAX_ASK_OPTIONS, description: "Short answers to choose from" },
      allow_other: { type: "boolean", description: "Whether the person may also answer in their own words (default true)" },
    },
    required: ["question"],
  },
  // A loop pauses on the call and never runs this; a caller with nobody to ask says so.
  run: async () => ({ ok: false, detail: "Nobody can be asked here. Go on with your best reading, and list what you guessed under `Assumed:`." }),
};

/** A run that stopped to ask (#75): everything needed to go on from the answer. */
export interface PausedRun {
  /** The conversation so far, the turn that asked included. */
  transcript: ChatMessage[];
  /** The `ask_person` call waiting for its result; absent when the question was a marker (`ASK:` / `QUESTION:`). */
  pending?: string;
  /** Questions this request has asked, this one included. */
  asked: number;
  /** Model calls spent so far: the run goes on inside the same budget. */
  steps: number;
}

/** The paused conversation with the person's answer in it: the pending call's result, or the next message. */
export function resumeWith(paused: Pick<PausedRun, "transcript" | "pending">, answer: string): ChatMessage[] {
  const said = answer.trim();
  return [
    ...paused.transcript,
    paused.pending ? { role: "tool", tool_call_id: paused.pending, content: `The person answered: ${said}` } : { role: "user", content: `The answer: ${said}` },
  ];
}

/** What a resumed chain's last message says, for a note when the chain is started afresh; "" when it is not an answer. */
export function answerIn(transcript: readonly ChatMessage[]): string {
  const last = transcript.at(-1);
  return last && (last.role === "tool" || last.role === "user") && /^(The person answered|The answer): /.test(last.content) ? last.content : "";
}
