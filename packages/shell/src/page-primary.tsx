// A page's frequent action (`primaryAction`) as a bar at the bottom of the screen: where a thumb is,
// above the tab bar and any timer, and out of the way of the content above it. "Done shopping",
// "Start workout", "+ Expense".
//
// When the action says when it applies (`when`, over the rows the page shows), the bar is there only
// then: "Done shopping" with nothing in the basket is a button that can only say "not yet". The
// question goes through the host like every app function, so a sealed app's `when` works too.

import { useEffect, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { Resolved } from "potyro";
import type { PageCta } from "./page-header.js";
import { glyphOf } from "@potyro/views";

interface PrimaryBarProps {
  runtime: PotyroRuntime;
  pageId: string;
  params: Record<string, unknown>;
  cta: PageCta;
  /** The page action's index, when the bar is one of the page's own actions (its `when` may hide it). */
  actionIndex?: number;
}

export function PrimaryBar(props: PrimaryBarProps) {
  const page = props.runtime.definition.pages.find((p) => p.id === props.pageId);
  const conditional = props.actionIndex !== undefined && (page?.actions?.[props.actionIndex] as { when?: unknown } | undefined)?.when !== undefined;
  return conditional ? <WhenBar {...props} actionIndex={props.actionIndex!} /> : <Bar cta={props.cta} />;
}

function WhenBar({ runtime, pageId, params, cta, actionIndex }: PrimaryBarProps & { actionIndex: number }) {
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const [applies, setApplies] = useState(false);
  useEffect(() => {
    if (loading) return;
    let alive = true;
    runtime.core.app
      .callFold(pageId, `page.actions.${actionIndex}.when`, [...rows] as Resolved[], runtime.ctx)
      .then((v) => alive && setApplies(v === true))
      // A `when` that fails hides nothing the person needs: the action still runs, and says why it cannot.
      .catch(() => alive && setApplies(true));
    return () => {
      alive = false;
    };
  }, [runtime, pageId, rows, loading, actionIndex]);
  return applies ? <Bar cta={cta} /> : null;
}

function Bar({ cta }: { cta: PageCta }) {
  return (
    <div className="k-primary-bar">
      <button type="button" className="k-cta" onClick={cta.onRun} disabled={cta.busy} aria-busy={cta.busy || undefined} data-k-wording>
        {cta.icon ? (
          <span className="k-cta-icon" aria-hidden>
            {glyphOf(cta.icon)}
          </span>
        ) : null}
        <span>{cta.label}</span>
      </button>
    </div>
  );
}
