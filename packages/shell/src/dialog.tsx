// Real `ctx.ui.confirm` / `ctx.ui.prompt` — in-app dialogs instead of the platform's.
//
// The bridge shipped with `globalThis.confirm` / `globalThis.prompt`. Those block the whole page,
// cannot be styled or themed, announce the origin ("localhost:5173 says…") rather than the app, and
// on the Capacitor target become OS dialogs that look nothing like the surface they interrupt. They
// are also the wrong register for the thing they now guard: deleting a record is irreversible here,
// and that deserves a dialog that says which record, in the app's own voice.
//
// Shape mirrors `PickerHost`: a tiny store the bridge pushes to and the App subscribes to. `confirm`
// and `prompt` return promises that settle on answer or dismissal, so app code keeps awaiting a value
// and never learns there is a React tree involved.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface DialogRequest {
  kind: "confirm" | "prompt";
  message: string;
  /** Seed for a prompt's input. */
  initial: string;
  /** `true`/`false` for confirm, the string or `null` for prompt. */
  settle: (value: boolean | string | null) => void;
}

export class DialogHost {
  private current: DialogRequest | null = null;
  private listeners = new Set<() => void>();

  private open(kind: DialogRequest["kind"], message: string, initial: string): Promise<boolean | string | null> {
    return new Promise((resolve) => {
      // A second request while one is open would strand the first promise. Settle it as declined —
      // never as accepted: an abandoned confirm must not delete anything.
      this.current?.settle(this.current.kind === "confirm" ? false : null);
      this.current = {
        kind,
        message,
        initial,
        settle: (value) => {
          this.current = null;
          this.emit();
          resolve(value);
        },
      };
      this.emit();
    });
  }

  confirm = async (message: string): Promise<boolean> => Boolean(await this.open("confirm", message, ""));

  prompt = async (message: string, opts?: { default?: string }): Promise<string | null> => {
    const value = await this.open("prompt", message, opts?.default ?? "");
    return typeof value === "string" ? value : null;
  };

  get = (): DialogRequest | null => this.current;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

/**
 * The shell's one dialog host.
 *
 * A module singleton rather than a prop: `ctx.ui` needs it before `<App>` exists, and the shell's own
 * surfaces (renaming an app in the launcher, the Studio's save-anyway question) need it from places
 * that never receive App's props. `<Dialogs>` is mounted once at the root, so the Studio's preview
 * `<App>` cannot put a second one on screen.
 */
export const shellDialogs = new DialogHost();

export function Dialogs({ host }: { host: DialogHost }) {
  const request = useSyncExternalStore(host.subscribe, host.get, host.get);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!request) return;
    setText(request.initial);
    // Focus what the user is about to act on, so the dialog is usable from the keyboard the moment
    // it appears — the one thing the native dialogs did get right.
    const t = setTimeout(() => (request.kind === "prompt" ? inputRef.current?.focus() : okRef.current?.focus()), 0);
    return () => clearTimeout(t);
  }, [request]);

  if (!request) return null;

  const cancel = (): void => request.settle(request.kind === "confirm" ? false : null);
  const accept = (): void => request.settle(request.kind === "confirm" ? true : text);

  return (
    // Dismissing by scrim or Escape counts as "no" — the safe answer for both kinds.
    <div className="k-modal-scrim" onClick={cancel}>
      <div
        className="k-modal k-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={request.message}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          if (e.key === "Enter" && request.kind === "prompt") accept();
        }}
      >
        <p className="k-dialog-message">{request.message}</p>
        {request.kind === "prompt" ? (
          <input
            ref={inputRef}
            className="k-input"
            aria-label={request.message}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : null}
        <div className="k-form-actions">
          <button type="button" className="k-add" onClick={cancel}>
            Cancel
          </button>
          <button ref={okRef} type="button" className="k-add k-primary-action" onClick={accept}>
            {request.kind === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
