// "Camera on" — the shell's own sign that an app is seeing through the camera (docs/25).
//
// Shown whenever the page's live camera runs, whichever app (or Studio preview) started it, and
// owned by the shell: the app does not render it and cannot take it away. Removed from the page, it
// is put back; hidden or restyled, it is shown again. A trusted app shares this page, so this guards
// against a careless app rather than walling off a hostile one — a hostile app is a sealed one, and
// a sealed app has no page to reach and no live camera at all. The browser's and the phone's own
// indicators stand behind it either way.
//
// Turn off stops the camera for the person ("person"); the app hears it through `onStop`.

import { t } from "@lingui/core/macro";
import type { LiveCameraCap } from "@potyro/capabilities";

const CLASS = "k-camera-on";
/** The app's top bar on a phone: the sign sits just under it, never on the app's name (#338). */
const BAR = ".k-topbar";
/** Where the bar ends, for the stylesheet; set on the root, because the sign's own style is the shell's. */
const TOP_VAR = "--k-camera-on-top";
/**
 * How much of the top of the app's screen — under its top bar, or under the top of the page when it
 * has none — the shell's own chrome covers, for an app's custom view to keep clear (docs/04): the
 * sign, while it shows, and the gap under it. Like `--k-chrome-bottom`; 0px when nothing is there.
 */
const CHROME_TOP_VAR = "--k-chrome-top";
/** Room left under the sign before the app's own things. */
const CLEARANCE_PX = 8;

/** Keep the indicator on screen while `cap` runs. Returns the way to stop watching. */
export function watchLiveCamera(cap: LiveCameraCap, doc: Document = document): () => void {
  let el: HTMLElement | null = null;
  let guard: MutationObserver | null = null;
  let bar: Element | null = null;
  let barSize: ResizeObserver | null = null;
  let recheck: ReturnType<typeof setInterval> | null = null;
  const win = doc.defaultView;

  /**
   * Under the app's top bar when there is one, at its right — out of the way of the app's name and
   * the bar's buttons, and still in reach of a thumb; centred at the top of the screen when there is
   * none. The bar comes and goes as the person moves between screens, so it is looked for again.
   */
  const place = () => {
    if (!el) return;
    const found = doc.querySelector(BAR);
    if (found !== bar) {
      barSize?.disconnect();
      bar = found;
      if (bar && typeof ResizeObserver !== "undefined") {
        barSize = new ResizeObserver(place);
        barSize.observe(bar);
      }
    }
    const rect = bar?.getBoundingClientRect();
    if (rect && rect.height > 0 && rect.bottom > 0) {
      doc.documentElement.style.setProperty(TOP_VAR, `${Math.round(rect.bottom)}px`);
      if (el.dataset.under !== "bar") el.dataset.under = "bar";
    } else if (el.dataset.under) {
      delete el.dataset.under;
    }
    // Measured after it moved: where the sign ends, from where the app's screen starts.
    const under = rect && rect.height > 0 && rect.bottom > 0 ? rect.bottom : 0;
    const room = `${Math.max(0, Math.round(el.getBoundingClientRect().bottom - under + CLEARANCE_PX))}px`;
    if (doc.documentElement.style.getPropertyValue(CHROME_TOP_VAR) !== room) doc.documentElement.style.setProperty(CHROME_TOP_VAR, room);
  };

  const build = (): HTMLElement => {
    const box = doc.createElement("div");
    box.className = CLASS;
    box.setAttribute("role", "status");
    box.setAttribute("data-testid", "camera-on");
    const dot = doc.createElement("span");
    dot.className = "k-camera-on-dot";
    dot.setAttribute("aria-hidden", "true");
    const label = doc.createElement("span");
    label.className = "k-camera-on-label";
    label.textContent = t({ message: "Camera on", comment: "The shell's sign that an app is using the camera live" });
    const off = doc.createElement("button");
    off.type = "button";
    off.className = "k-camera-on-off";
    off.textContent = t({ message: "Turn off", comment: "Button on the camera-on sign: stops the live camera" });
    off.addEventListener("click", () => cap.stopAll("person"));
    box.append(dot, label, off);
    return box;
  };

  /** Put it back exactly as the shell made it, whatever an app did to it. */
  const assert = () => {
    if (!el) return;
    if (el.hidden) el.hidden = false;
    if (el.getAttribute("style")) el.removeAttribute("style");
    if (el.className !== CLASS) el.className = CLASS;
    if (el.parentNode !== doc.body || el !== doc.body.lastElementChild) doc.body.append(el);
  };

  const show = () => {
    if (el) return;
    el = build();
    doc.body.append(el);
    place();
    win?.addEventListener("resize", place);
    doc.addEventListener("scroll", place, { capture: true, passive: true });
    recheck = setInterval(place, 700);
    guard = new MutationObserver(() => {
      guard?.disconnect();
      assert();
      place();
      watch();
    });
    watch();
  };
  const watch = () => {
    if (!el || !guard) return;
    guard.observe(doc.body, { childList: true });
    guard.observe(el, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
  };
  const hide = () => {
    guard?.disconnect();
    guard = null;
    barSize?.disconnect();
    barSize = null;
    bar = null;
    if (recheck) clearInterval(recheck);
    recheck = null;
    win?.removeEventListener("resize", place);
    doc.removeEventListener("scroll", place, { capture: true });
    doc.documentElement.style.removeProperty(TOP_VAR);
    doc.documentElement.style.removeProperty(CHROME_TOP_VAR);
    el?.remove();
    el = null;
  };

  const unsubscribe = cap.subscribe((on) => (on ? show() : hide()));
  return () => {
    unsubscribe();
    hide();
  };
}
