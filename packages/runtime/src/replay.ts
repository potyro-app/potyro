// Run a recorded case against an app and say what actually happened.
//
// This is the verification gate. Today "compiles, validates, renders" all pass for an app whose
// list opens a page that does not exist — so every signal reports success while the app does
// nothing when tapped. Replaying the user's own path is the only check that speaks to what they
// reported, and it is what an agent must satisfy before it may claim a fix.

import type { Case, CaseStep, ScreenState } from "./case.js";

/** The slice of a composed runtime replay needs. Structural, so tests need no real app. */
export interface ReplayTarget {
  // `title` is `Dynamic<string>` on a real definition (#133); replay only ever reads the id.
  definition: { pages: Array<{ id: string; title?: unknown; view: { type: string; entity?: string } }> };
  /** Runs a page's real query — filters, sorts and display bindings included. */
  query: (entity: string, pageId: string) => Promise<unknown[]>;
  /**
   * Optional: run an entity action. Cases without action steps do not need it.
   *
   * ⚠️ SAFETY CRITICAL: An action mutates data. Replaying an action step against the user's
   * live store would *change the very records they are reporting a bug about*, destroying
   * the evidence and corrupting their workflow. ALWAYS wire this only to a seeded in-memory
   * store constructed for replay, never to production data.
   */
  runAction?: (entity: string, action: string, recordId: string) => Promise<void>;
  /**
   * Render the page NOW and report what it shows — supplied when replaying against a CANDIDATE.
   *
   * Without this, a step's recorded `saw` is all replay has, and that is a fact about the app as it
   * WAS. Re-reading it while judging a candidate fails the step no matter what the candidate does,
   * which made the gate unwinnable: the first real attempt burned every step it had and gave up,
   * and no possible fix could have passed. When this is present the recorded observation is
   * evidence of the ORIGINAL problem only, and the candidate is judged on what IT renders.
   *
   * Returning `null` means "could not look" (no DOM) — replay must then fall back to structure and
   * say so, never silently treat it as fine.
   */
  observe?: (pageId: string, params: Record<string, unknown>) => Promise<ScreenState | null>;
}

export interface StepOutcome {
  step: CaseStep;
  ok: boolean;
  /** What happened, in the terms the reader cares about — a page id, a count, an error message. */
  detail: string;
}

export interface ReplayReport {
  caseId: string;
  title: string;
  /** The user's own words, lifted out of the steps so a report leads with what they expected. */
  expectation: string | null;
  outcomes: StepOutcome[];
}

/** Screen text goes into a report a person reads and into a model's context; a whole page of it
 *  helps neither. One line is enough to recognise "Loading…" or an error. */
function sample(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 120 ? `${one.slice(0, 120)}…` : one || "(nothing)";
}

async function runStep(target: ReplayTarget, step: CaseStep): Promise<StepOutcome> {
  if (step.kind === "expect") return { step, ok: true, detail: step.note };

  if (step.kind === "open") {
    const page = target.definition.pages.find((p) => p.id === step.page);
    if (!page) {
      const known = target.definition.pages.map((p) => p.id).join(", ");
      return {
        step,
        ok: false,
        detail: `no page "${step.page}" in this app — it has: ${known}. Tapping here goes nowhere.`,
      };
    }
    // WHAT THE PERSON ACTUALLY SAW OUTRANKS what the structure says. A page can resolve, its query
    // can return rows, and the screen can still have been stuck on "Loading…" — which is exactly the
    // bug that made this check look useless: every line below reported "ok" while someone was
    // staring at a hung view, and the loop then announced it could not reproduce the problem. If the
    // recording says the page never finished rendering, the step failed, whatever the query did.
    // A fresh look beats the recorded one. `step.saw` says what the ORIGINAL app did; when a
    // candidate is being judged, `target.observe` renders it and reports what THIS app does. Only
    // when nobody can look do we fall back to the recording.
    const now = target.observe ? await target.observe(page.id, step.params ?? {}) : null;
    const saw = now ?? step.saw;
    if (saw?.loading) {
      const which = now ? "still never finishes loading" : "opened but never finished loading";
      return {
        step,
        ok: false,
        detail: `"${page.id}" ${which} — the screen showed: ${sample(saw.text)}`,
      };
    }
    const seen = saw ? ` — on screen: ${sample(saw.text)}` : "";
    const entity = page.view.entity;
    if (!entity) return { step, ok: true, detail: `opened "${page.id}"${seen}` };
    try {
      const rows = await target.query(entity, page.id);
      return { step, ok: true, detail: `opened "${page.id}" — ${rows.length} records${seen}` };
    } catch (e) {
      return { step, ok: false, detail: `"${page.id}" threw: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  if (!target.runAction) {
    return { step, ok: false, detail: `cannot run action "${step.action}" — no action runner` };
  }
  try {
    await target.runAction(step.entity, step.action, step.recordId);
    return { step, ok: true, detail: `ran "${step.action}"` };
  } catch (e) {
    return { step, ok: false, detail: `"${step.action}" threw: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function replayCase(target: ReplayTarget, c: Case): Promise<ReplayReport> {
  const outcomes: StepOutcome[] = [];
  // Sequential on purpose: a path is an order, and step 3 only means anything after step 2 ran.
  for (const step of c.steps) outcomes.push(await runStep(target, step));
  const expectation = c.steps.find((s): s is Extract<CaseStep, { kind: "expect" }> => s.kind === "expect");
  return { caseId: c.id, title: c.title, expectation: expectation?.note ?? null, outcomes };
}

export function replayPassed(r: ReplayReport): boolean {
  // `[].every()` is vacuously true — a case with no outcomes (nothing ever ran) must not read as
  // "everything passed". A case reaches this state only when a caller saves one with no `open` or
  // `action` steps; the outcome-less case itself is guarded against upstream (app-cases.ts's
  // `hasRecordedActivity`), but `replayPassed` must not depend on every caller remembering that.
  if (r.outcomes.length === 0) return false;
  return r.outcomes.every((o) => o.ok);
}
