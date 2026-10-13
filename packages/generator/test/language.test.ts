// The person's language on the model side (#301): one instruction per turn, none for English, and a
// change that keeps the app's own language for its words. Engines are scripted; nothing calls a model.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AppDefinition } from "potyro";
import {
  LANGUAGES,
  appLanguage,
  bestLanguage,
  changeLanguageInstruction,
  classifyText,
  createLanguageInstruction,
  matchLanguage,
  userFacingStrings,
} from "../src/language.js";
import { buildModifyMessage, buildUserMessage } from "../src/prompt.js";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import { runAgentLoop, type LoopDeps } from "../src/agent/loop.js";
import { runAskLoop, askLanguageInstruction } from "../src/agent/ask.js";
import { OpenRouterBackend } from "../src/openrouter-backend.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const appsIn = (dir: string) => readdirSync(here(dir)).filter((f) => /\.app\.tsx?$/.test(f)).map((f) => [f, readFileSync(here(`${dir}/${f}`), "utf8")] as const);
const ENGLISH_APPS = [...appsIn("../../../examples"), ...appsIn("../fixtures")];

const POLISH_APP = `import { defineApp } from "potyro";
export default defineApp({
  id: "rosliny", name: "Moje rośliny", version: "1.0.0", schemaVersion: 1,
  entities: { plant: { label: "Roślina", displayField: "name", fields: {
    name: { type: "text", label: "Nazwa", required: true },
    room: { type: "text", label: "Pokój", help: "W którym pokoju stoi" },
    lastWatered: { type: "datetime", label: "Ostatnie podlewanie" },
  } } },
  pages: [{ id: "all", title: "Wszystkie rośliny", view: { type: "list", entity: "plant", display: { primary: "name" } } }],
});`;

function scripted(turns: ChatResponse["choices"][number]["message"][]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } },
  };
}
const userTurn = (req: ChatRequest | undefined): string => req?.messages.find((m) => m.role === "user")?.content ?? "";

describe("which language", () => {
  it("matches a device tag to a language Potyro speaks, on its primary subtag", () => {
    expect(matchLanguage("pl-PL")).toBe("pl");
    expect(matchLanguage("pt")).toBe("pt-BR");
    expect(matchLanguage("pt-PT")).toBe("pt-BR");
    expect(matchLanguage("EN-gb")).toBe("en");
    expect(matchLanguage("de-AT")).toBe("de");
    expect(matchLanguage("fr-FR")).toBeNull();
    expect(matchLanguage(undefined)).toBeNull();
  });

  it("takes the first of the device's languages it speaks, else English", () => {
    expect(bestLanguage(["fr-FR", "it-IT", "en-US"])).toBe("it");
    expect(bestLanguage(["fr-FR"])).toBe("en");
    expect(bestLanguage([])).toBe("en");
  });
});

describe("the create turn", () => {
  it("is exactly what it was for English: no line added", () => {
    const english = `Create a Potyro app for this request:\n\n"a todo list"\n\nReturn only the .app.ts source in one \`\`\`ts block.`;
    expect(buildUserMessage({ id: "x", description: "a todo list" })).toBe(english);
    expect(buildUserMessage({ id: "x", description: "a todo list", language: "en" })).toBe(english);
    expect(createLanguageInstruction(undefined)).toBeNull();
    expect(createLanguageInstruction("en")).toBeNull();
  });

  it("for every other language says to write the app and ask the question in it, keeping code English", () => {
    for (const l of LANGUAGES.filter((x) => x !== "en")) {
      const msg = buildUserMessage({ id: "x", description: "lista zadań", language: l });
      const name = { "pt-BR": "Brazilian Portuguese", de: "German", es: "Spanish", pl: "Polish", it: "Italian" }[l];
      expect(msg).toContain(`LANGUAGE: the person speaks ${name}. Write the app in ${name}`);
      expect(msg).toMatch(/every label, page title, option/);
      expect(msg).toContain("Give every field a `label`");
      expect(msg).toContain("Keep ids, field keys and code identifiers in English");
      expect(msg).toContain(`keep the marker exactly as written and ask the question in ${name}`);
    }
  });
});

