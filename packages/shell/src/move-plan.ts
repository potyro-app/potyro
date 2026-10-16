// What happens to each app that moves in (docs/16 §Moving to a new home). Pure.
//
// The rule is "merge, never duplicate". Records keep their ids, so copying them into an app that
// already has some is an upsert: the same move run twice — or resumed after a closed window — ends
// with one of everything. What needs deciding is the APP: the new site may already have one under the
// same id, most often a bundled example it seeded itself.
//
//   - not here                         → it comes in as it was
//   - here, same code                  → its records join the ones here
//   - it is an untouched example       → likewise: the copy here is the same example, maybe newer
//   - the one here is an untouched one → replaced by the person's edited version
//   - both changed, differently        → it comes in beside the one here, under an id of its own
//
// A second move remembers where each app went the first time (`received`), so an app that came in
// under a new id goes on arriving there rather than becoming a third.
//
// Trust: an app runs directly here only if it did there AND it was the person's own. One that came
// from someone else — a link, a maker's credit, someone's shared space — arrives sealed whatever the
// old site had decided, and a saved file brings every app sealed: a file can be from anyone.

import type { MovedApp } from "./move-archive.js";

export type MoveVia = "window" | "file";

export interface TargetApp {
  id: string;
  source: string;
  example?: "untouched" | "edited";
}

/** Where an app went in an earlier move, and the code it had then. */
export interface Received {
  id: string;
  sourceHash: string;
}

export type PlanKind = "new" | "merge" | "replace" | "copy";

export interface AppPlan {
  app: MovedApp;
  kind: PlanKind;
  /** The id it has here. */
  id: string;
  /** Runs directly here. For `merge` it is the app already here, unchanged. */
  trusted: boolean;
}

/** Did this app come from someone else? */
export function fromSomeoneElse(app: Pick<MovedApp, "link" | "credit" | "joined">): boolean {
  return Boolean(app.link || app.credit || app.joined);
}

/** Does this app run directly on the new site? */
export function arrivesTrusted(app: MovedApp, via: MoveVia): boolean {
  return via === "window" && app.trusted && !fromSomeoneElse(app);
}

/** A cheap, stable fingerprint of a source (FNV-1a), for "has it changed since". Not a security check. */
export function sourceHash(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The key an earlier move is remembered under: the site and the app's id there. */
export const receivedKey = (from: string, appId: string): string => `${from} ${appId}`;

export function planMove(
  apps: readonly MovedApp[],
  here: ReadonlyMap<string, TargetApp>,
  opts: { via: MoveVia; from: string; received: Readonly<Record<string, Received>> },
): AppPlan[] {
  const taken = new Set(here.keys());
  const plans: AppPlan[] = [];
  const plan = (app: MovedApp, kind: PlanKind, id: string, trusted = arrivesTrusted(app, opts.via)): void => {
    taken.add(id);
    plans.push({ app, kind, id, trusted });
  };

  for (const app of apps) {
    const before = opts.received[receivedKey(opts.from, app.id)];
    const target = before ? here.get(before.id) : undefined;
    if (before && target) {
      if (target.source === app.source) plan(app, "merge", target.id, false);
      // Unchanged here since the last move: the newer code from there replaces it.
      else if (sourceHash(target.source) === before.sourceHash) plan(app, "replace", target.id);
      // Changed here since: what was done here is kept, and the records still join.
      else plan(app, "merge", target.id, false);
      continue;
    }
    const same = here.get(app.id);
    if (!same) plan(app, "new", app.id);
    else if (same.source === app.source || app.example === "untouched") plan(app, "merge", same.id, false);
    else if (same.example === "untouched") plan(app, "replace", same.id);
    else plan(app, "copy", freeId(app.id, taken));
  }
  return plans;
}

function freeId(base: string, taken: ReadonlySet<string>): string {
  let n = 2;
  const stem = base.replace(/-\d+$/, "").slice(0, 58);
  while (taken.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/** The id an app has here, given the plans — for rows and preferences that name it. */
export function idMap(plans: readonly AppPlan[]): Map<string, string> {
  return new Map(plans.map((p) => [p.app.id, p.id]));
}
