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

import { tileIdentity } from "./tile-identity.js";
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
}

/** Read a declaration out of an app's source without running it — the trick `examples.ts` uses. */
const declared = (source: string | undefined, key: string): string | undefined =>
  source ? (new RegExp(`^\\s*${key}:\\s*"([^"]+)"`, "m").exec(source)?.[1] ?? undefined) : undefined;

export function Splash({ id, name, source, icon, verb = "Opening", failed, promote }: SplashProps) {
  // The launcher's entry carries what THIS device calls the app — a nickname, another emoji, a
  // colour someone picked (#83) — so the splash matches the tile that was tapped, not the app's
  // own idea of itself.
  const entry = id ? getEntry(appKey("user", id)) : undefined;
  const identity = tileIdentity({
    key: id ? appKey("user", id) : `user:${name}`,
    name: entry?.displayName ?? name,
    icon: entry?.icon ?? icon ?? entry?.identity?.icon ?? declared(source, "icon"),
    accent: entry?.identity?.accent ?? declared(source, "accent"),
    hue: entry?.hue,
  });

  return (
    <div className={failed ? "k-splash k-splash-failed" : "k-splash"} role={failed ? "alert" : "status"} aria-live="polite">
      <div className="k-splash-body" style={{ ["--tile-accent" as string]: identity.accent }}>
        <span className={`k-splash-tile k-splash-tile-${identity.kind}`} aria-hidden>
          {identity.glyph}
        </span>
        <p className="k-splash-name">{entry?.displayName ?? name}</p>
        {failed ? (
          <>
            <p className="k-splash-verb">It could not open.</p>
            <p className="k-splash-why">{failed}</p>
            {promote ? <p className="k-splash-why k-splash-advice">Only let it run as yours if you know who made it. Otherwise it stays sealed, and it will not open.</p> : null}
            <div className="k-splash-actions">
              {promote ? <PromoteButton app={promote} primary /> : null}
              <button type="button" className="k-add" onClick={() => navigateTo({ kind: "home" })}>
                Back to my apps
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="k-splash-verb">{verb}…</p>
            {/* Indeterminate on purpose: nothing here knows how far along it is, and a bar that
                pretends to would be lying at a moment the person is already waiting. */}
            <span className="k-splash-bar" aria-hidden />
          </>
        )}
      </div>
    </div>
  );
}
