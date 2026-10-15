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

/** Keep the indicator on screen while `cap` runs. Returns the way to stop watching. */
export function watchLiveCamera(cap: LiveCameraCap, doc: Document = document): () => void {
  let el: HTMLElement | null = null;
  let guard: MutationObserver | null = null;

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
    guard = new MutationObserver(() => {
      guard?.disconnect();
      assert();
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
    el?.remove();
    el = null;
  };

  const unsubscribe = cap.subscribe((on) => (on ? show() : hide()));
  return () => {
    unsubscribe();
    hide();
  };
}
