// What the replay found, in the user's terms. Their expectation leads, because that is the question
// being answered — the steps are the evidence, not the headline.

import type { ReplayReport } from "@karta/runtime";

export function CaseReport({ report, onClose }: { report: ReplayReport; onClose: () => void }) {
  return (
    <div className="k-case-report" role="dialog" aria-label="What happened">
      <h3>{report.title || "What happened"}</h3>
      {report.expectation ? <p className="k-case-expect">You expected: {report.expectation}</p> : null}
      <ol>
        {report.outcomes.map((o, i) => (
          <li key={i} className="k-case-step" data-ok={o.ok}>
            {o.ok ? "✓" : "✗"} {o.detail}
          </li>
        ))}
      </ol>
      <button type="button" className="k-add" onClick={onClose}>Close</button>
    </div>
  );
}
