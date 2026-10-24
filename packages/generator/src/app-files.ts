// An app made of several files, as one text for the model (#258, #448).
//
// The modify loop, its gates and its SEARCH/REPLACE edits all work on one source text. An app whose
// code is its entry file plus modules of its own (`./card.ts`) is shown to the model as ONE text: each
// file under a marker line, the entry first. The model edits whichever file holds what must change,
// with the edits it already knows; the caller splits the text back into files before anything is
// checked, run or saved. An app that is one file is never joined, so what the model sees for it does
// not change at all.

/** The line that starts a file. Valid TypeScript (a comment), so a stray bundle of the text still parses. */
export const FILE_MARK = "//// FILE: ";
/** The entry file's name in the text: the app module, `defineApp`'s file. */
export const ENTRY_FILE = "(the app)";

const MARK_LINE = /^\/\/\/\/ FILE: (.+?)\s*$/;

/** The entry and its modules (path in `src/` → text) as one text, files in path order after the entry. */
export function joinAppFiles(entry: string, modules: Readonly<Record<string, string>>): string {
  const section = (name: string, text: string) => `${FILE_MARK}${name}\n${text.endsWith("\n") ? text : `${text}\n`}`;
  return [section(ENTRY_FILE, entry), ...Object.keys(modules).sort().map((path) => section(path, modules[path]!))].join("");
}

/**
 * Whether the files can be joined: none of them has a line of its own that reads as a marker — the
 * split could not tell it from one. Such an app is shown as its entry alone, as before #448.
 */
export function canJoinAppFiles(entry: string, modules: Readonly<Record<string, string>>): boolean {
  return [entry, ...Object.values(modules)].every((text) => !text.split("\n").some((line) => MARK_LINE.test(line)));
}

/** Whether a text is a joined app: it starts with the entry's marker. */
export function isJoinedApp(text: string): boolean {
  return text.startsWith(`${FILE_MARK}${ENTRY_FILE}\n`);
}

export type SplitResult = { ok: true; entry: string; modules: Record<string, string> } | { ok: false; problem: string };

/**
 * A joined text back into its files. `expected` is the modules it was joined from: a file may not be
 * added, renamed or removed, and every marker line must still be there as it was — an edit that moved
 * or broke one is refused with a sentence the model can act on.
 */
export function splitAppFiles(text: string, expected: readonly string[]): SplitResult {
  if (!isJoinedApp(text)) return { ok: false, problem: `The app must start with its \`${FILE_MARK}${ENTRY_FILE}\` line, as it was shown. Keep every \`${FILE_MARK}\` line exactly as it is.` };
  const files = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    const mark = MARK_LINE.exec(line);
    if (mark) {
      const name = mark[1]!;
      if (files.has(name)) return { ok: false, problem: `\`${FILE_MARK}${name}\` appears twice. Keep every \`${FILE_MARK}\` line exactly once, as it was shown.` };
      current = [];
      files.set(name, current);
    } else current!.push(line);
  }
  const want = new Set([ENTRY_FILE, ...expected]);
  const added = [...files.keys()].filter((n) => !want.has(n));
  if (added.length) return { ok: false, problem: `Files cannot be added or renamed here (${added.join(", ")}). Put the change in one of the files shown.` };
  const missing = [...want].filter((n) => !files.has(n));
  if (missing.length) return { ok: false, problem: `The \`${FILE_MARK}\` line of ${missing.join(", ")} is gone. Keep every \`${FILE_MARK}\` line exactly as it is; files cannot be removed here.` };
  // Each section ends with the newline before the next marker; the text's own last line ends it too.
  const body = (lines: string[]) => lines.join("\n").replace(/\n$/, "") + "\n";
  const modules: Record<string, string> = {};
  for (const path of expected) modules[path] = body(files.get(path)!);
  return { ok: true, entry: body(files.get(ENTRY_FILE)!), modules };
}

/** What the model is told when it is shown a joined app: once, beside the app. */
export function appFilesNote(modules: readonly string[]): string {
  return [
    `This app is ${modules.length + 1} files, shown one after another, each under a \`${FILE_MARK}<name>\` line.`,
    `\`${ENTRY_FILE}\` is the main file, with \`defineApp\`; the others are its own modules, imported as \`./<name>\` (${modules.join(", ")}).`,
    "Change whichever file holds what must change. A SEARCH block matches lines inside one file; keep every",
    `\`${FILE_MARK}\` line exactly as it is. Files cannot be added, renamed or removed.`,
  ].join("\n");
}
