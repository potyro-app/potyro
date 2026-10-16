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

import { useRef, useState, type ComponentType } from "react";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { StorageReport } from "./storage-report.js";
import { LANGUAGE_SELECT_ID, LanguagePicker } from "./language-picker.js";
import { BackupSwitch } from "./backup-switch.js";
import { shellDialogs } from "./dialog.js";
import { RELAY_KEY, syncRelayUrl } from "./open-store.js";
import { DEFAULT_NAME, ensureIdentity, peekIdentity, recoveryPassphrase, renameIdentity, signInWithPassphrase } from "@potyro/identity";
import { personHue, personInitials } from "@potyro/runtime";

/** Set once the user has been offered their words, so the offer is made once and not on every sync. */
const OFFERED = "potyro:identity:offeredBackup";
/** Set once the name has been ASKED for. Separate from having a name: declining is an answer. */
const ASKED_NAME = "potyro:identity:askedName";

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
 *
 * **`Unnamed` is checked, not just `asked`.** The first version only looked at the flag, so someone
 * who had already named themselves in this panel — the obvious thing to do before sharing — was
 * asked again the moment they pressed Share. The question is about the NAME; the flag only records
 * that we have bothered them once.
 */
export async function askNameIfUnnamed(): Promise<void> {
  if (globalThis.localStorage?.getItem(ASKED_NAME)) return;
  const me = await ensureIdentity();
  // Marked before either exit: whether they answered by naming themselves earlier or answer the
  // prompt below, the question is now settled and nothing asks again.
  globalThis.localStorage?.setItem(ASKED_NAME, new Date().toISOString());

  // Already answered, by doing rather than by telling.
  if (me.name && me.name !== DEFAULT_NAME) return;

  const name = await shellDialogs.prompt(
    t`What should the people you share with see you as?` +
      "\n\n" +
      t`Everyone starts out as “Me”, which makes a shared app hard to read. You can change this any time from ⌾ You.`,
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
    t`Your data now lives in more than one place.` +
      "\n\n" +
      t`A short list of words is the only way back to it if you lose this device — and the only way to use it on another one. Nobody can recover them for you.` +
      "\n\n" +
      t`Show them now?`,
  );
  if (yes) open();
}

