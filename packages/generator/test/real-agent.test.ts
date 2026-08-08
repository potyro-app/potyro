import { expect, test } from "vitest";

// Verifies the Edit-mode contract against the REAL model, not a stub.
//
// Every other test of this contract stubs the endpoint, which proves the plumbing but not the thing
// that actually matters: whether a model, given this contract, declines a host-owned request instead
// of inventing an app-level change. That can only be answered by asking one.
//
// Opt-in — it spends a real `claude -p` call and needs `pnpm dev` running:
//   KARTA_REAL_AGENT=1 pnpm --filter @karta/generator exec vitest run test/real-agent.test.ts
//
// Last run: answered `NOT-IN-APP`, correctly attributing pin animation to packages/views and
// naming the map's declarable surface back.
import { SYSTEM_PROMPT, buildModifyMessage, parseModifyReply, NOT_IN_APP } from "../src/prompt.js";

const APP = `import { defineApp } from "karta";

export default defineApp({
  id: "spots", name: "Spots", version: "1.0.0", schemaVersion: 1,
  entities: { place: { label: "Place", displayField: "name",
    fields: { name: { type: "text", required: true }, loc: { type: "geo" }, tags: { type: "tags", options: ["a","b"] } } } },
  pages: [{ id: "map", title: "Map", view: { type: "map", entity: "place", geo: "loc", title: "name",
    filters: [{ label: "Tags", param: "tag", from: "tags", multi: true }] } }],
});
`;

// A request that is unambiguously HOST behaviour: nothing a map view can declare controls how its
// markers animate in. The contract's whole point is that this comes back as a diagnosis.
const INSTRUCTION = 'Regarding the "Map" page: make the pins fade in one by one as the map loads';

test.skipIf(!process.env.KARTA_REAL_AGENT)("the real model answers NOT-IN-APP for a host-owned request", async () => {
  const prompt = [
    "The current app:", "```ts", APP, "```", "",
    buildModifyMessage(INSTRUCTION, {
      target: { viewType: "map", pageTitle: "Map",
        fields: ["entity", "geo", "title?", "color?", "filter?", "filters?", "onOpen?", "camera?"],
        pageFields: ["title", "hidden?", "summary?"] },
    }),
  ].join("\n");

  const start = await fetch("http://localhost:5173/__generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: SYSTEM_PROMPT, prompt }),
  });
  const { id } = (await start.json()) as { id?: string };
  expect(id, "dev server did not start a job").toBeTruthy();

  let text = "";
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const body = (await (await fetch(`http://localhost:5173/__generate?id=${id}`)).json()) as
      { status?: string; text?: string; error?: string };
    if (body.status === "running") continue;
    if (body.status === "done") { text = body.text ?? ""; break; }
    throw new Error(`generator failed: ${body.error}`);
  }

  const reply = parseModifyReply(text);
  console.log("\n>>> RAW REPLY (first 700 chars):\n" + text.slice(0, 700));
  console.log("\n>>> PARSED AS:", reply.kind);
  if (reply.kind === "diagnosis") console.log(">>> DIAGNOSIS:", reply.text.slice(0, 400));
  console.log(">>> contains marker at line start:", new RegExp(`^\\s*${NOT_IN_APP}`, "m").test(text));
}, 320_000);
