// Public surface of the fixing agent — the loop, the tool machinery it runs on, and the app-aware
// tools it can be wired up with. Split out from the package's main barrel (index.ts) rather than
// bolted onto it: the loop and its tools are what a caller like @karta/shell needs to actually run
// the agent, while the main barrel is the eval harness (score.ts / run-eval.ts), which pulls in
// esbuild + node:fs and must never reach a browser bundle. This file re-exports nothing from there.
//
// Everything reachable from here was traced for Node-only imports before this file was added — see
// the KA task report (.superpowers/sdd/agent-seam-report.md) for the full chain. It is a graph, not
// a line, and both branches have to stay clean:
//
//   loop.ts          -> tools.ts                      (tools.ts imports nothing of its own)
//   loop.ts          -> ../guarded-modify.js -> @karta/runtime, ../edits.js, ../prompt.js
//   loop.ts          -> ../edits.js                   (describeEditFailures, directly)
//                       — the fix loop reads the model's candidates as EDITS, through the same
//                       reader the Studio uses
//   app-tools.ts     -> @karta/runtime, and `import type` from tools.ts — its own branch, reached
//                       from this barrel directly, never through loop.ts
//   system-prompt.ts -> ../edits.js (EDIT_FORMAT), ../prompt.js (SYSTEM_PROMPT)
//   modify-loop.ts   -> tools.ts, ../guarded-modify.js, ../edits.js, ../prompt.js, @karta/runtime
//                       (structuralLoss) — the modify loop (#131), same edges as loop.ts
//   discovery-tools.ts -> ../reference.generated.js (a string), ../prompt.js (the examples), karta
//                       (VIEW_FIELDS), and `import type` from tools.ts
//   modify-system-prompt.ts -> ../prompt.js (SYSTEM_PROMPT)
//   ask.ts           -> karta (fieldValueProblem, humanizeKey), tools.ts, and `import type` from
//                       ../chat-backend.js — Ask (#213)
//
// Along every one of those, each cross-package import is either `import type` (erased at build
// time) or a real value import that bottoms out in `karta` (zod only) or `react` — nothing here
// imports esbuild, node:fs, or any other Node-only module. `../score.js` and `../run-eval.ts` are
// the Node-only side of the package and are reachable only from the main barrel, never from here.

export { runAgentLoop, type LoopOutcome, type LoopStep, type LoopDeps } from "./loop.js";
export { AGENT_SYSTEM_PROMPT } from "./system-prompt.js";
export { runTool, toolSpecs, type AgentTool, type ToolSpec, type ToolCall, type ToolResult } from "./tools.js";
export { buildAppTools, allowsRawRecords, type InvestigationDeps, type DataAccess } from "./app-tools.js";
export { runModifyLoop, type ModifyLoopDeps, type ModifyLoopOutcome } from "./modify-loop.js";
export { MODIFY_AGENT_SYSTEM_PROMPT } from "./modify-system-prompt.js";
export { buildDiscoveryTools, lookupReference, type DiscoveryDeps } from "./discovery-tools.js";
export { runAskLoop, checkProposal, checkProposedRows, describeStructure, askSystemPrompt, ASK_SYSTEM_PROMPT, type AskLoopDeps, type AskOutcome, type AskContext, type AskStep, type Proposal, type ProposedRow, type ProposedAction, type AskSource, type SourceFetch, type SourceRequest } from "./ask.js";
export type { ChatMessage, Citation } from "../chat-backend.js";
export { verifyRow, Retrieved, normText, type Evidence, type Trust, type TrustStatus } from "./evidence.js";
export { verifyClaims } from "./verify-claims.js";
