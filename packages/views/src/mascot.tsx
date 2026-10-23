// The mascot (DESIGN.md §4.2): the "y" of the logo — a person with their arms up, the pen in the
// negative space — for the edge moments only: an empty page, a success, a long wait, a 404. One per
// screen; never in an error, a payment or a deletion. The shapes are the designer's (packages/design/
// logo/symbol-rosa.svg), untouched; only the one coloured stroke takes the app's hour, as §4.1 allows
// for an app's context (the ink follows the theme, as the on-dark file does).
//
// Three ways it appears (#426):
//   still     — beside the words of an empty page or a 404.
//   enter     — a success: it comes in with `--ease-boing` (a fade under reduced motion).
//   drawing   — a long wait: the coloured stroke draws itself, over and over (`stroke-dashoffset`);
//               under reduced motion the stroke is simply there and a bar moves instead.

import type { ReactNode } from "react";

export type MascotMode = "still" | "enter" | "drawing";

export interface MascotProps {
  className?: string;
  /** How it appears; `still` by default. */
  mode?: MascotMode;
  /** The box, in px; 48 by default (§6 "Tela vazia"). */
  size?: number;
}

const BODY = "M407.62,288.12c-.2-.23-.39-.46-.61-.68-3.29-3.38-7.17-5.49-7.37-10.57-.16-4.23-7.1-4.25-6.94,0,.18,4.78,2.05,8.41,5.57,11.76,2.48,2.35,4.57,4.27,5.88,6.72.7-2.66,1.85-5.05,3.46-7.22h0Z";
const STROKE = "M418.58,276.87c-.19,5.09-4.07,7.18-7.37,10.57-3.81,3.92-5.41,8.47-5.57,13.78-.13,4.24,6.81,4.24,6.94,0,.18-6.01,3.23-8.67,7.37-12.6,3.51-3.33,5.39-6.99,5.57-11.76.16-4.24-6.78-4.23-6.94,0h0Z";

export function Mascot({ className, mode = "still", size }: MascotProps) {
  const style = size ? { width: size, height: Math.round((size * 30.716) / 32.825) } : undefined;
  return (
    <svg
      className={`k-mascot${mode !== "still" ? ` k-mascot-${mode}` : ""}${className ? ` ${className}` : ""}`}
      viewBox="392.697 273.684 32.825 30.716"
      style={style}
      aria-hidden="true"
      focusable="false"
      data-mascot={mode}
    >
      <path className="k-mascot-ink" d={BODY} />
      <path className="k-mascot-stroke" d={STROKE} />
      <circle className="k-mascot-ink" cx="409.16" cy="278.4" r="4.71" />
    </svg>
  );
}

/**
 * A long wait, said the system's way (§4.2, REDACAO §Carregando): the mascot drawing its stroke
 * beside what is happening — and, for whoever asked for less motion, a bar that moves instead.
 */
export function Waiting({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={`k-waiting${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <Mascot mode="drawing" size={28} />
      <span className="k-waiting-bar" aria-hidden />
      <span className="k-waiting-words">{children}</span>
    </span>
  );
}
