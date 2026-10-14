// A file from an app's folder, opened to look at (#254). Read-only: a text file is shown as text, a
// picture, a sound or a video plays, anything else says what it is and offers a copy to open
// elsewhere. Changing a file is the app's business, or Replace's; this only shows what is there.
//
// In a shared app (#255) opening a file is what brings it to this device: the read asks for it, the
// viewer says it is on its way (or that it will come once this device is online), and shows it the
// moment it arrives. Below the file, its earlier copies — what newer writes replaced, kept for a
// while — can be brought back.

import { fmt } from "@potyro/i18n";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileInfo } from "potyro";
import type { EarlierCopy, Store } from "@potyro/store";
import { formatSize } from "@potyro/views";
import { earlierCopies, readForView, restoreCopy, watchArrival, type FileView } from "./app-folder.js";
import { shellDialogs } from "./dialog.js";

export interface FileViewerProps {
  store: Store;
  file: FileInfo;
  onSave: () => void;
  /** The file changed here (an earlier copy came back, or its bytes arrived): the list re-reads. */
  onChanged?: () => void;
  onClose: () => void;
}

const isOnline = (): boolean => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

export function FileViewer({ store, file, onSave, onChanged, onClose }: FileViewerProps) {
  const { t } = useLingui();
  const [view, setView] = useState<FileView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline);
  const [earlier, setEarlier] = useState<EarlierCopy[]>([]);
  const [version, setVersion] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const url = useRef<string | null>(null);

  const read = useCallback(async (): Promise<FileView> => {
    const v = await readForView(store, file.id);
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "url" in v ? v.url : null;
    return v;
  }, [store, file.id]);

  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    const show = (): void =>
      void read()
        .then((v) => {
          if (!live) return;
          setView(v);
          setFailed(null);
        })
        .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    show();
    // Reading asked for it; when it lands, show it — and the list stops saying it is not here.
    void watchArrival(store, file.id, () => {
      show();
      onChanged?.();
    }).then((s) => (live ? (stop = s) : s()));
    void earlierCopies(store, file.id).then((c) => live && setEarlier(c), () => {});
    const backOnline = (): void => {
      setOnline(true);
      show();
    };
    const offline = (): void => setOnline(false);
    window.addEventListener("online", backOnline);
    window.addEventListener("offline", offline);
    closeRef.current?.focus();
    return () => {
      live = false;
      stop?.();
      window.removeEventListener("online", backOnline);
      window.removeEventListener("offline", offline);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    };
    // `onChanged` is the panel's reload, a new function each render: not a reason to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, file.id, file.updated, read, version]);

  const restore = async (copy: EarlierCopy): Promise<void> => {
    const when = fmt.date(copy.updated, { dateStyle: "medium", timeStyle: "short" });
    const ok = await shellDialogs.confirm(t`Bring back the copy from ${when}?`, {
      detail: t`The file as it is now is kept as an earlier copy, so you can change your mind.`,
      ok: t({ message: "Bring it back", comment: "Restore an earlier copy of a file" }),
    });
    if (!ok) return;
    try {
      await restoreCopy(store, file.id, copy);
      setVersion((n) => n + 1);
      onChanged?.();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  };

  const name = file.name;
  const size = formatSize(file.size);
  return (
    <div className="k-modal-scrim k-viewer-scrim" onClick={onClose}>
      <section
        className="k-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="k-viewer-head">
          <div className="k-viewer-title">
            <h3>{name}</h3>
            <p>
              {file.path !== file.name ? <span className="k-viewer-path">{file.path} · </span> : null}
              {size}
            </p>
          </div>
          <button type="button" className="k-add" onClick={onSave} disabled={view?.kind === "missing"}>
            <span aria-hidden>⤓</span> <Trans>Save a copy</Trans>
          </button>
          <button ref={closeRef} type="button" className="k-tools-close" aria-label={t`Close ${name}`} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="k-viewer-body" data-kind={view?.kind}>
          {failed ? <p className="k-files-error">{failed}</p> : null}
          {!view && !failed ? <p className="k-muted">{t`Opening ${name}…`}</p> : null}
          {view?.kind === "text" ? (
            <>
              <pre className="k-viewer-text" tabIndex={0} aria-label={t`Contents of ${name}`}>
                {view.text}
              </pre>
              {view.cut ? (
                <p className="k-viewer-note">
                  <Trans>This is the beginning of {name}. Save a copy to read all of it.</Trans>
                </p>
              ) : null}
            </>
          ) : null}
          {view?.kind === "image" ? <img className="k-viewer-media" src={view.url} alt={name} /> : null}
          {view?.kind === "audio" ? <audio className="k-viewer-media" src={view.url} controls /> : null}
          {view?.kind === "video" ? <video className="k-viewer-media" src={view.url} controls /> : null}
          {view?.kind === "none" ? (
            <p className="k-viewer-note">
              <Trans>Potyro can’t show this kind of file. Save a copy to open it with another app.</Trans>
            </p>
          ) : null}
          {view?.kind === "missing" ? (
            <div className="k-viewer-away" role="status">
              <span className="k-viewer-away-mark" data-online={online || undefined} aria-hidden />
              <strong>
                <Trans>{name} is not on this device yet.</Trans>
              </strong>
              <span>
                {online ? (
                  <Trans>Getting it from the shared app now — it opens here when it arrives, and stays on this device after.</Trans>
                ) : (
                  <Trans>This device is offline. It arrives once it is back online.</Trans>
                )}
              </span>
            </div>
          ) : null}
        </div>
        {earlier.length ? (
          <footer className="k-viewer-earlier">
            <h4>
              <Trans comment="Files viewer: copies of this file that newer writes replaced">Earlier copies</Trans>
            </h4>
            <ul>
              {earlier.map((c) => (
                <li key={`${c.blob}:${c.replaced}`}>
                  <span>
                    <time dateTime={c.updated}>{fmt.date(c.updated, { dateStyle: "medium", timeStyle: "short" })}</time> · {formatSize(c.size)}
                  </span>
                  <button type="button" className="k-add" onClick={() => void restore(c)}>
                    <Trans comment="Restore an earlier copy of a file">Bring back</Trans>
                  </button>
                </li>
              ))}
            </ul>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
