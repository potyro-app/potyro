// The `file` field (#252): a file in the app's own folder, held by id so a rename never breaks it.
//
// In a form it is a chip naming the file, or a button that says what it wants. The button opens a
// menu: bring a file in from this device, or pick one already in the app's folder, newest first,
// narrowed by the field's `accept`. On the record page the chip opens the file, and a second button
// saves a copy outside the app.
//
// The chip shows the name the field remembered, and then the file's CURRENT name once the folder
// answers: a file renamed since the field was set should not be shown under its old name.

import { fmt } from "@potyro/i18n";
import { t as tr } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { FileField, FileInfo, FileRef } from "potyro";
import { ActionMenu, type MenuEntry } from "./menu.js";

const MAX_CHOICES = 12;

/** Does a file match an `accept` string like `.md,.txt`, `text/*` or `application/pdf`? */
export function matchesAccept(file: Pick<FileInfo, "name" | "mime">, accept: string | undefined): boolean {
  if (!accept || !accept.trim()) return true;
  const name = file.name.toLowerCase();
  const mime = file.mime.toLowerCase();
  return accept
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => (a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? mime.startsWith(a.slice(0, -1)) : mime === a));
}

const refOf = (f: FileInfo): FileRef => ({ id: f.id, path: f.path, name: f.name, mime: f.mime });

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    const n = fmt.number(bytes);
    return tr({ message: `${n} B`, comment: "A size in bytes" });
  }
  if (bytes < 1024 * 1024) {
    const digits = bytes < 10 * 1024 ? 1 : 0;
    const n = fmt.number(bytes / 1024, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return tr({ message: `${n} KB`, comment: "A size in kilobytes" });
  }
  const n = fmt.number(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return tr({ message: `${n} MB`, comment: "A size in megabytes" });
}

/** The file a ref points at, as the folder has it now; `null` once it is known to be gone. */
function useFileInfo(runtime: PotyroRuntime, ref: FileRef | null): FileInfo | null | undefined {
  const [info, setInfo] = useState<FileInfo | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!ref) {
      setInfo(null);
      return;
    }
    setInfo(undefined);
    runtime.ctx.files
      .stat(ref)
      .then((f) => live && setInfo(f))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [runtime, ref?.id]);
  return info;
}

function glyphOf(mime: string): string {
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.startsWith("video/")) return "🎬";
  if (mime === "application/pdf") return "📕";
  if (mime.startsWith("text/") || mime.includes("json")) return "📄";
  return "📎";
}

function FileChip({ runtime, value, info }: { runtime: PotyroRuntime; value: FileRef; info: FileInfo | null | undefined }) {
  const name = info?.name ?? value.name ?? value.path ?? "File";
  const mime = info?.mime ?? value.mime ?? "";
  const gone = info === null;
  const open = async (): Promise<void> => {
    const url = await runtime.ctx.files.url(value).catch(() => null);
    if (url) window.open(url, "_blank", "noopener");
  };
  return (
    <span className="k-file-chip" data-gone={gone || undefined}>
      <span className="k-file-glyph" aria-hidden>
        {glyphOf(mime)}
      </span>
      {gone ? (
        <span className="k-file-name">
          {name}{" "}
          <span className="k-muted">
            · <Trans>no longer in this app</Trans>
          </span>
        </span>
      ) : (
        <button type="button" className="k-file-name" onClick={() => void open()} title={info?.path ?? value.path}>
          {name}
        </button>
      )}
      {info ? <span className="k-file-size">{formatSize(info.size)}</span> : null}
    </span>
  );
}

export interface FileInputProps {
  runtime: PotyroRuntime;
  field: FileField;
  value: FileRef | null;
  onChange: (v: unknown) => void;
  label?: string;
}

export function FileInput({ runtime, field, value, onChange, label }: FileInputProps) {
  const { t } = useLingui();
  const info = useFileInfo(runtime, value);
  const [choices, setChoices] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // What is already in the folder, so a file imported for one record can be chosen for another.
  useEffect(() => {
    let live = true;
    runtime.ctx.files
      .list()
      .then((all) => {
        if (!live) return;
        const fit = all.filter((f) => matchesAccept(f, field.accept)).sort((a, b) => b.updated.localeCompare(a.updated));
        setChoices(fit.slice(0, MAX_CHOICES));
      })
      .catch(() => live && setChoices([]));
    return () => {
      live = false;
    };
  }, [runtime, field.accept, value?.id]);

  const bringIn = async (): Promise<void> => {
    setFailed(null);
    setBusy(true);
    try {
      const [landed] = await runtime.ctx.files.import({ folder: field.folder, accept: field.accept, multiple: false });
      if (landed) onChange(refOf(landed));
    } catch (err) {
      // The person chose a file; if it did not land they must be told why.
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const others = choices.filter((f) => f.id !== value?.id);
  const entries: MenuEntry[] = [
    { key: "import", label: t`From this device…`, icon: "⤓", onSelect: () => void bringIn() },
    ...(others.length ? (["separator"] as MenuEntry[]) : []),
    ...others.map<MenuEntry>((f) => ({
      key: f.id,
      label: f.path,
      icon: glyphOf(f.mime),
      hint: formatSize(f.size),
      onSelect: () => onChange(refOf(f)),
    })),
  ];
  const word = value ? t({ message: "Change", comment: "Pick another file for a file field" }) : t`Choose a file`;
  const wordAfter = value ? t({ message: "change", comment: "After a field's name and a colon, lower case: pick another file" }) : t({ message: "choose a file", comment: "After a field's name and a colon, lower case" });

  return (
    <div className="k-file">
      {value ? <FileChip runtime={runtime} value={value} info={info} /> : null}
      <ActionMenu
        label={label ? t({ message: `${label}: ${wordAfter}`, comment: "A file field's button: the field's name, then what it does" }) : word}
        title={label ?? t({ message: "File", comment: "A file field with no name of its own" })}
        entries={entries}
        busy={busy}
        buttonClassName="k-file-pick"
        trigger={busy ? t`Bringing it in…` : word}
      />
      {value ? (
        <button type="button" className="k-file-clear" onClick={() => onChange(null)} aria-label={label ? t({ message: `Remove: ${label}`, comment: "Clear a file field; label is the field's name" }) : t`Remove file`}>
          <Trans>Remove</Trans>
        </button>
      ) : null}
      {failed ? (
        <p className="k-file-failed" role="alert">
          <Trans>Couldn’t bring it in: {failed}</Trans>
        </p>
      ) : null}
    </div>
  );
}

/** A `file` value on the record page or in a row: open it, or save a copy outside the app. */
export function FileValue({ runtime, value }: { runtime: PotyroRuntime; value: FileRef | null }) {
  const { t } = useLingui();
  const info = useFileInfo(runtime, value);
  if (!value) return <span className="k-muted">–</span>;
  const fileName = info?.name ?? "";
  return (
    <span className="k-file k-file-read">
      <FileChip runtime={runtime} value={value} info={info} />
      {info ? (
        <button type="button" className="k-file-export" onClick={() => void runtime.ctx.files.export(value)} aria-label={t`Save a copy of ${fileName}`}>
          <Trans>Save a copy</Trans>
        </button>
      ) : null}
    </span>
  );
}
