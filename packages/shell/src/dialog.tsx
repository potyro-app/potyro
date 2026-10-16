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
import { Trans, useLingui } from "@lingui/react/macro";
import { ShareBody } from "./share-body.js";

export { ShareBody, type ShareHow } from "./share-body.js";

export interface DialogRequest {
  kind: "confirm" | "prompt" | "share";
  message: string;
  /** Seed for a prompt's input; the link for a share. */
  initial: string;
  /** A confirm's quieter second line, its button's words, and whether that button is the red one (#112). */
  detail?: string;
  ok?: string;
  /** The other button's words. Shell-only: "Not now" reads better than "Cancel" for a choice that is not undoing anything. */
  cancel?: string;
  destructive?: boolean;
  /** For a share: the words to send (`ctx.ui.share`), shown as they will go out; `initial` is the link, if any. */
  text?: string;
  /** For a share: the files to send (`ctx.ui.share({ files })`), named and checked by the host; pictures are previewed. */
  files?: File[];
  /** `true`/`false` for confirm, the string or `null` for prompt; for a share, whether it was copied or handed on. */
  settle: (value: boolean | string | null) => void;
}

export class DialogHost {
  private current: DialogRequest | null = null;
  private listeners = new Set<() => void>();

  private open(kind: DialogRequest["kind"], message: string, initial: string, extra: Pick<DialogRequest, "detail" | "ok" | "cancel" | "destructive" | "text" | "files"> = {}): Promise<boolean | string | null> {
    return new Promise((resolve) => {
      // A second request while one is open would strand the first promise. Settle it as declined —
      // never as accepted: an abandoned confirm must not delete anything.
      this.current?.settle(this.current.kind === "confirm" ? false : null);
      this.current = {
        kind,
        message,
        initial,
        ...extra,
        settle: (value) => {
          this.current = null;
          this.emit();
          resolve(value);
        },
      };
      this.emit();
    });
  }

  confirm = async (message: string, opts?: { detail?: string; ok?: string; cancel?: string; destructive?: boolean }): Promise<boolean> =>
    Boolean(await this.open("confirm", message, "", { detail: opts?.detail, ok: opts?.ok, cancel: opts?.cancel, destructive: opts?.destructive }));

  prompt = async (message: string, opts?: { default?: string }): Promise<string | null> => {
    const value = await this.open("prompt", message, opts?.default ?? "");
    return typeof value === "string" ? value : null;
  };

  /**
   * Hand over a link. Resolves when the dialog is closed; copying is the dialog's business, and it
   * reports the outcome itself rather than the caller copying blindly beforehand (#79).
   */
  share = async (message: string, link: string): Promise<void> => {
    await this.open("share", message, link);
  };

  /**
   * `ctx.ui.share` (an app's words, a link, files, or any of them together): the same dialog,
   * showing what will be sent. `true` once it was copied, saved or handed to the device's share sheet.
   */
  send = async (opts: { text?: string; url?: string; title?: string; files?: File[] }): Promise<boolean> =>
    (await this.open("share", opts.title ?? "", opts.url ?? "", { ...(opts.text ? { text: opts.text } : {}), ...(opts.files?.length ? { files: opts.files } : {}) })) === true;

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
  const { t } = useLingui();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);
  /** A share's answer: whether it was copied or handed on before the dialog closed. */
  const handed = useRef(false);

  useEffect(() => {
    if (!request) return;
    handed.current = false;
    setText(request.initial);
    // Focus what the user is about to act on, so the dialog is usable from the keyboard the moment
    // it appears — the one thing the native dialogs did get right.
    const timer = setTimeout(() => (request.kind === "prompt" ? inputRef.current?.focus() : okRef.current?.focus()), 0);
    return () => clearTimeout(timer);
  }, [request]);

  if (!request) return null;

  const cancel = (): void => request.settle(request.kind === "confirm" ? false : null);
  const accept = (): void => request.settle(request.kind === "confirm" ? true : text);

  if (request.kind === "share") {
    // Closing says whether anything left: `share` from the shell ignores it, `ctx.ui.share` answers it.
    const done = (): void => request.settle(handed.current);
    const fromApp = request.text !== undefined || Boolean(request.files?.length);
    return (
      <div className="k-modal-scrim" onClick={done}>
        <div
          className={`k-modal k-dialog k-share-dialog${request.files?.length ? " k-share-dialog-files" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={fromApp ? request.message || t({ message: "Share", comment: "Share dialog title when an app gives none" }) : t`Share link`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") done();
          }}
        >
          {request.message ? <p className="k-dialog-message">{request.message}</p> : null}
          <ShareBody link={request.initial} text={request.text} files={request.files} onHanded={() => (handed.current = true)} onDone={done} />
        </div>
      </div>
    );
  }

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
        {request.detail ? <p className="k-dialog-detail">{request.detail}</p> : null}
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
            {request.cancel ?? t({ message: "Cancel", comment: "Dialog button: decline" })}
          </button>
          <button ref={okRef} type="button" className={`k-add k-primary-action${request.destructive ? " k-dialog-destructive" : ""}`} onClick={accept}>
            {request.ok ?? (request.kind === "confirm" ? t({ message: "Confirm", comment: "Dialog button: accept" }) : t({ message: "OK", comment: "Prompt button: accept what was typed" }))}
          </button>
        </div>
      </div>
    </div>
  );
}
