// A version the Studio held back (#486, #448, #266): one that came back with problems, or that rewrote
// the app, and so was not saved. Fix it and Keep it anyway pick it up again — and everything it was
// going to be saved with has to come along: its libraries, the modules it edited, and for a new app
// the sample records it was made with. Lost on the way, a new app kept through either button opened
// its demo link on an empty copy.
import type { PackagedFile, AppLock } from "@potyro/store";
import type { AppSeed } from "./app-seed.js";
import type { StudioLibraries } from "./studio-libraries.js";

/** Modules a version edited (#448): every module's text, and the files and lock entries they make. */
export type OwnEdit = { texts: Record<string, string>; code: { lock: AppLock; files: PackagedFile[] } };

/** A version that was made and failed a gate, so it was not saved. */
export interface Held {
  source: string;
  summary: string;
  /** What was asked, for the version's note if it is kept. */
  note: string;
  issues: string[];
  loss: string | null;
  /** Its libraries, already fetched with the person's say-so (#266). */
  libraries: StudioLibraries | null;
  /** The modules it edited (#448), kept with it if it is kept. */
  own?: OwnEdit;
  /** A new app's sample records (#486), kept with it through Fix it or Keep it anyway. */
  made?: AppSeed;
}

/** What a repair of a held version lands as: the repair's source, with what the held version carried. */
export interface Landing {
  source: string;
  summary: string;
  note: string;
  loss: string | null;
  modules?: Record<string, string>;
  made?: AppSeed;
}

/** Fix it: the repaired source lands like any answer, carrying the held version's modules and sample records. */
export function fixedLanding(held: Held, fixed: { source: string; summary: string; loss: string | null; modules?: Record<string, string> }): Landing {
  const modules = fixed.modules ?? held.own?.texts;
  return {
    source: fixed.source,
    summary: `${held.summary} ${fixed.summary}`.trim(),
    note: held.note,
    loss: fixed.loss,
    ...(modules ? { modules } : {}),
    ...(held.made ? { made: held.made } : {}),
  };
}

/** What Keep it anyway saves: the held version as it is, with everything it carried. */
export interface KeptAnyway {
  source: string;
  summary: string;
  note: string;
  libraries: StudioLibraries | null;
  own?: OwnEdit;
  made?: AppSeed;
}

/** Keep it anyway: `kept` is the words said beside it ("Kept with problems."). */
export function keptAnyway(held: Held, kept: string): KeptAnyway {
  return {
    source: held.source,
    summary: `${held.summary} ${kept}`.trim(),
    note: held.note,
    libraries: held.libraries,
    ...(held.own ? { own: held.own } : {}),
    ...(held.made ? { made: held.made } : {}),
  };
}

/** The seed a saved version sets (#486): a new app's sample records; a changed app keeps the ones it has, untouched. */
export const seedToSave = (isNew: boolean, made: AppSeed | undefined): { seed?: AppSeed } => (isNew && made ? { seed: made } : {});
