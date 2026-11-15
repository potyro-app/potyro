import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps, type ModifyLoopOutcome } from "../src/agent/modify-loop.js";
import { runCreateLoop, type CreateLoopDeps, type CreateLoopOutcome } from "../src/agent/create-loop.js";
import { ASK_LIMIT_NOTE, ASK_PERSON, MAX_QUESTIONS, ONE_QUESTION_NOTE, readAsk, resumeWith, type AgentTool } from "../src/agent/tools.js";
import { conversationRecap } from "../src/agent/conversation.js";
import { MODIFY_AGENT_SYSTEM_PROMPT } from "../src/agent/modify-system-prompt.js";
import { CREATE_AGENT_SYSTEM_PROMPT } from "../src/agent/create-system-prompt.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";
import { FIRST_ACTION_RULE, parseAssumed, parseNotDone, questionOptionsIn, splitQuestion, withNotDone, withoutAssumed, withoutNotDone } from "../src/prompt.js";

// #75: a question is a tool with choices, and the run WAITS — the answer is the call's result in the
// same conversation, where it used to start a new run from a recap. And what was guessed is said
// (`Assumed:`), so a wrong guess is a tap from a fix. Engines are scripted; nothing here calls a model.

type Turn = ChatResponse["choices"][number]["message"];

function scripted(turns: Turn[]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } },
  };
}

