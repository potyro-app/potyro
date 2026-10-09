// Render a candidate's page off-screen and report what it actually put there.
//
// WHY THIS HAS TO EXIST. A recording captures what the person saw — including "this page never
// finished loading". That fact is HISTORICAL: it describes the app as it was. Replaying the same
// recording against a candidate re-reads the same recorded flag, so the step fails no matter what
// the candidate does. That is not a strict gate, it is an unwinnable one: the first real attempt
// burned every step it had and gave up, and no possible candidate could have passed.
//
// So verification stops re-reading the past and looks at the present: mount the candidate's page,
// give it the same settle time the recorder gave the original, and see whether IT hangs. That is
// the only comparison that can distinguish "still broken" from "fixed".
//
// It renders into a detached container with the candidate's own runtime. Nothing is attached to the
// live document tree the person is looking at, no navigation is wired (a view that calls `navigate`
// during render must not move the app under them), and edit/create are absent so a render cannot
// open a form.

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { ViewHost } from "@potyro/views";
import type { PotyroRuntime, ScreenState } from "@potyro/runtime";

/** Matches the recorder's own settle delay (App.tsx). The two must agree: a candidate judged on a
 *  shorter fuse than the recording would be called broken for being merely slow. */
export const SETTLE_MS = 1200;

/** True when this build can render at all — verification runs in the browser, but a Node/test
 *  context has no DOM and must degrade rather than throw. */
export function canObserveRender(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

/**
 * Mount `pageId` from `runtime` off-screen, wait for it to settle, and report what it showed.
 *
 * Returns `null` when there is no DOM to render into — the caller must treat that as "could not
 * look", never as "it was fine".
 */
export async function observeRender(
  runtime: PotyroRuntime,
  pageId: string,
  params: Record<string, unknown>,
  settleMs: number = SETTLE_MS,
): Promise<ScreenState | null> {
  if (!canObserveRender()) return null;

  const host = document.createElement("div");
  // Off-screen rather than display:none — a display:none subtree can skip layout-dependent work in
  // some views, which would make a hung view look settled for the wrong reason.
  host.style.position = "absolute";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "1024px";
  host.style.height = "768px";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(
      createElement(ViewHost, {
        runtime,
        pageId,
        params,
        setParam: () => {},
        // Deliberately inert: a candidate view that navigates on render must not be able to move
        // the app the person is actually looking at.
        navigate: () => {},
      }),
    );
    await new Promise((r) => setTimeout(r, settleMs));
    return {
      loading: Boolean(host.querySelector(".k-loading")),
      text: (host.textContent ?? "").trim(),
    };
  } catch (e) {
    // A view that throws while rendering is a real answer about the candidate, not an error to
    // propagate — the caller turns it into a failed verdict the agent can act on.
    return { loading: false, text: `render threw: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    try {
      root.unmount();
    } catch {
      // Unmounting a tree that already threw can throw again; the container is discarded either way.
    }
    host.remove();
  }
}