describe("a change's language line", () => {
  it("adds nothing when the person and the app are both English", () => {
    expect(changeLanguageInstruction(undefined)).toBeNull();
    expect(changeLanguageInstruction({ person: "en" })).toBeNull();
    expect(changeLanguageInstruction({ person: "en", app: "en" })).toBeNull();
    expect(buildModifyMessage("add a rating", { language: { person: "en", app: "en" } })).toBe(buildModifyMessage("add a rating"));
  });

  it("answers a Polish speaker in Polish and writes a new app's words in Polish when the app's language is unknown", () => {
    const line = changeLanguageInstruction({ person: "pl", app: null })!;
    expect(line).toContain("reply to the person in Polish");
    expect(line).toContain("Keep those markers exactly as written, in English");
    expect(line).toContain("The app's own words are in Polish");
    expect(line).toContain("unless the person asks for another language");
  });

  it("keeps an English app's words English for a Polish speaker", () => {
    const line = changeLanguageInstruction({ person: "pl", app: "en" })!;
    expect(line).toContain("reply to the person in Polish");
    expect(line).toContain("The app's own words are in English");
    expect(line).not.toContain("The app's own words are in Polish");
  });

  it("keeps a Polish app's words Polish for an English speaker, without a reply line", () => {
    const line = changeLanguageInstruction({ person: "en", app: "pl" })!;
    expect(line).not.toContain("reply to the person");
    expect(line).toContain("The app's own words are in Polish");
  });

  it("goes last in the modify message, after the ladder and the comments rule", () => {
    const msg = buildModifyMessage("dodaj ocenę", { language: { person: "pl", app: "pl" } });
    expect(msg.trimEnd().endsWith(changeLanguageInstruction({ person: "pl", app: "pl" })!)).toBe(true);
  });
});

describe("reading an app's language", () => {
  it("reads every example and eval fixture as English, so an English change gets no line", () => {
    for (const [file, src] of ENGLISH_APPS) expect(appLanguage(src), file).toBe("en");
  });

  it("reads a Polish app as Polish, from its labels, titles and help", () => {
    expect(userFacingStrings(POLISH_APP)).toEqual(expect.arrayContaining(["Moje rośliny", "Pokój", "W którym pokoju stoi", "Wszystkie rośliny"]));
    expect(appLanguage(POLISH_APP)).toBe("pl");
  });

  it("tells short labels apart where a word or a letter gives it away, and says unknown when nothing does", () => {
    expect(classifyText("Ocena")).toBe("pl");
    expect(classifyText("Avaliação")).toBe("pt-BR");
    expect(classifyText("Rating")).toBe("en");
    expect(classifyText("Größe")).toBe("de");
    expect(classifyText("Link")).toBeNull();
  });
});

const APP = `export default defineApp({\n  id: "x",\n  name: "Moje rośliny",\n  entities: { plant: { label: "Roślina", fields: { name: { type: "text", label: "Nazwa" } } } },\n});`;
const ENGLISH = `export default defineApp({\n  id: "x",\n  name: "Plants",\n  entities: { plant: { label: "Plant", fields: { name: { type: "text", label: "Name" } } } },\n});`;

describe("the modify loop", () => {
  const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
    engine: scripted([]).engine,
    tools: [],
    system: "contract",
    instruction: "dodaj pokój",
    source: ENGLISH,
    check: async () => [],
    shapeOf: async () => ({ entities: { plant: {} }, pages: [] }),
    before: { entities: { plant: {} }, pages: [] },
    ...over,
  });

  it("is told the person's language in its first message, and the app's own (read off it)", async () => {
    const { engine, seen } = scripted([{ content: "ASK: Który pokój?" }]);
    const out = await runModifyLoop(base({ engine, language: "pl" }));
    expect(out).toMatchObject({ kind: "question", text: "Który pokój?" });
    const first = userTurn(seen[0]);
    expect(first).toContain("reply to the person in Polish");
    expect(first).toContain("The app's own words are in English");
  });

  it("keeps a Polish app Polish", async () => {
    const { engine, seen } = scripted([{ content: "ASK: ?" }]);
    await runModifyLoop(base({ engine, language: "pl", source: APP }));
    expect(userTurn(seen[0])).toContain("The app's own words are in Polish");
  });

  it("takes the app's declared language over what its words look like (the hook #302 fills)", async () => {
    const { engine, seen } = scripted([{ content: "ASK: ?" }]);
    await runModifyLoop(base({ engine, language: "pl", source: ENGLISH, appLanguage: "pt-BR" }));
    expect(userTurn(seen[0])).toContain("The app's own words are in Brazilian Portuguese");
  });

  it("sends the same first message as before for an English person and app", async () => {
    const a = scripted([{ content: "ASK: ?" }]);
    const b = scripted([{ content: "ASK: ?" }]);
    await runModifyLoop(base({ engine: a.engine }));
    await runModifyLoop(base({ engine: b.engine, language: "en" }));
    expect(userTurn(b.seen[0])).toBe(userTurn(a.seen[0]));
    expect(userTurn(a.seen[0])).not.toContain("LANGUAGE:");
  });
});

