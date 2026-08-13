// Turning a run into something a founder can read on a Sunday.
//
// The JSON report holds everything, which is the same as saying it holds nothing you can act on: a
// chain is four sources, a dozen findings and eleven numbers, and nobody opens that to decide
// whether AI editing is safe enough to put in front of a stranger. So the run also writes a Markdown
// sheet — the verdict per modification, the finding in words, the cost, and a link to the exact
// source each step produced, because the first honest reaction to any number here is "show me".
//
// The human column is deliberately EMPTY. The mechanical checks answer "did it break something";
// only a person answers "did it do what I asked, well". A sheet that pre-filled that would be
// inviting somebody to agree with it.

import type { ModifyReport, ScenarioRun, StepResult } from "./modify-eval.js";

/** Where a step's source is written, relative to the report. One definition, two callers. */
export function artifactPath(run: ScenarioRun, step: number | "generated"): string {
  const stem = `${run.scenario}-a${run.attempt}`;
  return step === "generated" ? `${stem}/00-generated.app.tsx` : `${stem}/${String(step).padStart(2, "0")}-modification.app.tsx`;
}

/** Where the invalid draft a repair was handed is written. Absent when no repair ran. */
export function rejectedPath(run: ScenarioRun, step: number | "generated"): string {
  return artifactPath(run, step).replace(/\.app\.tsx$/, "-before-repair.app.tsx");
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const pct = (n: number, of: number): string => (of === 0 ? "n/a" : `${Math.round((n / of) * 100)}%`);

/** A number the backend reported, or the word that means nobody knows. Never an estimate. */
const known = (n: number | null, format: (v: number) => string): string => (n === null ? "unknown" : format(n));
const usd = (n: number | null): string => known(n, (v) => `$${v.toFixed(4)}`);
const tokens = (n: number | null): string => known(n, (v) => v.toLocaleString("en-US"));

const VERDICT_MARK: Record<StepResult["verdict"], string> = {
  clean: "✅ clean",
  review: "🟡 review",
  failed: "❌ failed",
};

/** The short console summary — what a run prints when it finishes. */
export function formatModifyReport(r: ModifyReport): string {
  const t = r.totals;
  const lines = [
    `backend: ${r.backend}${r.models.length ? ` · model ${r.models.join(", ")}` : " · model unknown"}`,
    `${r.calls.total} model calls (${r.calls.generate} generate, ${r.calls.modify} modify, ${r.calls.repair} repair, ${r.calls.failed} failed) in ${secs(r.durationMs)}`,
    `cost: ${usd(r.usage.costUsd)}${r.usage.costEnforceable ? "" : ` — NOT enforceable: ${r.usage.unmeteredCalls} call(s) reported no cost`}`,
    ``,
    `chains where all 3 modifications held: ${t.chainsFullyClean}/${t.scenarios} (${pct(t.chainsFullyClean, t.scenarios)})`,
    ``,
    `of ${t.modifications} modifications attempted:`,
    `  valid            ${t.valid} (${pct(t.valid, t.modifications)})   — compiles and validates`,
    `  works            ${t.works} (${pct(t.works, t.modifications)})   — every computed/filter/action runs`,
    `  records survived ${t.recordsSurvived} (${pct(t.recordsSurvived, t.modifications)})   — every record still stored`,
    `  values survived  ${t.valuesSurvived} (${pct(t.valuesSurvived, t.modifications)})   — no unexplained field change`,
    `  still reachable  ${t.stillReachable} (${pct(t.stillReachable, t.modifications)})   — still gettable from a page`,
    `  nothing empty    ${t.noEmptyPages} (${pct(t.noEmptyPages, t.modifications)})   — no page filtered everything away`,
    `  feature works    ${t.featurePassed}/${t.featureChecked} (${pct(t.featurePassed, t.featureChecked)})   — where asserted`,
    `  needs review     ${t.needsReview}   — nothing failed, but a person must decide`,
  ];
  if (r.partial) lines.push(``, `PARTIAL RUN — stopped: ${r.stoppedBecause}`);

  for (const run of r.runs) {
    if (!run.generated) {
      lines.push(``, `✗ ${run.scenario} #${run.attempt}: ${run.stoppedBecause ?? "the app never generated"}`);
      continue;
    }
    const bad = run.steps.filter((s) => s.verdict !== "clean");
    if (!bad.length && !run.stoppedBecause) continue;
    lines.push(``, `${run.scenario} #${run.attempt}${run.stoppedBecause ? ` — stopped: ${run.stoppedBecause}` : ""}:`);
    for (const s of bad) {
      lines.push(`  ${s.index}. "${s.instruction.slice(0, 66)}…" → ${VERDICT_MARK[s.verdict]}`);
      for (const f of s.findings.slice(0, 3)) lines.push(`       ${f.slice(0, 160)}`);
    }
  }
  return lines.join("\n");
}

/** One step's model calls, as a line of prose with the numbers in it. */
function callLine(step: StepResult): string {
  if (!step.calls.length) return "- no model call was made (the run had already stopped)";
  return step.calls
    .map(
      (c) =>
        `- **${c.kind}** · ${secs(c.durationMs)} · ${tokens(c.inputTokens)} in / ${tokens(c.outputTokens)} out · ${usd(c.costUsd)}` +
        `${c.model ? ` · ${c.model}` : " · model unknown"}${c.failed ? ` · **FAILED**: ${c.error ?? ""}` : ""}`,
    )
    .join("\n");
}

/** What the value-level comparison found, in a sentence or two rather than a table of ids. */
function dataLine(step: StepResult): string[] {
  const d = step.data;
  if (!d) return ["- data: not compared — the step never produced a valid app to migrate to"];
  const out = [
    `- data: ${d.lostRecords.length ? `**${d.lostRecords.length} record(s) NO LONGER STORED**` : "every record still stored"}` +
      ` · ${d.unexplained.length ? `**${d.unexplained.length} unexplained value change(s)**` : "no unexplained value change"}` +
      ` · ${step.unreachableIds.length ? `**${step.unreachableIds.length} unreachable**` : "all reachable"}` +
      // Named in the summary as well as below it: "no unexplained value change" beside an orphaned
      // field reads as a contradiction, and the summary line is the one people skim.
      (d.orphanedFields.length ? ` · **${d.orphanedFields.length} field(s) stranded**` : ""),
  ];
  if (d.renamedEntities.length) out.push(`- renamed entities: ${d.renamedEntities.map((r) => `${r.from}→${r.to}`).join(", ")}`);
  if (d.renamedFields.length) {
    out.push(`- renamed fields: ${d.renamedFields.map((r) => `${r.entity}.${r.from}→${r.to}`).join(", ")}`);
  }
  if (d.removedEntities.length) out.push(`- entities left holding nothing: ${d.removedEntities.join(", ")}`);
  if (d.removedFields.length) {
    out.push(
      `- removed fields: ${d.removedFields
        .map((f) => `${f.entity}.${f.field}${f.explained ? ` (${f.explained})` : " — **nothing declared it**"}`)
        .join(", ")}`,
    );
  }
  if (d.orphanedFields.length) {
    out.push(
      `- **stored but no longer declared** (the record is fine, the values are unreachable): ${d.orphanedFields
        .map((f) => `${f.entity}.${f.field} on ${f.records} record(s)`)
        .join(", ")}`,
    );
  }
  if (d.opaqueTransform) {
    out.push("- the migration ran a `transform`, so no value change in this step can be attributed mechanically");
  }
  for (const c of d.unexplained.slice(0, 5)) {
    out.push(
      `  - \`${c.entity}.${c.field}\` on \`${c.id}\`: ${JSON.stringify(c.before)} → ${
        "after" in c ? JSON.stringify(c.after) : "**gone**"
      }`,
    );
  }
  if (d.unexplained.length > 5) out.push(`  - …and ${d.unexplained.length - 5} more`);
  return out;
}

/** The Markdown review sheet: every step, its verdict, its cost, and a link to its source. */
export function reviewSheet(r: ModifyReport): string {
  const t = r.totals;
  const md: string[] = [
    `# Modification chains — ${r.backend}`,
    ``,
    `${r.startedAt} → ${r.endedAt} · ${secs(r.durationMs)}`,
    ``,
    `Model: ${r.models.length ? r.models.join(", ") : "**unknown** — the backend did not say"}`,
    ``,
    ...(r.partial
      ? [`> **PARTIAL RUN.** Stopped: ${r.stoppedBecause}. The numbers below describe less than was asked for.`, ``]
      : []),
    `## Safety gates`,
    ``,
    `These are the ones that stop a pilot. A miss here is not an average to improve, it is a defect to fix.`,
    ``,
    `| gate | result |`,
    `| --- | --- |`,
    `| every pre-existing record still stored | ${t.recordsSurvived}/${t.modifications} (${pct(t.recordsSurvived, t.modifications)}) |`,
    `| every stored value survives or is flagged | ${t.valuesSurvived + t.needsReview}/${t.modifications} — ${t.valuesSurvived} clean, ${t.needsReview} flagged for review |`,
    `| every surviving record still reachable | ${t.stillReachable}/${t.modifications} (${pct(t.stillReachable, t.modifications)}) |`,
    ``,
    `## Usefulness`,
    ``,
    `| measure | result |`,
    `| --- | --- |`,
    `| chains with all 3 modifications clean | ${t.chainsFullyClean}/${t.scenarios} |`,
    `| modifications that compile and validate | ${t.valid}/${t.modifications} |`,
    `| modifications whose logic runs | ${t.works}/${t.modifications} |`,
    `| pages that still show something | ${t.noEmptyPages}/${t.modifications} |`,
    `| behavioural assertions passed | ${t.featurePassed}/${t.featureChecked} |`,
    `| human score ≥2 | _fill in below_ |`,
    ``,
    `## What it cost`,
    ``,
    `| | |`,
    `| --- | --- |`,
    `| model calls | ${r.calls.total} (${r.calls.generate} generate · ${r.calls.modify} modify · ${r.calls.repair} repair · ${r.calls.failed} failed) |`,
    `| wall clock | ${secs(r.durationMs)} |`,
    `| input tokens | ${tokens(r.usage.inputTokens)} |`,
    `| output tokens | ${tokens(r.usage.outputTokens)} |`,
    `| reported cost | ${usd(r.usage.costUsd)} |`,
    `| cost per fully clean chain | ${
      r.usage.costUsd !== null && t.chainsFullyClean > 0 ? usd(r.usage.costUsd / t.chainsFullyClean) : "unknown"
    } |`,
    ``,
    r.usage.costEnforceable
      ? `Every call reported a cost, so the figure above is spend and a monetary ceiling was enforceable.`
      : `**${r.usage.unmeteredCalls} of ${r.calls.total} calls reported no cost**, so the figure above is a floor, not a bill. ` +
        `A monetary ceiling could not be enforced on this run — call count and duration are what is measured. ` +
        `Reconcile the real spend before deciding whether to run more.`,
    ``,
  ];

  for (const run of r.runs) {
    md.push(`---`, ``, `## ${run.scenario} · attempt ${run.attempt}`, ``, `**Asked for:** ${run.request}`, ``);
    if (!run.generated) {
      md.push(`❌ **The app never generated.** ${run.stoppedBecause ?? ""}`, ``);
      for (const e of run.generation.errors.slice(0, 3)) md.push(`- \`${e.slice(0, 300)}\``);
      md.push(``);
      continue;
    }
    md.push(
      `Generated in ${secs(run.generation.calls.reduce((a, c) => a + c.durationMs, 0))}` +
        `${run.generation.repaired ? " (needed the one auto-repair)" : ""} → [source](${artifactPath(run, "generated")})`,
      ``,
      `| # | change asked for | verdict | source |`,
      `| --- | --- | --- | --- |`,
    );
    for (const s of run.steps) {
      md.push(
        `| ${s.index} | ${s.instruction.replace(/\|/g, "\\|")} | ${VERDICT_MARK[s.verdict]} | ${
          s.sourceAfter ? `[after](${artifactPath(run, s.index)})` : "—"
        } |`,
      );
    }
    if (run.stoppedBecause) md.push(``, `> **Chain stopped early:** ${run.stoppedBecause}`);
    md.push(``);

    for (const s of run.steps) {
      md.push(
        `### ${run.scenario} ${s.index}. ${VERDICT_MARK[s.verdict]}`,
        ``,
        `> ${s.instruction}`,
        ``,
        callLine(s),
        `- source: [before](${s.index === 1 ? artifactPath(run, "generated") : artifactPath(run, s.index - 1)})` +
          `${s.sourceAfter ? ` → [after](${artifactPath(run, s.index)})` : " → nothing valid was produced"}`,
        // The link is only offered when the draft was actually kept — a repair whose own call
        // failed has nothing on disk, and a dead link in a review sheet is worse than a plain
        // sentence.
        `- repair used: ${
          s.repaired
            ? `yes (the one the product allows)${s.rejectedSource ? `, on [this draft](${rejectedPath(run, s.index)})` : ""}` +
              ` — it failed on: ${s.validationErrors.slice(0, 2).join("; ").slice(0, 200)}`
            : "no"
        }`,
        ...dataLine(s),
      );
      if (s.findings.length) {
        md.push(`- findings:`);
        for (const f of s.findings) md.push(`  - ${f}`);
      }
      md.push(
        ``,
        `**Human review** — 0 broken/unrelated · 1 runs but misses the request · 2 usable with gaps · 3 genuinely good`,
        ``,
        `- score: `,
        `- notes: `,
        ``,
      );
    }
  }

  return md.join("\n");
}
