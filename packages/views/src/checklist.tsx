// The `checklist` built-in (#106): a list of things you tick — groceries, packing, chores, habits.
//
// A `list` view's rows open a detail page where a boolean is edited in a form and saved: three taps
// and a modal for what should be one tap on the row. Here the row's check flips the record's `done`
// field through `ctx.patch` — rows in, patches out, so it renders untrusted like every declarative
// view — and the row strikes through, holds for a beat, then sinks to the bottom of its own group,
// so what is still to buy stays together. `quickAdd` is what makes it a list app: type, Enter, next.
//
// Everything a shopping list needs beyond that is declared, never coded, because an app that needs a
// custom React view to rename a row is an app most people cannot write:
//
//   editText     tap a row's text to rename it in place
//   reorder      the number field holding a row's position — with it, rows drag, and a row dropped
//                under another group's heading JOINS that group (its `group` field is patched)
//   groupOrder   when `group` names a relation, the groups are records: their headings rename in
//                place, drag into order, and delete — asking first what becomes of their rows
//
// One consequence worth stating: with groups as records, a new item has nowhere to go until someone
// says where. So it is added ungrouped and the view asks — "Tap the aisle for Milk" — rather than
// guessing, or making the person open a form to answer a question one tap can.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Resolved } from "karta";
import type { BuiltinViewProps } from "./types.js";
import { displayFieldFor, getView } from "./format.js";
import { useDynamicText } from "./dynamic.js";
import { RowActions, mapOnOpen } from "./builtins.js";
import { createDefaults } from "./record-form.js";
import { useRowGroups } from "./row-groups.js";
import { useReorder } from "./reorder.js";

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
  donePlacement?: "sink" | "stay";
  quickAdd?: boolean;
  editText?: boolean;
  reorder?: string;
  groupOrder?: string;
  rowActions?: string[];
  onOpen?: { page: string; param?: Record<string, string> };
}

interface RowText {
  text: string;
  detail: string;
}

interface Section {
  /** A relation group's record id, an enum group's option, or `""` for the rows with no group. */
  key: string;
  label: string;
  rows: Resolved[];
  /** The group's own record — present only when `group` names a relation, and it is the manageable case. */
  record?: Resolved;
}

const str = (v: unknown): string => (v == null ? "" : String(v));

const PATHS = ["text", "detail"] as const;

const rowKey = (row: Resolved): string => `r:${String(row.id)}`;
const groupKey = (key: string): string => `g:${key}`;

/** The id a relation field holds, whether the row carries the record or just its id. */
function relationId(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return str((v as { id?: unknown }).id);
  return String(v);
}

