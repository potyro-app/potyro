// RecordForm — a generated create/edit form for any entity, driven by its field definitions.
// Works in RAW value space so its output goes straight to runtime.create()/patch().
//
// The fields are arranged by the entity's `groups` (#100) — the same declaration the detail page
// reads — with a field's `help` under its control, its `placeholder` in it, and two `width: "half"`
// neighbours sharing a row on a wide form. A required field left empty is told so under the field,
// gets the focus, and is marked invalid; there is no summary line at the top to walk back from.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Field } from "karta";
import type { KartaRuntime } from "@karta/runtime";
import { FieldInput } from "./field-input.js";
import { fieldLabel } from "./format.js";
import { resolveGroups, type ResolvedGroup } from "./groups.js";
import { SwitchRow } from "./switch.js";

export interface RecordFormProps {
  runtime: KartaRuntime;
  entity: string;
  /** Present → edit that record; absent → create a new one. */
  recordId?: string;
  /** Preset values for a new record (e.g. a quick action's prefill). Ignored when editing. */
  initial?: Record<string, unknown>;
  onDone: (id: string) => void;
  onCancel: () => void;
  /** Render as a div, not a form — for nesting inside another form (see RelationInput). */
  nested?: boolean;
}

type Hints = { required?: boolean; help?: string; width?: "full" | "half" };

function relId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object") return (value as { id?: string }).id ?? null;
  return String(value);
}

/** Convert a resolved value back to raw (relations → ids); recurse into list rows. */
function toRaw(runtime: KartaRuntime, field: Field, val: unknown): unknown {
  if (val == null) return val;
  if (field.type === "relation") {
    return field.many ? (Array.isArray(val) ? val.map(relId).filter(Boolean) : []) : relId(val);
  }
  if (field.type === "list") {
    if (!Array.isArray(val)) return [];
    return val.map((row) => rawRow(runtime, field.of, row as Record<string, unknown>));
  }
  return val;
}

function rawRow(runtime: KartaRuntime, of: Record<string, Field>, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, sub] of Object.entries(of)) out[k] = toRaw(runtime, sub, row?.[k]);
  return out;
}

function defaultFor(runtime: KartaRuntime, field: Field): unknown {
  const d = (field as { default?: unknown }).default;
  if (d !== undefined) return typeof d === "function" ? (d as (ctx: unknown) => unknown)(runtime.ctx) : d;
  // A relation to the scoped entity ("which trip is this for") defaults to the current selection
  // (#134): a new place, event or expense belongs to the trip you are in unless the app says otherwise.
  if (field.type === "relation" && !field.many && field.to === runtime.definition.scope?.entity) {
    const current = runtime.ctx.scope[field.to];
    if (current) return current.id;
  }
  if (field.type === "list" || field.type === "tags") return [];
  if (field.type === "boolean") return false;
  return undefined;
}

function initialFormState(
  runtime: KartaRuntime,
  entity: string,
  resolved: Record<string, unknown> | null,
  preset?: Record<string, unknown>,
): Record<string, unknown> {
  const fields = runtime.definition.entities[entity]?.fields ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (resolved) out[key] = toRaw(runtime, field, resolved[key]);
    else out[key] = preset?.[key] ?? defaultFor(runtime, field);
  }
  return out;
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Default-filled raw values for a NEW record of `entity`, with optional presets applied. Mirrors
 *  what the create form seeds, so a programmatic create (e.g. a quick action) matches a form create
 *  — including field defaults like a `datetime` default of `ctx.now()`. */
export function createDefaults(runtime: KartaRuntime, entity: string, preset?: Record<string, unknown>): Record<string, unknown> {
  return initialFormState(runtime, entity, null, preset);
}

/** The control a field's message and focus belong to: its text-like input first, else its switch,
 *  else its first button (a photo field's "Take photo", a list's "Add row"). */
function controlIn(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  return (
    root.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea") ??
    root.querySelector<HTMLElement>("[role=switch]") ??
    root.querySelector<HTMLElement>("button")
  );
}

/**
 * One field's row: caption (unless the control carries its own, like a switch row), the control,
 * a line of help, and — after a submit that found it wanting — its error. The help and error are
 * announced with the control and the control is marked invalid, whatever kind of control it is:
 * the attributes are stamped on the DOM here rather than threaded through every input variant,
 * because the row, not the input, is what knows about them.
 */
