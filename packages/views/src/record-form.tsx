// RecordForm — a generated create/edit form for any entity, driven by its field definitions.
// Works in RAW value space so its output goes straight to runtime.create()/patch().

import { useEffect, useState } from "react";
import type { Field } from "karta";
import type { KartaRuntime } from "@karta/runtime";
import { FieldInput } from "./field-input.js";
import { fieldLabel } from "./format.js";
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

export function RecordForm({ runtime, entity, recordId, initial, onDone, onCancel, nested }: RecordFormProps) {
  const isEdit = Boolean(recordId);
  const { record, loading } = runtime.useRecord(entity, recordId ?? "");
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
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
  const fields = Object.entries(def?.fields ?? {}).filter(([, f]) => !(f as { hidden?: boolean }).hidden);
  const set = (key: string, v: unknown): void => setForm((prev) => ({ ...(prev ?? {}), [key]: v }));

  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    const missing = fields
      .filter(([key, f]) => (f as { required?: boolean }).required && isEmpty(form[key]))
      .map(([key]) => fieldLabel(runtime, entity, key));
    if (missing.length) {
      setErrors(missing);
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

  // `nested` renders a div instead of a form: a relation field can open a create form for its target
  // entity inline, and a <form> inside a <form> is invalid HTML (the inner submit would bubble).
  const Root = (nested ? "div" : "form") as "div";
  const rootProps = nested ? {} : { onSubmit: submit as unknown as React.FormEventHandler };

  return (
    <Root className={`k-form${nested ? " k-form-nested" : ""}`} {...rootProps}>
      <h3>{isEdit ? `Edit ${def?.label ?? entity}` : `New ${def?.label ?? entity}`}</h3>
      {errors.length > 0 ? <p className="k-form-error">Required: {errors.join(", ")}</p> : null}
      {saveError ? (
        <p className="k-form-error" role="alert">
          Couldn't save: {saveError}
        </p>
      ) : null}
      {fields.map(([key, field]) =>
        field.type === "boolean" ? (
          // A boolean is a switch row (#97): the label and the toggle are one hit target, not a
          // grey caption over a bare checkbox.
          <SwitchRow
            key={key}
            label={fieldLabel(runtime, entity, key)}
            required={(field as { required?: boolean }).required}
            checked={Boolean(form[key])}
            onChange={(v) => set(key, v)}
          />
        ) : (
          <label className="k-form-field" key={key}>
            <span className="k-form-label">
              {fieldLabel(runtime, entity, key)}
              {(field as { required?: boolean }).required ? <em aria-hidden> *</em> : null}
            </span>
            <FieldInput runtime={runtime} field={field} value={form[key]} onChange={(v) => set(key, v)} />
          </label>
        ),
      )}
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
