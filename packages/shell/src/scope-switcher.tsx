// The app-wide selection as the page's title: "Weekly shop ▾" (#134). It is what the person is looking
// at, so it reads as a title, not as a setting tucked beside the app's name — and it opens on what
// someone does with lists: switch to another, start a new one, rename, copy or delete this one.
// The app writes none of it (scope-manage.ts): every app that works on one list at a time gets it.

import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { PotyroRuntime } from "@potyro/runtime";
import { ActionMenu, byPeople, type MenuEntry } from "@potyro/views";
import type { Resolved } from "potyro";
import { chooseScope } from "./scope.js";
import { contentsOf, deleteScope, duplicateScope } from "./scope-manage.js";

interface ScopeSwitcherProps {
  runtime: PotyroRuntime;
  /** Where the selection is remembered (`scope.ts`). */
  appId: string;
  /** Open the form for a new one; the shell selects it once made. */
  onNew: () => void;
}

export function ScopeSwitcher({ runtime, appId, onNew }: ScopeSwitcherProps) {
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
      // Somewhere to land: the next one, or — with none left — the form for a first one.
      await chooseScope(runtime, appId, next ? String(next.id) : null);
      if (!next && def.required) onNew();
    });

  const entries: MenuEntry[] = [
    ...all.map((r): MenuEntry => ({
      key: `s-${String(r.id)}`,
      label: nameOf(r),
      icon: scoped && String(r.id) === String(scoped.id) ? "✓" : "",
      className: "k-scope-choice",
      onSelect: () => void chooseScope(runtime, appId, String(r.id)),
    })),
    ...(writable
      ? [
          "separator" as const,
          { key: "new", label: t({ message: `New ${kind}`, comment: "Scope menu: start a new list/trip/group; the app's word for it" }), icon: "＋", onSelect: onNew },
          ...(scoped
            ? [
                { key: "rename", label: t`Rename…`, icon: "✎", onSelect: () => void rename() },
                { key: "duplicate", label: t({ message: "Duplicate…", comment: "Scope menu: a copy of the list with everything in it" }), icon: "⧉", onSelect: () => void duplicate() },
                "separator" as const,
                { key: "delete", label: t`Delete…`, icon: "🗑", danger: true, onSelect: () => void remove() },
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
          <span className="k-scope-name" data-empty={!scoped || undefined}>
            {scoped ? current : t`Choose…`}
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
 * is — never a question before the person has seen the app. With none at all, the form for a first one.
 */
export function useOpeningScope(runtime: PotyroRuntime, appId: string, onNone: () => void): void {
  const def = runtime.definition.scope;
  useEffect(() => {
    if (!def?.required || runtime.scope[def.entity]) return;
    let alive = true;
    void runtime.ctx.query(def.entity).then((rows) => {
      if (!alive || runtime.scope[def.entity]) return;
      if (rows[0]) void chooseScope(runtime, appId, String(rows[0].id));
      else if (byPeople(runtime, def.entity)) onNone();
    });
    return () => {
      alive = false;
    };
    // Once, as the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
