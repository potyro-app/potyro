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
import type { GenPrompt, ModelBackend } from "./backend.js";
import { SYSTEM_PROMPT, buildModifyMessage, buildRepairMessage, buildUserMessage, extractSource } from "./prompt.js";

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
}

/** Run `claude -p`, feeding the user message on stdin and the contract as the system prompt. */
async function runClaude(userMessage: string, opts: CliBackendOptions): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "karta-cli-"));
  const sysFile = join(dir, "system.txt");
  writeFileSync(sysFile, opts.systemPrompt ?? SYSTEM_PROMPT);

  const args = [
    "-p",
    "--system-prompt-file",
    sysFile,
    "--output-format",
    "text",
    "--disallowedTools",
    ...NO_TOOLS,
  ];
  if (opts.model) args.push("--model", opts.model);

  try {
    return await new Promise<string>((resolve, reject) => {
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class ClaudeCliBackend implements ModelBackend {
  readonly name: string;

  constructor(private readonly opts: CliBackendOptions = {}) {
    this.name = `claude-cli:${opts.model ?? "default"}${opts.systemPrompt ? "+budget" : ""}`;
  }

  async generate(prompt: GenPrompt): Promise<string> {
    return extractSource(await runClaude(buildUserMessage(prompt), this.opts));
  }

  // The CLI is stateless per invocation, so prior turns are replayed inline as context.
  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    const msg = [
      buildUserMessage(prompt),
      "",
      "You previously produced this app:",
      "```ts",
      source,
      "```",
      "",
      buildRepairMessage(errors),
    ].join("\n");
    return extractSource(await runClaude(msg, this.opts));
  }

  async modify(source: string, instruction: string, prompt: GenPrompt): Promise<string> {
    const msg = [
      buildUserMessage(prompt),
      "",
      "You previously produced this app:",
      "```ts",
      source,
      "```",
      "",
      buildModifyMessage(instruction),
    ].join("\n");
    return extractSource(await runClaude(msg, this.opts));
  }
}
