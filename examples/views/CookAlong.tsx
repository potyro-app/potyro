// The custom cook-along view (docs M1 DoD): a full React component — the "no ceiling" escape
// hatch. It reads the recipe via the runtime, keeps local tick state, and fires the finish
// action when every step is checked.
import { useState } from "react";
import type { ViewProps } from "karta";

interface Step {
  text: string;
  durationSec?: number;
}

export function CookAlong(props: ViewProps) {
  const { runtime, param } = props;
  const recipeId = param?.recipeId ?? "";
  const { record, loading } = runtime.useRecord("recipe", recipeId);
  const [done, setDone] = useState<Set<number>>(() => new Set());

  if (loading) return <p>Loading…</p>;
  if (!record) return <p>Recipe not found.</p>;

  const steps: Step[] = Array.isArray(record.steps) ? (record.steps as Step[]) : [];
  const allDone = steps.length > 0 && done.size === steps.length;

  const toggle = (i: number): void =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section aria-labelledby="cook-heading">
      <h1 id="cook-heading">Cooking: {String(record.name)}</h1>
      <ol>
        {steps.map((step, i) => (
          <li key={i} data-done={done.has(i)}>
            <label>
              <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
              <span>{step.text}</span>
              {step.durationSec ? <em> · {Math.round(step.durationSec / 60)} min</em> : null}
            </label>
          </li>
        ))}
      </ol>
      <button type="button" disabled={!allDone} onClick={() => void runtime.runAction("recipe", "markCooked", record.id)}>
        Finish
      </button>
    </section>
  );
}
