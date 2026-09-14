// The `checklist` built-in (#106): a list of things you tick — groceries, packing, chores, habits.
//
// A `list` view's rows open a detail page where a boolean is edited in a form and saved: three taps
// and a modal for what should be one tap on the row. Here the row's check flips the record's `done`
// field through `ctx.patch` — rows in, patches out, so it renders untrusted like every declarative
// view — and the row strikes through, holds for a beat, then moves to the Done section. `quickAdd`
// is what makes it a list app: type, Enter, next; the input keeps the focus.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Resolved } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { displayFieldFor, getView } from "./format.js";
import { useDynamicText } from "./dynamic.js";
import { RowActions, mapOnOpen } from "./builtins.js";
import { createDefaults } from "./record-form.js";

/** How long a ticked row stays where it is before it moves — long enough to see the strike. */
const HOLD_MS = 700;

interface ChecklistDef {
  entity: string;
  done: string;
  doneValue?: string;
  text?: unknown;
  detail?: unknown;
  group?: unknown;
  hideDone?: boolean | "collapse";
  quickAdd?: boolean;
  rowActions?: string[];
  onOpen?: { page: string; param?: Record<string, string> };
}

interface RowText {
  text: string;
  detail: string;
  group: string;
}

const str = (v: unknown): string => (v == null ? "" : String(v));

const PATHS = ["text", "detail", "group"] as const;

/**
 * The three bindings per row. A field-key binding — the common case — is read straight off the
 * row during render, so the rows appear grouped on the first paint. A function binding is a host
 * call, resolved outside render; until every row has its texts, `null` says "not yet" and the view
 * shows nothing rather than a flash of ungrouped rows that regroup a moment later.
 */
