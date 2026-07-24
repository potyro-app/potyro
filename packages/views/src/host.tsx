// ViewHost — renders the correct built-in (or custom) view component for a page.

import type { ComponentType } from "react";
import type { View } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";
import { resolveViewComponent } from "./registry.js";

export function ViewHost(
  props: BuiltinViewProps & { registry?: Partial<Record<View["type"], ComponentType<BuiltinViewProps>>> },
) {
  const view = getView(props.runtime, props.pageId);
  const Component = resolveViewComponent(view.type, props.registry);
  return <Component {...props} />;
}