export function IdentityPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [me, setMe] = useState(() => peekIdentity());
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [Probe, setProbe] = useState<ComponentType<{ onClose: () => void }> | null>(null);
  const taps = useRef<number[]>([]);
  const tapHeading = (): void => {
    const now = Date.now();
    taps.current = [...taps.current.filter((at) => now - at < 3000), now];
    if (taps.current.length < 7) return;
    taps.current = [];
    void import("./realm-probe-screen.js").then((m) => setProbe(() => m.RealmProbeScreen));
  };

  const rename = async (): Promise<void> => {
    const name = await shellDialogs.prompt(t`What should people you share with see you as?`, { default: me?.name ?? "" });
    if (!name?.trim()) return;
    // A fresh device may have no identity until something needs one; naming yourself is such a thing.
    await ensureIdentity();
    const renamed = renameIdentity(name);
    setMe(renamed);
    // Naming yourself here IS the answer to "what should people see you as?", so the sharing and
    // joining paths must not ask it again. Without this, doing the obvious thing before sharing —
    // setting your name first — was rewarded with the same question the moment you pressed Share.
    globalThis.localStorage?.setItem(ASKED_NAME, new Date().toISOString());
    // Renaming writes locally; the copy other people read is the account profile, published on every
    // open. Pushed here too, so the change lands on the people you are sharing with now rather than
    // whenever you next reload — chat makes a stale name impossible to miss.
    const { republishName } = await import("./open-store.js");
    await republishName(renamed.name);
  };

  /**
   * Point this device at a different relay.
   *
   * A reload, not a re-render: every open store was built around the current relay and its socket,
   * and re-pointing them in place is far more failure-prone than starting clean — the same call the
   * passphrase sign-in makes, for the same reason. Blank clears the override and falls back to the
   * deployment's own default.
   */
  const changeRelay = async (): Promise<void> => {
    const entered = await shellDialogs.prompt(
      t`Which relay should this device use?` +
        "\n\n" +
        t`A websocket URL — wss://… on a secure page, since a browser refuses ws:// from https://.` +
        "\n" +
        t`Leave it blank to use this site’s own relay.`,
      { default: globalThis.localStorage?.getItem(RELAY_KEY) ?? "" },
    );
    if (entered === null) return; // cancelled — not the same as "clear it"
    const next = entered.trim();
    if (next && !/^wss?:\/\//i.test(next)) {
      await shellDialogs.confirm(t`That is not a websocket URL. It needs to start with wss:// or ws://.`);
      return;
    }
    if (next) globalThis.localStorage?.setItem(RELAY_KEY, next);
    else globalThis.localStorage?.removeItem(RELAY_KEY);
    location.reload();
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
      t`Paste the words from your other device.` +
        "\n\n" +
        t`This replaces the identity on THIS device — anything stored here under the current one stops being yours to open.`,
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

  const named = Boolean(me?.name && me.name !== DEFAULT_NAME);
  const ownRelay = Boolean(globalThis.localStorage?.getItem(RELAY_KEY));
  const relay = syncRelayUrl();

  // #95: this read like a debug page — a monospace `no identity yet` under the name, a ws:// URL on
  // the front, and "Add a device" / "I already use Potyro" as two unrelated products. It leads with the
  // person now; the two device paths sit under one heading; infrastructure is under Advanced.
  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-identity" role="dialog" aria-modal="true" aria-label={t`You and your devices`} onClick={(e) => e.stopPropagation()}>
        <header className="k-identity-head">
          {/* Seven taps open the sealed-screen device check (#267, docs/22 §5): hidden, inert until then. */}
          <h2 onClick={tapHeading}>
            <Trans comment="Heading of the panel about the person using Potyro and their devices">You</Trans>
          </h2>
          <button type="button" className="k-add" onClick={onClose} aria-label={t`Close`}>
            ✕
          </button>
        </header>

        <div className="k-identity-person">
          <span className="k-identity-avatar" aria-hidden style={{ ["--k-hue" as string]: me ? personHue(me.id) : 60 }}>
            {me ? personInitials(me.name, me.id) : "?"}
          </span>
          <div className="k-identity-who">
            <strong className="k-identity-name">{named ? me!.name : t`No name yet`}</strong>
            <span className="k-muted">{named ? t`Shown to the people you share an app with.` : t`People you share an app with see you as “Me”.`}</span>
          </div>
          <button type="button" className="k-add" onClick={() => void rename()}>
            {named ? t`Rename` : t`Set a name`}
          </button>
        </div>

        {/* Early, before anything that has to be read carefully: someone who cannot read the rest
            of this panel needs to find this first. */}
        <section aria-labelledby="k-lang-h">
          {/* The heading is the select's visible label: tapping it opens the picker. */}
          <h3 id="k-lang-h">
            <label htmlFor={LANGUAGE_SELECT_ID}>
              <Trans comment="Section heading: which language Potyro is shown in">Language</Trans>
            </label>
          </h3>
          <LanguagePicker />
        </section>

        {/* Before the devices, deliberately: linking one is only worth doing if there is something
            for it to bring back. */}
        <section aria-labelledby="k-backup-h">
          <h3 id="k-backup-h">
            <Trans>Backup</Trans>
          </h3>
          <BackupSwitch />
        </section>

        <section aria-labelledby="k-devices-h">
          <h3 id="k-devices-h">
            <Trans>Your devices</Trans>
          </h3>
          <div className="k-identity-device">
            <span aria-hidden>💻</span>
            <div>
              <Trans>This device</Trans>
              <small className="k-muted">
                <Trans>Your apps and data live here. Add another device to use them there too.</Trans>
              </small>
            </div>
          </div>
          {words ? (
            <div className="k-identity-words">
              <p className="k-muted">
                <Trans>Type these words into Potyro on the other device. They are the only copy — write them down somewhere safe.</Trans>
              </p>
              <output className="k-passphrase">{words}</output>
              <button type="button" className="k-add" onClick={() => void navigator.clipboard?.writeText(words).catch(() => {})}>
                <Trans>Copy</Trans>
              </button>
            </div>
          ) : (
            <button type="button" className="k-identity-path" disabled={busy} onClick={() => void reveal()}>
              <b>
                <Trans>Add a device</Trans>
              </b>
              <small className="k-muted">
                <Trans>Shows 24 words to type on the other device. They are the only copy — keep them safe.</Trans>
              </small>
            </button>
          )}
          <button type="button" className="k-identity-path" disabled={busy} onClick={() => void signIn()}>
            <b>
              <Trans>This is my second device</Trans>
            </b>
            <small className="k-muted">
              <Trans>Type the words from your first device to bring its apps here.</Trans>
            </small>
          </button>
        </section>

        {/* KA-28: "bring your own relay" must be reachable without a rebuild and without devtools —
            and, since it is not something most people should touch, without being on the front. */}
        <details className="k-identity-advanced">
          <summary>
            <Trans>Advanced — sync relay, identity id</Trans>
          </summary>
          <p className="k-muted">
            {relay
              ? ownRelay
                ? t`Synced apps meet through your own relay. It only ever sees encrypted data — it cannot read your records.`
                : t`Synced apps meet through this site’s relay. It only ever sees encrypted data — it cannot read your records.`
              : t`No relay: synced apps stay on this device.`}
          </p>
          {relay ? (
            <p className="k-muted k-relay-current">
              <code>{relay}</code>
            </p>
          ) : null}
          <button type="button" className="k-add" disabled={busy} onClick={() => void changeRelay()}>
            <Trans>Change relay</Trans>
          </button>
          {me ? (
            <p className="k-muted k-identity-id">
              <Trans>
                Identity <code>{me.id}</code>
              </Trans>
            </p>
          ) : null}
          {/* What this device's storage is actually doing. Every fallback in `openStore` is silent,
              so without this the only way to know is to ask someone to open a console. */}
          <StorageReport />
        </details>
        {Probe ? <Probe onClose={() => setProbe(null)} /> : null}
      </div>
    </div>
  );
}
