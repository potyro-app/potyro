// "Fix this" on an app made of several files (#448), as the Studio's modify does it: the agent is
// shown every file joined under marker lines, a candidate is split back into its files before it is
// verified, and the fix comes back as the entry plus the modules it changed — never the joined text.
import { describe, expect, it, vi } from "vitest";
import { addStep, newCase } from "@potyro/runtime";
import { lockEntryFor, srcKey, type AppLock } from "@potyro/store";
import { memoryModules, type ModuleSource } from "../src/package-modules.js";
import { DEFAULT_ENGINE_CONFIG } from "../src/engines.js";

const mocks = vi.hoisted(() => ({ chatCreate: vi.fn(), verified: [] as Array<{ source: string; card: string | null }> }));

vi.mock("@potyro/generator/backends", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@potyro/generator/backends")>()),
  createOpenRouterEngine: () => ({ chat: { completions: { create: mocks.chatCreate } } }),
}));
// What the gate was handed: the entry, and the module as the candidate has it.
vi.mock("../src/verify-candidate.js", () => ({
  verifyCandidate: async (deps: { source: string; modules?: ModuleSource }) => {
    const entry = deps.modules?.lock[srcKey("card.ts")];
    const bytes = entry ? await deps.modules!.read(entry.file) : null;
    mocks.verified.push({ source: deps.source, card: bytes ? new TextDecoder().decode(bytes) : null });
    return { passed: true, detail: "ok: the case passes" };
  },
}));

const { startFix } = await import("../src/start-fix.js");

const enc = (s: string) => new TextEncoder().encode(s);
const ENTRY = 'import { size } from "./card.ts";\nexport default size;\n';
const CARD = "export const size = 0;\n";
const FIXED = "export const size = 12;\n";

async function modulesOf(src: Record<string, string>): Promise<ModuleSource> {
  const lock: AppLock = {};
  const files = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(src)) {
    lock[srcKey(path)] = await lockEntryFor(`.src/${path}`, enc(text));
    files.set(`.src/${path}`, enc(text));
  }
  return memoryModules(lock, files);
}

// The recorded case opens a page the app does not have: the baseline fails, so a passing candidate is a fix.
const theCase = addStep(newCase("cards", "the cards are too small"), { kind: "open", page: "nowhere" });
const runtime = {
  definition: { pages: [{ id: "all", title: "Cards", view: { type: "list", entity: "card" } }] },
  queryPage: async () => ({ rows: [], ctx: {} }),
  ctx: { query: async () => [] },
} as never;
const engine = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter" as const, openrouterKey: "test-key" };
const reply = (content: string) => ({ choices: [{ message: { content } }] });

describe("Fix this on an app made of several files", () => {
  it("shows every file, verifies the candidate as files, and returns the module it changed", async () => {
    mocks.chatCreate.mockResolvedValue(
      reply(["The size is 0 in card.ts.", "```ts", "<<<<<<< SEARCH", CARD.trimEnd(), "=======", FIXED.trimEnd(), ">>>>>>> REPLACE", "```"].join("\n")),
    );
    const out = await startFix({ source: ENTRY, theCase, runtime, store: {} as never, engine, modules: await modulesOf({ "card.ts": CARD }) });

    const opening = (mocks.chatCreate.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }> }).messages.find((m) => m.role === "user")!.content;
    expect(opening).toContain("//// FILE: card.ts");
    expect(opening).toMatch(/This app is 2 files/);
    expect(mocks.verified.at(-1)).toEqual({ source: ENTRY, card: FIXED });
    expect(out).toMatchObject({ kind: "fix", source: ENTRY, modules: { "card.ts": FIXED } });
  });
});
