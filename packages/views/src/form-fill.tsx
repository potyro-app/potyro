// A form's fill buttons (#81): "Scan label" at the head of the form, above its first field.
//
// An entity declares them (`fill: [{ label, run }]`); `run` is the app's own function and returns
// values, checked by the host before they get here (`runtime.fillForm`). What this does with them is
// the form's side of the bargain, the same for adding and for editing:
//
//   - an empty field is filled
//   - a field holding something nobody typed — a new record's default, what an earlier fill put
//     there — takes the new value
//   - a field the person filled, where the new value is DIFFERENT, is never replaced silently: a
//     review lists each one, theirs beside the new one, and they choose — field by field, or all at
//     once. A new value equal to theirs is not mentioned at all
//   - a value its field does not take was left out by the host, and is named in a line under the
//     button; the app's code failing is said there too, not in a toast that has gone by the time
//     the person looks back up
//
// The review lives in the form's sheet, not in a dialog of its own: the dialog host shows one dialog,
// and the form is already it. While a fill runs the form stays usable; it just is not saved.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
import type { PotyroRuntime } from "@potyro/runtime";
import type { ShownField as Field } from "./shown.js";
import { FieldValue } from "./field-value.js";
import { displayFieldFor, fieldLabel } from "./format.js";
import { isEmpty, toRaw, valueKey } from "./form-values.js";
import { Glyph } from "./glyph.js";

export interface FormFillProps {
  runtime: PotyroRuntime;
  entity: string;
  /** Present when the form edits a record: the draft carries its id. */
  recordId?: string;
  /** The form's values as they are now (raw). */
  values: Record<string, unknown>;
  /** The fields the form shows, in its order: only these are ever put to the person in a review. */
  shown: readonly string[];
  /** Whether `value` is something nobody typed: the field's default, or what a fill put there. */
  unwritten: (key: string, value: unknown) => boolean;
  /** Put these values in the form. */
  onFill: (values: Record<string, unknown>) => void;
  /** A fill started or ended: the form is not saved meanwhile. */
  onBusy: (busy: boolean) => void;
}

type Choice = "mine" | "new";

interface ReviewItem {
  key: string;
  current: unknown;
  next: unknown;
}

interface Note {
  /** Which button this is about. */
  index: number;
  /** The app's code failed: the sentence for the person. */
  error?: string;
  /** Labels of the fields that were filled. */
  filled: string[];
  /** One sentence per value a field refused. */
  skipped: string[];
  /** It ran and there was nothing to put anywhere. */
  nothing?: boolean;
}

/** A raw value as the detail page would show it: a relation's ids become its records' names. */
function ReviewValue({ runtime, entity, fieldKey, field, value }: { runtime: PotyroRuntime; entity: string; fieldKey: string; field: Field; value: unknown }): ReactNode {
  if (field.type === "relation") return <RelationNames runtime={runtime} to={field.to} value={value} />;
  if (field.type === "member") {
    const ids = (Array.isArray(value) ? value : [value]).map((v) => (v && typeof v === "object" ? (v as { id?: string }).id : v));
    const people = runtime.ctx.people;
    return <>{fmt.list(ids.map((id) => people.find((p) => p.id === id)?.name ?? String(id)))}</>;
  }
  return <FieldValue runtime={runtime} entity={entity} fieldKey={fieldKey} value={value} />;
}

function RelationNames({ runtime, to, value }: { runtime: PotyroRuntime; to: string; value: unknown }): ReactNode {
  const { rows } = runtime.useQuery(to);
  const display = displayFieldFor(runtime, to);
  const ids = (Array.isArray(value) ? value : [value]).map(String);
  return <>{fmt.list(ids.map((id) => String(rows.find((r) => r.id === id)?.[display] ?? id)))}</>;
}

