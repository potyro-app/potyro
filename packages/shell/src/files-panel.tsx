// One app's files, as a person sees them (#254): the Files tab on the Data page, and — narrowed to
// what the app ships with — the Studio's Files tab.
//
// A list, not a table: a file is a name first, and what a person needs beside it is where it came
// from (it came with the app, the app made it, or you added it), how big it is and when it changed.
// Every file opens in a read-only viewer; its menu saves a copy outside, renames, replaces or
// deletes it. Files come in through "Add files" or by dropping them anywhere on the panel; a name
// that is taken gets a free one beside it rather than replacing anything (app-folder.ts).
//
// Opened on the same store the app uses, so a file added here is one the app's `ctx.files` reads,
// and in a shared app it is everyone's.

import { fmt } from "@potyro/i18n";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import type { FileInfo, FileOrigin } from "potyro";
import type { Store } from "@potyro/store";
import type { Capabilities } from "@potyro/capabilities";
import { pickFilesFromInput } from "@potyro/capabilities";
import { ActionMenu, formatSize, type MenuEntry } from "@potyro/views";
import { bringIn, listFolder, readFile, removeFile, renameFile, replaceFile, totalSize } from "./app-folder.js";
import { FileViewer } from "./file-viewer.js";
import { shellDialogs } from "./dialog.js";

export type FilesScope = "all" | "shipped";

export interface FilesPanelProps {
  store: Store;
  appName: string;
  /** "all": every file the app has, and what is added is the person's. "shipped": what it comes with (the Studio). */
  scope: FilesScope;
  caps: Pick<Capabilities, "filesystem">;
  /** Files that just arrived from outside (a drop, Open with), to point out once. */
  arrived?: readonly string[];
  /** Something above the list, beside the count: the Studio's "Save as a package". */
  extra?: ReactNode;
}

/** A hue per kind of file, so a folder of them can be scanned by eye; the word is always beside it. */
function hueOf(f: Pick<FileInfo, "mime">): number {
  const m = f.mime;
  if (m.startsWith("image/")) return 150;
  if (m.startsWith("audio/")) return 30;
  if (m.startsWith("video/")) return 350;
  if (m === "application/pdf") return 20;
  if (m.includes("json") || m.includes("csv") || m.includes("xml") || m.includes("yaml") || m.includes("tab-separated")) return 290;
  if (m.startsWith("text/")) return 240;
  return 80;
}

/** "MD", "JSON", "PNG": what a person calls the kind of file. */
function tagOf(f: Pick<FileInfo, "name">): string {
  const dot = f.name.lastIndexOf(".");
  const ext = dot > 0 ? f.name.slice(dot + 1) : "";
  return ext && ext.length <= 4 ? ext.toUpperCase() : "·";
}

/** "3 Oct", "just now", "5h ago" — the same as History. */
function changed(iso: string, now: number, justNow: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((now - then) / 60_000);
  if (mins < 1) return justNow;
  if (mins < 24 * 60) return fmt.relative(then, now, { style: "narrow", numeric: "always" });
  return fmt.date(iso, { month: "short", day: "numeric" });
}

