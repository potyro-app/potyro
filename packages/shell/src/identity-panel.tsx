// You, and your other devices (KA-16 · ADR 0001 D2a).
//
// Three things live here because they are the same subject: your name, the words that ARE your
// identity, and adopting an identity from another device.
//
// ## Why the words are not shown at first run
//
// No signup is the product's position, and a "save these 24 words" wall on first launch is a signup
// ceremony wearing different clothes. Worse, for a solo app it would be a lie: the data lives in
// local storage on this one device, and the relay has never held a byte of it, so the words restore
// NOTHING. They start being true the moment sync is turned on — which is when the prompt appears,
// and where `noteSyncEnabled` is called from.
//
// Always reachable here regardless, because the honest version of "we won't nag you" is "and you can
// find it whenever you want".

import { useState } from "react";
import { shellDialogs } from "./dialog.js";
import { ensureIdentity, peekIdentity, recoveryPassphrase, renameIdentity, signInWithPassphrase } from "@karta/identity";

/** Set once the user has been offered their words, so the offer is made once and not on every sync. */
const OFFERED = "karta:identity:offeredBackup";
/** Set once the name has been ASKED for. Separate from having a name: declining is an answer. */
const ASKED_NAME = "karta:identity:askedName";

/**
 * Ask what to call you, at the first moment somebody else can see it.
 *
 * A fresh identity is named "Me" and nothing used to change that, so every member of a space read as
 * "Me" — on the chat, on the activity feed, on every member chip. Three people sharing a list saw
 * three lines of "Me" and no way to tell who meant what. `identity.ts` had described this prompt for
 * a while; it had simply never been built.
 *
 * Asked on SHARING and on JOINING — the two moments the name stops being private — and never at
 * first run, which would be a signup ceremony for a solo app where nobody can see it.
 *
 * Asked ONCE. Declining is a real answer and re-asking on every share would be nagging; the control
 * stays in this panel forever.
 *
 * Mints the identity itself rather than assuming one. On the JOINING path there may be none yet —
 * a device whose first ever act is opening someone's link — and `renameIdentity` throws without one,
 * so the question would have been skipped for exactly the person it matters most for.
 */
export async function askNameIfUnnamed(): Promise<void> {
  if (globalThis.localStorage?.getItem(ASKED_NAME)) return;
  await ensureIdentity();
  globalThis.localStorage?.setItem(ASKED_NAME, new Date().toISOString());

  const name = await shellDialogs.prompt(
    "What should the people you share with see you as?\n\n" +
      "Everyone starts out as “Me”, which makes a shared app hard to read. You can change this any " +
      "time from ⌾ You.",
    { default: "" },
  );
  if (!name?.trim()) return;

  const renamed = renameIdentity(name);
  // Publish now rather than on the next open: on the sharing path the space is already open, and on
  // the joining path it is about to be, so waiting would show the invitee as "Me" to everyone.
  const { republishName } = await import("./open-store.js");
  await republishName(renamed.name);
}

/**
 * Offer the recovery words the first time sync is switched on for anything.
 *
 * Called from the sync toggle and the share flow — the two doors to "this data now exists somewhere
 * other than this device". Returns immediately every later time.
 */
export async function offerBackupOnFirstSync(open: () => void): Promise<void> {
  if (globalThis.localStorage?.getItem(OFFERED)) return;
  globalThis.localStorage?.setItem(OFFERED, new Date().toISOString());
  const yes = await shellDialogs.confirm(
    "Your data now lives in more than one place.\n\n" +
      "A short list of words is the only way back to it if you lose this device — and the only way " +
      "to use it on another one. Nobody can recover them for you.\n\nShow them now?",
  );
  if (yes) open();
}

export function IdentityPanel({ onClose }: { onClose: () => void }) {
  const [me, setMe] = useState(() => peekIdentity());
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rename = async (): Promise<void> => {
    const name = await shellDialogs.prompt(
      "What should people you share with see you as?",
      { default: me?.name ?? "" },
    );
    if (!name?.trim()) return;
    const renamed = renameIdentity(name);
    setMe(renamed);
    // Renaming writes locally; the copy other people read is the account profile, published on every
    // open. Pushed here too, so the change lands on the people you are sharing with now rather than
    // whenever you next reload — chat makes a stale name impossible to miss.
    const { republishName } = await import("./open-store.js");
    await republishName(renamed.name);
  };

  const reveal = async (): Promise<void> => {
    setBusy(true);
    try {
      setWords(await recoveryPassphrase());
    } catch (e) {
      await shellDialogs.confirm(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (): Promise<void> => {
    const entered = await shellDialogs.prompt(
      "Paste the words from your other device.\n\nThis replaces the identity on THIS device — anything " +
        "stored here under the current one stops being yours to open.",
    );
    if (!entered?.trim()) return;
    setBusy(true);
    try {
      await signInWithPassphrase(entered);
      // A full reload, not a re-render: every open store, space and runtime was built around the old
      // identity, and rebuilding them in place is far more failure-prone than starting clean.
      location.reload();
    } catch (e) {
      await shellDialogs.confirm(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-identity" role="dialog" aria-modal="true" aria-label="You and your devices" onClick={(e) => e.stopPropagation()}>
        <header className="k-identity-head">
          <h2>You</h2>
          <button type="button" className="k-add" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="k-identity-name">
          <strong>{me?.name ?? "Me"}</strong>
          <button type="button" className="k-add" onClick={() => void rename()}>
            Rename
          </button>
        </p>
        <p className="k-muted k-identity-id">{me?.id ?? "no identity yet"}</p>

        <section aria-labelledby="k-backup-h">
          <h3 id="k-backup-h">Add a device</h3>
          <p className="k-muted">
            Type these words into Karta on another device to use the same data there. They are the only
            copy — write them down somewhere safe.
          </p>
          {words ? (
            <>
              <output className="k-passphrase">{words}</output>
              <button type="button" className="k-add" onClick={() => void navigator.clipboard?.writeText(words).catch(() => {})}>
                Copy
              </button>
            </>
          ) : (
            <button type="button" className="k-add k-primary-action" disabled={busy} onClick={() => void reveal()}>
              Show my words
            </button>
          )}
        </section>

        <section aria-labelledby="k-signin-h">
          <h3 id="k-signin-h">I already use Karta</h3>
          <p className="k-muted">Bring this device into an identity you already have elsewhere.</p>
          <button type="button" className="k-add" disabled={busy} onClick={() => void signIn()}>
            Enter my words
          </button>
        </section>
      </div>
    </div>
  );
}
