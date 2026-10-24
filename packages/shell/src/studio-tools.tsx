// The app's code and its history, behind the conversation (#261).
//
// The Studio used to open on three tabs — Preview, Source, History — with the code one tap from the
// app. For the people Potyro is for, the code is not the app: it is what you open when you want to
// look underneath. So it lives here, reached from the menu, from an opened app's bar, or from a card,
// and the conversation is what the Studio opens on.
//
// What it keeps from the old stage: editing the source by hand and running it, saving that edit as
// a version, every version with a diff and a way back, and the problems people reported, replayable.
// And beside the code, the files the app ships with (#254): part of the app, like its code.

import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { Case } from "@potyro/runtime";
import { caseLabel } from "./app-cases.js";
import { CodeEditor } from "./code-editor.js";
import { History } from "./history.js";
import { StudioFiles } from "./studio-files.js";

export type ToolsTab = "source" | "files" | "history";

export interface StudioToolsProps {
  initialTab: ToolsTab;
  source: string;
  onSourceChange: (next: string) => void;
  /** Build what is in the editor; what it finds wrong comes back as `error`. */
  onRun: () => Promise<void>;
  /** Save what is in the editor as a version. */
  onSave: () => Promise<void>;
  /** Problems with what is in the editor, as the last run found them. */
  error: string | null;
  busy: boolean;
  /** Null until there is an app to have a history. */
  app: { id: string; name: string } | null;
  cases: readonly Case[];
  onReplay: (c: Case) => void;
  onRestored: (source: string) => void;
  onClose: () => void;
  /** The app as the preview loaded it: what a package says it is (#271). */
  definition?: unknown;
  /**
   * The app's own modules (#258, #448), by their path in `src/`, as they are in the editor: listed
   * beside the entry file, each one editable. Absent for an app that is one file.
   */
  modules?: Record<string, string>;
  onModuleChange?: (path: string, next: string) => void;
  /** Modules whose text differs from the saved app's: marked in the list until saved. */
  changed?: ReadonlySet<string>;
}

export function StudioTools({ initialTab, source, onSourceChange, onRun, onSave, error, busy, app, cases, onReplay, onRestored, onClose, definition, modules, onModuleChange, changed }: StudioToolsProps) {
  const { t } = useLingui();
  // Which file the editor shows: the entry (null), or one of the app's own modules.
  const [file, setFile] = useState<string | null>(null);
  const paths = Object.keys(modules ?? {}).sort();
  const shown = file !== null && modules && file in modules ? file : null;
  // Files belong to a saved app: before there is one, the tab is not offered.
  const [tab, setTab] = useState<ToolsTab>(initialTab === "files" && !app ? "source" : initialTab);
  return (
    <div className="k-modal-scrim k-tools-scrim" onClick={onClose}>
      <section
        className="k-tools-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t`Code, files and history`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <header className="k-tools-head">
          <div className="k-studio-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "source"} className="k-tab" data-active={tab === "source"} onClick={() => setTab("source")}>
              <Trans comment="Tab: the app's source code">Source</Trans>
            </button>
            {app ? (
              <button type="button" role="tab" aria-selected={tab === "files"} className="k-tab" data-active={tab === "files"} onClick={() => setTab("files")}>
                <Trans comment="Tab: the files an app ships with">Files</Trans>
              </button>
            ) : null}
            <button type="button" role="tab" aria-selected={tab === "history"} className="k-tab" data-active={tab === "history"} onClick={() => setTab("history")}>
              <Trans>History</Trans>
            </button>
          </div>
          <span className="k-studio-tabs-spacer" />
          {tab === "source" ? (
            <>
              <button type="button" className="k-add" disabled={busy} onClick={() => void onRun()}>
                {busy ? t`Building` : t({ message: "Run ▶", comment: "Button: build and run the code in the editor" })}
              </button>
              <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void onSave()}>
                <Trans>Save changes</Trans>
              </button>
            </>
          ) : null}
          <button type="button" className="k-tools-close" aria-label={t`Close code, files and history`} onClick={onClose}>
            ✕
          </button>
        </header>
        {tab === "source" ? (
          <div className="k-tools-body">
            {error ? <p className="k-form-error k-studio-error">{error}</p> : null}
            {paths.length ? (
              <div className="k-chips k-tools-files" role="group" aria-label={t({ message: "The app's files", comment: "The Studio's code: the list of files the app's code is made of" })}>
                <button type="button" className="k-chip" data-on={shown === null} aria-pressed={shown === null} onClick={() => setFile(null)}>
                  <Trans comment="The Studio's code: the app's main file, beside the modules it imports">The app</Trans>
                </button>
                {paths.map((path) => (
                  <button key={path} type="button" className="k-chip" data-on={shown === path} aria-pressed={shown === path} data-changed={changed?.has(path) || undefined} onClick={() => setFile(path)}>
                    <code>{path}</code>
                    {changed?.has(path) ? <span className="k-tools-file-changed" aria-label={t({ message: "changed", comment: "The Studio's code: a file edited but not saved yet" })} title={t({ message: "changed", comment: "The Studio's code: a file edited but not saved yet" })} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {shown === null ? (
              <CodeEditor key="app" className="k-studio-source" label={t`App source`} value={source} onChange={onSourceChange} />
            ) : (
              <CodeEditor key={shown} className="k-studio-source" label={shown} value={modules![shown]!} onChange={(next) => onModuleChange?.(shown, next)} />
            )}
          </div>
        ) : tab === "files" && app ? (
          <StudioFiles app={app} definition={definition} />
        ) : (
          <div className="k-tools-body k-studio-history" aria-label={t`App history`}>
            {/* What people reported, above the versions — evidence someone handed you reads first. */}
            {app && cases.length ? (
              <section className="k-cases-section">
                <h3 className="k-field-label">
                  <Trans>Reported problems</Trans>
                </h3>
                <ul className="k-cases">
                  {cases.map((c) => (
                    <li key={c.id}>
                      <span className="k-case-title">{caseLabel(c)}</span>
                      <button type="button" className="k-add" title={t`Replay this path against the app`} onClick={() => onReplay(c)}>
                        <Trans comment="Button: run a reported problem's steps again">Replay</Trans>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {app ? (
              <History appId={app.id} appName={app.name} embedded onClose={onClose} onRestored={onRestored} />
            ) : (
              <p className="k-muted">
                <Trans>Nothing yet. Once the app is made, every version shows up here — what was asked, and the way back to it.</Trans>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
