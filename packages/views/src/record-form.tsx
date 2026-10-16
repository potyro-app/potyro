// RecordForm — a generated create/edit form for any entity, driven by its field definitions.
// Works in RAW value space so its output goes straight to runtime.create()/patch().
//
// The fields are arranged by the entity's `groups` (#100) — the same declaration the detail page
// reads — with a field's `help` under its control, its `placeholder` in it, and two `width: "half"`
// neighbours sharing a row on a wide form. A required field left empty is told so under the field,
// gets the focus, and is marked invalid; there is no summary line at the top to walk back from.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ShownField as Field } from "./shown.js";
import { FN_SENTINEL, type PotyroRuntime } from "@potyro/runtime";
import { Trans, useLingui } from "@lingui/react/macro";
import { FieldInput } from "./field-input.js";
import { fieldLabel, humanizeKey } from "./format.js";
import { FormSheet } from "./form-sheet.js";
import { resolveGroups, type ResolvedGroup } from "./groups.js";
import { SwitchRow } from "./switch.js";
import { byPeople } from "./edit-lock.js";

export interface RecordFormProps {
  runtime: PotyroRuntime;
  entity: string;
  /** Present → edit that record; absent → create a new one. */
  recordId?: string;
  /** Preset values for a new record (e.g. a quick action's prefill). Ignored when editing. */
  initial?: Record<string, unknown>;
  onDone: (id: string) => void;
  onCancel: () => void;
  /** A form opened from inside another (a relation creating its target): a second sheet stacked
   *  on the first, and a div rather than a <form>, so its submit never reaches the outer form. */
  nested?: boolean;
}

type Hints = { required?: boolean; help?: string; width?: "full" | "half" };

function relId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object") return (value as { id?: string }).id ?? null;
  return String(value);
}

/** Convert a resolved value back to raw (relations → ids); recurse into list rows. */
function toRaw(runtime: PotyroRuntime, field: Field, val: unknown): unknown {
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

function rawRow(runtime: PotyroRuntime, of: Record<string, Field>, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, sub] of Object.entries(of)) out[k] = toRaw(runtime, sub, row?.[k]);
  return out;
}

/**
 * A field's starting value. A function default (KA-25, `(ctx) => ctx.now()`) is evaluated by the
 * host where the function lives: for an untrusted app the definition out here holds only the
 * sentinel string, and a form that used it pre-filled "__potyro_fn__".
 */
