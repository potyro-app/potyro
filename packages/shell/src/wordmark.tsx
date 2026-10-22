// Potyro's logo, as the designer drew it (packages/design/logo, cut from the original sheet; DESIGN.md
// §4.1: never redrawn, never re-typeset). The wordmark is graphite with the "y"'s one coloured stroke
// in Potyro's rosa; on a dark ground the letters are white. Both are real files, so the browser
// picks by theme in CSS (`.k-wordmark`) and a system theme that flips at dusk needs no script.
import wordmarkOnDark from "@potyro/design/logo/wordmark-rosa-on-dark.svg";
import wordmark from "@potyro/design/logo/wordmark-rosa.svg";
import symbolOnDark from "@potyro/design/logo/symbol-rosa-on-dark.svg";
import symbol from "@potyro/design/logo/symbol-rosa.svg";

/** The wordmark: "Potyro". Its height is the surrounding font's (`1em` tall by default). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`k-wordmark${className ? ` ${className}` : ""}`} role="img" aria-label="Potyro">
      <img className="k-wordmark-light" src={wordmark} alt="" draggable={false} />
      <img className="k-wordmark-dark" src={wordmarkOnDark} alt="" draggable={false} />
    </span>
  );
}

/**
 * The symbol alone: the "y", a person with their arms up and the pen in its negative space. The
 * mascot of DESIGN.md §4.2 — for the edge moments (an empty screen, a success, a long wait), one
 * per screen, never in an error, a payment or a deletion.
 */
export function Symbol({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={`k-wordmark k-symbol${className ? ` ${className}` : ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <img className="k-wordmark-light" src={symbol} alt="" draggable={false} />
      <img className="k-wordmark-dark" src={symbolOnDark} alt="" draggable={false} />
    </span>
  );
}
