// The `custom` view — the no-ceiling escape hatch. For trusted apps it renders the app's own
// React component (or `mount`) with full ctx access. For a sealed app in the browser realm it is drawn
// in a sandboxed frame of its own (#267, docs/05 "Custom views"): the app's code runs there, never in
// the shell's realm, and reaches ctx only through the mediated ctx. Where neither exists (the QuickJS
// fallback, the Studio's preview) it says so and offers the trust dialog.

import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import type { CustomViewMount, ViewProps } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";
import { PartProblem, describePartFailure } from "./part-failure.js";
import { usePageTitles } from "./dynamic.js";

/** Fired on `window` when a view asks the shell to open its trust dialog. */
export const TRUST_REQUEST = "potyro:trust-request";

type SealedView = NonNullable<ReturnType<NonNullable<BuiltinViewProps["runtime"]["core"]["app"]["sealedView"]>>>;

export function CustomView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate } = props;
  const view = getView(runtime, pageId) as { entity: string };
  const Component = runtime.core.app.customView(pageId);
  const mount = runtime.core.app.customViewMount?.(pageId) ?? null;
  const sealed = !Component && !mount ? (runtime.core.app.sealedView?.(pageId) ?? null) : null;

  const viewProps: ViewProps = {
    runtime,
    entity: view.entity,
    options: {},
    param: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    navigate,
  };

  if (sealed) return <SealedCustomView sealed={sealed} props={viewProps} pageId={pageId} runtime={runtime} navigate={navigate} />;

  if (!Component && !mount) {
    // A dead end otherwise: the screen the user came for is blank, and the only way forward is a
    // control in the header they have no reason to associate with it. Say what to press.
    return (
      <div className="k-custom-fallback">
        <p>
          <Trans>This screen is built with the app’s own code, so it only runs when the app runs as yours.</Trans>
        </p>
        <p>
          {/* The shell owns the decision (views never change trust): this asks it to open its own
              dialog, the same one the 🛡 mark at the top opens. */}
          <button type="button" className="k-add k-primary-action" onClick={() => globalThis.dispatchEvent(new CustomEvent(TRUST_REQUEST))}>
            <Trans>Run it as mine…</Trans>
          </button>
        </p>
      </div>
    );
  }

  // The framework-neutral form: hand over a container and keep the teardown. The host does not know
  // or care what rendered into it — the same deal MapLibre gets.
  if (mount) return <MountedView mount={mount} props={viewProps} what={`view ${pageId}`} host={runtime} />;

  // Render as a proper React element so the custom view gets its own fiber + hook context
  // (rather than being called inline as a plain function).
  const Rendered = Component as unknown as FC<ViewProps>;
  return <Rendered {...viewProps} />;
}

function MountedView({ mount, props, what, host }: { mount: CustomViewMount; props: ViewProps; what: string; host: BuiltinViewProps["runtime"] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // A throw in an effect never reaches an error boundary, so this part says it failed itself (#271).
  const [failed, setFailed] = useState<string | null>(null);
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
      host.reportFailure?.(what, e);
      setFailed(e instanceof Error ? e.message : String(e));
    }
    return () => {
      try {
        teardown?.();
      } catch (e) {
        console.warn("[potyro] custom view failed to clean up:", e);
      }
    };
  }, [mount]);

  if (failed !== null) return <PartProblem text={describePartFailure({ what, message: failed }, host)} />;
  return <div className="k-custom-mounted" ref={ref} />;
}

/**
 * A sealed app's own screen, in its sandboxed frame. The shell keeps the chrome and the navigation;
 * the frame fills this page's content area. When the screen stops responding — or froze Potyro on
 * this device before — this page shows the app's plain version instead: a calm notice, the app's
 * other pages, and a way to try the screen again. Never a red error: nothing the person did is wrong.
 */
function SealedCustomView({ sealed, props, pageId, runtime, navigate }: { sealed: SealedView; props: ViewProps; pageId: string; runtime: BuiltinViewProps["runtime"]; navigate: BuiltinViewProps["navigate"] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"live" | "plain" | "failed">(() => (sealed.state() === "off" ? "plain" : "live"));
  const [failed, setFailed] = useState<string>("");
  const titles = usePageTitles(runtime);
  const propsRef = useRef(props);
  propsRef.current = props;
  const what = `view ${pageId}`;

  useEffect(() => {
    const el = ref.current;
    if (state !== "live" || !el) return;
    const teardown = sealed.mount(
      el,
      propsRef.current,
      {
        onStopped: () => setState("plain"),
        onFailed: (message) => {
          runtime.reportFailure?.(what, new Error(message));
          setFailed(message);
          setState("failed");
        },
      },
      titles[pageId.split("#")[0]!] ?? pageId,
    );
    return teardown;
    // `titles` names the frame once; a title resolved later is not worth remounting the app's screen.
  }, [sealed, state]);

  if (state === "failed") return <PartProblem text={describePartFailure({ what, message: failed }, runtime)} />;
  if (state === "plain") {
    const here = pageId.split("#")[0];
    const plain = runtime.definition.pages.filter((p) => p.id !== here && (p.view ?? p.layout?.items[0]?.view)?.type !== "custom");
    return (
      <div className="k-sealed-notice" role="status">
        <p>
          <Trans>This app’s screen stopped responding, so Potyro is showing its plain version.</Trans>
        </p>
        <div className="k-sealed-notice-actions">
          {plain.map((p) => (
            <button key={p.id} type="button" className="k-add" onClick={() => navigate(p.id)}>
              {titles[p.id] ?? p.id}
            </button>
          ))}
          <button
            type="button"
            className="k-add k-sealed-retry"
            onClick={() => {
              sealed.retry();
              setState("live");
            }}
          >
            <Trans>Try its screen again</Trans>
          </button>
        </div>
      </div>
    );
  }
  return <div className="k-sealed-view" ref={ref} />;
}
