// The `custom` view — the no-ceiling escape hatch. For trusted apps it renders the app's own
// React component with full ctx access. For untrusted apps the host returns null (docs/05
// policy: custom views run only for trusted apps) and we fall back to a promote prompt.

import { useEffect, useRef } from "react";
import type { FC } from "react";
import type { CustomViewMount, ViewProps } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";

export function CustomView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate } = props;
  const view = getView(runtime, pageId) as { entity: string };
  const Component = runtime.core.app.customView(pageId);
  const mount = runtime.core.app.customViewMount?.(pageId) ?? null;

  if (!Component && !mount) {
    // A dead end otherwise: the screen the user came for is blank, and the only way forward is a
    // control in the header they have no reason to associate with it. Say what to press.
    return (
      <div className="k-custom-fallback">
        <p>This screen is built with the app’s own code, so it only runs when the app is trusted.</p>
        <p>
          Use the <strong>“untrusted ▾”</strong> button in the header to trust this app and show
          this screen.
        </p>
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
  // The framework-neutral form: hand over a container and keep the teardown. The host does not know
  // or care what rendered into it — the same deal MapLibre gets.
  if (mount) return <MountedView mount={mount} props={viewProps} />;

  // Render as a proper React element so the custom view gets its own fiber + hook context
  // (rather than being called inline as a plain function).
  const Rendered = Component as unknown as FC<ViewProps>;
  return <Rendered {...viewProps} />;
}

function MountedView({ mount, props }: { mount: CustomViewMount; props: ViewProps }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let teardown: (() => void) | undefined;
    try {
      teardown = mount(el, propsRef.current);
    } catch (e) {
      // A custom view is app code. A throw here must not take the shell down with it.
      console.warn("[potyro] custom view failed to mount:", e);
      el.textContent = "This screen could not be displayed.";
    }
    return () => {
      try {
        teardown?.();
      } catch (e) {
        console.warn("[potyro] custom view failed to clean up:", e);
      }
    };
  }, [mount]);

  return <div className="k-custom-mounted" ref={ref} />;
}
