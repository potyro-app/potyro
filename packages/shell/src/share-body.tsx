// The body of the share dialog (#79, docs/04 §Share): what will be sent, read-only — an app's words
// (`ctx.ui.share`), a link, files, or several of them — and the ways it can leave: the device's own
// share sheet where there is one, Copy for words and links, Save a copy for files.
//
// `navigator.clipboard` is missing in an insecure context and can be denied. Either way the person
// is told, and what was to be copied is left selected so that the recourse — copy it by hand — is one
// keystroke rather than a 200-character drag on a phone.
//
// Files: every one is shown before anything leaves — a picture as itself, anything else by its name
// and size — because the person, not the app, decides where it goes (no permission, sealed or not).
// The share sheet takes them where the device can share files (`ShareCap.canShare`: Android, iOS,
// Safari, Chromium on Windows/macOS/ChromeOS, the phone app); everywhere else Save a copy is the way.

import { Glyph } from "@potyro/views";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { webShare, type ShareCap } from "@potyro/capabilities";
import { shellCaps } from "./shell-caps.js";

/** `making`: a link to an app's page is on its way (`pendingLink`); `unmade`: it could not be made. */
type State = "idle" | "copied" | "saved" | "failed" | "save-failed" | "making" | "unmade";

/** How it left: copied, through the device's own sheet, or saved as a copy (docs/24 counts which). */
export type ShareHow = "copy" | "native" | "save";

/** The device's share sheet: the shell's capabilities' (the phone's in the app), else the browser's. */
function deviceShare(): ShareCap {
  try {
    return shellCaps().share ?? webShare();
  } catch {
    return webShare();
  }
}

export interface ShareBodyProps {
  link: string;
  /** A link still being made (`ctx.ui.share({ app })`, docs/24 §11): shown as on its way, and Copy waits for it. If it cannot be made, the rest goes alone. */
  pendingLink?: Promise<string>;
  text?: string;
  files?: File[];
  onHanded: (how: ShareHow) => void;
  onDone: () => void;
}

