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
  /** What the person called it — shown in lists and sent to the agent verbatim. */
  title: string;
  steps: CaseStep[];
  createdAt: string;
}

export function newCase(appId: string, title: string, id = `case-${appId}-${Date.now()}`): Case {
  return { id, appId, title, steps: [], createdAt: new Date().toISOString() };
}

export function addStep(c: Case, step: CaseStep): Case {
  // Copy the step to avoid mutations of the recorded path. A case is a record of what happened;
  // if a caller mutates their original params object after calling addStep, the recording must remain unchanged.
  let copiedStep: CaseStep;
  if (step.kind === "open") {
    copiedStep = {
      kind: "open",
      page: step.page,
      params: step.params ? { ...step.params } : undefined,
    };
  } else if (step.kind === "action") {
    copiedStep = {
      kind: "action",
      entity: step.entity,
      action: step.action,
      recordId: step.recordId,
    };
  } else {
    copiedStep = {
      kind: "expect",
      note: step.note,
    };
  }
  return { ...c, steps: [...c.steps, copiedStep] };
}

export function annotate(c: Case, note: string): Case {
  return addStep(c, { kind: "expect", note });
}
