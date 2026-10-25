// The app's code as a tree of files and folders, for the Studio's Source tab (#448 follow-up).
//
// An app's own modules are kept by their path in its package's `src/` ("lib/colors.ts"). Folders are
// nothing but those paths' leading segments — the app's file space has no empty folders — so a
// folder made in the Studio lives only in the editor until a file is put in it.

/** What an app's own module may be: code the bundler reads. */
export const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

export type CodeNode =
  | { kind: "folder"; name: string; path: string; children: CodeNode[] }
  | { kind: "file"; name: string; path: string };

/** The tree of `files` and of `folders` (made here, maybe empty): folders first, then files, by name. */
export function codeTree(files: readonly string[], folders: readonly string[] = []): CodeNode[] {
  const root: CodeNode[] = [];
  const folderAt = (path: string): CodeNode[] => {
    let level = root;
    let at = "";
    for (const name of path.split("/")) {
      at = at ? `${at}/${name}` : name;
      let folder = level.find((n): n is Extract<CodeNode, { kind: "folder" }> => n.kind === "folder" && n.name === name);
      if (!folder) {
        folder = { kind: "folder", name, path: at, children: [] };
        level.push(folder);
      }
      level = folder.children;
    }
    return level;
  };
  for (const folder of folders) folderAt(folder);
  for (const path of files) {
    const cut = path.lastIndexOf("/");
    const level = cut < 0 ? root : folderAt(path.slice(0, cut));
    level.push({ kind: "file", name: path.slice(cut + 1), path });
  }
  const sort = (nodes: CodeNode[]): CodeNode[] =>
    nodes
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1))
      .map((n) => (n.kind === "folder" ? { ...n, children: sort(n.children) } : n));
  return sort(root);
}

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

export type NameCheck = { ok: true; path: string } | { ok: false; problem: "empty" | "characters" | "extension" | "taken" };

/**
 * A new file or folder called `name` inside `folder` ("" for the top): its path, or why it cannot be.
 * A name may itself hold folders ("lib/colors.ts"). A file must end in one of `MODULE_EXTENSIONS`; a
 * folder must not. `taken` holds every file and folder path there is.
 */
export function checkNewName(name: string, folder: string, kind: "file" | "folder", taken: ReadonlySet<string>): NameCheck {
  const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return { ok: false, problem: "empty" };
  const segments = trimmed.split("/");
  if (!segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")) return { ok: false, problem: "characters" };
  const isCode = MODULE_EXTENSIONS.some((ext) => trimmed.endsWith(ext));
  if (kind === "file" ? !isCode : isCode) return { ok: false, problem: "extension" };
  const path = folder ? `${folder}/${trimmed}` : trimmed;
  if (taken.has(path)) return { ok: false, problem: "taken" };
  return { ok: true, path };
}

/** Every folder the files sit in, at every depth: what "taken" must also hold. */
export function foldersOf(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const path of files) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out];
}

/** What a new module starts as: a module, so the bundler and TypeScript both read it as one. */
export const NEW_MODULE = "export {};\n";
