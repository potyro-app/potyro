// History panel — what the agent changed, and the way back.
//
// An AI edit rewrites the whole app module, so "what changed?" is only answerable by diffing against
// the previous source. This panel lists an app's versions newest-first with the instruction that
// produced each one, shows the diff of a version against its parent (or against what is running
// now), and restores any of them.
//
// Restoring APPENDS the old source as a new version rather than truncating the log — so rolling back
// is itself undoable, and no history is destroyed by a panicked click.
//
// ## The TIMELINE is the view; a diff is something you ask for
//
// This was a two-pane master/detail that auto-selected the newest version, so opening History put a
// sixty-line diff on screen before you had asked anything. Below 720px the panes stacked and the
// diff pushed the list of versions off the top entirely: the question people actually open this to
// answer — "what has happened to my app?" — was the one thing not visible.
//
// So: one list, full width, nothing expanded. The prompt that produced each version is the headline,
// because that is what a person recognises their own change by; the diff is inside the entry and
// opens when you click it. An accordion rather than a second pane deliberately — the timeline stays
// the spine at every width, instead of being a sidebar that a narrow window turns back into a sliver.

import { useEffect, useState } from "react";
import { diffLines, diffStat, toHunks, type DiffLine } from "./diff.js";
import { listVersions, type AppVersion } from "./app-history.js";
import { listDiagnoses, type AppDiagnosis } from "./app-diagnoses.js";
import { highlightLines, type CodeRun } from "./highlight.js";
import { saveUserApp, getUserApp } from "./user-apps.js";

const ORIGIN_LABEL: Record<AppVersion["origin"], string> = {
  created: "created",
  // Not "AI edit": a Studio save from the source editor lands here too, and mislabelling a hand
  // edit as the agent's work is exactly the confusion history exists to remove.
  edited: "edit",
  // "you changed this" vs "the agent rewrote the file" — see VersionOrigin.
  adjusted: "adjusted",
  restored: "restored",
  imported: "imported",
};

