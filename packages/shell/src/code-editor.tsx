// A syntax-highlighted source editor.
//
// The textarea stays. A `<pre>` painted directly behind it carries the colour while the textarea's
// own text is transparent — so the caret, selection, undo stack, IME, spellcheck and every
// accessibility affordance are the browser's real ones, unchanged from the plain textarea this
// replaced. Replacing the textarea with a contenteditable or a full editor would buy nicer
// highlighting by giving all of that back up.
//
// The two layers only line up while their typography is IDENTICAL, so font, size, line-height,
// padding and `white-space` are set once on `.k-code` and inherited by both (see styles.css). The
// paint has no scrollbar of its own — the textarea scrolls, and drags the paint with it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { highlightLines, type CodeRun } from "./highlight.js";

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Names the textarea, exactly as it would on a bare one. */
  label: string;
  className?: string;
  readOnly?: boolean;
}

/** What to paint before Prism has answered: the same text, uncoloured. */
const plainLines = (code: string): CodeRun[][] => code.split("\n").map((t) => (t ? [{ text: t }] : []));

export function CodeEditor({ value, onChange, label, className, readOnly }: CodeEditorProps) {
  const [lines, setLines] = useState<CodeRun[][] | null>(null);
  const paintRef = useRef<HTMLPreElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let live = true;
    // Keeping the previous paint until the new one arrives: blanking it on every keystroke would
    // strobe. A frame of stale colour is invisible; the textarea owns the layout either way.
    void highlightLines(value).then((next) => {
      if (live) setLines(next);
    });
    return () => {
      live = false;
    };
  }, [value]);

  // After the paint re-renders it is back at the top; re-apply the textarea's scroll before the
  // browser paints, or every keystroke in a scrolled file flashes the wrong region.
  useLayoutEffect(() => {
    const paint = paintRef.current;
    const input = inputRef.current;
    if (paint && input) {
      paint.scrollTop = input.scrollTop;
      paint.scrollLeft = input.scrollLeft;
    }
  }, [lines]);

  const syncScroll = (): void => {
    const paint = paintRef.current;
    const input = inputRef.current;
    if (!paint || !input) return;
    paint.scrollTop = input.scrollTop;
    paint.scrollLeft = input.scrollLeft;
  };

  return (
    <div className={`k-code k-syntax${className ? ` ${className}` : ""}`}>
      {/* Decoration only: the same characters are already readable in the textarea, and a screen
          reader meeting them twice would read the file twice. */}
      <pre className="k-code-paint" ref={paintRef} aria-hidden="true">
        <code>
          {(lines ?? plainLines(value)).map((runs, i, all) => (
            <span key={i} className="k-code-line">
              {runs.map((run, j) =>
                run.cls ? (
                  <span key={j} className={run.cls}>
                    {run.text}
                  </span>
                ) : (
                  run.text
                ),
              )}
              {/* Separator, not terminator: a newline after the LAST line would make the paint one
                  character longer than the textarea, and "these two hold the same text" is the whole
                  guarantee that the colour sits under the right glyphs. */}
              {i < all.length - 1 ? "\n" : null}
            </span>
          ))}
        </code>
      </pre>
      <textarea
        ref={inputRef}
        className="k-code-input"
        aria-label={label}
        value={value}
        spellCheck={false}
        wrap="off"
        readOnly={readOnly}
        onScroll={syncScroll}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
