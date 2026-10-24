// The app-wide selection as the page's title: "Weekly shop ▾" (#134). It is what the person is looking
// at, so it reads as a title, not as a setting tucked beside the app's name — and it opens on what
// someone does with lists: switch to another, start a new one, rename, copy or delete this one.
// The app writes none of it (scope-manage.ts): every app that works on one list at a time gets it.

import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { PotyroRuntime } from "@potyro/runtime";
import { ActionMenu, Glyph, byPeople, type MenuEntry } from "@potyro/views";
import type { Resolved } from "potyro";
import { chooseScope } from "./scope.js";
import { contentsOf, deleteScope, duplicateScope } from "./scope-manage.js";
import { I } from "./icons.js";

interface ScopeSwitcherProps {
  runtime: PotyroRuntime;
  /** The app's name: what the title reads while an optional selection is none — everything shows. */
  appName: string;
  /** Where the selection is remembered (`scope.ts`). */
  appId: string;
  /** Open the form for a new one; the shell selects it once made. */
  onNew: () => void;
}

export function ScopeSwitcher({ runtime, appName, appId, onNew }: ScopeSwitcherProps) {
  const { t } = useLingui();
  const def = runtime.definition.scope!;
  const entityDef = runtime.definition.entities[def.entity];
  const kind = def.label ?? entityDef?.label ?? def.entity;
  const nameField = entityDef?.displayField ?? "name";
  const nameOf = (r: Resolved): string => String(r[nameField] ?? r.id);
  const scoped = runtime.scope[def.entity];
  const current = scoped ? nameOf(scoped) : "";
  const all = runtime.useQuery(def.entity).rows;
  const writable = byPeople(runtime, def.entity);
  const ui = runtime.ctx.ui;
  const [busy, setBusy] = useState(false);

  const work = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await job();
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : t`That did not work`);
    } finally {
      setBusy(false);
    }
  };

  const rename = (): Promise<void> =>
    work(async () => {
      if (!scoped) return;
      const next = (await ui.prompt(t({ message: `Rename “${current}”`, comment: "Scope menu: a new name for the list/trip/group being shown" }), { default: current }))?.trim();
      if (next && next !== current) await runtime.patch(def.entity, String(scoped.id), { [nameField]: next });
    });

  const duplicate = (): Promise<void> =>
    work(async () => {
      if (!scoped) return;
      const name = (
        await ui.prompt(t({ message: `Name the copy of “${current}”`, comment: "Scope menu: duplicating a list; asks for the copy's name" }), {
          default: t({ message: `${current} (copy)`, comment: "The suggested name of a duplicated list" }),
        })
      )?.trim();
      if (!name) return;
      const id = await duplicateScope(runtime, def.entity, String(scoped.id), name);
      await chooseScope(runtime, appId, id);
    });

  const remove = (): Promise<void> =>
    work(async () => {
      if (!scoped) return;
      const inside = (await contentsOf(runtime, def.entity, String(scoped.id))).reduce((n, c) => n + c.rows.length, 0);
      const ok = await ui.confirm(t({ message: `Delete “${current}”?`, comment: "Scope menu: deleting the list/trip/group being shown" }), {
        detail: inside
          ? t({ message: `Everything in it goes too (${inside}).`, comment: "Deleting a list: the records in it are deleted with it; the number is how many" })
          : undefined,
        ok: t`Delete`,
        destructive: true,
      });
      if (!ok) return;
      const id = String(scoped.id);
      const next = all.find((r) => String(r.id) !== id);
      await deleteScope(runtime, def.entity, id);
      // Somewhere to land: the next one, or — with none left — the page offers a first one.
      await chooseScope(runtime, appId, next ? String(next.id) : null);
    });

  // An optional selection can be none: everything shows, and the title says the app's own name.
  const showAll: MenuEntry[] = def.required
    ? []
    : [{ key: "all", label: t({ message: "Show all", comment: "Scope menu: no list/trip chosen, so every record shows" }), icon: scoped ? "" : "✓", onSelect: () => void chooseScope(runtime, appId, null) }];
  const entries: MenuEntry[] = [
    ...showAll,
    ...all.map((r): MenuEntry => ({
      key: `s-${String(r.id)}`,
      label: nameOf(r),
      icon: scoped && String(r.id) === String(scoped.id) ? "check" : "",
      className: "k-scope-choice",
      onSelect: () => void chooseScope(runtime, appId, String(r.id)),
    })),
    ...(writable
      ? [
          "separator" as const,
          { key: "new", label: t({ message: `New ${kind}`, comment: "Scope menu: start a new list/trip/group; the app's word for it" }), icon: I.plus, onSelect: onNew },
          ...(scoped
            ? [
                { key: "rename", label: t`Rename`, icon: I.edit, onSelect: () => void rename() },
                { key: "duplicate", label: t({ message: "Duplicate", comment: "Scope menu: a copy of the list with everything in it" }), icon: I.duplicate, onSelect: () => void duplicate() },
                "separator" as const,
                { key: "delete", label: t`Delete`, icon: I.delete, danger: true, onSelect: () => void remove() },
              ]
            : []),
        ]
      : []),
  ];

  return (
    <ActionMenu
      label={scoped ? t({ message: `${kind}: ${current} — change`, comment: "The scope switcher: which one the app shows, e.g. which trip" }) : t({ message: `${kind}: none chosen — change`, comment: "The scope switcher, nothing chosen yet" })}
      title={kind}
      entries={entries}
      busy={busy}
      buttonClassName="k-scope"
      trigger={
        <>
          <span className="k-scope-name" data-empty={(!scoped && def.required) || undefined}>
            {scoped ? current : def.required ? t`Choose` : appName}
          </span>
          <span className="k-scope-caret" aria-hidden>
            ▾
          </span>
        </>
      }
    />
  );
}

