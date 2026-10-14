// What the replay found, in the user's terms. Their expectation leads, because that is the question
// being answered — the steps are the evidence, not the headline.

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReplayReport } from "@potyro/runtime";

export function CaseReport({
  report,
  lostSteps,
  onClose,
}: {
  report: ReplayReport;
  /** Steps the recorder dropped while capturing this case (CaseRecorder.lost, App.tsx). Shown as a
   *  plain warning when non-zero: a report that otherwise reads clean below it must not be mistaken
   *  for proof the whole path was captured. */
  lostSteps?: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const expectation = report.expectation;
  return (
    <div className="k-case-report" role="dialog" aria-label={t`What happened`}>
      <h3>{report.title || t`What happened`}</h3>
      {lostSteps ? (
        <p className="k-case-lost">
          <Plural
            value={lostSteps}
            one="Part of this recording was lost — # step could not be captured."
            other="Part of this recording was lost — # steps could not be captured."
          />
        </p>
      ) : null}
      {report.expectation ? <p className="k-case-expect">
          <Trans>You expected: {expectation}</Trans>
        </p> : null}
      <ol>
        {report.outcomes.map((o, i) =>
          // An `expect` step is the user's own words, not a check the replay ran — it can't fail,
          // so marking it ✓/✗ next to steps that genuinely can reads as "your expectation was met"
          // (it already leads the report above). Neutral marker, no data-ok: nothing here claims a
          // pass or a fail.
          o.step.kind === "expect" ? (
            <li key={i} className="k-case-step">
              · {o.detail}
            </li>
          ) : (
            <li key={i} className="k-case-step" data-ok={o.ok}>
              {o.ok ? "✓" : "✗"} {o.detail}
            </li>
          ),
        )}
      </ol>
      <button type="button" className="k-add" onClick={onClose}>
        <Trans comment="Button: close the replay report">Close</Trans>
      </button>
    </div>
  );
}
