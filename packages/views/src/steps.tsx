// The `steps` built-in: walk an ordered list field, ticking items as you go.
//
// This was declared in the schema, in the type union and in the docs from the start, but rendered a
// "arrives in a later milestone" placeholder — the one place the definition model still promised
// something it did not do. The reference implementation existed all along as `examples/views/
// CookAlong.tsx`, a custom view written because the built-in wasn't there.
//
// Two things it does that the custom view didn't, because a built-in has to survive normal use:
// progress is PERSISTED (walk away mid-recipe and come back to it), and `onFinish` fires once when
// the last step is ticked rather than behind a button you might not press.

import { fmt } from "@potyro/i18n";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { Resolved } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { getView } from "./format.js";

interface StepsViewDef {
  entity: string;
  param?: string;
  list: string;
  text?: string | ((step: Resolved) => unknown);
  onFinish?: string;
}

/**
 * Where a walk-through has got to, per record.
 *
 * In `ctx.storage` — the app's own key/value space — for the same reason the map's camera is: it is
 * per-app state that must survive a reload, and going through `ctx` keeps it working identically for
 * an untrusted app in the isolate. Indices rather than item ids because a list's items have none.
 */
const progressKey = (pageId: string, recordId: string): string => `steps:${pageId}:${recordId}`;

function toIndices(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isInteger(n)) : [];
}

/** One step's text: a sub-field key, a function, or the item's own `text`/`name`. */
function stepText(step: Resolved, binding: StepsViewDef["text"]): string {
  if (typeof binding === "function") return String(binding(step) ?? "");
  if (typeof binding === "string") return String(step[binding] ?? "");
  return String(step.text ?? step.name ?? "");
}

export function StepsView(props: BuiltinViewProps) {
  const { t } = useLingui();
  const { runtime, pageId, params } = props;
  const view = getView(runtime, pageId) as unknown as StepsViewDef;
  const id = String((view.param && params[view.param]) ?? params.id ?? "");
  const { record, loading } = runtime.useRecord(view.entity, id);

  const [done, setDone] = useState<Set<number> | null>(null);
  // `onFinish` must fire on the transition to complete, not on every render while complete —
  // otherwise re-opening a finished walk-through would run the action again.
  const firedFor = useRef<string | null>(null);

  const storageKey = id ? progressKey(pageId, id) : null;

  useEffect(() => {
    let live = true;
    if (!storageKey) return;
    setDone(null);
    void runtime.ctx.storage
      .get(storageKey)
      .then((saved) => {
        if (live) setDone(new Set(toIndices(saved)));
      })
      .catch((e: unknown) => {
        // Losing saved progress is a nuisance; refusing to render the steps is worse.
        console.warn("[potyro] could not read step progress:", e);
        if (live) setDone(new Set());
      });
    return () => {
      live = false;
    };
  }, [runtime, storageKey]);

  if (loading || done === null) return <p className="k-loading">{t`Loading`}</p>;
  if (!record) return <p className="k-empty">{t`Not found.`}</p>;

  const steps: Resolved[] = Array.isArray(record[view.list]) ? (record[view.list] as Resolved[]) : [];
  const complete = steps.length > 0 && done.size === steps.length;
  const doneCount = fmt.number(done.size);
  const stepCount = fmt.number(steps.length);

  const toggle = (index: number): void => {
    const next = new Set(done);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setDone(next);

    if (storageKey) {
      void runtime.ctx.storage
        .set(storageKey, [...next])
        .catch((e: unknown) => console.warn("[potyro] could not save step progress:", e));
    }

    const nowComplete = steps.length > 0 && next.size === steps.length;
    if (nowComplete && view.onFinish && firedFor.current !== record.id) {
      firedFor.current = String(record.id);
      void runtime.runAction(view.entity, view.onFinish, String(record.id));
    }
    if (!nowComplete) firedFor.current = null;
  };

  const reset = (): void => {
    setDone(new Set());
    firedFor.current = null;
    if (storageKey) {
      void runtime.ctx.storage
        .delete(storageKey)
        .catch((e: unknown) => console.warn("[potyro] could not clear step progress:", e));
    }
  };

  return (
    <section className="k-steps" aria-label={t({ message: "Steps", comment: "A recipe's or a routine's steps, ticked off one by one" })}>
      <header className="k-steps-head">
        <p className="k-steps-progress" role="status">
          {t`${doneCount} of ${stepCount} done`}
        </p>
        {done.size > 0 ? (
          <button type="button" className="k-add" onClick={reset}>
            <Trans>Start over</Trans>
          </button>
        ) : null}
      </header>

      {steps.length === 0 ? (
        <p className="k-empty">{t`No steps yet.`}</p>
      ) : (
        <ol className="k-steps-list">
          {steps.map((step, i) => (
            <li key={i} className="k-steps-item" data-done={done.has(i) || undefined}>
              <label>
                <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
                <span className="k-steps-text">{stepText(step, view.text)}</span>
              </label>
            </li>
          ))}
        </ol>
      )}

      {complete ? <p className="k-steps-done">{t`All done.`}</p> : null}
    </section>
  );
}