async function defaultFor(runtime: PotyroRuntime, entity: string, key: string, field: Field): Promise<unknown> {
  const d = (field as { default?: unknown }).default;
  if (typeof d === "function" || d === FN_SENTINEL) {
    try {
      const v = await runtime.core.app.callFieldDefault(entity, key, runtime.ctx);
      return v ?? undefined;
    } catch (e) {
      // A default is app code; one that throws starts the field empty rather than blocking the form.
      console.warn(`[potyro] default for ${entity}.${key} failed:`, e);
      return undefined;
    }
  }
  if (d !== undefined) return d;
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

async function initialFormState(
  runtime: PotyroRuntime,
  entity: string,
  resolved: Record<string, unknown> | null,
  preset?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = runtime.definition.entities[entity]?.fields ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (resolved) out[key] = toRaw(runtime, field, resolved[key]);
    else out[key] = preset?.[key] ?? (await defaultFor(runtime, entity, key, field));
  }
  return out;
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Default-filled raw values for a NEW record of `entity`, with optional presets applied. Mirrors
 *  what the create form seeds, so a programmatic create (e.g. a quick action) matches a form create
 *  — including field defaults like a `datetime` default of `ctx.now()`. */
export function createDefaults(runtime: PotyroRuntime, entity: string, preset?: Record<string, unknown>): Promise<Record<string, unknown>> {
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
  tag,
  children,
}: {
  label: string;
  hints: Hints;
  error?: string;
  /** Changes when this field should take the focus (a submit found it invalid). */
  focusToken: number;
  /** The control names itself (a switch row) or is several controls (a number with its stepper). */
  plain?: boolean;
  /** `entity.key` when this row is a record field — how edit mode finds the label it can rename. */
  tag?: string;
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
    <div className="k-form-field" ref={ref} data-k-field={tag} data-width={hints.width ?? "full"} data-invalid={error ? "true" : undefined}>
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

/** A field's row with the control its type asks for — shared by the record form and `ctx.ui.form` (#112). */
function FieldRow({
  runtime,
  field,
  label,
  value,
  onChange,
  error,
  focusToken,
  tag,
}: {
  runtime: PotyroRuntime;
  field: Field;
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  focusToken: number;
  tag?: string;
}) {
  const hints = field as Hints;
  const common = { label, hints, error, focusToken, tag };
  if (field.type === "boolean") {
    // A boolean is a switch row (#97): the label and the toggle are one hit target, not a grey
    // caption over a bare checkbox. The row carries its own help line.
    return (
      <FormField {...common} hints={{ ...hints, help: undefined }} plain>
        <SwitchRow label={label} help={hints.help} required={hints.required} checked={Boolean(value)} onChange={(v) => onChange(v)} />
      </FormField>
    );
  }
  if (
    field.type === "number" ||
    field.type === "duration" ||
    field.type === "datetime" ||
    field.type === "enum" ||
    field.type === "media" ||
    field.type === "file" ||
    field.type === "list" ||
    field.type === "relation"
  ) {
    // Several controls — an input and its stepper, a date and its chips, a row of options, a
    // strip of tiles, a stack of row cards — so no <label> around them (#99, #103, #98, #102,
    // #104): the control names itself from the label it is given, and a list needs it to say
    // what it adds.
    return (
      <FormField {...common} plain>
        <span className="k-form-label" aria-hidden>
          {label}
          {hints.required ? <em aria-hidden> *</em> : null}
        </span>
        <FieldInput runtime={runtime} field={field} value={value} onChange={onChange} label={label} />
      </FormField>
    );
  }
  return (
    <FormField {...common}>
      <FieldInput runtime={runtime} field={field} value={value} onChange={onChange} />
    </FormField>
  );
}

export function RecordForm({ runtime, entity, recordId, initial, onDone, onCancel, nested }: RecordFormProps) {
  const { t } = useLingui();
  const isEdit = Boolean(recordId);
  const { record, loading } = runtime.useRecord(entity, recordId ?? "");
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // What the form opened with, so "has it been edited" is a comparison, not a flag to maintain.
  const opened = useRef<string>("");

  useEffect(() => {
    if (form) return;
    if (isEdit && (loading || !record)) return;
    let live = true;
    void initialFormState(runtime, entity, isEdit ? record : null, initial).then((next) => {
      if (!live) return;
      opened.current = JSON.stringify(next);
      setForm(next);
    });
    return () => {
      live = false;
    };
  }, [form, isEdit, loading, record, runtime, entity, initial]);

  const def = runtime.definition.entities[entity];
  // "Add: Recipe", not "New recipe": the shell cannot know the gender of an app's noun, and "new"
  // agrees with it in pl/de/es/it/pt (docs/20 Q3).
  const noun = def?.label ?? entity;
  const title = isEdit
    ? t({ message: `Edit: ${noun}`, comment: "Form title for changing a record; {noun} is the app's own name for the kind of record" })
    : t({ message: `Add: ${noun}`, comment: "Form title for a new record; {noun} is the app's own name for the kind of record. Keep the form that needs no gender agreement" });
  const dirty = form !== null && JSON.stringify(form) !== opened.current;

  // Closing a form with edits in it asks once — Escape, the scrim, a swipe, Close and Cancel alike.
  const requestClose = async (): Promise<void> => {
    if (dirty && !(await runtime.ctx.ui.confirm(t`Discard your changes?`))) return;
    onCancel();
  };

  if (!form) {
    return (
      <FormSheet title={title} onClose={onCancel} stacked={nested} ready={false}>
        <p className="k-loading">
          <Trans>Loading…</Trans>
        </p>
      </FormSheet>
    );
  }

  const fields = def?.fields ?? {};
  const groups = resolveGroups(def, "form");
  const set = (key: string, v: unknown): void => {
    setForm((prev) => ({ ...(prev ?? {}), [key]: v }));
    // Typing into a field answers its complaint; it is checked again on the next submit.
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    // Records only the app writes (`editableBy: "app"`) are never saved from a form; nothing offers
    // one for them, and this holds even if something did.
    if (!byPeople(runtime, entity)) return onCancel();
    const missing: Record<string, string> = {};
    for (const group of groups) {
      for (const key of group.fields) {
        if ((fields[key] as Hints | undefined)?.required && isEmpty(form[key]))
          missing[key] = t({ message: "Required", comment: "Under a form field that was left empty but must be filled" });
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

  const renderField = (key: string): ReactNode => (
    <FieldRow
      key={key}
      runtime={runtime}
      field={fields[key]!}
      label={fieldLabel(runtime, entity, key)}
      tag={`${entity}.${key}`}
      value={form[key]}
      onChange={(v) => set(key, v)}
      error={errors[key]}
      focusToken={focus?.key === key ? focus.n : 0}
    />
  );

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

  // `nested` renders a div instead of a form: the sheet is a portal, so the DOM is not a <form> in a
  // <form>, but React would still bubble the inner submit to the outer form's handler.
  const Root = (nested ? "div" : "form") as "div";
  const rootProps = nested ? {} : { onSubmit: submit as unknown as React.FormEventHandler, noValidate: true };

  return (
    <FormSheet title={title} onClose={() => void requestClose()} stacked={nested} className={nested ? "k-inline-create" : undefined}>
      <Root className={`k-form${nested ? " k-form-nested" : ""}`} {...rootProps}>
        <header className="k-form-head">
          <h3>{title}</h3>
          <button type="button" className="k-form-close" aria-label={t`Close`} onClick={() => void requestClose()}>
            ✕
          </button>
        </header>
        <div className="k-form-body">
          {saveError ? (
            <p className="k-form-error" role="alert">
              <Trans>Couldn't save: {saveError}</Trans>
            </p>
          ) : null}
          {groups.map(renderGroup)}
        </div>
        <footer className="k-form-actions">
          <button type="button" className="k-add" onClick={() => void requestClose()}>
            <Trans>Cancel</Trans>
          </button>
          <button
            type={nested ? "button" : "submit"}
            className="k-add k-primary-action"
            disabled={saving}
            onClick={nested ? () => void submit() : undefined}
          >
            {saving ? t`Saving…` : isEdit ? t`Save changes` : t({ message: "Create", comment: "Form button that saves a new record" })}
          </button>
        </footer>
      </Root>
    </FormSheet>
  );
}

export interface ValuesFormProps {
  runtime: PotyroRuntime;
  title: string;
  fields: Record<string, Field>;
  initial?: Record<string, unknown>;
  /** The submit button's words. Default: "OK". */
  submit?: string;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
}

/**
 * `ctx.ui.form` (#112): several values asked at once, in the record form's sheet with the record
 * form's controls, but belonging to no record. Required fields are checked the same way; the answer
 * is the raw values (a relation's id, a number as a number).
 */
export function ValuesForm({ runtime, title, fields, initial, submit, onSubmit, onCancel }: ValuesFormProps) {
  const { t } = useLingui();
  // A ui.form's fields are plain data from the action, never functions: their defaults are values.
  const [form, setForm] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(fields)) {
      const d = (field as { default?: unknown }).default;
      out[key] = initial?.[key] ?? (d !== undefined && typeof d !== "function" && d !== FN_SENTINEL ? d : field.type === "boolean" ? false : field.type === "list" || field.type === "tags" ? [] : undefined);
    }
    return out;
  });
  const opened = useRef(JSON.stringify(form));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
  const dirty = JSON.stringify(form) !== opened.current;

  const requestClose = async (): Promise<void> => {
    if (dirty && !(await runtime.ctx.ui.confirm(t`Discard what you entered?`, { ok: t`Discard`, destructive: true }))) return;
    onCancel();
  };
  const set = (key: string, v: unknown): void => {
    setForm((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };
  const keys = Object.keys(fields).filter((k) => !(fields[k] as { hidden?: boolean }).hidden);
  const send = (e?: React.FormEvent): void => {
    e?.preventDefault();
    const missing: Record<string, string> = {};
    for (const key of keys) if ((fields[key] as Hints).required && isEmpty(form[key]))
        missing[key] = t({ message: "Required", comment: "Under a form field that was left empty but must be filled" });
    const first = Object.keys(missing)[0];
    if (first) {
      setErrors(missing);
      setFocus((prev) => ({ key: first, n: (prev?.n ?? 0) + 1 }));
      return;
    }
    onSubmit(form);
  };

  return (
    <FormSheet title={title} onClose={() => void requestClose()} className="k-values-form">
      <form className="k-form" onSubmit={send} noValidate>
        <header className="k-form-head">
          <h3>{title}</h3>
          <button type="button" className="k-form-close" aria-label={t`Close`} onClick={() => void requestClose()}>
            ✕
          </button>
        </header>
        <div className="k-form-body">
          <div className="k-form-group">
            <div className="k-form-fields">
              {keys.map((key) => (
                <FieldRow
                  key={key}
                  runtime={runtime}
                  field={fields[key]!}
                  label={(fields[key] as { label?: string }).label ?? humanizeKey(key)}
                  value={form[key]}
                  onChange={(v) => set(key, v)}
                  error={errors[key]}
                  focusToken={focus?.key === key ? focus.n : 0}
                />
              ))}
            </div>
          </div>
        </div>
        <footer className="k-form-actions">
          <button type="button" className="k-add" onClick={() => void requestClose()}>
            <Trans>Cancel</Trans>
          </button>
          <button type="submit" className="k-add k-primary-action">
            {submit ?? t`OK`}
          </button>
        </footer>
      </form>
    </FormSheet>
  );
}
