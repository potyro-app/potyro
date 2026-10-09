// ViewHost — renders the correct built-in (or custom) view component for a page.

import type { ComponentType } from "react";
import type { View } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";
import { resolveViewComponent } from "./registry.js";

export function ViewHost(
  props: BuiltinViewProps & { registry?: Partial<Record<View["type"], ComponentType<BuiltinViewProps>>> },
) {
  const view = getView(props.runtime, props.pageId);
  const Component = resolveViewComponent(view.type, props.registry);
  // A custom view is the app's own JSX: every word in it is the app's to change (edit mode).
  if (view.type === "custom") return <Component {...props} />;
  // A built-in view prints records, and its text is theirs unless marked `data-k-wording`. Edit mode
  // pairs text with the app's literals, and a record called "Milk" must never pass for one of them —
  // so here the default is "data", and a view that forgets to mark its wording just offers less.
  return (
    <div data-k-view style={{ display: "contents" }}>
      <Component {...props} />
    </div>
  );
}
