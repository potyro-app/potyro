import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";
import { NEEDS_PLATFORM } from "../src/agent/platform-request.js";

// #263: NEEDS-PLATFORM in the modify loop. The harness offers it where it has evidence — a rolled-
// back repeat, a failure that names something Potyro lacks — and one last tools-off call writes the
// request. Engines are scripted; nothing calls a model.

const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { plant: {} },", "});"].join("\n");
const edit = (prose: string, search: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\n`;
const rename = (to: string, prose = `Rename to ${to}.`) => ({ content: edit(prose, '  id: "x",', `  id: "${to}",`) });
const lookupCall = (q: string) => ({ content: "", tool_calls: [{ id: `l-${q}-${Math.random()}`, type: "function" as const, function: { name: "lookup", arguments: JSON.stringify({ query: q }) } }] });
const WRITTEN = { content: "TITLE: Scan barcodes\nI wanted to scan the barcode on a pot so the plant fills itself in." };

type Turn = ChatResponse["choices"][number]["message"];
function scripted(turns: Turn[]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } },
  };
}

/** A lookup that finds nothing for "barcode", like the real one. */
const lookup: AgentTool = {
  name: "lookup",
  description: "look",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  run: async (a) =>
    String(a.query).includes("barcode")
      ? { ok: true, detail: `Nothing in the potyro module is called "barcode" or declares a "barcode". It does not exist.` }
      : { ok: true, detail: `declaration of ${String(a.query)}` },
};

const picky = async (src: string): Promise<string[]> => (/id: "(ok|good)"/.test(src) || src === SOURCE ? [] : [`id must be "ok"`]);

const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
  engine: scripted([]).engine,
  tools: [lookup],
  system: "contract",
  instruction: "let me scan the barcode on a pot",
  source: SOURCE,
  check: picky,
  shapeOf: async () => ({ entities: { plant: {} }, pages: [] }),
  before: { entities: { plant: {} }, pages: [] },
  ...over,
});

describe("the harness offers NEEDS-PLATFORM where it has evidence (#263)", () => {
  it("beside a lookup that found nothing, once", async () => {
    const { engine, seen } = scripted([lookupCall("barcode"), lookupCall("barcodes scanner"), rename("ok")]);
    await runModifyLoop(base({ engine }));
    const results = seen[2]!.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(results[0]).toContain(NEEDS_PLATFORM);
    // Once: the second finding is said as it was.
    expect(results[1]).not.toContain(NEEDS_PLATFORM);
  });

  it("not when nothing points at Potyro", async () => {
    const { engine, seen } = scripted([lookupCall("camera"), rename("ok")]);
    await runModifyLoop(base({ engine }));
    expect(seen.flatMap((r) => r.messages).some((m) => m.content.includes(NEEDS_PLATFORM))).toBe(false);
  });

  it("beside a candidate a run turned back for a missing ctx member", async () => {
    const run = async () => ({ report: { errors: ["TypeError: ctx.caps.barcode is not a function"], warnings: [], ran: "1 computed" }, preexisting: { errors: [], warnings: [] } });
    const { engine, seen } = scripted([rename("good"), rename("ok", "Another go.")]);
    await runModifyLoop(base({ engine, run: run as unknown as ModifyLoopDeps["run"] }));
    expect(seen[1]!.messages.at(-1)!.content).toContain(NEEDS_PLATFORM);
  });

  it("on a rolled-back repeat, as one of the ways out", async () => {
    const { engine, seen } = scripted([rename("bad"), rename("bad"), rename("ok")]);
    await runModifyLoop(base({ engine }));
    expect(seen[2]!.messages.at(-1)!.content).toContain(NEEDS_PLATFORM);
  });
});

describe("a NEEDS-PLATFORM answer (#263)", () => {
  it("alone: nothing changes, and one last call with the tools off writes the request", async () => {
    const { engine, seen } = scripted([lookupCall("barcode"), { content: `${NEEDS_PLATFORM} reading barcodes with the camera` }, WRITTEN]);
    const out = await runModifyLoop(base({ engine, language: "pl" }));
    expect(out).toEqual({
      kind: "platform",
      request: { title: "Scan barcodes", body: "I wanted to scan the barcode on a pot so the plant fills itself in." },
      said: "reading barcodes with the camera",
    });
    const last = seen.at(-1)!;
    expect(last.tool_choice).toBe("none");
    expect(last.messages.at(-1)!.content).toContain("Polish");
    expect(last.messages.at(-1)!.content).toContain("reading barcodes with the camera");
  });

  it("beside edits: the change is kept, with the request", async () => {
    const prose = "Added a barcode field.\nNot done:\n- scanning it with the camera, because Potyro cannot read barcodes\nNEEDS-PLATFORM: reading barcodes with the camera";
    const { engine } = scripted([lookupCall("barcode"), rename("ok", prose), WRITTEN]);
    const out = await runModifyLoop(base({ engine }));
    expect(out.kind).toBe("source");
    if (out.kind !== "source") return;
    expect(out.source).toContain('id: "ok"');
    expect(out.notDone).toEqual(["scanning it with the camera, because Potyro cannot read barcodes"]);
    expect(out.platformRequest).toEqual({ title: "Scan barcodes", body: "I wanted to scan the barcode on a pot so the plant fills itself in." });
  });

  it("without having looked, it is sent to the tools first — like NOT-IN-APP", async () => {
    const { engine, seen } = scripted([{ content: `${NEEDS_PLATFORM} barcodes` }, { content: `${NEEDS_PLATFORM} barcodes` }, WRITTEN]);
    const out = await runModifyLoop(base({ engine }));
    expect(seen[1]!.messages.at(-1)!.content).toMatch(/use the tools/);
    expect(out.kind).toBe("platform");
  });
});

describe("giving up after Potyro was named as lacking it (#263, docs/19 F7)", () => {
  it("one last tools-off call may turn the give-up into a request", async () => {
    const { engine, seen } = scripted([lookupCall("barcode"), rename("bad1"), rename("bad2"), rename("bad3"), rename("bad4"), { content: `${NEEDS_PLATFORM}\nTITLE: Scan barcodes\nI wanted to scan.` }]);
    const out = await runModifyLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "failed", cause: "candidates", platformRequest: { title: "Scan barcodes", body: "I wanted to scan." } });
    expect(seen.at(-1)!.tool_choice).toBe("none");
  });

  it("and stays a plain give-up when the model says it is not Potyro's", async () => {
    const { engine } = scripted([lookupCall("barcode"), rename("bad1"), rename("bad2"), rename("bad3"), rename("bad4"), { content: "NO" }]);
    const out = await runModifyLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "failed", cause: "candidates" });
    expect(out.kind === "failed" && out.platformRequest).toBeFalsy();
  });

  it("no last call when nothing pointed at Potyro", async () => {
    const { engine, seen } = scripted([rename("bad1"), rename("bad2"), rename("bad3"), rename("bad4")]);
    const out = await runModifyLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "failed", cause: "candidates" });
    expect(seen).toHaveLength(4);
  });
});
