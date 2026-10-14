// The app's code and its history, behind the conversation (#261).
//
// The Studio used to open on three tabs — Preview, Source, History — with the code one tap from the
// app. For the people Potyro is for, the code is not the app: it is what you open when you want to
// look underneath. So it lives here, reached from the menu, from an opened app's bar, or from a card,
// and the conversation is what the Studio opens on.
//
// What it keeps from the old stage: editing the source by hand and running it, saving that edit as
// a version, every version with a diff and a way back, and the problems people reported, replayable.

import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { Case } from "@potyro/runtime";
import { caseLabel } from "./app-cases.js";
import { CodeEditor } from "./code-editor.js";
import { History } from "./history.js";

export type ToolsTab = "source" | "history";

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
}

export function StudioTools({ initialTab, source, onSourceChange, onRun, onSave, error, busy, app, cases, onReplay, onRestored, onClose }: StudioToolsProps) {
  const { t } = useLingui();
  const [tab, setTab] = useState<ToolsTab>(initialTab);
  return (
    <div className="k-modal-scrim k-tools-scrim" onClick={onClose}>
      <section
        className="k-tools-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t`Code and history`}
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
            <button type="button" role="tab" aria-selected={tab === "history"} className="k-tab" data-active={tab === "history"} onClick={() => setTab("history")}>
              <Trans>History</Trans>
            </button>
          </div>
          <span className="k-studio-tabs-spacer" />
          {tab === "source" ? (
            <>
              <button type="button" className="k-add" disabled={busy} onClick={() => void onRun()}>
                {busy ? t`Building…` : t({ message: "Run ▶", comment: "Button: build and run the code in the editor" })}
              </button>
              <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void onSave()}>
                <Trans>Save changes</Trans>
              </button>
            </>
          ) : null}
          <button type="button" className="k-tools-close" aria-label={t`Close code and history`} onClick={onClose}>
            ✕
          </button>
        </header>
        {tab === "source" ? (
          <div className="k-tools-body">
            {error ? <p className="k-form-error k-studio-error">{error}</p> : null}
            <CodeEditor className="k-studio-source" label={t`App source`} value={source} onChange={onSourceChange} />
          </div>
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