export function FilesPanel({ store, appName, scope, caps, arrived, extra }: FilesPanelProps) {
  const { t } = useLingui();
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [viewing, setViewing] = useState<FileInfo | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set(arrived ?? []));
  const depth = useRef(0);
  const origin: FileOrigin = scope === "shipped" ? "shipped" : "imported";

  const reload = useCallback(async (): Promise<void> => {
    const all = await listFolder(store);
    setFiles(scope === "shipped" ? all.filter((f) => f.origin === "shipped") : all);
  }, [store, scope]);

  useEffect(() => {
    let live = true;
    const load = () => void reload().catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    load();
    // A peer's file, or one the app wrote while this is open, shows up without a reload.
    const stop = store.subscribeFiles?.(() => live && load());
    return () => {
      live = false;
      stop?.();
    };
  }, [store, reload]);

  /** Run a change; what goes wrong is said on the panel, never swallowed. */
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setFailed(null);
    try {
      await fn();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
    await reload().catch(() => {});
  };

  const add = async (chosen: File[]): Promise<void> => {
    if (!chosen.length) return;
    await act(async () => {
      const landed = await bringIn(store, chosen, { origin });
      setFresh(new Set(landed.map((f) => f.id)));
    });
  };

  const pick = async (multiple: boolean): Promise<File[]> =>
    caps.filesystem.pickFiles ? caps.filesystem.pickFiles({ multiple }) : pickFilesFromInput({ multiple });

  const saveCopy = (f: FileInfo) =>
    act(async () => {
      const blob = await readFile(store, f.id);
      if (!blob) {
        const name = f.name;
        throw new Error(t`${name} is not on this device yet.`);
      }
      await caps.filesystem.save(f.name, blob);
    });

  const rename = async (f: FileInfo): Promise<void> => {
    const name = f.name;
    const next = await shellDialogs.prompt(t`Rename ${name}`, { default: f.path });
    if (next === null || next.trim() === f.path) return;
    await act(() => renameFile(store, f.id, next));
  };

  const replace = async (f: FileInfo): Promise<void> => {
    const [chosen] = await pick(false);
    if (!chosen) return;
    await act(async () => {
      await replaceFile(store, f.id, chosen, scope === "shipped" ? { origin: "shipped" } : {});
      setFresh(new Set([f.id]));
    });
  };

  const remove = async (f: FileInfo): Promise<void> => {
    const name = f.name;
    const ok = await shellDialogs.confirm(t`Delete ${name}?`, {
      detail:
        scope === "shipped"
          ? t`${appName} will no longer come with it. Copies already installed keep theirs until they update.`
          : t`It goes from ${appName} for good. Anything in the app that uses it will no longer find it.`,
      ok: t`Delete`,
      destructive: true,
    });
    if (ok) await act(() => removeFile(store, f.id));
  };

  const menu = (f: FileInfo): MenuEntry[] => [
    { key: "open", label: t({ message: "Open", comment: "Files: open a file in the viewer" }), icon: "◱", onSelect: () => setViewing(f) },
    { key: "save", label: t`Save a copy`, icon: "⤓", onSelect: () => void saveCopy(f) },
    { key: "rename", label: t`Rename`, icon: "✎", onSelect: () => void rename(f) },
    { key: "replace", label: t({ message: "Replace…", comment: "Files: choose another file to put in this one's place" }), icon: "⇄", onSelect: () => void replace(f) },
    "separator",
    { key: "delete", label: t`Delete`, danger: true, onSelect: () => void remove(f) },
  ];

  // A drop anywhere on the panel. Counted, because dragging over a child fires leave on the parent.
  // Each event stops here: Potyro's own drop target (incoming-files-host.tsx) would otherwise cover
  // the panel and ask which app the files are for — and over an app's Files, that is this app.
  const isFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDragEnter = (e: DragEvent): void => {
    if (!isFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth.current++;
    setDropping(true);
  };
  const onDragOver = (e: DragEvent): void => {
    if (!isFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: DragEvent): void => {
    if (!isFiles(e)) return;
    e.stopPropagation();
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDropping(false);
  };
  const onDrop = (e: DragEvent): void => {
    if (!isFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setDropping(false);
    void add(Array.from(e.dataTransfer.files));
  };

  const now = Date.now();
  const justNow = t`just now`;
  const count = files?.length ?? 0;
  const size = formatSize(totalSize(files ?? []));
  const summary = plural(count, { one: `# file · ${size}`, other: `# files · ${size}` });
  const addButton = (
    <button type="button" className="k-add k-primary-action k-files-add" onClick={() => void pick(true).then(add)}>
      <span aria-hidden>＋</span> <Trans comment="Files: bring files from this device into the app">Add files</Trans>
    </button>
  );

  return (
    <section
      className="k-files"
      data-dropping={dropping || undefined}
      aria-label={scope === "shipped" ? t`Files ${appName} comes with` : t`${appName} files`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {files?.length || extra ? (
        <header className="k-files-bar">
          <p className="k-files-summary">{count ? summary : null}</p>
          <span className="k-files-bar-spacer" />
          {extra}
          {count ? addButton : null}
        </header>
      ) : null}
      {files === null ? <p className="k-files-summary">{t`Reading the folder…`}</p> : null}
      {failed ? (
        <p className="k-files-error" role="alert">
          {failed}
        </p>
      ) : null}
      {files && !files.length ? (
        <div className="k-files-empty">
          <span className="k-files-empty-mark" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <h3>{scope === "shipped" ? <Trans>{appName} comes with no files yet</Trans> : <Trans>No files yet</Trans>}</h3>
          <p>
            {scope === "shipped" ? (
              <Trans>A file added here goes wherever the app goes: everyone who installs it gets a copy, ready to use — a list to start from, a picture, a sound.</Trans>
            ) : (
              <Trans>Files you add, files {appName} makes and files it came with all show up here. Drop files on this page, or add them from this device.</Trans>
            )}
          </p>
          {addButton}
        </div>
      ) : null}
      {files?.length ? (
        <ul className="k-files-list">
          {files.map((f) => (
            <FileRow key={f.id} file={f} showOrigin={scope === "all"} fresh={fresh.has(f.id)} when={changed(f.updated, now, justNow)} onOpen={() => setViewing(f)} menu={menu(f)} />
          ))}
        </ul>
      ) : null}
      <p className="k-files-drop" aria-hidden>
        <Trans>Drop to add to {appName}</Trans>
      </p>
      {viewing ? <FileViewer store={store} file={viewing} onSave={() => void saveCopy(viewing)} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}

function OriginTag({ origin }: { origin: FileOrigin }) {
  const { t } = useLingui();
  const words: Record<FileOrigin, string> = {
    shipped: t({ message: "came with the app", comment: "Files: a file that was installed with the app" }),
    app: t({ message: "made by the app", comment: "Files: a file the app wrote itself" }),
    imported: t({ message: "added by you", comment: "Files: a file the person brought in" }),
  };
  return (
    <span className="k-files-origin" data-origin={origin}>
      {words[origin]}
    </span>
  );
}

function FileRow({ file, showOrigin, fresh, when, onOpen, menu }: { file: FileInfo; showOrigin: boolean; fresh: boolean; when: string; onOpen: () => void; menu: MenuEntry[] }) {
  const { t } = useLingui();
  const slash = file.path.lastIndexOf("/");
  const folder = slash > 0 ? file.path.slice(0, slash) : "";
  const name = file.name;
  return (
    <li className="k-files-row" data-fresh={fresh || undefined}>
      <button type="button" className="k-files-open" onClick={onOpen} aria-label={t`Open ${name}`}>
        <span className="k-files-tag" style={{ "--k-hue": hueOf(file) } as CSSProperties} aria-hidden>
          {tagOf(file)}
        </span>
        <span className="k-files-name">
          <strong>{file.name}</strong>
          {folder ? <span className="k-files-folder">{folder}/</span> : null}
        </span>
        <span className="k-files-meta" data-no-origin={showOrigin ? undefined : true}>
          {showOrigin ? <OriginTag origin={file.origin} /> : null}
          <span className="k-files-size">{formatSize(file.size)}</span>
          <time className="k-files-when" dateTime={file.updated}>
            {when}
          </time>
        </span>
      </button>
      <ActionMenu label={t`More for ${name}`} title={file.name} entries={menu} buttonClassName="k-files-more" />
    </li>
  );
}