export function FormFill({ runtime, entity, recordId, values, shown, unwritten, onFill, onBusy }: FormFillProps): ReactNode {
  const { t } = useLingui();
  const [running, setRunning] = useState<number | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [review, setReview] = useState<{ index: number; items: ReviewItem[] } | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const reviewTitle = useId();
  const radios = useId();
  const reviewRef = useRef<HTMLElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  // The values at the moment a fill ANSWERS, not when it was pressed: the form stays usable meanwhile.
  const latest = useRef(values);
  latest.current = values;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // A review that has just appeared takes the focus, so it is read out and scrolled to.
  useEffect(() => {
    if (!review) return;
    reviewRef.current?.focus();
    reviewRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [review]);

  const def = runtime.definition.entities[entity];
  const fills = def?.fill ?? [];
  if (!def || fills.length === 0) return null;
  const fields = def.fields;
  const label = (key: string): string => fieldLabel(runtime, entity, key);

  const run = async (index: number): Promise<void> => {
    if (running !== null) return;
    setRunning(index);
    onBusy(true);
    setNote(null);
    setReview(null);
    let result: Awaited<ReturnType<PotyroRuntime["fillForm"]>>;
    try {
      result = await runtime.fillForm(entity, index, { ...latest.current, ...(recordId ? { id: recordId } : {}) });
    } catch (e) {
      // `fillForm` does not reject; a runtime that does must still leave the form usable.
      result = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    if (!live.current) return;
    setRunning(null);
    onBusy(false);
    if (!result.ok) {
      setNote({ index, error: result.message, filled: [], skipped: [] });
      return;
    }
    const now = latest.current;
    const direct: Record<string, unknown> = {};
    const items: ReviewItem[] = [];
    for (const [key, given] of Object.entries(result.values)) {
      const field = fields[key];
      if (!field) continue;
      const next = toRaw(field, given);
      // A fill adds and replaces; it never empties a field.
      if (isEmpty(next)) continue;
      const current = now[key];
      if (valueKey(field, current) === valueKey(field, next)) continue;
      if (isEmpty(current) || !shown.includes(key) || unwritten(key, current)) direct[key] = next;
      else items.push({ key, current, next });
    }
    // In the form's order, whatever order the app answered in.
    items.sort((a, b) => shown.indexOf(a.key) - shown.indexOf(b.key));
    if (Object.keys(direct).length) onFill(direct);
    const filled = shown.filter((key) => key in direct).map(label);
    const skipped = result.skipped.map((s) => s.why);
    setNote({ index, filled, skipped, nothing: !result.declined && !filled.length && !items.length && !skipped.length });
    if (items.length) {
      setChoices(Object.fromEntries(items.map((i) => [i.key, "mine" as Choice])));
      setReview({ index, items });
    }
  };

  /** The review is answered: put the chosen values in, and hand the focus back to the button. */
  const settle = (take: (item: ReviewItem) => boolean): void => {
    if (!review) return;
    const taken = review.items.filter(take);
    if (taken.length) onFill(Object.fromEntries(taken.map((i) => [i.key, i.next])));
    setNote((prev) => (prev ? { ...prev, nothing: false, filled: [...prev.filled, ...taken.map((i) => label(i.key))] } : prev));
    const back = buttons.current[review.index];
    setReview(null);
    back?.focus();
  };

  const filledList = note?.filled.length ? fmt.list(note.filled) : "";
  const chosen = review ? review.items.filter((i) => choices[i.key] === "new").length : 0;

  return (
    <div className="k-form-fill" data-k-form-fill>
      <div className="k-form-fill-buttons">
        {fills.map((fill, index) => {
          const busy = running === index;
          return (
            <div className="k-form-fill-item" key={index}>
              <button
                type="button"
                className="k-form-fill-button"
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                // Not `disabled`: a disabled button drops the focus, and the answer is announced from here.
                aria-disabled={running !== null}
                aria-busy={busy}
                data-busy={busy ? "true" : undefined}
                onClick={() => void run(index)}
              >
                <Glyph icon={fill.icon ?? "sparkles"} size={20} />
                <span className="k-form-fill-label">{fill.label}</span>
                {busy ? (
                  <span className="k-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                ) : null}
              </button>
              {fill.description ? <p className="k-form-fill-about">{fill.description}</p> : null}
            </div>
          );
        })}
      </div>
      {/* Always in the page, so what lands in it is announced. */}
      <div className="k-form-fill-status" role="status">
        {running !== null ? (
          <p className="k-form-fill-note">
            <Trans comment="Under a button in a form that fills it in (e.g. “Scan label”), while it works">Working on it…</Trans>
          </p>
        ) : null}
        {filledList ? (
          <p className="k-form-fill-note" data-kind="filled">
            {t({ message: `Filled in: ${filledList}`, comment: "Under a button in a form that filled some of its fields; {filledList} is the fields' names, already joined: “Name, Year and Grape”" })}
          </p>
        ) : null}
        {note?.nothing ? (
          <p className="k-form-fill-note">
            <Trans comment="Under a button in a form that fills it in: it ran and had nothing to add or change">Nothing new to fill in.</Trans>
          </p>
        ) : null}
        {note?.skipped.map((why, i) => (
          <p className="k-form-fill-note" data-kind="skipped" key={i}>
            {why}
          </p>
        ))}
      </div>
      {note?.error ? (
        <p className="k-form-fill-note" data-kind="error" role="alert">
          {note.error}
        </p>
      ) : null}
      {review ? (
        <section className="k-form-review" role="group" aria-labelledby={reviewTitle} tabIndex={-1} ref={reviewRef}>
          <h4 className="k-form-review-title" id={reviewTitle}>
            <Trans comment="Heading of a short review inside a form: a button read new values for fields the person had already filled in">Replace what you entered?</Trans>
          </h4>
          <div className="k-form-review-items">
            {review.items.map((item) => {
              const field = fields[item.key]!;
              const side = (choice: Choice, caption: string, value: unknown): ReactNode => (
                <label className="k-form-review-choice" data-chosen={choices[item.key] === choice ? "true" : undefined}>
                  <input type="radio" name={`${radios}-${item.key}`} checked={choices[item.key] === choice} onChange={() => setChoices((prev) => ({ ...prev, [item.key]: choice }))} />
                  <span className="k-form-review-caption">{caption}</span>
                  <span className="k-form-review-value">
                    <ReviewValue runtime={runtime} entity={entity} fieldKey={item.key} field={field} value={value} />
                  </span>
                </label>
              );
              return (
                <fieldset className="k-form-review-item" key={item.key}>
                  <legend>{label(item.key)}</legend>
                  {side("mine", t({ message: "Yours", comment: "In a form's review, above the value the person entered themselves (beside “New”)" }), item.current)}
                  {side("new", t({ message: "New", comment: "In a form's review, above the value a button just read (beside “Yours”)" }), item.next)}
                </fieldset>
              );
            })}
          </div>
          <div className="k-form-review-actions">
            <button type="button" className="k-add" onClick={() => settle(() => false)}>
              <Trans comment="Button in a form's review: keep every value the person entered, take none of the new ones">Keep mine</Trans>
            </button>
            <button type="button" className="k-add" onClick={() => settle(() => true)}>
              <Trans comment="Button in a form's review: replace every listed value with the new one">Use all new</Trans>
            </button>
            <button type="button" className="k-add k-primary-action" disabled={chosen === 0} onClick={() => settle((i) => choices[i.key] === "new")}>
              <Trans comment="Button in a form's review: replace only the values where the person picked “New”">Use selected</Trans>
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
