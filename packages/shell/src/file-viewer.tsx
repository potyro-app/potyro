// A file from an app's folder, opened to look at (#254). Read-only: a text file is shown as text, a
// picture, a sound or a video plays, anything else says what it is and offers a copy to open
// elsewhere. Changing a file is the app's business, or Replace's; this only shows what is there.

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "potyro";
import type { Store } from "@potyro/store";
import { formatSize } from "@potyro/views";
import { readForView, type FileView } from "./app-folder.js";

export interface FileViewerProps {
  store: Store;
  file: FileInfo;
  onSave: () => void;
  onClose: () => void;
}

export function FileViewer({ store, file, onSave, onClose }: FileViewerProps) {
  const { t } = useLingui();
  const [view, setView] = useState<FileView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    readForView(store, file.id)
      .then((v) => {
        if ("url" in v) url = v.url;
        if (live) setView(v);
      })
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    closeRef.current?.focus();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [store, file.id, file.updated]);

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
          <button type="button" className="k-add" onClick={onSave}>
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
            <p className="k-viewer-note">
              <Trans>{name} is not on this device yet.</Trans>
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
