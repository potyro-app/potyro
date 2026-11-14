// "Potyro is open in another tab" — what a tab shows when another one owns the storage.
//
// Every app's database lives in one OPFS pool that only one tab at a time can hold
// (packages/store/src/storage-owner.ts). A second tab used to fight the first for it, lose, log an
// error for every file, and quietly carry on over a second copy of the apps in `localStorage` — so
// what was written in one tab was missing from the other. Now the storage refuses, and this screen
// says what is going on in words and offers the one way forward that keeps both tabs right: use
// Potyro HERE, and the other tab steps aside (it shows this same screen).
//
// Shown over everything, the page behind made inert: whatever was on it was read from storage this
// tab no longer has, and a tap on it would be a write that goes nowhere.

import { Trans } from "@lingui/react/macro";
import { createRoot } from "react-dom/client";
import { onStorageElsewhere, onStorageStuck, takeOverStorageOnNextLoad } from "@potyro/store";

const HOST = "k-elsewhere-host";

/** Show the screen whenever this tab learns another one has the storage. Once per page load. */
export function watchStorageOwner(): void {
  onStorageElsewhere(() => {
    if (document.querySelector(`.${HOST}`)) return;
    for (const el of Array.from(document.body.children)) (el as HTMLElement).inert = true;
    const host = document.createElement("div");
    host.className = HOST;
    document.body.append(host);
    createRoot(host).render(<ElsewhereScreen />);
  });
  // The browser will not open its own storage (packages/store/src/storage-rescue.ts). The same kind
  // of screen for the same reason — nothing behind it has storage to read or write — but not the
  // same words: there is no other tab to go back to, and "Use it here" would change nothing.
  onStorageStuck(() => {
    if (document.querySelector(`.${HOST}`)) return;
    for (const el of Array.from(document.body.children)) (el as HTMLElement).inert = true;
    const host = document.createElement("div");
    host.className = HOST;
    document.body.append(host);
    createRoot(host).render(<StuckScreen />);
  });
}

function useItHere(): void {
  takeOverStorageOnNextLoad();
  location.reload();
}

export function ElsewhereScreen() {
  return (
    <div className="k-splash k-splash-failed k-elsewhere" role="alertdialog" aria-modal="true" aria-labelledby="k-elsewhere-title" aria-describedby="k-elsewhere-why">
      <div className="k-splash-body" style={{ ["--tile-accent" as string]: "var(--accent)" }}>
        <span className="k-splash-tile k-splash-tile-monogram" aria-hidden>
          {/* i18n-ignore — Potyro's mark, not words */}◆
        </span>
        <p className="k-splash-name" id="k-elsewhere-title">
          <Trans>Potyro is open in another tab</Trans>
        </p>
        <p className="k-splash-why" id="k-elsewhere-why">
          <Trans>Your apps are open in one tab at a time, so nothing you change in one is ever missing from the other.</Trans>
        </p>
        <p className="k-splash-why k-splash-advice">
          <Trans>Go back to that tab, or use Potyro here — the other tab will step aside.</Trans>
        </p>
        <div className="k-splash-actions">
          {/* Focused on arrival: it is the only thing on the screen that does anything. */}
          <button type="button" className="k-add k-primary-action" onClick={useItHere} autoFocus>
            <Trans>Use it here</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Restart your browser to open Potyro": the browser refuses its own storage until it is restarted.
 *
 * What was stored has been set aside and comes back on the next start, so the screen says the two
 * things a person needs: nothing is lost, and what to do. Reloading is offered because after the
 * restart this very tab may be restored showing the screen, and because it is the honest "try again".
 */
export function StuckScreen() {
  return (
    <div className="k-splash k-splash-failed k-elsewhere" role="alertdialog" aria-modal="true" aria-labelledby="k-stuck-title" aria-describedby="k-stuck-why">
      <div className="k-splash-body" style={{ ["--tile-accent" as string]: "var(--accent)" }}>
        <span className="k-splash-tile k-splash-tile-monogram" aria-hidden>
          {/* i18n-ignore — Potyro's mark, not words */}◆
        </span>
        <p className="k-splash-name" id="k-stuck-title">
          <Trans>Restart your browser to open Potyro</Trans>
        </p>
        <p className="k-splash-why" id="k-stuck-why">
          <Trans>Your browser cannot open the place where it keeps your apps right now. Nothing is lost: your apps and everything in them are kept safe on this device.</Trans>
        </p>
        <p className="k-splash-why k-splash-advice">
          <Trans>Close the browser completely — every window — then open Potyro again.</Trans>
        </p>
        <div className="k-splash-actions">
          <button type="button" className="k-add k-primary-action" onClick={() => location.reload()} autoFocus>
            <Trans>Try again</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}
