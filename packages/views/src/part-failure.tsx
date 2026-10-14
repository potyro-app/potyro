// A failure stays where it happens (#271).
//
// An app is many parts — computed values, filters, views, its own screens — and any of them is code
// that can throw: on data it did not expect, or, in the sealed box, on a feature that is not there.
// One part failing must not take the rest with it. So every view a page shows is held in its own
// boundary, and a view that cannot show at all — it crashed while rendering, its custom view would
// not mount, its page's records could not be listed — says so in its place, in words for the person
// using the app: "This part of the app hit a problem: …". The other views on the page, and every
// other page, carry on.
//
// A computed value that throws for SOME records is not one of those. The view still has every record
// to show; only that value is missing where it failed, and it shows as empty (host/resolve.ts). An
// alert for it took the whole view's place — over a map, because one place had no opening hours —
// to tell the person using the app about code they cannot fix. So it is quiet here: the runtime still
// reports it (`computed entity.key`) to whoever checks the app — the Studio's run of a change hears
// it (shell/run-candidate.ts) — and the console says it once. Not a view's business.
//
// The runtime is the one that knows: a page whose filter or query threw is reported there (`page
// id`), and a view listens for that. A view that crashes while rendering reports itself (`view id`),
// so whoever checks an app off-screen (the Studio) hears it as well.

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { fieldLabel } from "./format.js";
import type { PotyroRuntime } from "@potyro/runtime";

interface Failure {
  what: string;
  message: string;
}

/** What failed, in words: the computed value by its name, a page's records, a view. */
export function describePartFailure(failure: Failure, runtime: Pick<PotyroRuntime, "definition">): string {
  const message = failure.message;
  const computed = /^computed ([^.]+)\.(.+)$/.exec(failure.what);
  if (computed) {
    const [, entity, key] = computed;
    const label = fieldLabel(runtime, entity!, key!);
    return t`“${label}” could not be worked out for some records: ${message}`;
  }
  if (failure.what.startsWith("page ")) return t`its records could not be listed: ${message}`;
  return t`it could not be shown: ${message}`;
}

export function PartProblem({ text }: { text: string }) {
  return (
    <div className="k-part-problem" role="alert">
      <p>
        <Trans comment="A part of an app failed; {text} says what, e.g. 'it could not be shown: …'">
          <strong>This part of the app hit a problem:</strong> {text}
        </Trans>
      </p>
    </div>
  );
}

interface BoundaryProps {
  runtime: PotyroRuntime;
  /** The part, as the runtime names failures: `view today#1`. */
  what: string;
  children: ReactNode;
}

/** A view that throws while rendering fails alone, says so in its place, and is reported. */
export class PartBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[potyro] view crashed:", error, info.componentStack);
    this.props.runtime.reportFailure?.(this.props.what, error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <PartProblem text={describePartFailure({ what: this.props.what, message: error.message }, this.props.runtime)} />;
  }
}

/** Views that say themselves when their page's records could not be read (builtins.tsx `LoadError`). */
const SAY_THEIR_OWN_LOAD_ERROR = new Set(["list", "gallery", "table"]);

/**
 * Failures, reported while this view is up, that leave it with nothing to show: its own page's
 * records, unless the view says that itself. Each once, newest message kept. Never a computed value
 * that failed for some records — the view still shows them (see the top of this file).
 */
export function usePartFailures(runtime: PotyroRuntime, pageId: string, viewType?: string): Failure[] {
  const [failures, setFailures] = useState<Failure[]>([]);
  useEffect(() => {
    setFailures([]);
    const ownPage = !SAY_THEIR_OWN_LOAD_ERROR.has(viewType ?? "");
    const concerns = (what: string): boolean => ownPage && what === `page ${pageId}`;
    // A runtime from before #271 (a test's stand-in) has nothing to say.
    return runtime.onFailure?.((f) => {
      if (!concerns(f.what)) return;
      setFailures((prev) => {
        const at = prev.findIndex((p) => p.what === f.what);
        if (at >= 0 && prev[at]!.message === f.message) return prev;
        const next = prev.filter((p) => p.what !== f.what);
        return [...next, { what: f.what, message: f.message }];
      });
    });
  }, [runtime, pageId, viewType]);
  return failures;
}
