// The Studio, loaded when it is first opened (#48).
//
// The Studio and what it brings (the generator's prompt and reference, the checks a made app goes
// through) were a third of the script the page downloads before it shows anything, and Home needs
// none of it. So `studio.tsx` is a chunk of its own: fetched in the background once Home is up
// (`warmStudio`), and on the tap if that has not happened yet.
//
// While it arrives the person sees the Studio's own frame, already in place: its paper, its bar,
// the close button (which works) and its name. Never a blank, and nothing moves when the real one
// takes over, because it is the same markup with the same classes.
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { cor, varsBoth } from "@potyro/design";
import { I } from "./icons.js";
import type { StudioProps } from "./studio.js";

const load = () => import("./studio.js");
const LoadedStudio = lazy(async () => ({ default: (await load()).Studio }));

/** The platform wears rosa only (DESIGN.md §10), as in studio.tsx. */
const ROSA = varsBoth(cor("rosa"));

/** Fetch the Studio now, so opening it later is instant. A failure is the tap's to report. */
export function warmStudio(): void {
  void load().catch(() => undefined);
}

function StudioOpening({ onClose, onShown }: Pick<StudioProps, "onClose"> & { onShown: () => void }) {
  const { t } = useLingui();
  useEffect(onShown, [onShown]);
  return (
    <div className="k-studio k-traco" role="dialog" aria-label={t`App studio`} aria-busy="true" style={ROSA as CSSProperties}>
      <div className="k-studio-chat">
        <header className="k-studio-bar">
          <button type="button" className="k-studio-close" aria-label={t`Close studio`} onClick={onClose}>
            {I.close}
          </button>
          <div className="k-studio-title">
            <span className="k-studio-eyebrow">
              <Trans comment="The Studio's name, above the app's: where apps are made by talking">Studio</Trans>
            </span>
          </div>
        </header>
        <span className="k-studio-arriving" aria-hidden />
      </div>
    </div>
  );
}

export function Studio(props: StudioProps) {
  // The frame has already come in once the Studio itself arrives: it must not come in a second time.
  const [waited, setWaited] = useState(false);
  const [markWaited] = useState(() => () => setWaited(true));
  return (
    <div className="k-studio-door" data-waited={waited || undefined}>
      <Suspense fallback={<StudioOpening onClose={props.onClose} onShown={markWaited} />}>
        <LoadedStudio {...props} />
      </Suspense>
    </div>
  );
}
