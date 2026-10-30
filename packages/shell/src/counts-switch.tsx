// You → "Send anonymous counts" (#118): on by default, and off means nothing is counted from this
// device, from anywhere (demand-counts.ts). What a count is, in one line: no one can be told apart.

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
          <Trans comment="You panel: a switch; counts like 'someone added their own key this month', nothing about who">Send anonymous counts</Trans>
        </span>
        <span className="k-switch-help">
          <Trans>Once a month at most: that someone added their own key, or asked for a paid plan. Nothing about you or your apps.</Trans>
        </span>
      </span>
      <span className="k-switch" aria-hidden>
        <span className="k-switch-knob" />
      </span>
    </button>
  );
}
