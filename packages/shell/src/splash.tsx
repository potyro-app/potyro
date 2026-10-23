// What is on screen while an app is being opened.
//
// Opening is not instant and never will be: a store is opened (for a synced app, a CRDT engine, an
// identity and a space), the app's module is fetched and transpiled, and an untrusted one is handed
// to the isolate. That second or two used to be the words `Opening "Groceries"…` in the top-left
// corner of an otherwise blank page — which reads as a page that failed to load, not one that is
// loading.
//
// So: the app's own tile, centred, in the colour it wears in the launcher, with its name under it
// and a bar that says something is happening. The tile is the same identity the user just tapped,
// which is what makes this feel like the app opening rather than a screen in between.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { tileIdentity } from "./tile-identity.js";
import { TileGlyph } from "./tile-glyph.js";
import { appKey, getEntry } from "./launcher-store.js";
import { navigateTo } from "./router.js";
import { PromoteButton } from "./trust-dialog.js";
import type { UserApp } from "./user-apps.js";

export interface SplashProps {
  /** The app's id, so its tile identity (and any override on this device) can be looked up. */
  id?: string;
  name: string;
  /** The app's source. What it declares about itself is read straight out of it — the launcher's
   *  cached identity is written when a launcher has rendered, and opening an app by link or reload
   *  can happen before that ever has, which is how the icon came out as a monogram. */
  source?: string;
  /** The app's declared icon, when the caller has it already. */
  icon?: string;
  /** "Opening" while a local app starts, "Joining" while an invite is accepted. */
  verb?: "Opening" | "Joining";
  /**
   * Why it did not open, when it did not: one of its libraries cannot start in the sealed box, or
   * no longer matches the copy it was installed with (#266). Said where the app would have been,
   * in the app's own colours, rather than a blank page or a line of text in the corner.
   */
  failed?: string;
  /**
   * The sealed app that failed, when running it as yours is what would fix it (promotion.ts): the
   * screen then offers exactly that. Never for code that does not match its lock.
   */
  promote?: Pick<UserApp, "id" | "name" | "source">;
  /**
   * The way out of a failure that is not the app's: "Try again" once its data is free in the other
   * tab, "Reinstall its files" from where it came from. The button is the primary one; while it
   * runs it says so, and if it fails the reason replaces the old one.
   */
  action?: { label: string; run: () => Promise<void> };
}

/** Read a declaration out of an app's source without running it — the trick `examples.ts` uses. */
const declared = (source: string | undefined, key: string): string | undefined =>
  source ? (new RegExp(`^\\s*${key}:\\s*"([^"]+)"`, "m").exec(source)?.[1] ?? undefined) : undefined;

export function Splash({ id, name, source, icon, verb = "Opening", failed, promote, action }: SplashProps) {
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState<string | null>(null);
  // The launcher's entry carries what THIS device calls the app — a nickname, another emoji, a
  // colour someone picked (#83) — so the splash matches the tile that was tapped, not the app's
  // own idea of itself.
  const { t } = useLingui();
  const entry = id ? getEntry(appKey("user", id)) : undefined;
  const identity = tileIdentity({
    key: id ? appKey("user", id) : `user:${name}`,
    name: entry?.displayName ?? name,
    icon: entry?.icon ?? icon ?? entry?.identity?.icon ?? declared(source, "icon"),
    image: entry?.icon ? undefined : entry?.iconImage?.image,
    accent: entry?.identity?.accent ?? declared(source, "accent"),
    hue: entry?.hue,
  });

  return (
    <div className={failed ? "k-splash k-splash-failed" : "k-splash"} role={failed ? "alert" : "status"} aria-live="polite">
      <div className="k-splash-body" style={{ ["--tile-accent" as string]: identity.accent }}>
        <span className={`k-splash-tile k-splash-tile-${identity.kind}`} aria-hidden>
          <TileGlyph identity={identity} size={48} />
        </span>
        <p className="k-splash-name">{entry?.displayName ?? name}</p>
        {failed ? (
          <>
            <p className="k-splash-verb">
              <Trans>It could not open.</Trans>
            </p>
            <p className="k-splash-why">{actionFailed ?? failed}</p>
            {promote ? (
              <p className="k-splash-why k-splash-advice">
                <Trans>Only let it run as yours if you know who made it. Otherwise it stays sealed, and it will not open.</Trans>
              </p>
            ) : null}
            <div className="k-splash-actions">
              {promote ? <PromoteButton app={promote} primary /> : null}
              {action ? (
                <button
                  type="button"
                  className="k-add k-primary-action"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setActionFailed(null);
                    action.run().catch((e: unknown) => {
                      setActionFailed(e instanceof Error ? e.message : String(e));
                      setBusy(false);
                    });
                  }}
                >
                  {busy ? t`Working…` : action.label}
                </button>
              ) : null}
              <button type="button" className="k-add" onClick={() => navigateTo({ kind: "home" })}>
                <Trans>Back to my apps</Trans>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="k-splash-verb">{verb === "Joining" ? t`Joining…` : t`Opening…`}</p>
            {/* Indeterminate on purpose: nothing here knows how far along it is, and a bar that
                pretends to would be lying at a moment the person is already waiting. */}
            <span className="k-splash-bar" aria-hidden />
          </>
        )}
      </div>
    </div>
  );
}
