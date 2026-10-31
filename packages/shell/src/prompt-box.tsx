// The prompt box: Potyro's central component (DESIGN.md §6). A large box with 20px corners inside a
// 2px outline that takes the app's colour in focus, a round 44px send button in its bottom-right
// corner, and three or four short real examples as chips under it. The placeholder is always a
// concrete example, never a label.
//
// On the home screen it is what a new app starts from; the Studio's own box is the same component
// (§10). Enter sends; Shift+Enter is a new line.
import { useLingui } from "@lingui/react/macro";
import { useId, useState, type KeyboardEvent } from "react";
import { I } from "./icons.js";

export interface PromptBoxProps {
  /** What the send button is called, for readers: "Describe an app", "Create the app". */
  sendLabel: string;
  /** Sent with what was typed, trimmed. Empty is allowed: the Studio opens with nothing in it. */
  onSend: (text: string) => void;
  /** Short real prompts to tap, three or four (§6). Each is sent as typed. */
  examples?: string[];
  /** One line: the box grows to three on focus and when there is text (the home screen, after
   *  the first app, where the apps come first). */
  compact?: boolean;
  /** Focus the box when it appears (not on a phone, where the keyboard would cover the apps). */
  autoFocus?: boolean;
  /** What the box starts with: words the person typed before, and kept (kept-idea.ts). */
  initial?: string;
  /** Told what the box holds after each edit (a clear included): the words are this box's now. */
  onEdit?: (text: string) => void;
}

export function PromptBox({ sendLabel, onSend, examples = [], compact = false, autoFocus = false, initial = "", onEdit }: PromptBoxProps) {
  const { t } = useLingui();
  const id = useId();
  const [text, setText] = useState(initial);
  const send = (): void => onSend(text.trim());
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className="k-prompt" data-compact={compact || undefined}>
      <label className="k-prompt-label" htmlFor={id}>
        {t({ message: "Describe your app", comment: "The label over the prompt box" })}
      </label>
      <div className="k-prompt-field" data-filled={text ? true : undefined}>
        <textarea
          id={id}
          className="k-prompt-box"
          rows={compact ? 1 : 3}
          value={text}
          placeholder={
            compact
              ? t({ message: "e.g. a shopping list for the house", comment: "The one-line prompt box's placeholder: a short concrete example" })
              : t({ message: "e.g. a shopping list for the house, split by store", comment: "The prompt box's placeholder: a concrete example, never a label" })
          }
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            onEdit?.(e.target.value);
          }}
          onKeyDown={onKey}
        />
        <button type="button" className="k-prompt-send" aria-label={sendLabel} title={sendLabel} onClick={send}>
          {I.send24}
        </button>
      </div>
      {examples.length ? (
        <ul className="k-prompt-examples">
          {examples.map((ex) => (
            <li key={ex}>
              <button type="button" className="k-chip k-prompt-example" onClick={() => onSend(ex)}>
                {ex}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
