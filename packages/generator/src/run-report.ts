// What happened when a candidate app actually RAN (#262) — the feedback the validator cannot give.
//
// An app can compile, validate and keep its shape and still throw on its first computed, call a ctx
// method that does not exist, or show a list that filters every record away. The Studio's model used
// to learn none of that: it got the validator's words and nothing else. A run report is what a
// developer sees in the console, compact enough to send back to a model.

export interface RunReport {
  /** Things that broke when the app ran on sample records. A candidate must not ship with these. */
  errors: string[];
  /** Things that look wrong but can be meant — a page that shows nothing on sample data. */
  warnings: string[];
  /** What actually ran, so a pass with nothing to run is visible: "3 pages, 2 actions". */
  ran: string;
}

const MAX_LINES = 12;
const CANNOT_RUN = "it could not be run to check it: ";
const MAX_LINE = 300;

const clip = (s: string): string => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}…` : s);

function list(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LINES).map((i) => `- ${clip(i.replace(/\s+/g, " ").trim())}`);
  if (items.length > MAX_LINES) shown.push(`- … and ${items.length - MAX_LINES} more`);
  return shown.join("\n");
}

/**
 * The report in words a model (and a person reading the transcript) can act on. `preexisting` is what
 * already failed in the app before the change: said as context, after the change's own failures, so
 * it reads as "not yours" rather than as something to fix.
 */
export function describeRun(report: RunReport, preexisting?: RunReport): string {
  const parts = [`Ran it on sample records (${report.ran || "nothing to run"}).`];
  if (report.errors.length) parts.push(`It failed:\n${list(report.errors)}`);
  if (report.warnings.length) parts.push(`Looks wrong:\n${list(report.warnings)}`);
  if (!report.errors.length && !report.warnings.length) parts.push("Nothing new threw and no page newly showed nothing.");
  const before = [...(preexisting?.errors ?? []), ...(preexisting?.warnings ?? [])];
  if (before.length) {
    parts.push(
      `Already failing before this change, in the app as first shown — not caused by it; leave it unless the person asked about it:\n${list(before)}`,
    );
  }
  return parts.join("\n");
}

// ---- the regression gate ----

/** A candidate's run, split by whether the change caused it. */
export interface GatedRun {
  /** What the candidate introduced: failures the app as first shown did not have. Only these block. */
  report: RunReport;
  /** What already failed before the change. Context, never a reason to reject. */
  preexisting: RunReport;
}

/** Run a candidate against the app as first shown. Never throws. */
export type RunGate = (candidate: string) => Promise<GatedRun>;

/** A failure's identity across two runs: sample ids, counts and dates differ between them; the failure does not. */
const keyOf = (line: string): string =>
  line
    .replace(/\b(?=[0-9a-z_-]*\d)[0-9a-z_-]{6,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();

function split(lines: readonly string[], before: readonly string[]): { added: string[]; kept: string[] } {
  const known = new Map<string, number>();
  for (const l of before) known.set(keyOf(l), (known.get(keyOf(l)) ?? 0) + 1);
  const added: string[] = [];
  const kept: string[] = [];
  for (const l of lines) {
    const n = known.get(keyOf(l)) ?? 0;
    if (n > 0) {
      known.set(keyOf(l), n - 1);
      kept.push(l);
    } else added.push(l);
  }
  return { added, kept };
}

/**
 * The run gate as a REGRESSION gate (#262). The first version blocked a candidate on every failure
 * its run reported, so an app that already had one could not be changed at all: the paid eval's
 * "add a rating to recipes" went from 3/3 to 0/3, the model saying each time — correctly — that the
 * failures were the app's own. The app as first shown is run once, lazily, with the same sample data;
 * a candidate is judged only on what is new.
 */
export function regressionGate(run: (source: string) => Promise<RunReport>, original: string): RunGate {
  let baseline: Promise<RunReport> | undefined;
  return async (candidate) => {
    // An original that cannot run at all counts as failing nothing: the harness's trouble is not a
    // reason to excuse the candidate's own failures, nor to hold it back.
    baseline ??= runSafely(run, original).then((b) => ({ ...b, warnings: b.warnings.filter((w) => !w.startsWith(CANNOT_RUN)) }));
    const [before, now] = await Promise.all([baseline, runSafely(run, candidate)]);
    const errors = split(now.errors, before.errors);
    const warnings = split(now.warnings, before.warnings);
    return {
      report: { errors: errors.added, warnings: warnings.added, ran: now.ran },
      preexisting: { errors: errors.kept, warnings: warnings.kept, ran: before.ran },
    };
  };
}

/**
 * Run a candidate, never throwing. A run that cannot even start says so as a WARNING: it is the
 * harness that failed, not necessarily the app, and a broken harness must not hold every change back.
 */
export async function runSafely(run: (source: string) => Promise<RunReport>, source: string): Promise<RunReport> {
  try {
    return await run(source);
  } catch (e) {
    return { errors: [], warnings: [`${CANNOT_RUN}${e instanceof Error ? e.message : String(e)}`], ran: "" };
  }
}

/** Two reports as one — the logic run and the render, say. */
export function mergeRuns(a: RunReport, b: RunReport): RunReport {
  return {
    errors: [...a.errors, ...b.errors],
    warnings: [...a.warnings, ...b.warnings],
    ran: [a.ran, b.ran].filter(Boolean).join(", "),
  };
}
