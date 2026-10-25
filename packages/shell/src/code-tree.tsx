// The app's code files, as a tree beside the editor (#448 follow-up): the app's main file first,
// then its own modules in their folders. Picking one shows it in the editor; files and folders are
// made here, and a file can be deleted. Nothing is kept until the code is saved — a folder with no
// file in it is not kept at all, since the app's file space has no empty folders.

import { Trans, useLingui } from "@lingui/react/macro";
import { useState, type ReactNode } from "react";
import { checkNewName, codeTree, foldersOf, type CodeNode, type NameCheck } from "./code-files.js";
import { I } from "./icons.js";

export interface CodeTreeProps {
  /** The modules, by path in `src/`. */
  files: readonly string[];
  /** Folders made here that hold no file yet. */
  folders: readonly string[];
  /** The file the editor shows: null for the app's main file. */
  shown: string | null;
  changed?: ReadonlySet<string>;
  onShow: (path: string | null) => void;
  /** Null when files cannot be made yet (an app not saved once). */
  onCreateFile: ((path: string) => void) | null;
  onCreateFolder: ((path: string) => void) | null;
  onDeleteFile: (path: string) => void;
}

type Making = { kind: "file" | "folder"; folder: string };

/** What a new name could be, in the empty box: names in code, the same in every language. */
const EXAMPLE_NAME: Record<Making["kind"], string> = { file: "colors.ts", folder: "lib" };

