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
const MAX_LINE = 300;

const clip = (s: string): string => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}…` : s);

function list(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LINES).map((i) => `- ${clip(i.replace(/\s+/g, " ").trim())}`);
  if (items.length > MAX_LINES) shown.push(`- … and ${items.length - MAX_LINES} more`);
  return shown.join("\n");
}

/** The report in words a model (and a person reading the transcript) can act on. */
export function describeRun(report: RunReport): string {
  const parts = [`Ran it on sample records (${report.ran || "nothing to run"}).`];
  if (report.errors.length) parts.push(`It failed:\n${list(report.errors)}`);
  if (report.warnings.length) parts.push(`Looks wrong:\n${list(report.warnings)}`);
  if (!report.errors.length && !report.warnings.length) parts.push("Nothing threw and every page showed something.");
  return parts.join("\n");
}

/**
 * Run a candidate, never throwing. A run that cannot even start says so as a WARNING: it is the
 * harness that failed, not necessarily the app, and a broken harness must not hold every change back.
 */
export async function runSafely(run: (source: string) => Promise<RunReport>, source: string): Promise<RunReport> {
  try {
    return await run(source);
  } catch (e) {
    return { errors: [], warnings: [`it could not be run to check it: ${e instanceof Error ? e.message : String(e)}`], ran: "" };
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