function FormField({
  label,
  hints,
  error,
  focusToken,
  plain,
  children,
}: {
  label: string;
  hints: Hints;
  error?: string;
  /** Changes when this field should take the focus (a submit found it invalid). */
  focusToken: number;
  /** The control names itself (a switch row) or is several controls (a number with its stepper). */
  plain?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const errorId = useId();

  useLayoutEffect(() => {
    const control = controlIn(ref.current);
    if (!control) return;
    if (error) control.setAttribute("aria-invalid", "true");
    else control.removeAttribute("aria-invalid");
    const ids = [hints.help ? helpId : "", error ? errorId : ""].filter(Boolean).join(" ");
    if (ids) control.setAttribute("aria-describedby", ids);
    else control.removeAttribute("aria-describedby");
  });

  useEffect(() => {
    if (!focusToken) return;
    // A folded group is opened first: focus inside a closed <details> goes nowhere.
    const details = ref.current?.closest("details");
    if (details) details.open = true;
    controlIn(ref.current)?.focus();
  }, [focusToken]);

  const caption = plain ? null : (
    <span className="k-form-label">
      {label}
      {hints.required ? <em aria-hidden> *</em> : null}
    </span>
  );

  return (
    <div className="k-form-field" ref={ref} data-width={hints.width ?? "full"} data-invalid={error ? "true" : undefined}>
      {plain ? (
        children
      ) : (
        // A label around a single control names it by its caption. Controls that are several
        // controls (a number with its stepper) or name themselves are rendered `plain` instead:
        // a <label> around them would name only the first and press it when the caption is tapped.
        <label className="k-form-control">
          {caption}
          {children}
        </label>
      )}
      {hints.help ? (
        <p className="k-form-help" id={helpId}>
          {hints.help}
        </p>
      ) : null}
      {error ? (
        <p className="k-form-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RecordForm({ runtime, entity, recordId, initial, onDone, onCancel, nested }: RecordFormProps) {
  const isEdit = Boolean(recordId);
  const { record, loading } = runtime.useRecord(entity, recordId ?? "");
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (form) return;
    if (isEdit) {
      if (!loading && record) setForm(initialFormState(runtime, entity, record));
    } else {
      setForm(initialFormState(runtime, entity, null, initial));
    }
  }, [form, isEdit, loading, record, runtime, entity, initial]);

  if (!form) return <p className="k-loading">Loading…</p>;

  const def = runtime.definition.entities[entity];
  const fields = def?.fields ?? {};
  const groups = resolveGroups(def, "form");
  const set = (key: string, v: unknown): void => {
    setForm((prev) => ({ ...(prev ?? {}), [key]: v }));
    // Typing into a field answers its complaint; it is checked again on the next submit.
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    const missing: Record<string, string> = {};
    for (const group of groups) {
      for (const key of group.fields) {
        if ((fields[key] as Hints | undefined)?.required && isEmpty(form[key])) missing[key] = "Required";
      }
    }
    const firstMissing = Object.keys(missing)[0];
    if (firstMissing) {
      setErrors(missing);
      setFocus((prev) => ({ key: firstMissing, n: (prev?.n ?? 0) + 1 }));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (isEdit && recordId) {
        await runtime.patch(entity, recordId, form);
        onDone(recordId);
      } else {
        const created = await runtime.create(entity, form);
        onDone(created.id);
      }
    } catch (err) {
      // A save that fails — an app's computed throwing on the new record, a store refusing — used
      // to leave the form open and silent, as if the button had not worked. Say so.
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const renderField = (key: string): ReactNode => {
    const field = fields[key]!;
    const hints = field as Hints;
    const label = fieldLabel(runtime, entity, key);
    const common = { label, hints, error: errors[key], focusToken: focus?.key === key ? focus.n : 0 };
    if (field.type === "boolean") {
      // A boolean is a switch row (#97): the label and the toggle are one hit target, not a grey
      // caption over a bare checkbox. The row carries its own help line.
      return (
        <FormField key={key} {...common} hints={{ ...hints, help: undefined }} plain>
          <SwitchRow label={label} help={hints.help} required={hints.required} checked={Boolean(form[key])} onChange={(v) => set(key, v)} />
        </FormField>
      );
    }
    if (field.type === "number" || field.type === "duration") {
      // Several controls — the input and its stepper — so no <label> around them (#99).
      return (
        <FormField key={key} {...common} plain>
          <span className="k-form-label" aria-hidden>
            {label}
            {hints.required ? <em aria-hidden> *</em> : null}
          </span>
          <FieldInput runtime={runtime} field={field} value={form[key]} onChange={(v) => set(key, v)} label={label} />
        </FormField>
      );
    }
    return (
      <FormField key={key} {...common}>
        <FieldInput runtime={runtime} field={field} value={form[key]} onChange={(v) => set(key, v)} />
      </FormField>
    );
  };

  const renderGroup = (group: ResolvedGroup, index: number): ReactNode => {
    const body = <div className="k-form-fields">{group.fields.map(renderField)}</div>;
    if (group.collapsed) {
      return (
        <details key={index} className="k-form-group">
          <summary className="k-form-group-title">{group.title}</summary>
          {body}
        </details>
      );
    }
    if (!group.title) return <div key={index} className="k-form-group">{body}</div>;
    return (
      <section key={index} className="k-form-group" aria-label={group.title}>
        <h4 className="k-form-group-title">{group.title}</h4>
        {body}
      </section>
    );
  };

  // `nested` renders a div instead of a form: a relation field can open a create form for its target
  // entity inline, and a <form> inside a <form> is invalid HTML (the inner submit would bubble).
  const Root = (nested ? "div" : "form") as "div";
  const rootProps = nested ? {} : { onSubmit: submit as unknown as React.FormEventHandler, noValidate: true };

  return (
    <Root className={`k-form${nested ? " k-form-nested" : ""}`} {...rootProps}>
      <h3>{isEdit ? `Edit ${def?.label ?? entity}` : `New ${def?.label ?? entity}`}</h3>
      {saveError ? (
        <p className="k-form-error" role="alert">
          Couldn't save: {saveError}
        </p>
      ) : null}
      {groups.map(renderGroup)}
      <div className="k-form-actions">
        <button type="button" className="k-add" onClick={onCancel}>
          Cancel
        </button>
        <button
          type={nested ? "button" : "submit"}
          className="k-add k-primary-action"
          disabled={saving}
          onClick={nested ? () => void submit() : undefined}
        >
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create"}
        </button>
      </div>
    </Root>
  );
}
