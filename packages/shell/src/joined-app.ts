// An app of several files, for the model that changes it (#448).
//
// The Studio's modify works on one text. An app with modules of its own is shown to the model as its
// files joined under marker lines (`joinAppFiles`, generator); everything that checks, runs or saves a
// candidate splits it back first (`unpackCandidate`), so a candidate is always bundled as the files it
// names. An app that is one file — or whose modules are too big to send — is not joined, and is
// changed exactly as before.
import { joinAppFiles, splitAppFiles } from "@potyro/generator/backends";
import { srcKey } from "@potyro/store";
import { ownModuleCode, withEditedModules } from "./app-modules.js";
import type { ModuleSource } from "./package-modules.js";

/**
 * Most of an app's own modules the model is shown, in characters (~30k tokens). Past it the model is
 * shown the entry alone, as before #448: a change still works there, and one in a module is out of
 * reach — rather than every change to a big app costing a fortune.
 */
export const JOINED_MAX = 120_000;

export interface JoinedApp {
  /** What the model is shown and edits. */
  text: string;
  /** The entry file as it is now. */
  entry: string;
  /** The modules it holds, by path in `src/`, as they are now. */
  texts: Record<string, string>;
}

/** The app's own modules as text, from what it is bundled with. Undefined for an app with none. */
export async function ownTextsOf(modules: ModuleSource | undefined): Promise<Record<string, string> | undefined> {
  const own = Object.entries(modules?.lock ?? {}).filter(([key]) => key.startsWith(srcKey("")));
  if (!own.length) return undefined;
  const texts: Record<string, string> = {};
  for (const [key, entry] of own) {
    const bytes = await modules!.read(entry.file);
    if (!bytes) return undefined;
    texts[key.slice(srcKey("").length)] = new TextDecoder().decode(bytes);
  }
  return texts;
}

/** The app as the model is shown it, or null when it is shown as one file. */
export async function joinForModel(source: string, modules: ModuleSource | undefined): Promise<JoinedApp | null> {
  const texts = await ownTextsOf(modules);
  if (!texts) return null;
  const size = Object.values(texts).reduce((n, t) => n + t.length, 0);
  if (size > JOINED_MAX) return null;
  return { text: joinAppFiles(source, texts), entry: source, texts };
}

export type Unpacked =
  | {
      ok: true;
      /** The entry file. */
      source: string;
      /** What it bundles with: the edited modules in place of the saved ones. */
      modules: ModuleSource | undefined;
      /** Every module's text when any changed (the set to save); undefined when none did. */
      changed?: Record<string, string>;
    }
  | { ok: false; problem: string };

/** The same text, give or take the newline at its end that joining adds to a file without one. */
const sameText = (a: string, b: string): boolean => a === b || a.replace(/\n$/, "") === b.replace(/\n$/, "");

/** A candidate the model wrote, as the files it is: what is checked, run and kept. */
export async function unpackCandidate(text: string, joined: JoinedApp | null, modules: ModuleSource | undefined): Promise<Unpacked> {
  if (!joined) return { ok: true, source: text, modules };
  const split = splitAppFiles(text, Object.keys(joined.texts));
  if (!split.ok) return { ok: false, problem: split.problem };
  const entry = sameText(split.entry, joined.entry) ? joined.entry : split.entry;
  const next: Record<string, string> = {};
  let changed = false;
  for (const [path, was] of Object.entries(joined.texts)) {
    const now = split.modules[path]!;
    if (sameText(now, was)) next[path] = was;
    else {
      next[path] = now;
      changed = true;
    }
  }
  if (!changed) return { ok: true, source: entry, modules };
  return { ok: true, source: entry, modules: withEditedModules(modules, await ownModuleCode(next)), changed: next };
}

/** `unpackCandidate` for a gate that must have files: a broken text is an error, in the model's words. */
export async function unpackOrThrow(text: string, joined: JoinedApp | null, modules: ModuleSource | undefined): Promise<Extract<Unpacked, { ok: true }>> {
  const u = await unpackCandidate(text, joined, modules);
  if (!u.ok) throw new Error(u.problem);
  return u;
}
