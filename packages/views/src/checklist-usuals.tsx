// What a checklist's empty add box offers (`quickAdd.usuals`): the app's own guess at what is likely
// next — "Milk", "Eggs" — as chips, one tap each. Asked through the host over the rows the page shows,
// so a sealed app's guess works as a trusted one's does, and only while the box is in use: a list
// you are ticking in a shop needs no suggestions taking up the screen.

import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { Resolved } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { Glyph } from "./glyph.js";

/** At most this many usuals are offered at once. */
const USUALS = 12;

/** The app's usuals while `active`, without the texts already open on the list. */
export function useUsuals(
  runtime: BuiltinViewProps["runtime"],
  pageId: string,
  rows: readonly Resolved[],
  declared: boolean,
  active: boolean,
  isOpen: (text: string) => boolean,
): string[] {
  const [texts, setTexts] = useState<string[]>([]);
  useEffect(() => {
    if (!declared || !active) return;
    let alive = true;
    runtime.core.app
      .callFold(pageId, "quickAdd.usuals", [...rows] as Resolved[], runtime.ctx)
      .then((out) => {
        if (alive) setTexts(Array.isArray(out) ? out.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
      })
      // A guess that failed offers nothing; typing still works, and nothing about it is wrong.
      .catch(() => alive && setTexts([]));
    return () => {
      alive = false;
    };
  }, [runtime, pageId, rows, declared, active]);
  if (!declared || !active) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    const low = text.trim().toLocaleLowerCase();
    if (seen.has(low) || isOpen(text)) continue;
    seen.add(low);
    out.push(text.trim());
    if (out.length >= USUALS) break;
  }
  return out;
}

/** The chips. Pressing one must not blur the box first, or the chips would go before the tap lands. */
export function UsualChips({ texts, onPick }: { texts: string[]; onPick: (text: string) => void }) {
  const { t } = useLingui();
  if (!texts.length) return null;
  return (
    <ul className="k-check-suggest" data-usuals aria-label={t({ message: "Usual items", comment: "Checklist: what the app suggests adding, while the add box is empty" })}>
      {texts.map((text) => (
        <li key={text}>
          <button type="button" className="k-chip k-check-suggestion" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(text)}>
            <Glyph icon="plus" size={16} /> {text}
          </button>
        </li>
      ))}
    </ul>
  );
}
