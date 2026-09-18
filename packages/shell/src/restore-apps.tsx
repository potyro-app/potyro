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
import { rememberAppSpace, type AccountApp } from "@karta/store";
import { saveUserApp, getUserApp } from "./user-apps.js";

export interface RestoreAppsProps {
  apps: readonly AccountApp[];
  /** Install the chosen apps: writes them into this device's registry and records where their data is. */
  onRestore: (apps: readonly AccountApp[]) => Promise<void>;
  onClose: () => void;
}

/** What an app costs to bring over, in words — or nothing, when this is not known yet. */
function weight(app: AccountApp): string | null {
  if (typeof app.sizeBytes !== "number" || app.sizeBytes <= 0) return null;
  const mb = app.sizeBytes / 1_000_000;
  if (mb >= 1) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(app.sizeBytes / 1000))} KB`;
}

export function RestoreApps({ apps, onRestore, onClose }: RestoreAppsProps) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(apps.map((a) => a.id)));
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
      <div className="k-modal k-restore" role="dialog" aria-modal="true" aria-label="Load your apps">
        <h2 className="k-restore-title">Load your apps?</h2>
        <p className="k-restore-lede">
          These are on your account. Anything you leave unticked stays there — you can pull it onto this device later.
        </p>
        <ul className="k-restore-list">
          {apps.map((app) => {
            const size = weight(app);
            return (
              <li key={app.id}>
                <label className="k-restore-row">
                  <input type="checkbox" checked={chosen.has(app.id)} onChange={() => toggle(app.id)} />
                  <span className="k-restore-icon" aria-hidden>
                    {app.icon ?? "◇"}
                  </span>
                  <span className="k-restore-name">{app.name}</span>
                  {size ? <span className="k-restore-size">{size}</span> : null}
                  {app.shared ? <span className="k-restore-shared">shared</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="k-restore-actions">
          <button type="button" className="k-add" onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button type="button" className="k-add k-primary-action" onClick={() => void restore()} disabled={busy || chosen.size === 0}>
            {busy ? "Loading…" : `Load ${chosen.size} app${chosen.size === 1 ? "" : "s"}`}
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
  if (getUserApp(app.id)) return;
  // Where its space is, in the form the store looks for. Without this the app would open a second,
  // empty space and the data on the relay would be stranded — exactly what a share link avoids by
  // carrying the ids.
  rememberAppSpace(`user:${app.id}`, { group: app.group, root: app.root });
  await saveUserApp(
    { id: app.id, name: app.name, source: app.source, trusted: true, origin: "created", note: "from your account" },
    now,
  );
  // Synced, because that is where its data is. `saveUserApp` does not take the flag (it is not a
  // property of the source), so it is set straight after, before anything opens the app.
  const { setUserAppSync } = await import("./user-apps.js");
  setUserAppSync(app.id, true, now);
}
