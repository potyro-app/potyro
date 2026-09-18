// A list field's rows, as cards (#104).
//
// A recipe's ingredients and steps used to be a left rule, a grid of unlabelled boxes, and a bare ✕
// one mis-tap away from deleting a row. Order is the content of a step list, and `ordered: true`
// existed in the schema with no way to act on it.
//
// So: each row is a card. Its first sub-field is the line you read, the rest sit under it. Remove
// lives in the card's own menu. An ordered list gets a grip — drag it with a mouse or a finger, or
// focus it and use the arrow keys — and on a phone a card can be swiped aside to reveal Remove. The
// button that adds one says what it adds.

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { Field, ListField } from "karta";
// A row holds fields and a field may be a list, so these two modules name each other. ESM is fine
// with that here: both sides are hoisted function declarations, used at render, not at module load.
import { FieldInput } from "./field-input.js";
import { humanizeKey } from "./format.js";
import { ActionMenu } from "./menu.js";
import { useReorder } from "./reorder.js";
import { usePhone } from "./media.js";

export interface ListInputProps {
  runtime: KartaRuntime;
  field: ListField;
  value: unknown;
  onChange: (v: unknown) => void;
  label?: string;
}

/** "Ingredients" → "ingredient", "Seasonal Care" → "seasonal care", "Steps" → "step". */
export function singular(label: string): string {
  const word = label.trim().toLowerCase();
  if (!word) return "row";
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/** How far a card must travel before the swipe counts, and how far it opens. */
const SWIPE_OPEN = 88;
const SWIPE_TRIGGER = 40;

export function ListInput({ runtime, field, value, onChange, label }: ListInputProps) {
  const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
  const subEntries = Object.entries(field.of) as [string, Field][];
  const [head, ...restFields] = subEntries;
  const ordered = field.ordered === true;
  const noun = singular(label ?? field.label ?? "row");
  const phone = usePhone();
  // A row has no id of its own, so its position is its identity while it is on screen. That is
  // enough: every change rewrites the whole list at once.
  const keys = rows.map((_, i) => String(i));
  const [focusRow, setFocusRow] = useState<number | null>(null);

  const update = (i: number, key: string, v: unknown): void => onChange(rows.map((r, ri) => (ri === i ? { ...r, [key]: v } : r)));
  const removeRow = (i: number): void => onChange(rows.filter((_, ri) => ri !== i));
  const addRow = (): void => {
    onChange([...rows, {}]);
    setFocusRow(rows.length);
  };
  const rowName = (i: number): string => {
    const first = head ? rows[Number(i)]?.[head[0]] : undefined;
    return first ? String(first) : `${noun} ${Number(i) + 1}`;
  };

  const reorder = useReorder({
    keys,
    names: (k) => rowName(Number(k)),
    onReorder: (next) => onChange(next.map((k) => rows[Number(k)]!)),
    enabled: ordered && rows.length > 1,
    handle: ".k-row-grip",
    ignore: ".k-row-menu-host",
    keyboard: "plain",
  });

  return (
    <div className="k-rows" data-ordered={ordered || undefined}>
      {rows.map((row, i) => (
        <RowCard
          key={i}
          index={i}
          total={rows.length}
          ordered={ordered}
          phone={phone}
          name={rowName(i)}
          noun={noun}
          runtime={runtime}
          row={row}
          head={head}
          rest={restFields}
          autoFocus={focusRow === i}
          onUpdate={(key, v) => update(i, key, v)}
          onRemove={() => removeRow(i)}
          reorderProps={reorder.item(String(i))}
        />
      ))}
      <button type="button" className="k-add k-row-add" onClick={addRow}>
        ＋ Add {noun}
      </button>
      <span className="k-visually-hidden" aria-live="polite">
        {reorder.announcement}
      </span>
    </div>
  );
}

function RowCard({
  index,
  total,
  ordered,
  phone,
  name,
  noun,
  runtime,
  row,
  head,
  rest,
  autoFocus,
  onUpdate,
  onRemove,
  reorderProps,
}: {
  index: number;
  total: number;
  ordered: boolean;
  phone: boolean;
  name: string;
  noun: string;
  runtime: KartaRuntime;
  row: Record<string, unknown>;
  head?: [string, Field];
  rest: [string, Field][];
  autoFocus: boolean;
  onUpdate: (key: string, v: unknown) => void;
  onRemove: () => void;
  reorderProps: ReturnType<ReturnType<typeof useReorder>["item"]>;
}) {
  const swipe = useSwipeAway(phone);
  // A freshly added row puts the caret in its first box, so you can start typing where you tapped.
  //
  // ONCE, and this is the whole reason for the flag: React calls an inline ref callback on every
  // render, and a row re-renders on every keystroke. Without it, typing "0" in an opening hour sent
  // the caret back to the row's first control — the day of the week — and no one could write 09:00.
  const focused = useRef(false);
  const focusFirst = (el: HTMLDivElement | null): void => {
    if (!autoFocus || !el || focused.current) return;
    focused.current = true;
    el.querySelector<HTMLElement>("input, textarea, button, [tabindex]")?.focus();
  };

  const sub = (key: string, field: Field): ReactNode => (
    <label className="k-row-field" key={key}>
      <span className="k-row-field-label">{field.label ?? humanizeKey(key)}</span>
      <FieldInput runtime={runtime} field={field} value={row[key]} onChange={(v) => onUpdate(key, v)} label={field.label ?? humanizeKey(key)} />
    </label>
  );

  return (
    <div className="k-row-swipe" {...swipe.container}>
      {swipe.offset ? (
        <button type="button" className="k-row-swipe-remove" aria-label={`Remove ${name}`} onClick={onRemove}>
          Remove
        </button>
      ) : null}
      <div className="k-row-card" {...reorderProps} style={{ ...reorderProps.style, ...swipe.style }}>
        {ordered ? (
          <button
            type="button"
            className="k-row-grip"
            aria-label={`Reorder ${name}, ${index + 1} of ${total}. Use the arrow keys.`}
            title="Drag to reorder"
          >
            ⠿
          </button>
        ) : (
          <span className="k-row-n" aria-hidden>
            {index + 1}
          </span>
        )}
        <div className="k-row-body" ref={focusFirst}>
          {head ? (
            <FieldInput
              runtime={runtime}
              field={head[1]}
              value={row[head[0]]}
              onChange={(v) => onUpdate(head[0], v)}
              label={head[1].label ?? humanizeKey(head[0])}
            />
          ) : null}
          {rest.length ? <div className="k-row-sub">{rest.map(([key, f]) => sub(key, f))}</div> : null}
        </div>
        <span className="k-row-menu-host">
          <ActionMenu
            label={`${name}: more`}
            buttonClassName="k-row-menu"
            entries={[{ key: "remove", label: `Remove ${noun}`, icon: "🗑", danger: true, onSelect: onRemove }]}
          />
        </span>
      </div>
    </div>
  );
}

/** Swiping a card aside on a phone to reveal Remove. A pointer that starts on a control is typing. */
function useSwipeAway(enabled: boolean) {
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; id: number } | null>(null);

  if (!enabled) return { container: {}, style: undefined, offset: 0 };

  const close = (): void => setOffset(0);
  return {
    offset,
    style: offset ? { transform: `translateX(${-offset}px)`, transition: start.current ? "none" : undefined } : undefined,
    container: {
      onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse") return;
        const target = e.target as HTMLElement;
        // A pointer that lands in a box is typing, and one on the ⋯ is opening the menu. Everything
        // else — the card's own surface, and the grip — can swipe: the reorder only takes the grip
        // after a hold, so a quick sideways flick there is unambiguously a swipe.
        if (target.closest("input, textarea, select, [contenteditable], .k-row-menu-host")) return;
        start.current = { x: e.clientX, id: e.pointerId };
      },
      onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = s.x - e.clientX;
        setOffset(Math.max(0, Math.min(SWIPE_OPEN, dx)));
      },
      onPointerUp: () => {
        start.current = null;
        setOffset((o) => (o >= SWIPE_TRIGGER ? SWIPE_OPEN : 0));
      },
      onPointerCancel: () => {
        start.current = null;
        close();
      },
    },
  };
}