export function CodeTree({ files, folders, shown, changed, onShow, onCreateFile, onCreateFolder, onDeleteFile }: CodeTreeProps) {
  const { t } = useLingui();
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [making, setMaking] = useState<Making | null>(null);
  const tree = codeTree(files, folders);
  const canMake = onCreateFile !== null && onCreateFolder !== null;

  const toggle = (path: string) =>
    setClosed((was) => {
      const next = new Set(was);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const start = (kind: Making["kind"], folder: string) => {
    if (folder) setClosed((was) => new Set([...was].filter((p) => p !== folder)));
    setMaking({ kind, folder });
  };

  const node = (n: CodeNode, depth: number): ReactNode => {
    const indent = { paddingInlineStart: `calc(${depth} * var(--space-3) + var(--space-2))` };
    if (n.kind === "folder") {
      const open = !closed.has(n.path);
      return (
        <li key={`d:${n.path}`}>
          <div className="k-code-row">
            <button type="button" className="k-code-item k-code-folder" style={indent} aria-expanded={open} onClick={() => toggle(n.path)}>
              {open ? I.folderOpen16 : I.folder16}
              <span className="k-code-name">{n.name}</span>
            </button>
            {canMake ? (
              <button type="button" className="k-code-act" aria-label={t({ message: `New file in ${n.name}`, comment: "The Studio's code tree: make a file inside this folder" })} title={t`New file in ${n.name}`} onClick={() => start("file", n.path)}>
                {I.plus16}
              </button>
            ) : null}
          </div>
          {open ? (
            <ul>
              {n.children.map((c) => node(c, depth + 1))}
              {making?.folder === n.path ? <NewName key="new" making={making} depth={depth + 1} taken={taken} onDone={finish} /> : null}
            </ul>
          ) : null}
        </li>
      );
    }
    const isChanged = changed?.has(n.path);
    return (
      <li key={`f:${n.path}`}>
        <div className="k-code-row">
          <button type="button" className="k-code-item" style={indent} aria-current={shown === n.path ? "true" : undefined} data-changed={isChanged || undefined} onClick={() => onShow(n.path)}>
            {I.codeFile16}
            <span className="k-code-name">{n.name}</span>
            {isChanged ? <span className="k-code-changed" title={t({ message: "changed", comment: "The Studio's code: a file edited but not saved yet" })} aria-label={t({ message: "changed", comment: "The Studio's code: a file edited but not saved yet" })} /> : null}
          </button>
          <button type="button" className="k-code-act" aria-label={t({ message: `Delete ${n.path}`, comment: "The Studio's code tree: delete this file" })} title={t`Delete ${n.path}`} onClick={() => onDeleteFile(n.path)}>
            {I.delete16}
          </button>
        </div>
      </li>
    );
  };

  const taken = new Set([...files, ...folders, ...foldersOf(files)]);
  const finish = (path: string | null) => {
    const kind = making?.kind;
    setMaking(null);
    if (!path) return;
    if (kind === "folder") onCreateFolder?.(path);
    else onCreateFile?.(path);
  };

  return (
    <nav className="k-code-tree" aria-label={t({ message: "The app's files", comment: "The Studio's code: the list of files the app's code is made of" })}>
      <div className="k-code-tree-head">
        <span className="k-code-tree-title">
          <Trans comment="The Studio's code tree: its heading">Files</Trans>
        </span>
        <button
          type="button"
          className="k-code-tool"
          disabled={!canMake}
          aria-label={t({ message: "New file", comment: "The Studio's code tree: make a file of code" })}
          title={canMake ? t`New file` : t({ message: "Save the app once to add files to it", comment: "The Studio's code tree: why New file is not available yet" })}
          onClick={() => start("file", "")}
        >
          {I.newFile}
        </button>
        <button
          type="button"
          className="k-code-tool"
          disabled={!canMake}
          aria-label={t({ message: "New folder", comment: "The Studio's code tree: make a folder" })}
          title={canMake ? t`New folder` : t`Save the app once to add files to it`}
          onClick={() => start("folder", "")}
        >
          {I.newFolder}
        </button>
      </div>
      <ul className="k-code-list">
        <li>
          <button type="button" className="k-code-item k-code-main" aria-current={shown === null ? "true" : undefined} onClick={() => onShow(null)}>
            {I.codeFile16}
            <span className="k-code-name">
              <Trans comment="The Studio's code: the app's main file, beside the modules it imports">The app</Trans>
            </span>
            <span className="k-code-badge">
              <Trans comment="The Studio's code tree: the app's main file, the one with defineApp">main</Trans>
            </span>
          </button>
        </li>
        {tree.map((n) => node(n, 0))}
        {making?.folder === "" ? <NewName key="new" making={making} depth={0} taken={taken} onDone={finish} /> : null}
      </ul>
    </nav>
  );
}

/** The row a new file or folder is named in: Enter makes it, Escape or leaving it empty does not. */
function NewName({ making, depth, taken, onDone }: { making: Making; depth: number; taken: ReadonlySet<string>; onDone: (path: string | null) => void }) {
  const { t } = useLingui();
  const [name, setName] = useState("");
  const [check, setCheck] = useState<NameCheck | null>(null);
  const why = (c: NameCheck): string | null => {
    if (c.ok) return null;
    switch (c.problem) {
      case "empty":
        return null;
      case "characters":
        return t({ message: "Letters, digits, - _ and . only, no spaces", comment: "The Studio's code tree: a new file's name has characters it may not" });
      case "extension":
        return making.kind === "file"
          ? t({ message: "A file of code ends in .ts, .tsx, .js or .jsx", comment: "The Studio's code tree: a new file's name lacks a code extension" })
          : t({ message: "A folder's name has no .ts at the end", comment: "The Studio's code tree: a new folder's name looks like a file's" });
      case "taken":
        return t({ message: "There is one with that name already", comment: "The Studio's code tree: a new name that is already used" });
    }
  };
  const submit = () => {
    const c = checkNewName(name, making.folder, making.kind, taken);
    if (c.ok) onDone(c.path);
    else if (c.problem === "empty") onDone(null);
    else setCheck(c);
  };
  const problem = check ? why(check) : null;
  return (
    <li className="k-code-new" style={{ paddingInlineStart: `calc(${depth} * var(--space-3) + var(--space-2))` }}>
      {making.kind === "folder" ? I.folder16 : I.codeFile16}
      <input
        className="k-input k-code-input"
        autoFocus
        spellCheck={false}
        aria-label={making.kind === "folder" ? t({ message: "Name of the new folder", comment: "The Studio's code tree" }) : t({ message: "Name of the new file", comment: "The Studio's code tree" })}
        aria-invalid={problem ? true : undefined}
        placeholder={EXAMPLE_NAME[making.kind]}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setCheck(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone(null);
          }
        }}
        onBlur={() => {
          if (!name.trim()) onDone(null);
        }}
      />
      {problem ? (
        <p className="k-code-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </li>
  );
}
