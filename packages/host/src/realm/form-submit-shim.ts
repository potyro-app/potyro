// Forms in a sealed view (#267): the frame is sandboxed with `allow-scripts` and nothing else, so the
// browser drops a form's submission before its `submit` event fires. A view's own form — a Join box,
// a guess sent with Enter — then did nothing, in every sealed copy (Draw & Guess, 2026-10-19).
//
// `allow-forms` would let the event through, but also a real submission: `form.submit()` to another
// origin navigated the frame (the escape probe in e2e/sealed-views-sandbox.spec.ts). So the sandbox
// stays as it is, and this shim, run before the view's code, gives forms their event:
//   - a click on a submit button of a form, Enter in one of its fields (implicit submission), and
//     `requestSubmit()` run the form's validation and fire `submit` on it, as the browser would;
//   - nothing is ever submitted: there is no default action to run, and the sandbox still refuses one.
// The browser's own attempt is cancelled first (it would only be refused, with a console error).
//
// The view's code can undo all of this; it only hurts itself. Nothing here is trusted by the host.

type Submitter = HTMLButtonElement | HTMLInputElement;

const isSubmitter = (el: Element | null): el is Submitter =>
  (el instanceof HTMLButtonElement && el.type === "submit") || (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image"));

/** Fields where Enter submits their form (not a textarea, not a button). */
const IMPLICIT = new Set(["text", "search", "url", "tel", "email", "password", "number", "date", "datetime-local", "month", "week", "time"]);

export function installFormSubmitShim(doc: Document): void {
  const win = doc.defaultView;
  if (!win) return;
  const fire = (form: HTMLFormElement, submitter: Submitter | null): void => {
    const skipValidation = form.noValidate || Boolean(submitter?.formNoValidate);
    if (!skipValidation && !form.reportValidity()) return;
    const init = { bubbles: true, cancelable: true, submitter };
    const event = typeof win.SubmitEvent === "function" ? new win.SubmitEvent("submit", init) : new win.Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
  };

  // Bubbling, on the document: the view's own click handlers (React's included, on its root) run
  // first, and one that cancels the click cancels the submission, as it would in a page.
  doc.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target.closest("button, input") : null;
    if (!isSubmitter(target) || target.disabled || !target.form) return;
    e.preventDefault();
    fire(target.form, target);
  });

  doc.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const field = e.target;
    if (!(field instanceof HTMLInputElement) || !IMPLICIT.has(field.type) || !field.form) return;
    const form = field.form;
    // Implicit submission, as the HTML standard has it: the form's default button is clicked; without
    // one, the form submits when it has a single field that would.
    const button = [...form.elements].find(isSubmitter) ?? null;
    if (button) {
      e.preventDefault();
      if (!button.disabled) button.click();
      return;
    }
    const fields = [...form.elements].filter((el) => el instanceof HTMLInputElement && IMPLICIT.has(el.type));
    if (fields.length !== 1) return;
    e.preventDefault();
    fire(form, null);
  });

  const proto = win.HTMLFormElement.prototype;
  proto.requestSubmit = function requestSubmit(this: HTMLFormElement, submitter?: HTMLElement | null): void {
    if (submitter != null && (!isSubmitter(submitter) || submitter.form !== this)) {
      throw new win.DOMException("The submitter is not a submit button of this form", submitter && !isSubmitter(submitter) ? "TypeError" : "NotFoundError");
    }
    fire(this, (submitter as Submitter | null | undefined) ?? null);
  };
}
