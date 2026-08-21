// @karta/runtime — the core the views consume.
export { createRuntime, type KartaRuntime } from "./create-runtime.js";
export { RuntimeCore, type RuntimeDeps, FN_SENTINEL } from "./core.js";
export { usePageQuery, useEntityQuery, useRecord, type QueryState, type RecordState } from "./hooks.js";
export { asyncSort } from "./async-sort.js";

export { watchEntityQuery, watchPageQuery, watchRecord } from "./watch.js";
export type { Unsubscribe } from "./watch.js";

// Activity — what changed, by whom, since you last looked (KA-36).
export { activitySince, activitySupported, type ActivityItem, type ActivityDeps } from "./activity.js";
export { memberName, personHue, personInitials } from "./people.js";

export { newCase, addStep, annotate, observe, type Case, type CaseStep, type ScreenState } from "./case.js";
export {
  replayCase,
  replayPassed,
  type ReplayTarget,
  type ReplayReport,
  type StepOutcome,
} from "./replay.js";
