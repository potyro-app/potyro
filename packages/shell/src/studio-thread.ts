// The Studio's thread, read back from an app's history.
//
// Every version keeps the note that produced it, so the thread is that material read as a
// conversation. But not every version was a request, and not every request left an answer on disk:
//
//   - an ANSWER is only stored for model edits that explain themselves (`rationale`). A request made
//     in an earlier sitting and saved without one is still finished — it was saved.
//   - some versions are EVENTS, not requests: the app arriving from someone ("shared with you"), a
//     rollback, a hand edit in edit mode. Shown as asks, they read as questions nobody answered.
//
// Read back, a turn is therefore never pending. Only a request made in this sitting can be
// "Working…", and that turn is added live by the Studio, not here.

import type { AppVersion } from "./app-history.js";

/** One exchange in the Studio: what was asked, and what came back — or one thing that happened. */
export interface Turn {
  id: string;
  prompt: string;
  /** What the app did about it, once it is known — absent while the model is still working. */
  outcome?: string;
  /** A turn that changed nothing: a refusal, a question, or a failure. Shown differently. */
  refused?: boolean;
  /** The version this became, for turns read back from history. */
  seq?: number;
  /** Not a request: the app arrived, was rolled back, or was changed by hand. One quiet line. */
  event?: boolean;
}

/** Origins that record something that happened to the app, never something asked of the model. */
const EVENTS: ReadonlySet<AppVersion["origin"]> = new Set(["imported", "restored", "adjusted"]);

/**
 * `created` versions the shell writes itself, not from a request: a seeded example, a copy, the
 * baseline history starts from, an app restored from the account. Their writers are
 * examples.ts, user-apps.ts (duplicate), app-history.ts and restore-apps.tsx — studio-thread.test.ts
 * reads those files to keep this list honest.
 */
export const SYSTEM_NOTES: readonly RegExp[] = [/^example app$/, /^copied from /, /^the source before history was kept$/, /^from your account/];

const isEvent = (v: AppVersion): boolean =>
  EVENTS.has(v.origin) || (v.origin === "created" && !v.rationale && SYSTEM_NOTES.some((re) => re.test(v.note ?? "")));

/** `versions` newest-first, as `listVersions` returns them; the thread reads oldest-first. */
export function turnsFromHistory(versions: readonly AppVersion[]): Turn[] {
  return versions
    .slice()
    .reverse()
    .filter((v) => v.note)
    .map((v) =>
      isEvent(v)
        ? { id: `v${v.seq}`, prompt: v.note!, seq: v.seq, event: true }
        : { id: `v${v.seq}`, prompt: v.note!, outcome: v.rationale || "Saved.", seq: v.seq },
    );
}
