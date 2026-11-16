// A sealed app at rest (#90, docs/22 §7.1): the host had to stop it several times in a row — it ran
// too long, flooded, or the browser took its memory back — and does not start it again by itself.
// The person is told what happened in a sentence and can start it again; what they saved is in the
// store, untouched. A calm notice, never a red error: nothing the person did is wrong.

import { Trans } from "@lingui/react/macro";
import { useSyncExternalStore } from "react";
import type { LoadedApp } from "@potyro/host";

const never = (): (() => void) => () => {};

export function RestBanner({ app, onWake }: { app: LoadedApp; onWake?: () => void }) {
  const rest = app.rest;
  const resting = useSyncExternalStore(rest ? rest.subscribe : never, () => rest?.resting() ?? false, () => false);
  if (!rest || !resting) return null;
  return (
    <div className="k-sealed-notice k-rest-notice" role="status">
      <p>
        <Trans comment="A notice at the top of a shared app that Potyro had to stop several times in a row (it froze or used too much memory) and has now paused. Calm, not an error.">
          This app stopped several times in a row, so Potyro paused it. What you saved in it is still here.
        </Trans>
      </p>
      <div className="k-sealed-notice-actions">
        <button
          type="button"
          className="k-add k-sealed-retry"
          onClick={() => {
            rest.wake();
            onWake?.();
          }}
        >
          <Trans comment="A button on the notice of a paused app: run the app again">Start it again</Trans>
        </button>
      </div>
    </div>
  );
}
