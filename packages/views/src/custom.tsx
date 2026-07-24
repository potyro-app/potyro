// The `custom` view — the no-ceiling escape hatch. For trusted apps it renders the app's own
// React component with full ctx access. For untrusted apps the host returns null (docs/05
// policy: custom views run only for trusted apps) and we fall back to a promote prompt.

import type { FC } from "react";
import type { ViewProps } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";

export function CustomView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate } = props;
  const view = getView(runtime, pageId) as { entity: string };
  const Component = runtime.core.app.customView(pageId);

  if (!Component) {
    return (
      <div className="k-custom-fallback">
        <p>This screen is a custom view. Custom views run only for trusted apps.</p>
        <p>Promote this app to trusted to enable it.</p>
      </div>
    );
  }

  const viewProps: ViewProps = {
    runtime,
    entity: view.entity,
    options: {},
    param: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    navigate,
  };
  // Render as a proper React element so the custom view gets its own fiber + hook context
  // (rather than being called inline as a plain function).
  const Rendered = Component as unknown as FC<ViewProps>;
  return <Rendered {...viewProps} />;
}
