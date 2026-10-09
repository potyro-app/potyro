// Rows under headings (#108). "Places by category", "plants by room", "expenses by month" — all of
// them at once, instead of one filter chip's worth at a time.
//
// A view's `group` is a binding. A field key reads straight off the row during render, so the list
// appears grouped on its first paint; a function is a host call, resolved outside render, and until
// every row has its group the hook says "not yet" rather than flashing an ungrouped list that
// regroups a moment later (the checklist view learned that the hard way, #106).

import { useEffect, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { Field, Resolved } from "potyro";
import { displayFieldFor, formatValue } from "./format.js";

export interface RowGroup {
  /** Stable across renders: the value's identity (an enum option, a record id, the text). */
  key: string;
  /** What the heading says. Empty for rows with no value, which are shown first without one. */
  label: string;
  rows: Resolved[];
}

interface GroupedView {
  entity: string;
  group?: unknown;
}

/** One row's place(s): a tag field puts a row under each of its tags. */
interface Membership {
  key: string;
  label: string;
}

function membershipsOf(runtime: PotyroRuntime, field: Field | undefined, value: unknown): Membership[] {
  if (value == null || value === "") return [{ key: "", label: "" }];
  if (field?.type === "relation") {
    const one = (v: unknown): Membership => {
      if (v && typeof v === "object") {
        const rec = v as Record<string, unknown>;
        return { key: String(rec.id ?? ""), label: String(rec[displayFieldFor(runtime, field.to)] ?? rec.id ?? "") };
      }
      return { key: String(v), label: String(v) };
    };
    const list = Array.isArray(value) ? value.map(one) : [one(value)];
    return list.length ? list : [{ key: "", label: "" }];
  }
  if (Array.isArray(value)) {
    const list = value.filter((v) => v != null && v !== "").map((v) => ({ key: String(v), label: String(v) }));
    return list.length ? list : [{ key: "", label: "" }];
  }
  const text = value instanceof Date ? formatValue(value) : String(value);
  return [{ key: text, label: text }];
}

/**
 * Group rows by the view's `group` binding, keeping the rows' own order inside each group.
 *
 * Group order: an enum's option order when the binding names an enum field — "restaurant" before
 * "bar" because the app said so, not because of the alphabet — and otherwise the order the values
 * first appear in the (already sorted) rows. Rows with no value come first, under no heading.
 */
export function groupRows(runtime: PotyroRuntime, view: GroupedView, rows: Resolved[], memberships: Membership[][]): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  rows.forEach((row, i) => {
    for (const m of memberships[i] ?? [{ key: "", label: "" }]) {
      let g = groups.get(m.key);
      if (!g) {
        g = { key: m.key, label: m.label, rows: [] };
        groups.set(m.key, g);
      }
      g.rows.push(row);
    }
  });
  const list = [...groups.values()];
  const field = typeof view.group === "string" ? runtime.definition.entities[view.entity]?.fields[view.group] : undefined;
  const optionOrder = field?.type === "enum" ? field.options : null;
  const rank = (g: RowGroup): number => {
    if (g.key === "") return -1;
    if (!optionOrder) return 0;
    const at = optionOrder.indexOf(g.key);
    return at < 0 ? optionOrder.length : at;
  };
  // Array#sort is stable, so equal ranks keep first-appearance order.
  return list.sort((a, b) => rank(a) - rank(b));
}

/** `null` while a function binding is still being resolved; the groups once every row has one. */
export function useRowGroups(runtime: PotyroRuntime, pageId: string, rows: Resolved[], view: GroupedView): RowGroup[] | null {
  const byField = typeof view.group === "string";
  const [resolved, setResolved] = useState<{ rows: Resolved[]; groups: RowGroup[] } | null>(null);

  useEffect(() => {
    if (view.group === undefined || byField) return;
    let alive = true;
    const ctx = runtime.ctx;
    void Promise.all(rows.map((row) => runtime.resolveBinding({ kind: "view", page: pageId, path: "group" }, row, ctx))).then((values) => {
      if (!alive) return;
      const memberships = values.map((v) => membershipsOf(runtime, undefined, v));
      setResolved({ rows, groups: groupRows(runtime, view, rows, memberships) });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, pageId, rows, byField, view.group === undefined]);

  if (view.group === undefined) return [{ key: "", label: "", rows }];
  if (byField) {
    const key = view.group as string;
    const field = runtime.definition.entities[view.entity]?.fields[key];
    return groupRows(runtime, view, rows, rows.map((row) => membershipsOf(runtime, field, row[key])));
  }
  return resolved?.rows === rows ? resolved.groups : null;
}
