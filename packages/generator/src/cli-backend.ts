// A ModelBackend that shells out to the `claude` CLI in print mode (`claude -p`) instead of the
// Messages API — no ANTHROPIC_API_KEY required, it rides the user's existing CLI auth. Useful for
// running the eval corpus locally/ad-hoc; `ClaudeBackend` remains the path for the product.
//
// The CLI's own agent system prompt is REPLACED (not appended) with SYSTEM_PROMPT so the model is a
// generator, not a coding agent, and tools are disallowed so it can never wander into the repo.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenPrompt } from "./backend.js";
import { SYSTEM_PROMPT, buildModifyMessage, buildRepairMessage, buildUserMessage, extractSource } from "./prompt.js";
import { UNKNOWN_USAGE, type CallUsage, type MeteredBackend, type MeteredRequest, type MeteredResult } from "./model-call.js";

const DEFAULT_TIMEOUT_MS = 300_000;
const NO_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task"];

export interface CliBackendOptions {
  /** Model alias passed to `claude --model` (e.g. "opus", "sonnet"). Omit for the CLI default. */
  model?: string;
  /** Override the contract taught to the model (e.g. SYSTEM_PROMPT_BUDGETED). */
  systemPrompt?: string;
  timeoutMs?: number;
  /** Path to the CLI binary; override for testing. */
  bin?: string;
  /**
   * Ask for `--output-format json` so the call reports tokens, cost and the model that answered.
   *
   * OFF by default, which is a statement about risk rather than about the flag: `eval:cli` and the
   * Studio have run against `--output-format text` since this file existed, and silently changing
   * the invocation every existing measurement was taken under is not something to do as a side
   * effect. `eval:modify` turns it on, because a paid corpus with no cost line is the thing it was
   * written to avoid.
   *
   * The envelope only WRAPS the same generation — same contract, same disallowed tools, same
   * stdin — so a metered and an unmetered call produce the same source.
   */
  metered?: boolean;
}

/**
 * The `--output-format json` envelope, as much of it as this file relies on.
 *
 * Everything is optional. A CLI that changed the shape must degrade to "unknown cost", never to a
 * failed call: accounting is a reason to report less, not a reason to lose a generation that has
 * already been paid for.
 */
interface CliJsonResult {
  result?: unknown;
  is_error?: unknown;
  total_cost_usd?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
    cache_read_input_tokens?: unknown;
  };
  modelUsage?: Record<string, unknown>;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Sum the input-side counters that are present, or null when none are. Cache tokens are input. */
function inputTokens(usage: CliJsonResult["usage"]): number | null {
  const parts = [usage?.input_tokens, usage?.cache_creation_input_tokens, usage?.cache_read_input_tokens]
    .map(num)
    .filter((n): n is number => n !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/**
 * Read the text and the usage out of whatever the CLI printed.
 *
 * A stdout that does not parse is treated as the TEXT, with unknown usage — an older CLI that
 * ignores the flag, or a future one that changes the envelope, should cost a cost line and not a
 * generation.
 */
export function parseCliOutput(stdout: string): { text: string; usage: CallUsage } {
  let parsed: CliJsonResult;
  try {
    parsed = JSON.parse(stdout) as CliJsonResult;
  } catch {
    return { text: stdout, usage: UNKNOWN_USAGE };
  }
  if (typeof parsed !== "object" || parsed === null || typeof parsed.result !== "string") {
    return { text: stdout, usage: UNKNOWN_USAGE };
  }
  if (parsed.is_error === true) throw new Error(`claude -p reported an error: ${parsed.result.slice(0, 500)}`);

  const models = Object.keys(parsed.modelUsage ?? {});
  return {
    text: parsed.result,
    usage: {
      model: models.length === 1 ? models[0]! : models.length ? models.join("+") : null,
      inputTokens: inputTokens(parsed.usage),
      outputTokens: num(parsed.usage?.output_tokens),
      costUsd: num(parsed.total_cost_usd),
    },
  };
}

export { claudeCliAvailable } from "./cli-available.js";

/** Run `claude -p`, feeding the user message on stdin and the contract as the system prompt. */
async function runClaude(userMessage: string, opts: CliBackendOptions): Promise<{ text: string; usage: CallUsage }> {
  const dir = mkdtempSync(join(tmpdir(), "karta-cli-"));
  const sysFile = join(dir, "system.txt");
  writeFileSync(sysFile, opts.systemPrompt ?? SYSTEM_PROMPT);

  const args = [
    "-p",
    "--system-prompt-file",
    sysFile,
    "--output-format",
    opts.metered ? "json" : "text",
    "--disallowedTools",
    ...NO_TOOLS,
  ];
  if (opts.model) args.push("--model", opts.model);

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(opts.bin ?? "claude", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`claude -p timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`));
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout.on("data", (c) => (stdout += String(c)));
      child.stderr.on("data", (c) => (stderr += String(c)));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`claude -p exited ${code}: ${stderr.slice(0, 500)}`));
        else resolve(stdout);
      });

      child.stdin.write(userMessage);
      child.stdin.end();
    });
    return opts.metered ? parseCliOutput(stdout) : { text: stdout, usage: UNKNOWN_USAGE };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class ClaudeCliBackend implements MeteredBackend {
  readonly name: string;

  constructor(private readonly opts: CliBackendOptions = {}) {
    this.name = `claude-cli:${opts.model ?? "default"}${opts.systemPrompt ? "+budget" : ""}`;
  }

  /** The prompt for one request. The CLI is stateless per invocation, so prior turns ride inline. */
  private message(req: MeteredRequest): string {
    if (req.kind === "generate") return buildUserMessage(req.prompt);
    return [
      buildUserMessage(req.prompt),
      "",
      "You previously produced this app:",
      "```ts",
      req.source,
      "```",
      "",
      req.kind === "repair" ? buildRepairMessage(req.errors) : buildModifyMessage(req.instruction),
    ].join("\n");
  }

  async meteredCall(req: MeteredRequest): Promise<MeteredResult> {
    const { text, usage } = await runClaude(this.message(req), this.opts);
    return { source: extractSource(text), usage };
  }

  async generate(prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "generate", prompt })).source;
  }

  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "repair", source, errors, prompt })).source;
  }

  async modify(source: string, instruction: string, prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "modify", source, instruction, prompt })).source;
  }
}