export function ShareBody({ link: given, pendingLink, text, files, onHanded, onDone }: ShareBodyProps) {
  const { t } = useLingui();
  const [state, setState] = useState<State>(pendingLink ? "making" : "idle");
  const [link, setLink] = useState(given);
  useEffect(() => {
    if (!pendingLink) return;
    let alive = true;
    pendingLink.then(
      (made) => {
        if (!alive) return;
        setLink(made);
        setState("idle");
      },
      (e: unknown) => {
        console.warn("[potyro] the link could not be made:", e);
        if (alive) setState("unmade");
      },
    );
    return () => {
      alive = false;
    };
  }, [pendingLink]);
  const making = state === "making";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const words = text !== undefined;
  const hasFiles = Boolean(files?.length);
  /** What Copy puts on the clipboard: the words, then the link on a line of its own. */
  const whole = [text, link].filter(Boolean).join("\n");
  const payload = useMemo(() => ({ ...(text ? { text } : {}), ...(link ? { url: link } : {}), ...(hasFiles ? { files } : {}) }), [text, link, files, hasFiles]);
  const device = useMemo(() => deviceShare(), []);
  const canShare = device.canShare(payload);
  const canCopy = Boolean(whole) || making;

  // The dialog's main way holds focus from the start (once a link being made is there), so Enter does the likely thing.
  useEffect(() => {
    if (!making) primaryRef.current?.focus();
  }, [making]);

  const selectIt = (): void => {
    const field = textRef.current ?? inputRef.current;
    field?.focus();
    field?.select();
  };

  const copy = async (what: string = whole): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error("No clipboard in this context");
      await navigator.clipboard.writeText(what);
      setState("copied");
      onHanded("copy");
    } catch {
      setState("failed");
      selectIt();
    }
  };

  const shareNative = async (): Promise<void> => {
    try {
      await device.share(payload);
      onHanded("native");
      if (words || hasFiles) onDone();
    } catch (e) {
      // Closing the sheet without choosing anything is not a failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setState("failed");
      selectIt();
    }
  };

  const save = async (): Promise<void> => {
    try {
      for (const f of files ?? []) await shellCaps().filesystem.save(f.name, f);
      setState("saved");
      onHanded("save");
    } catch (e) {
      // A save dialog closed without saving is the person changing their mind.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setState("save-failed");
    }
  };

  const status =
    state === "making"
      ? t({ message: "Making the link", comment: "Share dialog: the link to an app's page is being made" })
      : state === "unmade"
        ? t({ message: "The link could not be made. The words can still be sent.", comment: "Share dialog: making the link to an app's page failed" })
        : state === "copied"
      ? t`Copied`
      : state === "saved"
        ? files && files.length > 1
          ? t({ message: "Saved the files", comment: "Share dialog: Save a copy worked, several files" })
          : t({ message: "Saved", comment: "Share dialog: Save a copy worked, one file" })
        : state === "save-failed"
          ? t({ message: "Couldn't save it. Try again.", comment: "Share dialog: Save a copy failed" })
          : state === "failed"
            ? hasFiles && !words && !link
              ? t({ message: "Couldn't share it. Save a copy instead.", comment: "Share dialog: the share sheet failed for files only" })
              : words
                ? t({ message: "Couldn't copy — select the text and copy it yourself.", comment: "Share dialog: copying an app's words failed" })
                : t`Couldn't copy — select the link and copy it yourself.`
            : "";
  const failed = state === "failed" || state === "save-failed" || state === "unmade";
  // The main way: the share sheet when it takes everything, else saving the files, else copying.
  const primary: "share" | "save" | "copy" = canShare && (hasFiles || !canCopy) ? "share" : hasFiles ? "save" : "copy";

  return (
    <>
      {hasFiles ? <SharedFiles files={files!} /> : null}
      {words ? (
        <textarea
          ref={textRef}
          className="k-input k-share-text"
          aria-label={t({ message: "What will be sent", comment: "Share dialog: the words an app hands over, read-only" })}
          readOnly
          // Lines as they wrap, not only as they are written: a long link is shown whole, not cut off.
          rows={Math.min(hasFiles ? 4 : 10, whole.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 56)), 0))}
          value={whole}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : link || making ? (
        <input ref={inputRef} className="k-input k-share-link" aria-label={t`Share link`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      ) : null}
      <p className={`k-share-status${failed ? " k-share-status-failed" : ""}`} role="status" aria-live="polite">
        {status}
      </p>
      <div className="k-form-actions k-share-actions">
        <button type="button" className="k-add" onClick={onDone}>
          <Trans comment="Share dialog: close it">Done</Trans>
        </button>
        {hasFiles ? (
          <button ref={primary === "save" ? primaryRef : undefined} type="button" className={`k-add${primary === "save" ? " k-primary-action" : ""}`} data-share="save" onClick={() => void save()}>
            <Trans comment="Share dialog: download or keep the files on this device">Save a copy</Trans>
          </button>
        ) : null}
        {canShare ? (
          <button ref={primary === "share" ? primaryRef : undefined} type="button" className={`k-add${primary === "share" ? " k-primary-action" : ""}`} data-share="native" disabled={making} onClick={() => void shareNative()}>
            <Trans comment="Opens the device's own share sheet">Share</Trans>
          </button>
        ) : null}
        {/* Words with a link: the link alone too, for pasting into an address bar (owner, 2026-11-07). */}
        {words && (link || making) ? (
          <button type="button" className="k-add" data-share="copy-link" disabled={making} onClick={() => void copy(link)}>
            <Trans comment="Share dialog: copy only the link, not the app's words">Copy link</Trans>
          </button>
        ) : null}
        {canCopy ? (
          <button ref={primary === "copy" ? primaryRef : undefined} type="button" className={`k-add${primary === "copy" ? " k-primary-action" : ""}`} data-share="copy" disabled={making} onClick={() => void copy()}>
            {words ? <Trans comment="Share dialog: copy an app's words (and link)">Copy</Trans> : <Trans>Copy link</Trans>}
          </button>
        ) : null}
      </div>
    </>
  );
}

/** A file's kind as its glyph shows it: "PDF", "CSV" — the extension, short. */
const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : "";
};

/** The files, as they will go: pictures as themselves, the rest by name; each with its size. */
function SharedFiles({ files }: { files: File[] }) {
  const { t, i18n } = useLingui();
  // One object URL per picture for as long as the dialog is open, revoked when it closes. Made in the
  // effect, not during render: an effect's cleanup can run and the effect again (StrictMode), and a
  // URL revoked by the first cleanup would leave the preview broken.
  const [urls, setUrls] = useState<Array<string | null>>(() => files.map(() => null));
  useEffect(() => {
    const made = files.map((f) => (f.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null));
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);
  const size = (bytes: number): string => {
    const mb = bytes >= 1024 * 1024;
    try {
      return new Intl.NumberFormat(i18n.locale, { style: "unit", unit: mb ? "megabyte" : "kilobyte", unitDisplay: "short", maximumFractionDigits: mb ? 1 : 0 }).format(mb ? bytes / 1024 / 1024 : Math.max(1, Math.round(bytes / 1024)));
    } catch {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`; // i18n-ignore — a unit
    }
  };
  const count = files.length;
  return (
    <ul className={`k-share-files${count === 1 ? " k-share-files-one" : ""}`} aria-label={t({ message: "What will be sent", comment: "Share dialog: the files an app hands over" })}>
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="k-share-file" data-kind={f.type.startsWith("image/") ? "picture" : "file"}>
          {urls[i] ? (
            <img className="k-share-file-picture" src={urls[i]!} alt={f.name} />
          ) : f.type.startsWith("image/") ? (
            <span className="k-share-file-picture k-share-file-waiting" aria-hidden />
          ) : (
            <span className="k-share-file-glyph" aria-hidden>
              {extOf(f.name) || <Glyph icon="file" size={16} />}
            </span>
          )}
          <span className="k-share-file-name">{f.name}</span>
          <span className="k-share-file-size">{size(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}
