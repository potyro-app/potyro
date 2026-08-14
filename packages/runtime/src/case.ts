// A CASE is what someone did, plus what they expected — recorded from the app they were using.
//
// It is deliberately SEMANTIC, not a DOM recording. A Karta app's navigation vocabulary is
// `navigate(pageId, params)`, so a trace is small, stable across edits, and replayable headlessly.
// A recorded click on a coordinate would break on the next layout change and could never be replayed
// without a browser; this survives an app being rewritten from scratch.

export type CaseStep =
  | { kind: "open"; page: string; params?: Record<string, string> }
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
