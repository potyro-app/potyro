// The "Feito com Potyro" seal (DESIGN.md §6, §8.1, #424): a `--surface` pill with the logo's symbol
// — its one stroke in the app's colour, the nearest the logo sheet has — and the words in
// `--text-micro`, in the footer of every app that came from someone else, leading to the landing.
// The shell draws it; no prompt can take it off an app it did not make.

import { SYMBOL, SYMBOL_GRAPHITE, SYMBOL_VIEWBOX, sheetColour } from "@potyro/design";
import { Trans } from "@lingui/react/macro";
import { GALLERY_URL } from "./gallery-link.js";

/** The logo's symbol, its stroke in the sheet colour nearest `hue`. 16px in a seal, bigger on a card. */
export function SealMark({ hue, size = 16 }: { hue: number; size?: number }) {
  const { hex } = sheetColour(hue);
  return (
    <svg className="k-seal-mark" viewBox={SYMBOL_VIEWBOX} width={size} height={size} aria-hidden>
      <path d={SYMBOL.body} fill={SYMBOL_GRAPHITE} />
      <path d={SYMBOL.stroke} fill={hex} />
      <circle cx={SYMBOL.head.cx} cy={SYMBOL.head.cy} r={SYMBOL.head.r} fill={SYMBOL_GRAPHITE} />
    </svg>
  );
}

/** The seal itself: the mark and the words, a link to Potyro. */
export function Seal({ hue }: { hue: number }) {
  return (
    <a className="k-seal" href={GALLERY_URL} target="_blank" rel="noopener" data-k-seal>
      <SealMark hue={hue} />
      <span className="k-seal-words">
        <Trans comment="The seal at the foot of an app made with Potyro by someone else; links to potyro.com">Made with Potyro</Trans>
      </span>
    </a>
  );
}