function useRowTexts(runtime: BuiltinViewProps["runtime"], pageId: string, rows: Resolved[], view: ChecklistDef): RowText[] | null {
  const fallback = displayFieldFor(runtime, view.entity);
  const plain = PATHS.every((p) => view[p] === undefined || typeof view[p] === "string");
  const [resolved, setResolved] = useState<{ rows: Resolved[]; texts: RowText[] } | null>(null);
  useEffect(() => {
    if (plain) return;
    let alive = true;
    const ctx = runtime.ctx;
    void Promise.all(
      rows.map(async (row): Promise<RowText> => {
        const one = async (path: (typeof PATHS)[number]): Promise<string> =>
          view[path] === undefined ? "" : str(await runtime.resolveBinding({ kind: "view", page: pageId, path }, row, ctx));
        const [text, detail, group] = await Promise.all([one("text"), one("detail"), one("group")]);
        return { text: view.text === undefined ? str(row[fallback] ?? row.id) : text, detail, group };
      }),
    ).then((texts) => {
      if (alive) setResolved({ rows, texts });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, pageId, rows, plain]);
  if (plain) {
    const read = (row: Resolved, path: (typeof PATHS)[number]): string => (view[path] === undefined ? "" : str(row[view[path] as string]));
    return rows.map((row) => ({ text: view.text === undefined ? str(row[fallback] ?? row.id) : read(row, "text"), detail: read(row, "detail"), group: read(row, "group") }));
  }
  return resolved?.rows === rows ? resolved.texts : null;
}

export function ChecklistView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate } = props;
  const view = getView(runtime, pageId) as unknown as ChecklistDef;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const texts = useRowTexts(runtime, pageId, rows, view);
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing to do.");
  const field = runtime.definition.entities[view.entity]?.fields[view.done];

  // A row just ticked keeps its place for a beat, struck through, before it moves: the eye follows
  // the change instead of losing the row.
  const [held, setHeld] = useState<Map<string, boolean>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const isDone = (row: Resolved): boolean =>
    field?.type === "enum" ? row[view.done] === view.doneValue : Boolean(row[view.done]);
  /** Where the row sits: by its state before the tick while it is held. */
  const placedDone = (row: Resolved): boolean => {
    const id = String(row.id);
    return held.has(id) ? held.get(id)! : isDone(row);
  };

  const toggle = async (row: Resolved): Promise<void> => {
    const id = String(row.id);
    const was = isDone(row);
    let next: unknown = !was;
    if (field?.type === "enum") next = was ? (field.options.find((o) => o !== view.doneValue) ?? null) : view.doneValue;
    setHeld((h) => new Map(h).set(id, was));
    const old = timers.current.get(id);
    if (old) clearTimeout(old);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setHeld((h) => {
          const m = new Map(h);
          m.delete(id);
          return m;
        });
      }, HOLD_MS),
    );
    try {
      await runtime.patch(view.entity, id, { [view.done]: next });
    } catch (e) {
      runtime.ctx.ui.toast(e instanceof Error ? e.message : "Could not save that");
    }
  };

  // Quick add: the text becomes the entity's display field; every other field takes its default.
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const key = displayFieldFor(runtime, view.entity);
      await runtime.create(view.entity, { ...(await createDefaults(runtime, view.entity)), [key]: text });
      setDraft("");
    } catch (e) {
      runtime.ctx.ui.toast(e instanceof Error ? e.message : "Could not add that");
    } finally {
      setAdding(false);
      // The input is never disabled, so the focus can go straight back for the next item.
      input.current?.focus();
    }
  };
  const onDraftKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  };

  if (loading || texts === null) return <p className="k-loading">Loading…</p>;

  const open = rows.filter((r) => !placedDone(r));
  const done = rows.filter((r) => placedDone(r));
  const textOf = (row: Resolved): RowText => texts[rows.indexOf(row)] ?? { text: str(row[displayFieldFor(runtime, view.entity)] ?? row.id), detail: "", group: "" };

  // Open rows under their headings, in first-seen order; rows with no group first, untitled.
  const sections: { title: string; rows: Resolved[] }[] = [];
  for (const row of open) {
    const title = view.group === undefined ? "" : textOf(row).group;
    const section = sections.find((s) => s.title === title);
    if (section) section.rows.push(row);
    else sections.push({ title, rows: [row] });
  }
  sections.sort((a, b) => (a.title === "" ? -1 : b.title === "" ? 1 : 0));

  const row = (r: Resolved) => {
    const t = textOf(r);
    const ticked = isDone(r);
    const id = String(r.id);
    return (
      <li key={id} className="k-check-row" data-done={ticked || undefined} data-held={held.has(id) || undefined}>
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label={t.text}
          className="k-check"
          onClick={() => void toggle(r)}
        >
          <span className="k-check-mark" aria-hidden />
        </button>
        <span className="k-check-text">
          <span className="k-check-label">{t.text}</span>
          {t.detail ? <span className="k-check-detail">{t.detail}</span> : null}
        </span>
        {/* Extra actions only: a red Delete on every row of a shopping list is noise — removing an
            item is what its detail page (the chevron) is for. */}
        <RowActions runtime={runtime} entity={view.entity} actions={view.rowActions} id={id} label={t.text || "this item"} />
        {view.onOpen ? (
          <button type="button" className="k-check-open" aria-label={`Open ${t.text}`} onClick={() => navigate(view.onOpen!.page, mapOnOpen(view.onOpen, r))}>
            ›
          </button>
        ) : null}
      </li>
    );
  };

  const doneList = done.length && view.hideDone !== true ? (
    view.hideDone === "collapse" ? (
      <details className="k-check-done">
        <summary className="k-check-heading">Done ({done.length})</summary>
        <ul className="k-check-list">{done.map(row)}</ul>
      </details>
    ) : (
      <section className="k-check-done" aria-label="Done">
        <h3 className="k-check-heading">Done ({done.length})</h3>
        <ul className="k-check-list">{done.map(row)}</ul>
      </section>
    )
  ) : null;

  return (
    <div className="k-checklist">
      {rows.length === 0 ? <p className="k-empty">{emptyText}</p> : null}
      {open.length === 0 && rows.length > 0 ? <p className="k-check-clear">All done.</p> : null}
      {sections.map((s) => (
        <section key={s.title || "—"} className="k-check-section" aria-label={s.title || undefined}>
          {s.title ? <h3 className="k-check-heading">{s.title}</h3> : null}
          <ul className="k-check-list">{s.rows.map(row)}</ul>
        </section>
      ))}
      {doneList}
      {view.quickAdd ? (
        <form
          className="k-check-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            ref={input}
            className="k-input"
            type="text"
            aria-label="Add an item"
            placeholder="Add an item…"
            enterKeyHint="done"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKey}
          />
          <button type="submit" className="k-add k-primary-action" disabled={adding || !draft.trim()}>
            Add
          </button>
        </form>
      ) : null}
    </div>
  );
}
