// Render every page of a candidate off-screen and report what went wrong (#262).
//
// The smoke run proves the app's logic runs; it never mounts a view. A view can still crash on what
// the logic returns (a binding that yields an object, an option function that throws), stay on
// "Loading" for good, or come up blank — and the model that wrote it learned none of that. This
// mounts each page the way the person will see it, with an error boundary around it, and listens
// for what the views say when they contain a failure (`[potyro] …` on the console) and for errors
// nothing caught.
//
// Same off-screen discipline as observe-render.ts: a detached container, inert navigation, no
// edit/create, so a render cannot move or touch the app the person is looking at.

import { Component, createElement, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { LayoutHost, ViewHost } from "@potyro/views";
import type { Localized, PageLayout } from "potyro";
import type { PotyroRuntime } from "@potyro/runtime";
import type { RunReport } from "@potyro/generator/backends";
import { canObserveRender, SETTLE_MS } from "./observe-render.js";

/** How long a page must stay unchanged to count as settled. */
const QUIET_MS = 200;

class Boundary extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error instanceof Error ? error : new Error(String(error)));
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Resolve when the container has not changed for QUIET_MS, or after `cap` ms regardless. */
function settled(host: HTMLElement, cap: number): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const done = (): void => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(hard);
      resolve();
    };
    const observer = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(done, QUIET_MS);
    });
    observer.observe(host, { childList: true, subtree: true, characterData: true, attributes: true });
    quiet = setTimeout(done, QUIET_MS);
    const hard = setTimeout(done, cap);
  });
}

function text(args: unknown[]): string {
  return args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : String(a))).join(" ");
}

export interface PageToRender {
  id: string;
  layout?: Localized<PageLayout>;
  params: Record<string, unknown>;
}

/**
 * Mount each page, wait for it to settle, and say what broke. Pages are rendered one after another:
 * a failure is then attributable to the page that was on screen when it happened.
 */
export async function renderPages(runtime: PotyroRuntime, pages: readonly PageToRender[], settleMs: number = SETTLE_MS): Promise<RunReport> {
  if (!canObserveRender()) return { errors: [], warnings: ["the pages were not rendered: there is no screen to render them on here"], ran: "" };
  const errors: string[] = [];
  const warnings: string[] = [];
  const shown: string[] = [];
  let rendered = 0;
  let current = "";

  const heard = (args: unknown[]): void => {
    const said = text(args);
    // The boundary below reports crashes itself; React's own echo of them would be a duplicate.
    if (!said.startsWith("[potyro]") || said.startsWith("[potyro] view crashed")) return;
    warnings.push(`page "${current}": ${said.replace(/^\[potyro\]\s*/, "")}`);
  };
  const original = { warn: console.warn, error: console.error };
  const onError = (e: ErrorEvent): void => {
    errors.push(`page "${current}": ${e.message}`);
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    errors.push(`page "${current}": ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
  };
  console.warn = (...args: unknown[]) => {
    heard(args);
    original.warn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    heard(args);
    original.error.apply(console, args);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  // A view that crashes is held in its own part (views/part-failure.tsx, #271), so it never reaches the
  // boundary below: the runtime hears it instead, and here it is the same error it always was.
  let crashedNow = false;
  const stopListening = runtime.onFailure((f) => {
    if (!f.what.startsWith("view ")) return;
    crashedNow = true;
    errors.push(`page "${current}" crashed while showing: ${f.message}`);
  });

  try {
    for (const page of pages) {
      current = page.id;
      const host = document.createElement("div");
      host.style.position = "absolute";
      host.style.left = "-10000px";
      host.style.top = "0";
      host.style.width = "390px";
      host.style.height = "800px";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
      const root = createRoot(host);
      let crashed = false;
      crashedNow = false;
      try {
        const props = { runtime, pageId: page.id, params: page.params, setParam: () => {}, navigate: () => {} };
        const view = page.layout ? createElement(LayoutHost, { ...props, layout: page.layout }) : createElement(ViewHost, props);
        flushSync(() => {
          root.render(
            createElement(Boundary, {
              onError: (e: Error) => {
                crashed = true;
                errors.push(`page "${page.id}" crashed while showing: ${e.message}`);
              },
              children: view,
            }),
          );
        });
        await settled(host, settleMs);
        rendered++;
        shown.push(page.id);
        if (crashed || crashedNow) continue;
        if (host.querySelector(".k-loading")) warnings.push(`page "${page.id}" was still loading after ${settleMs / 1000}s`);
        else if (!(host.textContent ?? "").trim() && !host.querySelector("img, canvas, svg, video, input, button")) {
          warnings.push(`page "${page.id}" showed nothing at all`);
        }
      } catch (e) {
        errors.push(`page "${page.id}" could not be shown: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        try {
          root.unmount();
        } catch {
          // a tree that already threw can throw again on unmount; the container is discarded anyway
        }
        host.remove();
      }
    }
  } finally {
    stopListening();
    console.warn = original.warn;
    console.error = original.error;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  }
  return { errors, warnings: [...new Set(warnings)], ran: rendered ? `${rendered} page${rendered === 1 ? "" : "s"} rendered` : "", pages: shown };
}
