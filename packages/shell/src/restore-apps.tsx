// "Load your apps?" — the screen a device shows the first time it signs in as you (KA-16 follow-up).
//
// Typing the recovery words makes a device you. This is what makes it yours: the account's own list
// of apps (`account-apps.ts` in the store) is read, anything this device does not have is offered,
// and what you tick is installed and opened against the space that already holds its data.
//
// Ticked by default, because "load my apps" is why you typed the words. Not forced, because a phone
// is not a laptop: an app whose photos run to hundreds of megabytes is a choice, and the ones you
// leave stay on the list to pull later rather than disappearing.

import { useState } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
import { rememberAppSpace, type AccountApp } from "@potyro/store";
import { saveUserApp, getUserApp } from "./user-apps.js";
import { receiveCode } from "./app-modules.js";
import { Glyph } from "@potyro/views";

export interface RestoreAppsProps {
  apps: readonly AccountApp[];
  /** The ids ticked when it opens. Every app when absent. */
  ticked?: ReadonlySet<string>;
  /** Install the chosen apps: writes them into this device's registry and records where their data is. */
  onRestore: (apps: readonly AccountApp[]) => Promise<void>;
  onClose: () => void;
}

/** What an app costs to bring over, in words — or nothing, when this is not known yet. */
function weight(app: AccountApp): string | null {
  if (typeof app.sizeBytes !== "number" || app.sizeBytes <= 0) return null;
  const mb = app.sizeBytes / 1_000_000;
  if (mb >= 1) return fmt.number(mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1)), { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
  return fmt.number(Math.max(1, Math.round(app.sizeBytes / 1000)), { style: "unit", unit: "kilobyte" });
}

export function RestoreApps({ apps, ticked, onRestore, onClose }: RestoreAppsProps) {
  const { t } = useLingui();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(ticked ?? apps.map((a) => a.id)));
  const [busy, setBusy] = useState(false);

  const toggle = (id: string): void =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const restore = async (): Promise<void> => {
    setBusy(true);
    try {
      await onRestore(apps.filter((a) => chosen.has(a.id)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-modal-scrim">
      <div className="k-modal k-restore" role="dialog" aria-modal="true" aria-label={t`Load your apps`}>
        <h2 className="k-restore-title">
          <Trans>Load your apps?</Trans>
        </h2>
        <p className="k-restore-lede">
          <Trans>These are on your account. Anything you leave unticked stays there — you can pull it onto this device later.</Trans>
        </p>
        <ul className="k-restore-list">
          {apps.map((app) => {
            const size = weight(app);
            return (
              <li key={app.id}>
                <label className="k-restore-row">
                  <input type="checkbox" checked={chosen.has(app.id)} onChange={() => toggle(app.id)} />
                  <span className="k-restore-icon" aria-hidden>
                    <Glyph icon={app.icon || "layout-grid"} size={20} />
                  </span>
                  <span className="k-restore-name">{app.name}</span>
                  {size ? <span className="k-restore-size">{size}</span> : null}
                  {app.shared ? <span className="k-restore-shared">
                      <Trans comment="Restore list: this app is shared with other people">shared</Trans>
                    </span> : null}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="k-restore-actions">
          <button type="button" className="k-add" onClick={onClose} disabled={busy}>
            <Trans>Not now</Trans>
          </button>
          <button type="button" className="k-add k-primary-action" onClick={() => void restore()} disabled={busy || chosen.size === 0}>
            {busy
              ? t`Loading`
              : chosen.size === 0
                ? t({ message: "Nothing to load", comment: "Load your apps: the button when no app is ticked" })
                : plural(chosen.size, { one: "Load # app", other: "Load # apps" })}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Put an app from the account onto this device.
 *
 * The registry entry carries the app's code and the ids of the space its data lives in, which is
 * everything needed: the app is saved like any other, and the space ids are written where the store
 * looks for them — so opening it attaches to the data already on the relay rather than starting an
 * empty one beside it.
 */
export async function installFromAccount(app: AccountApp, now: string): Promise<void> {
  const here = getUserApp(app.id);
  // An app of this id already syncing on this device is already pointed at a space, and a second
  // space cannot be grafted onto it — that one is left alone.
  if (here?.sync) return;
  // Anything else of that id is either an example this device seeded for itself or a local-only app
  // that happens to share the name, and the account's copy is the one with the person's data in it.
  // Its records stay in their own database, untouched; they are simply no longer what the app opens.
  // Where its space is, in the form the store looks for. Without this the app would open a second,
  // empty space and the data on the relay would be stranded — exactly what a share link avoids by
  // carrying the ids.
  rememberAppSpace(`user:${app.id}`, { group: app.group, root: app.root });
  // Its own modules, checked against the lock that came with them (#281). Its libraries are fetched
  // when it first opens here, with consent; their bytes never come through the account.
  if (app.modules) await receiveCode(app.id, app);
  await saveUserApp(
    {
      id: app.id,
      name: app.name,
      source: app.source,
      ...(app.lock ? { lock: app.lock } : {}),
      // Provenance decides execution (CLAUDE.md rule 3), and it has to survive the trip: the list
      // holds the apps this person joined as well as the ones they made. Only an entry a device of
      // theirs recorded as their own runs directly here; a joined app, or an entry from before this
      // was recorded, runs in the realm until they promote it themselves.
      trusted: app.trusted === true,
      origin: app.trusted === true ? "created" : "imported",
      // Stored in English: SYSTEM_NOTES (studio-thread.ts) recognises it by its words, and it syncs to devices in other languages.
      note: here ? "from your account, replacing this device's copy" : "from your account",
      // Synced, because that is where its data is — written WITH the app, not after it. Set in a
      // second call it lands after this function's history write, and an app that opened in between
      // would open the local copy and look empty.
      sync: true,
      // Its space came from the account, not from this device — so the first-run seeder must not
      // run against it. A space still replicating looks exactly like an empty one, and an example's
      // seed rows written into it are real records in the user's own data, on every other device
      // too.
      joined: true,
    },
    now,
  );
}
