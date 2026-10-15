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
import { onStorageElsewhere, takeOverStorageOnNextLoad } from "@potyro/store";

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
