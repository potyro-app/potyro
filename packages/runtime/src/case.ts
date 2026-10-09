// A CASE is what someone did, plus what they expected — recorded from the app they were using.
//
// It is deliberately SEMANTIC, not a DOM recording. A Potyro app's navigation vocabulary is
// `navigate(pageId, params)`, so a trace is small, stable across edits, and replayable headlessly.
// A recorded click on a coordinate would break on the next layout change and could never be replayed
// without a browser; this survives an app being rewritten from scratch.

/**
 * What was actually ON SCREEN a moment after landing on a page.
 *
 * The rest of a case is deliberately semantic — where you went, not what pixels appeared — and that
 * was too narrow. Replay could prove a page resolved and its query ran, and knew NOTHING about what
 * rendered, so a map stuck on "Loading…" forever replayed perfectly clean and the tool insisted it
 * could not reproduce a bug someone was staring at.
 *
 * This is the narrowest thing that fixes that: not a DOM snapshot (which would break on the next
 * layout change and could never be compared across an app being rewritten), but the two facts that
 * distinguish "the page worked" from "the page never finished": whether it was still showing a
 * loading state after it had had time to settle, and a short sample of the visible text.
 */
export interface ScreenState {
  /** Still rendering a loading state AFTER the settle delay — i.e. it never finished, not "it was
   *  briefly loading". This is the signal that catches a hung view. */
  loading: boolean;
  /** A truncated sample of the visible text, so a person and an agent can both see what was there. */
  text: string;
}

export type CaseStep =
  | {
      kind: "open";
      page: string;
      params?: Record<string, string>;
      /** What the screen showed once it settled. Absent when the recorder had no DOM to observe
       *  (headless replay, tests) — never treat absence as "it was fine". */
      saw?: ScreenState;
    }
  | { kind: "action"; entity: string; action: string; recordId: string }
  /** The user's own words, anchored to the point in the path where they wrote them. */
  | { kind: "expect"; note: string };

export interface Case {
  id: string;
  appId: string;
  /** Reserved for a future title someone gives the case; nothing constructs a `Case` with one yet
   *  (App.tsx's recorder always passes ""), so this is currently always empty. Kept typed and
   *  non-optional so the field exists the day something DOES fill it in, rather than needing a
   *  shape change threaded through storage and every reader at that point. */
  title: string;
  steps: CaseStep[];
  createdAt: string;
}

export function newCase(appId: string, title: string, id = `case-${appId}-${Date.now()}`): Case {
  return { id, appId, title, steps: [], createdAt: new Date().toISOString() };
}

/** Exhaustiveness check: a new `CaseStep` variant that isn't handled below is a compile error here,
 *  not a step that silently falls into whichever arm happens to be last. */
function assertNever(x: never): never {
  throw new Error(`unreachable case step kind: ${JSON.stringify(x)}`);
}

export function addStep(c: Case, step: CaseStep): Case {
  // Copy the step to avoid mutations of the recorded path. A case is a record of what happened;
  // if a caller mutates their original params object after calling addStep, the recording must remain unchanged.
  let copiedStep: CaseStep;
  switch (step.kind) {
    case "open":
      copiedStep = {
        kind: "open",
        page: step.page,
        params: step.params ? { ...step.params } : undefined,
        saw: step.saw ? { ...step.saw } : undefined,
      };
      break;
    case "action":
      copiedStep = {
        kind: "action",
        entity: step.entity,
        action: step.action,
        recordId: step.recordId,
      };
      break;
    case "expect":
      copiedStep = {
        kind: "expect",
        note: step.note,
      };
      break;
    default:
      assertNever(step);
  }
  return { ...c, steps: [...c.steps, copiedStep] };
}

export function annotate(c: Case, note: string): Case {
  return addStep(c, { kind: "expect", note });
}

/**
 * Attach what the screen showed to the most recent `open` step.
 *
 * Separate from `addStep` because the two facts arrive at different times and that gap is the whole
 * point: the navigation is known immediately, but "did this page ever finish rendering" is only
 * knowable AFTER giving it time to settle. Recording the screen at navigation time would capture
 * every page mid-load and call them all broken.
 *
 * A no-op when the last step isn't an `open` — an observation with no navigation to belong to is
 * meaningless, and guessing which earlier step it referred to would be worse than dropping it.
 */
export function observe(c: Case, saw: ScreenState): Case {
  const i = c.steps.length - 1;
  const last = c.steps[i];
  if (!last || last.kind !== "open") return c;
  const steps = [...c.steps];
  steps[i] = { ...last, saw: { ...saw } };
  return { ...c, steps };
}
