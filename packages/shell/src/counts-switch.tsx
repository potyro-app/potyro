// You → "Count me anonymously" (#118): on by default. It covers the two counts this device sends
// (demand-counts.ts): that a key of the person's own was used, and "I'd pay for a plan". Off, neither
// is sent. "Used up" is not one of them: the relay counts it itself, as part of keeping the free
// allowance (docs/23 "Counts"), so the label says exactly the two it turns off.

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { countsOn, setCountsOn } from "./demand-counts.js";

export function CountsSwitch() {
  const [on, setOn] = useState(countsOn());
  return (
    <button
      type="button"
      role="switch"
      className="k-switch-row"
      aria-checked={on}
      onClick={() => {
        setCountsOn(!on);
        setOn(!on);
      }}
    >
      <span className="k-switch-text">
        <span className="k-switch-label">
          <Trans comment="You panel: a switch; turns off two anonymous counts, nothing about who">Count me anonymously</Trans>
        </span>
        <span className="k-switch-help">
          <Trans>That I used my own key, or that I'd pay for a plan. Once a month at most, and nothing about you or your apps.</Trans>
        </span>
      </span>
      <span className="k-switch" aria-hidden>
        <span className="k-switch-knob" />
      </span>
    </button>
  );
}