function when(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The highlighted form of both sides of the diff, indexed by 1-based line number. */
interface Painted {
  before: CodeRun[][];
  after: CodeRun[][];
}

/**
 * Colour for one diff row.
 *
 * A diff line is a line of one specific side, so it is looked up in that side's highlighting rather
 * than tokenised on its own: a lone closing brace or a bare comment terminator says nothing in
 * isolation, and a line lifted out of a template literal would be read as code. Falls back to plain
 * text before the paint arrives, or if the line numbers and the highlighting ever disagree.
 */
function DiffCode({ line, painted }: { line: DiffLine; painted: Painted | null }) {
  const side = line.kind === "del" ? painted?.before : painted?.after;
  const index = (line.kind === "del" ? line.a : line.b ?? line.a) ?? 0;
  const runs = side?.[index - 1];
  if (!runs || runs.map((r) => r.text).join("") !== line.text) return <code>{line.text || " "}</code>;
  return (
    <code>
      {runs.map((run, i) => (run.cls ? <span key={i} className={run.cls}>{run.text}</span> : run.text))}
      {line.text ? null : " "}
    </code>
  );
}

function Diff({ lines, painted }: { lines: DiffLine[]; painted: Painted | null }) {
  const hunks = toHunks(lines);
  if (!hunks.length) return <p className="k-muted">No changes between these two versions.</p>;
  return (
    <div className="k-diff k-syntax" role="group" aria-label="Changes">
      {hunks.map((h, i) => (
        <div key={i} className="k-diff-hunk">
          {h.skippedBefore ? <div className="k-diff-gap">⋯ {h.skippedBefore} unchanged lines</div> : null}
          {h.lines.map((l, j) => (
            <div key={j} className={`k-diff-line k-diff-${l.kind}`}>
              <span className="k-diff-num" aria-hidden>{l.kind === "add" ? l.b : l.a}</span>
              <span className="k-diff-sign" aria-hidden>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
              <DiffCode line={l} painted={painted} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface HistoryProps {
  appId: string;
  appName: string;
  onClose: () => void;
  /** Called after a successful restore with the source now saved — the caller decides how to re-run
   *  the app (a reload in the shell; a rebuilt preview in the Studio). */
  onRestored?: (source: string) => void;
  /** Render as a plain block for the Studio's History tab instead of as a modal over the app. */
  embedded?: boolean;
}

export function History({ appId, appName, onClose, onRestored, embedded }: HistoryProps) {
  const [versions, setVersions] = useState<AppVersion[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [against, setAgainst] = useState<"parent" | "current">("parent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Changes that were deliberately NOT made, because the cause was host-side. They belong next to
  // the versions: "we looked, and the app wasn't the problem" is part of how this app got here.
  const [diagnoses, setDiagnoses] = useState<AppDiagnosis[]>([]);

  useEffect(() => {
    let live = true;
    void listVersions(appId).then((v) => {
      if (!live) return;
      setVersions(v);
      // Nothing opened. Auto-selecting the newest was what buried the timeline under a diff nobody
      // had asked for — see the header.
    });
    void listDiagnoses(appId).then((d) => {
      if (live) setDiagnoses(d);
    });
    return () => {
      live = false;
    };
  }, [appId]);

  const list = versions ?? [];
  const current = list.find((v) => v.seq === selected) ?? null;
  const parent = current ? list.find((v) => v.seq === current.seq - 1) ?? null : null;
  const newest = list[0] ?? null;
  // Default to the parent — "what did this change do?". The oldest version kept has no parent, so it
  // falls back to what's running: for a version you're considering restoring, "how does this differ
  // from what I have now?" is the question anyway, and an empty panel answered nothing.
  const candidate = against === "current" ? newest : parent ?? newest;
  const before = current && candidate && candidate.seq !== current.seq ? candidate : null;
  const lines = current && before ? diffLines(before.source, current.source) : [];
  const stat = diffStat(lines);

  // Highlight each SIDE once, not each row: tokenising a diff line alone loses the context that
  // tells a `}` from the inside of a template literal.
  const [painted, setPainted] = useState<Painted | null>(null);
  const beforeSource = before?.source;
  const currentSource = current?.source;
  useEffect(() => {
    if (beforeSource === undefined || currentSource === undefined) {
      setPainted(null);
      return;
    }
    let live = true;
    void Promise.all([highlightLines(beforeSource), highlightLines(currentSource)]).then(([b, a]) => {
      if (live) setPainted({ before: b, after: a });
    });
    return () => {
      live = false;
    };
  }, [beforeSource, currentSource]);
  const canToggle = Boolean(parent && newest && current && current.seq !== newest.seq && parent.seq !== newest.seq);

  const restore = async (v: AppVersion): Promise<void> => {
    const app = getUserApp(appId);
    if (!app) return;
    setBusy(true);
    setError(null);
    try {
      await saveUserApp(
        { id: appId, name: app.name, source: v.source, origin: "restored", note: `rolled back to version ${v.seq}` },
        new Date().toISOString(),
      );
      onRestored?.(v.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const body = (
    <>
        <header className="k-history-head">
          <div>
            <h3>History</h3>
            <p className="k-muted">Every version of <strong>{appName}</strong> — review a change, or roll back to it.</p>
          </div>
          {embedded ? null : (
            <button type="button" className="k-add" aria-label="Close history" onClick={onClose}>Close ✕</button>
          )}
        </header>

        {versions === null ? (
          <p className="k-muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="k-muted">
            No versions yet. The next change you save — in the Studio or with Edit mode — is recorded here.
          </p>
        ) : (
          <ol className="k-timeline" aria-label="Versions">
            {list.map((v) => {
              const open = v.seq === selected;
              return (
                <li key={v.seq} className="k-timeline-entry" data-open={open || undefined}>
                  <button
                    type="button"
                    className="k-timeline-row"
                    aria-expanded={open}
                    onClick={() => setSelected(open ? null : v.seq)}
                  >
                    <span className="k-timeline-dot" aria-hidden />
                    <span className="k-timeline-main">
                      {/* The prompt first and largest. It is what someone recognises their own change
                          by — "v7 · edit · 3h ago" identifies nothing. */}
                      <span className="k-timeline-note">
                        {v.note ?? <span className="k-muted">no description recorded</span>}
                      </span>
                      <span className="k-timeline-meta">
                        <span className="k-history-seq">v{v.seq}</span>
                        <span className={`k-history-origin k-history-origin-${v.origin}`}>{ORIGIN_LABEL[v.origin]}</span>
                        {v.seq === newest?.seq ? <span className="k-history-now">running now</span> : null}
                        <span className="k-muted k-history-when">{when(v.createdAt)}</span>
                      </span>
                    </span>
                    <span className="k-timeline-chevron" aria-hidden>
                      {open ? "▾" : "▸"}
                    </span>
                  </button>

                  {open && current ? (
                    <section className="k-history-detail" aria-label={`Changes in version ${current.seq}`}>
                      {/* The agent's own account of the change. It is kept here rather than as
                          comments in the source precisely so it informs you without becoming the
                          next edit's premise — see AppVersion.rationale. */}
                      {current.rationale ? <p className="k-history-rationale">{current.rationale}</p> : null}
                      <div className="k-history-detailhead">
                        <div className="k-muted">
                          {before
                            ? `vs v${before.seq}${before.seq === newest?.seq ? " (running)" : ""} · +${stat.added} −${stat.removed}`
                            : "the only version kept — nothing to compare against"}
                        </div>
                        <div className="k-history-detailactions">
                          {canToggle ? (
                            <button
                              type="button"
                              className="k-add"
                              data-active={against === "current"}
                              onClick={() => setAgainst(against === "current" ? "parent" : "current")}
                            >
                              {against === "current" ? "vs previous" : "vs running"}
                            </button>
                          ) : null}
                          {/* No disabled Restore on the version already running — an amber button you
                              cannot press reads as a dead control. Say why instead. */}
                          {current.seq === newest?.seq ? (
                            <span className="k-muted">this version is running</span>
                          ) : (
                            <button
                              type="button"
                              className="k-add k-primary-action"
                              disabled={busy}
                              title={`Roll back to v${current.seq}`}
                              onClick={() => void restore(current)}
                            >
                              {busy ? "Restoring…" : `Restore v${current.seq}`}
                            </button>
                          )}
                        </div>
                      </div>
                      {error ? <p className="k-form-error">{error}</p> : null}
                      <Diff lines={lines} painted={painted} />
                    </section>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}

        {diagnoses.length ? (
          <section className="k-history-diagnoses" aria-label="Reported as host-side">
            <h4>Asked for, but not this app&rsquo;s to fix</h4>
            <p className="k-muted">
              Times the agent was asked for a change this app cannot express, and said so instead of editing
              something that would not have helped. No version was written for these.
            </p>
            <ul>
              {diagnoses.map((d) => (
                <li key={d.id}>
                  <span className="k-history-note">{d.complaint}</span>
                  <span className="k-diagnosis-body">{d.text}</span>
                  <span className="k-muted k-history-when">{when(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
    </>
  );

  // Embedded: the Studio's History tab, where the timeline IS the view and there is nothing to
  // dismiss. Modal: opened over an app from My Apps, where it is.
  if (embedded) return <div className="k-history k-history-embedded">{body}</div>;
  return (
    <div className="k-modal-scrim" onClick={() => (busy ? undefined : onClose())}>
      <div className="k-modal k-history" role="dialog" aria-label={`History of ${appName}`} onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}
