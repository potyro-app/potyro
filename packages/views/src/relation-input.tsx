// A field that points at other records: a recipe's ingredient, a place's type.
//
// One record was a browser `<select>` — the last raw browser control in any form, and one you could
// not search. Several records were a chip for EVERY record of the other kind, which is fine for five
// and unusable for eighty. Both now use the searchable list a long enum uses: one choice picks and
// closes, several toggle and wait for Done, and the chosen ones sit as chips you can take off.
//
// When the search finds nothing, the list offers to create the record with what was typed, in a
// second sheet over the form, and selects it — a relation to an empty table is never a dead end.

import { useRef, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { RelationField } from "potyro";
import { displayFieldFor } from "./format.js";
import { PickList } from "./pick-list.js";
import { RecordForm } from "./record-form.js";

export interface RelationInputProps {
  runtime: PotyroRuntime;
  field: RelationField;
  value: unknown;
  onChange: (v: unknown) => void;
  label?: string;
}

export function RelationInput({ runtime, field, value, onChange, label }: RelationInputProps) {
  const { rows, loading } = runtime.useQuery(field.to);
  const disp = displayFieldFor(runtime, field.to);
  const entityLabel = runtime.definition.entities[field.to]?.label ?? field.to;
  const noun = entityLabel.toLowerCase();
  const title = label ?? entityLabel;
  const [open, setOpen] = useState(false);
  // What the search held when "New …" was chosen, so the new record starts with that name.
  const [creating, setCreating] = useState<{ name: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (loading) return <span className="k-muted">Loading…</span>;

  const nameOf = (id: string): string => {
    const r = rows.find((row) => row.id === id);
    return r ? String(r[disp] ?? r.id) : id;
  };
  const items = rows.map((r) => ({ id: r.id, label: String(r[disp] ?? r.id) }));

  const chosen: string[] = field.many
    ? Array.isArray(value)
      ? (value as unknown[]).map((v) => (typeof v === "string" ? v : String((v as { id?: string })?.id ?? ""))).filter(Boolean)
      : []
    : typeof value === "string" && value
      ? [value]
      : value && typeof value === "object" && (value as { id?: string }).id
        ? [(value as { id: string }).id]
        : [];
  const selected = new Set(chosen);

  const toggle = (id: string): void => {
    if (!field.many) return onChange(id);
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  // A second sheet over the first (#101), not a form folded into this one.
  const inlineForm = creating ? (
    <RecordForm
      nested
      runtime={runtime}
      entity={field.to}
      initial={creating.name ? { [disp]: creating.name } : undefined}
      onCancel={() => setCreating(null)}
      onDone={(id) => {
        setCreating(null);
        // Select what was just created — that is why the person made it.
        if (field.many) onChange([...new Set([...chosen, id])]);
        else onChange(id);
      }}
    />
  ) : null;

  const list = open ? (
    <PickList
      title={title}
      items={items}
      selected={selected}
      multi={field.many}
      anchor={triggerRef}
      onToggle={toggle}
      onClear={!field.many && !field.required ? () => onChange(null) : undefined}
      onCreate={(query) => setCreating({ name: query })}
      createNoun={noun}
      onClose={() => {
        setOpen(false);
        triggerRef.current?.focus();
      }}
    />
  ) : null;

  if (field.many) {
    return (
      <div className="k-relation-input k-relation-many">
        {chosen.map((id) => (
          <span key={id} className="k-selchip">
            {nameOf(id)}
            <button type="button" className="k-selchip-x" aria-label={`Remove ${nameOf(id)}`} onClick={() => toggle(id)}>
              ✕
            </button>
          </span>
        ))}
        <button
          ref={triggerRef}
          type="button"
          className="k-add k-relation-add"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${title}: add`}
          onClick={() => setOpen(true)}
        >
          ＋ Add
        </button>
        {list}
        {inlineForm}
      </div>
    );
  }

  const current = chosen[0];
  return (
    <div className="k-relation-input k-enum">
      <button
        ref={triggerRef}
        type="button"
        className="k-enum-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${title}: ${current ? nameOf(current) : "choose"}`}
        onClick={() => setOpen(true)}
      >
        {current ? <span>{nameOf(current)}</span> : <span className="k-enum-empty">{rows.length ? "Choose…" : `No ${noun} yet — add one`}</span>}
        <span className="k-enum-caret" aria-hidden>
          ▾
        </span>
      </button>
      {list}
      {inlineForm}
    </div>
  );
}