describe("the fix loop", () => {
  const base = (over: Partial<LoopDeps>): LoopDeps => ({
    engine: scripted([]).engine,
    tools: [],
    system: "contract",
    task: "kliknięcie nic nie robi",
    source: ENGLISH,
    verify: async () => ({ passed: true, detail: "ok" }),
    baseline: { passed: false, detail: "FAILED" },
    ...over,
  });

  it("puts the language line between the person's words and the app, which stays last", async () => {
    const { engine, seen } = scripted([{ content: "ASK: Co powinno się stać?" }]);
    await runAgentLoop(base({ engine, language: "pl" }));
    const first = userTurn(seen[0]);
    expect(first.indexOf("reply to the person in Polish")).toBeGreaterThan(first.indexOf("kliknięcie"));
    expect(first).toMatch(/The app as it is:\n```ts\n[\s\S]*\n```$/);
  });

  it("is unchanged for English", async () => {
    const { engine, seen } = scripted([{ content: "ASK: ?" }]);
    await runAgentLoop(base({ engine, task: "clicking does nothing" }));
    expect(userTurn(seen[0])).toBe(`clicking does nothing\n\nThe app as it is:\n\`\`\`ts\n${ENGLISH}\n\`\`\``);
  });
});

describe("Ask", () => {
  const DEF = { id: "t", name: "T", version: "1.0.0", schemaVersion: 1, entities: { note: { fields: { title: { type: "text" } } } }, pages: [] } as unknown as AppDefinition;
  const system = async (language: string | undefined): Promise<string> => {
    const { engine, seen } = scripted([{ content: "Ok." }]);
    await runAskLoop({ engine, definition: DEF, request: "dodaj coś", context: { today: "2026-10-13", ...(language ? { language } : {}) } });
    return seen[0]!.messages[0]!.content;
  };

  it("is told to reply in the person's language, and to keep real names as the sources write them", async () => {
    const s = await system("pl-PL");
    expect(s).toContain("- Their language: pl-PL");
    expect(s).toContain("Reply to the person in Polish");
    expect(s).toContain("keep the names of real places, businesses and things as your sources write them");
  });

  it("adds nothing for English or a language Potyro does not speak", async () => {
    expect(await system("en-US")).not.toContain("Reply to the person in");
    expect(await system("fr")).not.toContain("Reply to the person in");
    expect(askLanguageInstruction(undefined)).toBeNull();
  });
});

describe("the chat backends", () => {
  it("carry the language into generate, repair and modify", async () => {
    const { engine, seen } = scripted([{ content: "```ts\nx\n```" }, { content: "```ts\nx\n```" }, { content: "ok" }]);
    const backend = new OpenRouterBackend(engine, "m");
    await backend.generate({ id: "a", description: "lista", language: "pl" });
    await backend.repair("x", ["bad"], { id: "a", description: "lista", language: "pl" });
    await backend.modify(ENGLISH, "dodaj", { id: "a", description: "dodaj" }, { language: { person: "pl", app: "en" } });
    expect(seen[0]!.messages[1]!.content).toContain("LANGUAGE: the person speaks Polish");
    expect(seen[1]!.messages[1]!.content).toContain("LANGUAGE: the person speaks Polish");
    expect(seen[2]!.messages.at(-1)!.content).toContain("reply to the person in Polish");
  });
});