/**
 * The selection an app with a required scope opens on, when this device has none: the first there
 * is — never a question before the person has seen the app. Returns whether there is none at all, for
 * the page to offer the first one in place (`ScopeEmpty`) rather than a form popping up on its own.
 */
export function useOpeningScope(runtime: PotyroRuntime, appId: string): boolean {
  const def = runtime.definition.scope;
  const all = runtime.useQuery(def?.entity ?? "__none__", def ? undefined : { filter: () => false });
  const scoped = def ? runtime.scope[def.entity] : undefined;
  useEffect(() => {
    if (!def?.required || scoped || all.loading) return;
    const first = all.rows[0];
    if (first) void chooseScope(runtime, appId, String(first.id));
  }, [def, scoped, all.loading, all.rows, runtime, appId]);
  return Boolean(def?.required && !scoped && !all.loading && all.rows.length === 0);
}

/** In place of a page that needs a list (a trip, a group) while there is none: the way to the first. */
export function ScopeEmpty({ runtime, onNew }: { runtime: PotyroRuntime; onNew: () => void }) {
  const { t } = useLingui();
  const def = runtime.definition.scope!;
  const kind = def.label ?? runtime.definition.entities[def.entity]?.label ?? def.entity;
  const icon = runtime.definition.entities[def.entity]?.icon ?? "plus";
  return (
    <section className="k-scope-empty">
      <span className="k-scope-empty-icon" aria-hidden>
        <Glyph icon={icon} size={40} />
      </span>
      <p className="k-scope-empty-text">{t({ message: `Nothing here yet. Start with a first one: ${kind}.`, comment: "An app that works on one list/trip/group at a time, with none yet; kind is the app's word" })}</p>
      {byPeople(runtime, def.entity) ? (
        <button type="button" className="k-cta" onClick={onNew}>
          <span className="k-cta-icon" aria-hidden>
            <Glyph icon="plus" size={16} />
          </span>
          <span>{t({ message: `New ${kind}`, comment: "Scope menu: start a new list/trip/group; the app's word for it" })}</span>
        </button>
      ) : null}
    </section>
  );
}