const call = (name: string, args: Record<string, unknown>, id = "t1"): Turn => ({ content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const lookup: AgentTool = {
  name: "lookup",
  description: "look",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  run: async (a) => ({ ok: true, detail: `declaration of ${String(a.query)}` }),
};

const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { expense: {} },", "});"].join("\n");
const edit = (prose: string, search: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\n`;
const modifyDeps = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
  engine: scripted([]).engine,
  tools: [lookup],
  system: "contract",
  instruction: "add an amount to each expense",
  source: SOURCE,
  check: async () => [],
  shapeOf: async () => ({ entities: { expense: {} }, pages: [] }),
  before: { entities: { expense: {} }, pages: [] },
  ...over,
});
const question = (out: ModifyLoopOutcome | CreateLoopOutcome) => {
  if (out.kind !== "question") throw new Error(`expected a question, got ${out.kind}`);
  return out;
};
const CURRENCY = { question: "Which currency are the amounts in?", options: ["Euros", "Dollars", "Each expense says its own"] };

describe("the prose's lists: Assumed beside Not done", () => {
  const prose = ["Each expense now has an amount.", "", "Assumed:", "- Amounts are in euros.", "- An expense has one amount.", "", "Not done:", "- splitting an expense, because that needs a second kind of record"].join("\n");

  it("reads the guesses, and Not done beside them, whichever comes first", () => {
    expect(parseAssumed(prose)).toEqual(["Amounts are in euros.", "An expense has one amount."]);
    expect(parseNotDone(prose)).toEqual(["splitting an expense, because that needs a second kind of record"]);
    const swapped = ["Done.", "**Not done:**", "* the chart", "**Assumed:**", "1. Weeks start on Monday."].join("\n");
    expect(parseAssumed(swapped)).toEqual(["Weeks start on Monday."]);
    expect(parseNotDone(swapped)).toEqual(["the chart"]);
  });

  it("takes both lists out of what the card says, and keeps the words", () => {
    expect(withoutAssumed(withoutNotDone(prose))).toBe("Each expense now has an amount.");
    expect(withoutNotDone(withoutAssumed(prose))).toBe("Each expense now has an amount.");
  });

  it("rides on a reply as `assumed`, with no key when nothing was guessed; a long list is cut", () => {
    expect(withNotDone({ rationale: prose })).toMatchObject({ assumed: ["Amounts are in euros.", "An expense has one amount."], notDone: [expect.any(String)] });
    expect("assumed" in withNotDone({ rationale: "Renamed it." })).toBe(false);
    expect(parseAssumed(`Assumed:\n${[1, 2, 3, 4, 5, 6].map((n) => `- guess ${n}`).join("\n")}`)).toHaveLength(4);
    // Prose that only mentions the word is not a list.
    expect(parseAssumed("I assumed: nothing in particular.")).toEqual([]);
  });
});

describe("a marker question may carry choices", () => {
  it("the `- ` lines under the question are its choices; two to four", () => {
    expect(splitQuestion("Which currency?\n- Euros\n- Dollars")).toEqual({ text: "Which currency?", options: ["Euros", "Dollars"] });
    expect(splitQuestion("Which one?\n\n- **A**\n- B\n- C\n- D\n- E").options).toEqual(["A", "B", "C", "D"]);
    // One choice is no choice, and a question with none reads as it always did.
    expect(splitQuestion("Which currency?\n- Euros")).toEqual({ text: "Which currency?\n- Euros", options: [] });
    expect(splitQuestion("Stars out of 5, or a score out of 10?")).toEqual({ text: "Stars out of 5, or a score out of 10?", options: [] });
  });

  it("a create reply's QUESTION: reads the same", () => {
    expect(questionOptionsIn("QUESTION: Indoor plants, or a garden?\n- Indoor\n- A garden")).toEqual(["Indoor", "A garden"]);
    expect(questionOptionsIn("**QUESTION:** Indoor plants, or a garden?")).toEqual([]);
    expect(questionOptionsIn('```ts\nimport { defineApp } from "potyro";\nexport default defineApp({});\n```')).toEqual([]);
  });

  it("the modify loop hands the choices over with the question", async () => {
    const { engine } = scripted([{ content: "ASK: Which currency are the amounts in?\n- Euros\n- Dollars" }]);
    const out = question(await runModifyLoop(modifyDeps({ engine })));
    expect(out).toMatchObject({ text: "Which currency are the amounts in?", options: ["Euros", "Dollars"], allowOther: true, asked: 1, steps: 1 });
    expect(out.pending).toBeUndefined();
  });
});

describe("ask_person: what the model sent, as a question", () => {
  it("keeps two to four distinct choices; fewer is an open question", () => {
    expect(readAsk({ question: " Which currency? ", options: ["Euros", "Euros", " Dollars "], allow_other: false })).toEqual({ question: "Which currency?", options: ["Euros", "Dollars"], allowOther: false });
    expect(readAsk({ question: "Which?", options: ["a", "b", "c", "d", "e"] })?.options).toEqual(["a", "b", "c", "d"]);
    // One choice is none — and then the person's own words are the only way to answer.
    expect(readAsk({ question: "Which?", options: ["only"], allow_other: false })).toEqual({ question: "Which?", options: [], allowOther: true });
    expect(readAsk({ options: ["a", "b"] })).toBeNull();
    expect(readAsk({ question: "   " })).toBeNull();
  });
});

describe("the modify loop pauses on ask_person, and goes on from the answer", () => {
  it("the call ends the run with the question, its choices, the conversation and the call waiting", async () => {
    const { engine, seen } = scripted([call("lookup", { query: "NumberField" }, "t1"), call(ASK_PERSON, { ...CURRENCY, allow_other: false }, "q1")]);
    const steps: string[] = [];
    const out = question(await runModifyLoop(modifyDeps({ engine, onStep: (s) => steps.push(s.kind === "tool" ? s.name : s.kind) })));
    expect(out).toMatchObject({ text: CURRENCY.question, options: CURRENCY.options, allowOther: false, pending: "q1", asked: 1, steps: 2 });
    // Nothing more was asked of the model: the run holds no call open while the person thinks.
    expect(seen).toHaveLength(2);
    expect(seen[0]!.tools?.map((t) => t.function.name)).toContain(ASK_PERSON);
    // The conversation is the run's own: what it looked up before asking, and the turn that asked — with no result yet.
    expect(out.transcript.some((m) => m.role === "tool" && m.content.includes("declaration of NumberField"))).toBe(true);
    expect(out.transcript.at(-1)).toMatchObject({ role: "assistant", tool_calls: [{ id: "q1" }] });
    expect(out.transcript.some((m) => m.role === "tool" && m.tool_call_id === "q1")).toBe(false);
    expect(steps).toContain(ASK_PERSON);
  });

  it("the answer is the call's result, in the SAME conversation: what was looked up is still there, and the change lands", async () => {
    const first = scripted([call("lookup", { query: "NumberField" }, "t1"), call(ASK_PERSON, CURRENCY, "q1")]);
    const paused = question(await runModifyLoop(modifyDeps({ engine: first.engine })));

    const second = scripted([{ content: edit("Each expense has an amount, in dollars.", '  id: "x",', '  id: "x", currency: "USD",') }]);
    const out = await runModifyLoop(modifyDeps({ engine: second.engine, resumeFrom: resumeWith(paused, "Dollars"), asked: paused.asked, stepsSpent: paused.steps }));
    expect(out).toMatchObject({ kind: "source", via: "edits" });
    expect(out.kind === "source" && out.source).toContain('currency: "USD"');
    // One more call, not a new run: the app is in the conversation once, and so is the lookup's answer.
    expect(second.seen).toHaveLength(1);
    const messages = second.seen[0]!.messages;
    expect(messages.filter((m) => m.role === "user" && m.content.includes(SOURCE))).toHaveLength(1);
    expect(messages.some((m) => m.role === "tool" && m.content.includes("declaration of NumberField"))).toBe(true);
    expect(messages.at(-1)).toEqual({ role: "tool", tool_call_id: "q1", content: "The person answered: Dollars" });
  });

  it("a marker question resumes too: the answer is the next message of the same conversation", async () => {
    const first = scripted([call("lookup", { query: "NumberField" }), { content: "ASK: Which currency?\n- Euros\n- Dollars" }]);
    const paused = question(await runModifyLoop(modifyDeps({ engine: first.engine })));
    const second = scripted([{ content: edit("In euros.", '  id: "x",', '  id: "x", currency: "EUR",') }]);
    const out = await runModifyLoop(modifyDeps({ engine: second.engine, resumeFrom: resumeWith(paused, "Euros"), asked: paused.asked, stepsSpent: paused.steps }));
    expect(out.kind).toBe("source");
    expect(second.seen[0]!.messages.at(-1)).toEqual({ role: "user", content: "The answer: Euros" });
    expect(second.seen[0]!.messages.some((m) => m.role === "tool" && m.content.includes("declaration of NumberField"))).toBe(true);
  });

  it("a resumed run goes on inside the same step budget — the question counted once", async () => {
    const first = scripted([call("lookup", { query: "a" }, "t1"), call(ASK_PERSON, CURRENCY, "q1")]);
    const paused = question(await runModifyLoop(modifyDeps({ engine: first.engine, maxSteps: 4 })));
    expect(paused.steps).toBe(2);
    // Two calls were spent before the answer, so two are left of four: the third reply is never asked for.
    const second = scripted([call("lookup", { query: "b" }, "t2"), call("lookup", { query: "c" }, "t3"), { content: edit("Late.", '  id: "x",', '  id: "y",') }]);
    const out = await runModifyLoop(modifyDeps({ engine: second.engine, maxSteps: 4, resumeFrom: resumeWith(paused, "Euros"), asked: paused.asked, stepsSpent: paused.steps }));
    expect(out).toMatchObject({ kind: "failed", cause: "steps" });
    expect(second.seen).toHaveLength(2);
  });

  it(`at most ${MAX_QUESTIONS} questions a request: one more is told to go on and say what it guessed`, async () => {
    const { engine, seen } = scripted([
      call(ASK_PERSON, { question: "And should it round the amounts?", options: ["Yes", "No"] }, "q3"),
      { content: edit("Each expense has an amount.\n\nAssumed:\n- Amounts are not rounded.", '  id: "x",', '  id: "y",') },
    ]);
    const out = await runModifyLoop(modifyDeps({ engine, asked: MAX_QUESTIONS }));
    // No pause: the third question's result is the note, and the run ends with the change and the guess.
    expect(out).toMatchObject({ kind: "source", assumed: ["Amounts are not rounded."] });
    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "q3", content: ASK_LIMIT_NOTE });
    expect(ASK_LIMIT_NOTE).toMatch(/Assumed:/);
  });

  it("the limit holds over a pause: the second question pauses, the third does not", async () => {
    const a = question(await runModifyLoop(modifyDeps({ engine: scripted([call(ASK_PERSON, CURRENCY, "q1")]).engine })));
    const b = question(
      await runModifyLoop(
        modifyDeps({ engine: scripted([call(ASK_PERSON, { question: "Per person, or per trip?", options: ["Per person", "Per trip"] }, "q2")]).engine, resumeFrom: resumeWith(a, "Euros"), asked: a.asked, stepsSpent: a.steps }),
      ),
    );
    expect(b.asked).toBe(2);
    const third = scripted([call(ASK_PERSON, { question: "Rounded?" }, "q3"), { content: edit("Done.", '  id: "x",', '  id: "y",') }]);
    const out = await runModifyLoop(modifyDeps({ engine: third.engine, resumeFrom: resumeWith(b, "Per trip"), asked: b.asked, stepsSpent: b.steps }));
    expect(out.kind).toBe("source");
    expect(third.seen[1]!.messages.at(-1)!.content).toBe(ASK_LIMIT_NOTE);
  });

  it("a marker question past the limit is sent back once", async () => {
    const { engine, seen } = scripted([{ content: "ASK: Rounded?" }, { content: edit("Done.", '  id: "x",', '  id: "y",') }]);
    const out = await runModifyLoop(modifyDeps({ engine, asked: MAX_QUESTIONS }));
    expect(out.kind).toBe("source");
    expect(seen[1]!.messages.at(-1)).toEqual({ role: "user", content: ASK_LIMIT_NOTE });
  });

  it("two questions in one turn: the first is put to the person, the second is told to wait", async () => {
    const turn: Turn = {
      content: "",
      tool_calls: [
        { id: "q1", type: "function", function: { name: ASK_PERSON, arguments: JSON.stringify(CURRENCY) } },
        { id: "t1", type: "function", function: { name: "lookup", arguments: '{"query":"NumberField"}' } },
        { id: "q2", type: "function", function: { name: ASK_PERSON, arguments: '{"question":"Rounded?"}' } },
      ],
    };
    const out = question(await runModifyLoop(modifyDeps({ engine: scripted([turn]).engine })));
    expect(out).toMatchObject({ text: CURRENCY.question, pending: "q1", asked: 1 });
    // Every call of the turn but the one waiting has its result, so the conversation can be sent on.
    const results = out.transcript.filter((m) => m.role === "tool");
    expect(results.map((m) => m.tool_call_id).sort()).toEqual(["q2", "t1"]);
    expect(results.find((m) => m.tool_call_id === "q2")!.content).toBe(ONE_QUESTION_NOTE);
  });

  it("a call with no question in it is answered, not put to the person", async () => {
    const { engine, seen } = scripted([call(ASK_PERSON, { options: ["a", "b"] }, "q1"), { content: edit("Done.", '  id: "x",', '  id: "y",') }]);
    expect((await runModifyLoop(modifyDeps({ engine }))).kind).toBe("source");
    expect(seen[1]!.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "q1", content: expect.stringMatching(/needs a `question`/) });
  });

  it("where nobody is there to answer, the tool is not offered", async () => {
    const { engine, seen } = scripted([{ content: edit("Done.", '  id: "x",', '  id: "y",') }]);
    await runModifyLoop(modifyDeps({ engine, askPerson: false }));
    expect(seen[0]!.tools?.map((t) => t.function.name)).toEqual(["lookup"]);
  });
});

describe("what was guessed rides on the change", () => {
  it("the modify loop carries Assumed beside Not done", async () => {
    const prose = "Each expense has an amount.\n\nAssumed:\n- Amounts are in euros.\n\nNot done:\n- a chart, because it was not asked for";
    const out = await runModifyLoop(modifyDeps({ engine: scripted([{ content: edit(prose, '  id: "x",', '  id: "y",') }]).engine }));
    expect(out).toMatchObject({ kind: "source", assumed: ["Amounts are in euros."], notDone: ["a chart, because it was not asked for"] });
  });

  it("a change that guessed nothing carries no list", async () => {
    const out = await runModifyLoop(modifyDeps({ engine: scripted([{ content: edit("Renamed.", '  id: "x",', '  id: "y",') }]).engine }));
    expect(out.kind === "source" && "assumed" in out).toBe(false);
  });

  it("the recap of the next run says what the last version guessed", () => {
    const recap = conversationRecap(
      [
        { kind: "ask", text: "Track what I spend." },
        { kind: "version", text: "Made “Spending”.", assumed: ["Amounts are in euros.", "An expense has one amount."] },
      ],
      { rounds: 6, tool: false },
    );
    expect(recap).toContain('You guessed, without being told: "Amounts are in euros."; "An expense has one amount."');
    // A version that guessed nothing says nothing of it.
    expect(conversationRecap([{ kind: "ask", text: "x" }, { kind: "version", text: "Changed." }], { rounds: 6, tool: false })).not.toContain("You guessed");
  });
});

describe("the create loop waits for its answer too", () => {
  const app = (name: string, extra = "") => `import { defineApp } from "potyro";\nexport default defineApp({ id: "x", name: "${name}"${extra} });`;
  const fenced = (src: string, prose = "") => `${prose}${prose ? "\n" : ""}\`\`\`ts\n${src}\n\`\`\``;
  const check = async (src: string): Promise<string[]> => (src.includes("BROKEN") ? ["pages[0].view.entity: no such entity"] : []);
  const createDeps = (over: Partial<CreateLoopDeps>): CreateLoopDeps => ({ engine: scripted([]).engine, tools: [lookup], system: "contract", brief: "something for my plants", check, ...over });

  it("a first draft's QUESTION: carries its choices and the conversation it was asked in", async () => {
    const { engine, seen } = scripted([{ content: "QUESTION: Indoor plants, or a garden?\n- Indoor\n- A garden" }]);
    const out = question(await runCreateLoop(createDeps({ engine })));
    expect(out).toMatchObject({ text: "Indoor plants, or a garden?", options: ["Indoor", "A garden"], allowOther: true, asked: 1, steps: 1 });
    expect(out.pending).toBeUndefined();
    expect(out.transcript.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(seen).toHaveLength(1);
  });

  it("the answer goes back into that conversation, and the app is made with ONE more call", async () => {
    const paused = question(await runCreateLoop(createDeps({ engine: scripted([{ content: "QUESTION: Indoor plants, or a garden?\n- Indoor\n- A garden" }]).engine })));
    const second = scripted([{ content: fenced(app("Plant Diary"), "Assumed:\n- Each plant is watered on its own days.") }]);
    const out = await runCreateLoop(createDeps({ engine: second.engine, brief: "something for my plants\n\nYou asked: Indoor plants, or a garden?\nThe answer: Indoor", resumeFrom: resumeWith(paused, "Indoor"), asked: paused.asked, stepsSpent: paused.steps }));
    expect(out).toMatchObject({ kind: "source", assumed: ["Each plant is watered on its own days."] });
    expect(second.seen).toHaveLength(1);
    // The same conversation: the request once, the question it asked, then the answer. A first draft still, tools off.
    const messages = second.seen[0]!.messages;
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages.at(-1)!.content).toBe("The answer: Indoor");
    expect(second.seen[0]!.tool_choice).toBe("none");
  });

  it("while correcting, ask_person pauses the repair and the answer is its result", async () => {
    const first = scripted([{ content: fenced(app("Diary", " /* BROKEN */")) }, { content: fenced(app("Diary 2", " /* BROKEN */")) }, call(ASK_PERSON, { question: "One list, or one per room?", options: ["One list", "One per room"] }, "q1")]);
    const paused = question(await runCreateLoop(createDeps({ engine: first.engine })));
    expect(paused).toMatchObject({ text: "One list, or one per room?", options: ["One list", "One per room"], pending: "q1", asked: 1, steps: 3 });

    const second = scripted([{ content: fenced(app("Plant Diary")) }]);
    const out = await runCreateLoop(createDeps({ engine: second.engine, resumeFrom: resumeWith(paused, "One per room"), asked: paused.asked, stepsSpent: paused.steps }));
    expect(out.kind).toBe("source");
    expect(second.seen).toHaveLength(1);
    expect(second.seen[0]!.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "q1", content: "The person answered: One per room" });
    // It was repairing when it asked: the tools are still on.
    expect(second.seen[0]!.tool_choice).toBe("auto");
  });

  it("a question past the limit is sent back once, and the app is made", async () => {
    const { engine, seen } = scripted([{ content: "QUESTION: And how often?" }, { content: fenced(app("Plant Diary")) }]);
    const out = await runCreateLoop(createDeps({ engine, asked: MAX_QUESTIONS }));
    expect(out.kind).toBe("source");
    expect(seen[1]!.messages.at(-1)).toEqual({ role: "user", content: ASK_LIMIT_NOTE });
  });

  it("what a new app could not do as asked is carried too", async () => {
    const prose = "Not done:\n- reading the label while adding a bottle, because a form has no action of its own";
    const out = await runCreateLoop(createDeps({ engine: scripted([{ content: fenced(app("Cellar"), prose) }]).engine }));
    expect(out).toMatchObject({ kind: "source", notDone: ["reading the label while adding a bottle, because a form has no action of its own"] });
  });
});

describe("the rule for when to ask is in the loops' prompts", () => {
  it("both say it, name the tool and the lists, and carry the first-action rule (#78)", () => {
    for (const prompt of [MODIFY_AGENT_SYSTEM_PROMPT, CREATE_AGENT_SYSTEM_PROMPT]) {
      expect(prompt).toMatch(/ASK ONLY WHEN THE ANSWER CHANGES WHAT GETS BUILT/);
      expect(prompt).toContain(ASK_PERSON);
      expect(prompt).toContain("Assumed:");
      expect(prompt).toMatch(/never build the close thing silently/);
      expect(prompt).toContain(FIRST_ACTION_RULE);
    }
  });
});