/**
 * The row's two texts. A field-key binding — the common case — is read straight off the row during
 * render, so the rows appear on the first paint. A function binding is a host call, resolved outside
 * render; until every row has its texts, `null` says "not yet" and the view shows nothing rather
 * than a flash of the wrong text.
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
        const [text, detail] = await Promise.all([one("text"), one("detail")]);
        return { text: view.text === undefined ? str(row[fallback] ?? row.id) : text, detail };
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
    return rows.map((row) => ({ text: view.text === undefined ? str(row[fallback] ?? row.id) : read(row, "text"), detail: read(row, "detail") }));
  }
  return resolved?.rows === rows ? resolved.texts : null;
}

/** An input that replaces a piece of text while it is being renamed. Enter or blur saves; Escape drops it. */
function InlineText({ value, label, onSave, onCancel }: { value: string; label: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (save: boolean): void => {
    if (done.current) return;
    done.current = true;
    const next = text.trim();
    if (save && next && next !== value) onSave(next);
    else onCancel();
  };
  return (
    <input
      className="k-input k-inline-edit"
      type="text"
      aria-label={label}
      value={text}
      autoFocus
      enterKeyHint="done"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

export function ChecklistView(props: BuiltinViewProps) {
  const { runtime, pageId, params, navigate } = props;
  const view = getView(runtime, pageId) as unknown as ChecklistDef;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const texts = useRowTexts(runtime, pageId, rows, view);
  const rowGroups = useRowGroups(runtime, pageId, rows, view);
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing to do.");
  const entityDef = runtime.definition.entities[view.entity];
  const field = entityDef?.fields[view.done];

  // Groups as records: `group` names a single relation, so the headings are rows of another entity
  // and every one of them exists whether or not anything is in it (an empty aisle is still an aisle).
  const groupField = typeof view.group === "string" ? view.group : undefined;
  const groupFieldDef = groupField ? entityDef?.fields[groupField] : undefined;
  const managed = groupFieldDef?.type === "relation" && !groupFieldDef.many;
  const groupEntity = groupFieldDef?.type === "relation" ? groupFieldDef.to : undefined;
  // Hooks cannot be conditional: with no group entity this subscribes to the rows' own entity with a
  // filter that keeps nothing, which costs one predicate per row and no fetch of its own.
  const groupQuery = runtime.useQuery(managed && groupEntity ? groupEntity : view.entity, managed ? undefined : { filter: () => false });

  // A row just ticked keeps its place for a beat, struck through, before it sinks: the eye follows
  // the change instead of losing the row.
  const [held, setHeld] = useState<Map<string, boolean>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  /** An item added with nowhere to put it, waiting for someone to tap a heading. */
  const [pending, setPending] = useState<{ id: string; text: string } | null>(null);

  const isDone = (row: Resolved): boolean => (field?.type === "enum" ? row[view.done] === view.doneValue : Boolean(row[view.done]));
  /** Where the row sits: by its state before the tick while it is held. */
  const placedDone = (row: Resolved): boolean => {
    const id = String(row.id);
    return held.has(id) ? held.get(id)! : isDone(row);
  };

  const fail = (e: unknown, fallback: string): void => runtime.ctx.ui.toast(e instanceof Error ? e.message : fallback);

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
      fail(e, "Could not save that");
    }
  };

  // Quick add: the text becomes the entity's display field; every other field takes its default.
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const textField = typeof view.text === "string" ? view.text : displayFieldFor(runtime, view.entity);

  const add = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const made = await runtime.create(view.entity, { ...(await createDefaults(runtime, view.entity)), [textField]: text });
      setDraft("");
      // Nowhere to put it and somewhere it could go: ask, rather than guess a group for it.
      if (managed && groupField && groupQuery.rows.length > 0 && !relationId((made as Record<string, unknown>)[groupField])) {
        setPending({ id: String(made.id), text });
      }
    } catch (e) {
      fail(e, "Could not add that");
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

  // ---- sections ----------------------------------------------------------------------------

  const groupLabelField = groupEntity ? displayFieldFor(runtime, groupEntity) : "id";
  const orderOf = (record: Resolved): number => {
    const v = view.groupOrder ? record[view.groupOrder] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
  };
  const posOf = (row: Resolved): number => {
    const v = view.reorder ? row[view.reorder] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
  };

  /** Inside a group: the app's order, then the ticked ones at the bottom unless told to stay. */
  const arrange = (list: Resolved[]): Resolved[] => {
    const ordered = view.reorder ? [...list].sort((a, b) => posOf(a) - posOf(b)) : list;
    if (view.donePlacement === "stay" || view.hideDone === "collapse") return ordered;
    return [...ordered].sort((a, b) => Number(placedDone(a)) - Number(placedDone(b)));
  };

  const byKey = new Map<string, Resolved[]>();
  for (const g of rowGroups ?? []) byKey.set(g.key, g.rows);

  let sections: Section[] = [];
  if (managed) {
    const ungrouped = byKey.get("") ?? [];
    if (ungrouped.length) sections.push({ key: "", label: "", rows: ungrouped });
    const records = [...groupQuery.rows].sort((a, b) => orderOf(a) - orderOf(b));
    for (const record of records) {
      const key = String(record.id);
      sections.push({ key, label: str(record[groupLabelField] ?? key), rows: byKey.get(key) ?? [], record });
    }
    // Defensive: a row pointing at a group that is gone still has to be reachable.
    for (const g of rowGroups ?? []) {
      if (g.key !== "" && !records.some((r) => String(r.id) === g.key)) sections.push({ key: g.key, label: g.label, rows: g.rows });
    }
  } else {
    sections = (rowGroups ?? []).map((g) => ({ key: g.key, label: g.label, rows: g.rows }));
  }
  sections = sections.map((s) => ({ ...s, rows: arrange(s.rows) }));

  const hiddenDone = view.hideDone === true;
  const collapsedDone = view.hideDone === "collapse";
  const visible = (list: Resolved[]): Resolved[] => (hiddenDone || collapsedDone ? list.filter((r) => !placedDone(r)) : list);
  const doneRows = collapsedDone ? rows.filter((r) => placedDone(r)) : [];

  // ---- dragging ----------------------------------------------------------------------------

  const canDragRows = Boolean(view.reorder);
  const canDragGroups = Boolean(managed && view.groupOrder);

  // One flat sequence of everything on screen, headings included: a heading is a drop target even
  // when it cannot itself be dragged, because "put this in that aisle" is a drop onto its heading.
  const keys: string[] = [];
  for (const s of sections) {
    if (s.key !== "" || sections.length > 1) keys.push(groupKey(s.key));
    for (const r of visible(s.rows)) keys.push(rowKey(r));
  }

  const sectionFor = (key: string): Section | undefined =>
    key.startsWith("g:") ? sections.find((s) => groupKey(s.key) === key) : sections.find((s) => s.rows.some((r) => rowKey(r) === key));
  const rowFor = (key: string): Resolved | undefined => rows.find((r) => rowKey(r) === key);

  const nameOf = (key: string): string => {
    if (key.startsWith("g:")) return sectionFor(key)?.label || "the top";
    const row = rowFor(key);
    return row ? (texts?.[rows.indexOf(row)]?.text ?? "this item") : "this item";
  };

  /** Write `reorder` down a group's rows, touching only the ones whose number actually changes. */
  const renumber = async (list: Resolved[]): Promise<void> => {
    if (!view.reorder) return;
    for (const [i, row] of list.entries()) {
      if (row[view.reorder] === i) continue;
      await runtime.patch(view.entity, String(row.id), { [view.reorder]: i });
    }
  };

  const groupValue = (key: string): unknown => (key === "" ? null : key);

  const moveRow = async (key: string, over: string): Promise<void> => {
    const row = rowFor(key);
    const from = sectionFor(key);
    const target = sectionFor(over);
    if (!row || !target) return;
    const at = over.startsWith("g:") ? 0 : target.rows.findIndex((r) => rowKey(r) === over);
    const rest = target.rows.filter((r) => rowKey(r) !== key);
    const next = [...rest.slice(0, Math.max(0, at)), row, ...rest.slice(Math.max(0, at))];
    try {
      if (groupField && from && from.key !== target.key) {
        await runtime.patch(view.entity, String(row.id), { [groupField]: groupValue(target.key) });
        await renumber(from.rows.filter((r) => rowKey(r) !== key));
      }
      await renumber(next);
    } catch (e) {
      fail(e, "Could not move that");
    }
  };

  const moveGroup = async (key: string, over: string): Promise<void> => {
    if (!view.groupOrder) return;
    const target = sectionFor(over);
    const mine = sectionFor(key);
    if (!target || !mine?.record) return;
    const records = sections.filter((s) => s.record).map((s) => s.record!);
    const ids = records.map((r) => String(r.id));
    const to = ids.indexOf(target.record ? String(target.record.id) : "");
    if (to < 0) return;
    const at = ids.indexOf(String(mine.record.id));
    const next = [...records];
    next.splice(at, 1);
    next.splice(to, 0, mine.record);
    try {
      for (const [i, record] of next.entries()) {
        if (record[view.groupOrder] === i) continue;
        await runtime.patch(groupEntity!, String(record.id), { [view.groupOrder]: i });
      }
    } catch (e) {
      fail(e, "Could not move that");
    }
  };

  const reorder = useReorder({
    keys,
    names: nameOf,
    onReorder: () => {},
    onDrop: (key, over) => void (key.startsWith("g:") ? moveGroup(key, over) : moveRow(key, over)),
    enabled: canDragRows || canDragGroups,
    ignore: ".k-check, .k-check-open, .k-inline-edit, .k-check-del",
    keyboard: "alt",
  });

  // ---- group headings ----------------------------------------------------------------------

  const renameGroup = async (record: Resolved, text: string): Promise<void> => {
    setEditingGroup(null);
    try {
      await runtime.patch(groupEntity!, String(record.id), { [groupLabelField]: text });
    } catch (e) {
      fail(e, "Could not rename that");
    }
  };

  /**
   * Delete a group, and answer the question that always comes with it: what happens to what was in
   * it? Two questions, never one — the second only when there is something to lose, and its "no"
   * moves the rows to the group above rather than taking them down with the heading.
   */
  const deleteGroup = async (section: Section): Promise<void> => {
    if (!section.record || !groupEntity) return;
    const ui = runtime.ctx.ui;
    const count = section.rows.length;
    const ok = await ui.confirm(`Delete “${section.label}”?`, {
      detail: count ? `${count} ${count === 1 ? "item is" : "items are"} in it.` : undefined,
      ok: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setEditingGroup(null);
    const withRecords = sections.filter((s) => s.record);
    const at = withRecords.findIndex((s) => s.key === section.key);
    const above = withRecords[at - 1] ?? withRecords[at + 1];
    try {
      if (count) {
        const alsoItems = await ui.confirm(`Delete its ${count === 1 ? "item" : `${count} items`} too?`, {
          detail: above
            ? `Otherwise ${count === 1 ? "it moves" : "they move"} to “${above.label}”.`
            : `Otherwise ${count === 1 ? "it stays" : "they stay"} on the list with no ${(runtime.definition.entities[groupEntity]?.label ?? "group").toLowerCase()}.`,
          ok: "Delete them",
          cancel: above ? `Move to “${above.label}”` : "Keep them",
          destructive: true,
        });
        for (const row of section.rows) {
          if (alsoItems) await runtime.remove(view.entity, String(row.id));
          else if (groupField) await runtime.patch(view.entity, String(row.id), { [groupField]: groupValue(above?.key ?? "") });
        }
      }
      await runtime.remove(groupEntity, String(section.record.id));
    } catch (e) {
      fail(e, "Could not delete that");
    }
  };

  const addGroup = async (text: string): Promise<void> => {
    setNewGroup(false);
    if (!groupEntity) return;
    try {
      const order = groupQuery.rows.length;
      await runtime.create(groupEntity, {
        ...(await createDefaults(runtime, groupEntity)),
        [groupLabelField]: text,
        ...(view.groupOrder ? { [view.groupOrder]: order } : {}),
      });
    } catch (e) {
      fail(e, "Could not add that");
    }
  };

  /** Tapping a heading while an item is waiting puts it there — that is the whole flow. */
  const assignPending = async (section: Section): Promise<void> => {
    if (!pending || !groupField) return;
    const item = pending;
    setPending(null);
    try {
      await runtime.patch(view.entity, item.id, { [groupField]: groupValue(section.key) });
    } catch (e) {
      fail(e, "Could not move that");
    }
  };

  const renameRow = async (row: Resolved, text: string): Promise<void> => {
    setEditingRow(null);
    try {
      await runtime.patch(view.entity, String(row.id), { [textField]: text });
    } catch (e) {
      fail(e, "Could not rename that");
    }
  };

  if (loading || texts === null || rowGroups === null) return <p className="k-loading">Loading…</p>;

  // ---- render ------------------------------------------------------------------------------

  const textOf = (row: Resolved): RowText => texts[rows.indexOf(row)] ?? { text: str(row[textField] ?? row.id), detail: "" };

  const renderRow = (r: Resolved) => {
    const t = textOf(r);
    const ticked = isDone(r);
    const id = String(r.id);
    const key = rowKey(r);
    const editing = editingRow === id;
    const drag = canDragRows && !editing ? reorder.item(key) : { "data-key": key };
    return (
      <li key={id} className="k-check-row" data-done={ticked || undefined} data-held={held.has(id) || undefined} {...drag}>
        <button type="button" role="checkbox" aria-checked={ticked} aria-label={t.text} className="k-check" onClick={() => void toggle(r)}>
          <span className="k-check-mark" aria-hidden />
        </button>
        {editing ? (
          <InlineText value={t.text} label={`Rename ${t.text}`} onSave={(text) => void renameRow(r, text)} onCancel={() => setEditingRow(null)} />
        ) : view.editText ? (
          <button type="button" className="k-check-text k-check-rename" onClick={() => setEditingRow(id)} aria-label={`Rename ${t.text}`}>
            <span className="k-check-label">{t.text}</span>
            {t.detail ? <span className="k-check-detail">{t.detail}</span> : null}
          </button>
        ) : (
          <span className="k-check-text">
            <span className="k-check-label">{t.text}</span>
            {t.detail ? <span className="k-check-detail">{t.detail}</span> : null}
          </span>
        )}
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

  const renderHeading = (s: Section) => {
    const key = groupKey(s.key);
    const editing = editingGroup === s.key;
    const drag = canDragGroups && s.record && !editing ? reorder.item(key) : { "data-key": key };
    if (s.key === "" && !s.label) return null;
    return (
      <h3 className="k-check-heading" data-target={pending ? true : undefined} {...drag}>
        {editing && s.record ? (
          <>
            <InlineText value={s.label} label={`Rename ${s.label}`} onSave={(text) => void renameGroup(s.record!, text)} onCancel={() => setEditingGroup(null)} />
            {/* Pressing Delete must not first blur the input, because closing the rename would take
                this button off the screen before the tap that is already on it lands. */}
            <button type="button" className="k-check-del k-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => void deleteGroup(s)}>
              Delete
            </button>
          </>
        ) : pending || (managed && s.record) ? (
          <button
            type="button"
            className="k-check-heading-name"
            onClick={() => (pending ? void assignPending(s) : setEditingGroup(s.key))}
            aria-label={pending ? `Put ${pending.text} in ${s.label}` : `Rename ${s.label}`}
          >
            {s.label}
          </button>
        ) : (
          s.label
        )}
      </h3>
    );
  };

  const anyVisible = sections.some((s) => visible(s.rows).length > 0);

  return (
    <div className="k-checklist">
      {rows.length === 0 && !managed ? <p className="k-empty">{emptyText}</p> : null}
      {rows.length > 0 && !anyVisible && !collapsedDone ? <p className="k-check-clear">All done.</p> : null}
      {sections.map((s) => (
        <section key={s.key || "—"} className="k-check-section" aria-label={s.label || undefined}>
          {renderHeading(s)}
          <ul className="k-check-list">{visible(s.rows).map(renderRow)}</ul>
        </section>
      ))}
      {managed ? (
        <div className="k-check-newgroup">
          {newGroup ? (
            <InlineText value="" label="New group name" onSave={(text) => void addGroup(text)} onCancel={() => setNewGroup(false)} />
          ) : (
            <button type="button" className="k-add" onClick={() => setNewGroup(true)}>
              + {groupEntity ? (runtime.definition.entities[groupEntity]?.label ?? "Group") : "Group"}
            </button>
          )}
        </div>
      ) : null}
      {doneRows.length ? (
        <details className="k-check-done">
          <summary className="k-check-heading">Done ({doneRows.length})</summary>
          <ul className="k-check-list">{doneRows.map(renderRow)}</ul>
        </details>
      ) : null}
      {pending ? (
        <p className="k-check-hint" role="status">
          Tap the {groupEntity ? (runtime.definition.entities[groupEntity]?.label ?? "group").toLowerCase() : "group"} for “{pending.text}”
          <button type="button" className="k-check-hint-close" aria-label="Leave it without one" onClick={() => setPending(null)}>
            ✕
          </button>
        </p>
      ) : null}
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
      <span className="k-visually-hidden" aria-live="polite">
        {reorder.announcement}
      </span>
    </div>
  );
}
