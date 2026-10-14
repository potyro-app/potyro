// ViewHost — renders the correct built-in (or custom) view component for a page.
//
// Each view is its own part (#271): a view that crashes while rendering fails alone, in its place,
// and a computed value or a filter of its own that threw is said above it — never a blank page, and
// never the rest of the app taken down with it (part-failure.tsx).

import type { ComponentType, ReactNode } from "react";
import type { View } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";
import { resolveViewComponent } from "./registry.js";
import { PartBoundary, PartProblem, describePartFailure, usePartFailures } from "./part-failure.js";

export function ViewHost(
  props: BuiltinViewProps & { registry?: Partial<Record<View["type"], ComponentType<BuiltinViewProps>>> },
) {
  // A page id the app never declared throws here, outside the part: that is the page's failure, and
  // the shell's page boundary says so.
  const view = getView(props.runtime, props.pageId);
  const Component = resolveViewComponent(view.type, props.registry);
  const entity = (view as { entity?: string }).entity;
  const failures = usePartFailures(props.runtime, props.pageId, entity, view.type);
  const notes: ReactNode = failures.map((f) => <PartProblem key={f.what} text={describePartFailure(f, props.runtime)} />);
  // `key` on the page: a part that failed on one page starts clean on the next.
  const part = (body: ReactNode): ReactNode => (
    <PartBoundary key={props.pageId} runtime={props.runtime} what={`view ${props.pageId}`}>
      {body}
    </PartBoundary>
  );
  // A custom view is the app's own JSX: every word in it is the app's to change (edit mode). Its
  // wrapper only names the part — `data-k-part`, for point mode (#284) — and lays nothing out.
  if (view.type === "custom") {
    return (
      <div data-k-part={props.pageId} data-k-custom style={{ display: "contents" }}>
        {notes}
        {part(<Component {...props} />)}
      </div>
    );
  }
  // A built-in view prints records, and its text is theirs unless marked `data-k-wording`. Edit mode
  // pairs text with the app's literals, and a record called "Milk" must never pass for one of them —
  // so here the default is "data", and a view that forgets to mark its wording just offers less.
  // `data-k-part` is the page ref this view renders (`today`, or a layout item's `today#1`): what
  // point mode (#284) names when the person points at it.
  return (
    <div data-k-view data-k-part={props.pageId} style={{ display: "contents" }}>
      {notes}
      {part(<Component {...props} />)}
    </div>
  );
}
