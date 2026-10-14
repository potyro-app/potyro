// A failure stays where it happens (#271).
//
// An app is many parts — computed values, filters, views, its own screens — and any of them is code
// that can throw: on data it did not expect, or, in the sealed box, on a feature that is not there.
// One part failing must not take the rest with it, and must not be silent either. So every view a
// page shows is held in its own boundary, and what failed is said where it would have been, in words
// for the person using the app: "This part of the app hit a problem: …". The other views on the page,
// and every other page, carry on.
//
// The runtime is the one that knows: a computed that threw is reported there (host/resolve.ts, as
// `computed entity.key`), as is a page whose filter or query threw (`page id`). A view listens for the
// failures that concern it. A view that crashes while rendering reports itself (`view id`), so whoever
// checks an app off-screen (the Studio) hears it as well.

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
 * Failures, reported while this view is up, of the parts it shows: the computed values of its
 * entity, and — unless the view says it itself — its own page's records. Each once, newest message kept.
 */
export function usePartFailures(runtime: PotyroRuntime, pageId: string, entity: string | undefined, viewType?: string): Failure[] {
  const [failures, setFailures] = useState<Failure[]>([]);
  useEffect(() => {
    setFailures([]);
    const ownPage = !SAY_THEIR_OWN_LOAD_ERROR.has(viewType ?? "");
    const concerns = (what: string): boolean => (ownPage && what === `page ${pageId}`) || (!!entity && what.startsWith(`computed ${entity}.`));
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
  }, [runtime, pageId, entity, viewType]);
  return failures;
}
