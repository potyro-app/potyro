// Run a model backend over a prompt corpus and aggregate pass rates. The repair loop models the
// "valid after ≤N repairs" metric: while the source doesn't validate and the backend can repair,
// feed the errors back (bounded by maxRepairs).

import type { GenPrompt, ModelBackend } from "./backend.js";
import { scoreSource, type ScoreResult } from "./score.js";

export interface PromptOutcome {
  prompt: GenPrompt;
  singlePass: ScoreResult;
  repairsUsed: number;
  final: ScoreResult;
}

export interface EvalReport {
  backend: string;
  total: number;
  /** validates on the first attempt */
  singlePassValid: number;
  /** validates within maxRepairs */
  validWithinN: number;
  /** final result renders */
  renders: number;
  maxRepairs: number;
  outcomes: PromptOutcome[];
}

export async function runEval(backend: ModelBackend, prompts: GenPrompt[], opts?: { maxRepairs?: number }): Promise<EvalReport> {
  const maxRepairs = opts?.maxRepairs ?? 2;
  const outcomes: PromptOutcome[] = [];

  for (const prompt of prompts) {
    let source = await backend.generate(prompt);
    const singlePass = await scoreSource(source);

    let final = singlePass;
    let repairsUsed = 0;
    while (!final.validates && repairsUsed < maxRepairs && backend.repair) {
      source = await backend.repair(source, final.errors, prompt);
      repairsUsed += 1;
      final = await scoreSource(source);
    }

    outcomes.push({ prompt, singlePass, repairsUsed, final });
  }

  return {
    backend: backend.name,
    total: prompts.length,
    singlePassValid: outcomes.filter((o) => o.singlePass.validates).length,
    validWithinN: outcomes.filter((o) => o.final.validates).length,
    renders: outcomes.filter((o) => o.final.renders).length,
    maxRepairs,
    outcomes,
  };
}

/** Compact, human-readable summary for logging a run. */
export function formatReport(report: EvalReport): string {
  const pct = (n: number) => `${Math.round((n / Math.max(report.total, 1)) * 100)}%`;
  return [
    `backend: ${report.backend}  (n=${report.total}, maxRepairs=${report.maxRepairs})`,
    `  single-pass valid: ${report.singlePassValid}/${report.total} (${pct(report.singlePassValid)})`,
    `  valid ≤${report.maxRepairs} repairs: ${report.validWithinN}/${report.total} (${pct(report.validWithinN)})`,
    `  renders: ${report.renders}/${report.total} (${pct(report.renders)})`,
  ].join("\n");
}
