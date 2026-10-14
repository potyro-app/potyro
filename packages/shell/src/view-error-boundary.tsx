// A generated app is a common, not exceptional, way to end up here: `ctx.navigate` (or a row's
// `onOpen`) naming a page id the app never declared. `getView` (packages/views/src/format.ts)
// throws synchronously when that happens, and `ViewHost` calls it during render — so with no
// boundary above it, React unmounts the WHOLE tree to a blank `#root`. That takes the header, the
// provenance badge and the "Something's wrong" recorder down with it — the one control that would
// let the person report the very thing that just broke. This boundary exists to keep that from
// happening: it catches a crash from rendering the CURRENT page only, so the chrome around it (and
// the recorder above it) never unmounts.
//
// React has no functional equivalent to `getDerivedStateFromError` / `componentDidCatch` — a class
// component is the only way to catch a render error from children, so this is one on purpose.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";

interface ViewErrorBoundaryProps {
  /** What was being shown when it broke, in words — surfaced in the fallback so the person (and
   *  whoever they hand this to) sees WHAT failed, not just THAT something did. */
  pageLabel: string;
  /** Escape hatch to a page that still works — the fallback's only button. Recovery, not reload:
   *  the person should not have to lose the rest of their session over one broken page. */
  onRecover: () => void;
  children: ReactNode;
}

interface ViewErrorBoundaryState {
  error: Error | null;
}

export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  override state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ViewErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Not swallowed — logged for whoever goes looking afterwards. The fallback below is what tells
    // the PERSON something broke; this is what tells the developer what and where.
    // eslint-disable-next-line no-console
    console.error("[potyro] view crashed:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashFallback pageLabel={this.props.pageLabel} message={error.message} onRecover={this.props.onRecover} />;
  }
}

/** The fallback, as a function component so its words follow a language switch. */
function CrashFallback({ pageLabel, message, onRecover }: { pageLabel: string; message: string; onRecover: () => void }) {
  return (
    <div className="k-view-crash" role="alert">
      <p className="k-view-crash-head">
        <Trans>This page couldn’t be shown</Trans>
      </p>
      <p className="k-muted">
        <Trans>Something went wrong opening {pageLabel}.</Trans>
      </p>
      <p className="k-view-crash-detail">{message}</p>
      <button type="button" className="k-add k-primary-action" onClick={onRecover}>
        <Trans>Back to a working page</Trans>
      </button>
    </div>
  );
}
