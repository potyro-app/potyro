// The page's summary figures, rendered above its view — alongside the filter chips, because they
// answer the same question: "what am I looking at, and what does it add up to?"
//
// It runs the page query itself rather than receiving rows, which costs a second query per write on
// a page that HAS figures. That is the price of the figures tracking the filter chips exactly: a
// total that disagreed with the rows beneath it would read as a bug, and threading rows up from
// inside the view would mean every view type had to cooperate.
//
// A page with no `summary` pays none of it. The query used to run there too — every record read a
// second time, on every change, to render nothing — which is why the strip is split in two: the
// component that decides calls no hooks, so the one that queries only exists when there is a figure
// to compute.

import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { PotyroRuntime } from "@potyro/runtime";
import type { Field, Resolved, SummaryValue } from "potyro";
import { computeSummary, type SummaryFigure } from "@potyro/views";

interface SummaryStripProps {
  runtime: PotyroRuntime;
  pageId: string;
  params: Record<string, unknown>;
}

export function SummaryStrip({ runtime, pageId, params }: SummaryStripProps) {
  const page = runtime.definition.pages.find((p) => p.id === pageId);
  const specs = page?.summary as SummaryValue[] | undefined;
  if (!specs?.length) return null;
  return <Figures runtime={runtime} pageId={pageId} params={params} specs={specs} />;
}

function Figures({ runtime, pageId, params, specs }: SummaryStripProps & { specs: SummaryValue[] }) {
  const { t } = useLingui();
  const page = runtime.definition.pages.find((p) => p.id === pageId);
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  // Figures became async when the `value` form started going through the host (so it works for
  // untrusted apps too — the function lives in the isolate). Hooks stay above every early return.
  const [figures, setFigures] = useState<SummaryFigure[]>([]);

  const entity = (page?.view as { entity?: string } | undefined)?.entity;

  useEffect(() => {
    let alive = true;
    const unitFor = (field: string): string | undefined => {
      const def = entity ? runtime.definition.entities[entity] : undefined;
      return (def?.fields[field] as (Field & { unit?: string }) | undefined)?.unit;
    };
    void computeSummary(specs, rows, runtime.ctx, unitFor, (index, rs) =>
      runtime.core.app.callSummary(pageId, index, [...rs] as Resolved[], runtime.ctx),
    ).then((next) => {
      // A late result after unmount (or after the rows changed again) must not push state into a
      // torn-down strip — the same guard `watch()` uses in the runtime.
      if (alive) setFigures(next);
    });
    return () => {
      alive = false;
    };
  }, [specs, rows, entity, pageId, runtime]);

  return (
    <section className="k-summary" aria-label={t({ message: "Summary", comment: "The strip of totals above a list" })} data-k-view>
      {figures.map((figure, i) => (
        <div key={i} className="k-summary-figure">
          <span className="k-summary-label" data-k-wording>
              {figure.label}
            </span>
          {/* A figure that failed shows a dash with the reason on hover — one bad summary must not
              blank the page it sits above. */}
          <span className="k-summary-value" title={figure.error} data-loading={loading || undefined}>
            {figure.text ?? "–"}
          </span>
        </div>
      ))}
    </section>
  );
}
