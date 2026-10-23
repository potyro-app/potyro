// The record page (`detail`): a cover, then the record's sections.
//
// The cover is what makes a record feel like itself rather than a form read back. With a picture —
// the record's photo, a computed's path in the app's files, or the page's background image — the
// picture fills the top of the screen (`cover: "banner"`), all of it (`"full"`), or sits behind the
// whole page with the sections over it (`"background"` — the record's information first, its picture
// still the place), and the title and key facts sit on it, on a scrim dark enough for white words in
// either theme. Without one, a band of the app's own colour carries the same things. The page's ONE
// primary action is a bar at the bottom of the screen, where the thumb is. The sections below show
// only what the record has: an empty field is a dash nobody came to read.

import { Trans, useLingui } from "@lingui/react/macro";
import { actionInfo, type Resolved } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { displayFieldFor, fieldLabel, formatValue, getView, humanizeKey, shownValue } from "./format.js";
import { FieldValue } from "./field-value.js";
import { resolveGroups, type ResolvedGroup } from "./groups.js";
import { ActionMenu, type MenuEntry } from "./menu.js";
import { enumSwatch } from "./enum.js";
import { Fold, foldKey } from "./fold.js";
import { byPeople, editLockFor } from "./edit-lock.js";
import { mediaFieldFor } from "./lead.js";
import { pictureOf, usePictureUrl } from "./picture.js";
import { backdropImage, pageOf } from "./backdrop.js";
import { useDeleteRecord } from "./builtins.js";
import { RelatedRecords, type RelatedSpec } from "./related.js";
import { Glyph } from "./glyph.js";

/** A section of the page: fields, or the records that point at this one (`related`). */
type DetailGroup = ResolvedGroup & { related?: RelatedSpec; index?: number };

type DetailAction = string | { label: string; navigate: { page: string; param?: Record<string, string> } };

interface DetailViewDef {
  entity: string;
  param?: string;
  sections?: { title?: string; fields?: string[]; related?: RelatedSpec; collapsible?: boolean; collapsed?: boolean }[];
  actions?: DetailAction[];
  media?: string | false;
  cover?: "banner" | "full" | "background" | "band" | "none";
  facts?: string[];
  primaryAction?: DetailAction;
}

/** How many enum fields a cover shows when the page names no `facts`. */
const DEFAULT_FACTS = 3;

export function DetailView(props: BuiltinViewProps) {
  const { t } = useLingui();
  const { runtime, pageId, params, navigate, onEdit: editByHand, onCreate: createByHand } = props;
  const view = getView(runtime, pageId) as DetailViewDef;
  // A feed's records (`editableBy: "app"`) are the app's: no Edit, no Delete, no Add by hand.
  const people = byPeople(runtime, view.entity);
  const onEdit = people ? editByHand : undefined;
  const onCreate = people ? createByHand : undefined;
  const id = String((view.param && params[view.param]) ?? "");
  const { record, loading } = runtime.useRecord(view.entity, id);
  const remove = useDeleteRecord(runtime, view.entity);
  const entityDef = runtime.definition.entities[view.entity];
  // The cover's picture: the record's own (the page's `media`, else the entity's first photo field),
  // else the page's background image, else the app's.
  const coverField = mediaFieldFor(view.media, entityDef);
  const own = coverField ? pictureOf(record?.[coverField]) : undefined;
  const fallback = view.media === false ? undefined : backdropImage(runtime.definition, pageOf(runtime.definition, pageId));
  const coverUrl = usePictureUrl(runtime.ctx, own ?? fallback);

  // Deleting the record you are looking at leaves this page with nothing to show, so go back to a
  // page that lists this entity (falling back to the first page rather than stranding you on "Not
  // found.").
  const listPage =
    runtime.definition.pages.find(
      (p) =>
        (p.view as { type?: string }).type !== "detail" &&
        (p.view as { entity?: string }).entity === view.entity,
    ) ?? runtime.definition.pages[0];

  if (loading) return <p className="k-loading">{t`Loading…`}</p>;
  if (!record) return <p className="k-empty">{t`Not found.`}</p>;

  const label = String(record[displayFieldFor(runtime, view.entity)] ?? t`this record`);
  const locked = editLockFor(runtime, view.entity, record);
  const explain = (): void => runtime.ctx.ui.toast(locked!);
  const onDelete = async (): Promise<void> => {
    if (!(await remove(id, label))) return;
    if (listPage) navigate(listPage.id);
  };
  const hasPicture = Boolean(own ?? fallback);
  const cover = view.cover ?? (hasPicture ? "banner" : "band");
  const pictured = (cover === "banner" || cover === "full" || cover === "background") && hasPicture;
  const behind = pictured && cover === "background";

  // The page's own `sections` override; otherwise the entity's `groups`, the same arrangement the
  // form uses (#100), so what was edited under "Nutrition" is read back under "Nutrition".
  const groups: DetailGroup[] = view.sections
    ? view.sections.map((s, index) => ({
        ...(s.title ? { title: s.title } : {}),
        fields: s.fields ?? [],
        ...(s.related ? { related: s.related, index } : {}),
        collapsed: s.collapsed === true,
        collapsible: s.collapsible === true || s.collapsed === true,
      }))
    : resolveGroups(runtime.definition.entities[view.entity], "detail");
  // A field with nothing in it is a dash on the page and nothing to read: the page shows what the
  // record has, and the form is where the rest is filled in. The cover's photo is not shown twice.
  // Only a STORED field hides when empty; a computed value is the app saying something ("no missing
  // ingredients"), and keeps its row.
  const stored = (f: string): boolean => Boolean(entityDef?.fields[f]);
  const shown = (f: string): boolean => !(pictured && own && f === coverField) && !(stored(f) && isBlank(record[f]));
  const visibleGroups = groups.map((g) => ({ ...g, fields: g.fields.filter(shown) })).filter((g) => g.fields.length > 0 || g.related);

  const runDetailAction = (a: DetailAction): void => {
    if (typeof a === "string") void runtime.runAction(view.entity, a, id);
    else navigate(a.navigate.page, mapDetailNav(a.navigate.param, record));
  };
  const actionLabel = (a: DetailAction): string =>
    // The action KEY is an identifier, not a label — "snapPhoto" is not a button name.
    typeof a === "string" ? actionInfo(entityDef, a)?.label ?? humanizeKey(a) : a.label;
  const actionGlyph = (a: DetailAction): string | undefined => {
    if (typeof a !== "string") return undefined;
    const def = entityDef?.actions?.[a] as { icon?: unknown } | undefined;
    return def && typeof def === "object" && typeof def.icon === "string" ? def.icon : undefined;
  };
  const actions = view.actions ?? [];
  // With a primary action at the bottom, the bar's actions are all quiet: one loud button per page.
  const fillFirst = !view.primaryAction;

  const fieldsOf = (group: DetailGroup) =>
    group.related ? (
      <>
        {group.fields.length ? fieldsList(group) : null}
        <RelatedRecords
          runtime={runtime}
          pageId={pageId}
          index={group.index ?? 0}
          recordId={id}
          spec={group.related}
          navigate={navigate}
          onEdit={onEdit}
          onCreate={createByHand}
        />
      </>
    ) : (
      fieldsList(group)
    );
  const fieldsList = (group: ResolvedGroup) => (
    <dl>
      {group.fields.map((f) => (
        <div className="k-field" key={f} data-wide={wideField(runtime, view.entity, f) || undefined}>
          {/* A section that is one field already says its name in the heading; saying it again
              under the heading ("Ingredients / Ingredients") is noise. It stays for assistive tech. */}
          <dt
            className={group.fields.length === 1 && group.title === fieldLabel(runtime, view.entity, f) ? "k-visually-hidden" : undefined}
            data-k-field={`${view.entity}.${f}`}
          >
            {fieldLabel(runtime, view.entity, f)}
          </dt>
          <dd data-k-value>
            <FieldValue runtime={runtime} entity={view.entity} fieldKey={f} value={record[f]} />
          </dd>
        </div>
      ))}
    </dl>
  );

  // The other actions. With a primary action at the bottom they are secondary — "Plan it", "Cooked
  // it" — and wait after the record's sections, so what the page is read for comes first.
  const actionBar = (
    <>
      {/* The app's first action is the one filled button (unless a primary action is on the cover);
          its other actions sit beside it, plain. Edit and Delete are behind "More actions", Delete
          last and styled as the one thing you might regret — never inline next to the thing you came
          to do (#111). */}
      <div className="k-detail-actions">
        {actions.map((a, ai) => (
          <button
            key={ai}
            type="button"
            className={`k-add${fillFirst && ai === 0 ? " k-primary-action" : ""}`}
            onClick={() => runDetailAction(a)}
            data-k-wording={typeof a === "string" ? undefined : true}
          >
            {actionGlyph(a) ? (
              <>
                <Glyph icon={actionGlyph(a)} size={16} />{" "}
              </>
            ) : null}
            {actionLabel(a)}
          </button>
        ))}
        {/* No app action at all: Edit is the one thing to do here, so it is the filled button. */}
        {!actions.length && onEdit ? (
          <button
            type="button"
            className={`k-add${fillFirst ? " k-primary-action" : ""}`}
            aria-disabled={locked ? true : undefined}
            onClick={() => (locked ? explain() : onEdit(view.entity, id))}
          >
            <span aria-hidden>✎ </span>
            <Trans>Edit</Trans>
          </button>
        ) : null}
        {!people ? null : locked ? (
          // Edit and Delete are all this menu holds; someone else's record offers neither, so the
          // menu is inactive rather than a list of things that would each refuse.
          <button type="button" className="k-menu-btn" aria-label={t`More actions`} aria-disabled onClick={explain}>
            ⋯
          </button>
        ) : (
          <ActionMenu
            label={t`More actions`}
            title={label}
            entries={[
              ...(actions.length && onEdit ? [{ key: "edit", label: t`Edit`, icon: "pencil", onSelect: () => onEdit(view.entity, id) } as MenuEntry] : []),
              ...(actions.length && onEdit ? ["separator" as const] : []),
              { key: "delete", label: t`Delete`, icon: "trash-2", danger: true, onSelect: () => void onDelete() },
            ]}
          />
        )}
      </div>
    </>
  );

  return (
    <article className="k-detail" data-cover={cover === "none" ? "none" : pictured ? cover : "band"}>
      {behind ? (
        // Behind the whole page, held in view while it scrolls: the sections read over it.
        <span className="k-detail-backdrop" aria-hidden>
          {coverUrl ? <img src={coverUrl} alt="" decoding="async" draggable={false} /> : null}
        </span>
      ) : null}
      <header className="k-detail-hero">
        {pictured && !behind ? (
          <span className="k-detail-photo" aria-hidden>
            {coverUrl ? <img src={coverUrl} alt="" decoding="async" draggable={false} /> : null}
          </span>
        ) : null}
        <div className="k-detail-hero-body">
          {cover === "none" ? null : (
            <span className="k-detail-kicker" data-k-wording>
              {entityDef?.icon ? (
                <>
                  <Glyph icon={entityDef.icon} size={16} />{" "}
                </>
              ) : null}
              {entityDef?.label ?? humanizeKey(view.entity)}
            </span>
          )}
          <h2 className="k-detail-title">{label}</h2>
          <Facts runtime={runtime} entity={view.entity} record={record} keys={view.facts ?? defaultFacts(entityDef, record)} />
        </div>
      </header>
      {view.primaryAction ? null : actionBar}
      <div className="k-detail-sections">
        {visibleGroups.map((group, si) =>
          (group.collapsible || group.collapsed) && group.title ? (
            // A section that folds (#108): the heading is the button, the fold is remembered per page
            // on this device, and a section that is one list says how many rows it holds.
            <section key={si} className="k-section k-section-fold">
              <Fold
                variant="section"
                storageKey={foldKey(runtime.definition.id, pageId, `section:${group.title}`)}
                title={group.title}
                count={sectionCount(runtime, view.entity, group, record)}
                collapsible
                initiallyOpen={!group.collapsed}
              >
                {fieldsOf(group)}
              </Fold>
            </section>
          ) : (
            <section key={si} className="k-section">
              {group.title ? <h3 data-k-wording>{group.title}</h3> : null}
              {fieldsOf(group)}
            </section>
          ),
        )}
      </div>
      {view.primaryAction ? actionBar : null}
      {view.primaryAction ? (
        <div className="k-primary-bar">
          <button type="button" className="k-cta" onClick={() => runDetailAction(view.primaryAction!)} data-k-wording={typeof view.primaryAction === "string" ? undefined : true}>
            {actionGlyph(view.primaryAction) ? (
              <span className="k-cta-icon" aria-hidden>
                <Glyph icon={actionGlyph(view.primaryAction)} size={20} />
              </span>
            ) : null}
            <span>{actionLabel(view.primaryAction)}</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}

/** The cover's chips: an option in its own colour; anything else as its value with a quiet label. */
function Facts({ runtime, entity, record, keys }: { runtime: BuiltinViewProps["runtime"]; entity: string; record: Resolved; keys: string[] }) {
  const facts = keys.filter((k) => !isBlank(record[k]));
  if (!facts.length) return null;
  const def = runtime.definition.entities[entity];
  return (
    <ul className="k-facts">
      {facts.map((k) => {
        const field = def?.fields[k] as { type?: string; colors?: Record<string, string> } | undefined;
        const text = formatValue(shownValue(runtime, entity, k, record[k]));
        if (field?.type === "enum") {
          return (
            <li key={k} className="k-fact" data-tinted="true" {...enumSwatch({ colors: field.colors }, String(record[k]))} data-k-value>
              {text}
            </li>
          );
        }
        return (
          <li key={k} className="k-fact">
            <span className="k-fact-label" data-k-field={`${entity}.${k}`}>
              {fieldLabel(runtime, entity, k)}
            </span>{" "}
            <span data-k-value>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Without `facts`: the entity's enum fields that have a value — "Easy", "Lunch" — up to three. */
function defaultFacts(entity: { fields: Record<string, { type?: string }> } | undefined, record: Resolved): string[] {
  if (!entity) return [];
  return Object.entries(entity.fields)
    .filter(([k, f]) => f.type === "enum" && !isBlank(record[k]))
    .map(([k]) => k)
    .slice(0, DEFAULT_FACTS);
}

/** Nothing to show: no value, an empty string, an empty list. `false` and `0` are values. */
export function isBlank(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** A field whose value is a block (a list, long text, pictures, a place) takes the section's whole width. */
function wideField(runtime: BuiltinViewProps["runtime"], entity: string, key: string): boolean {
  const field = runtime.definition.entities[entity]?.fields[key] as { type?: string; multiline?: boolean } | undefined;
  if (!field) return false;
  return field.type === "list" || field.type === "media" || field.type === "geo" || field.type === "file" || field.type === "richtext" || (field.type === "text" && field.multiline === true);
}

/** How many rows a section holds, when the section is a single list field; otherwise no count. */
function sectionCount(runtime: BuiltinViewProps["runtime"], entity: string, group: ResolvedGroup, record: Resolved): number | undefined {
  if (group.fields.length !== 1) return undefined;
  const field = runtime.definition.entities[entity]?.fields[group.fields[0]!];
  if (field?.type !== "list") return undefined;
  const value = record[group.fields[0]!];
  return Array.isArray(value) ? value.length : 0;
}

function mapDetailNav(param: Record<string, string> | undefined, record: Resolved): Record<string, string> {
  if (!param) return {};
  const out: Record<string, string> = {};
  for (const [target, sourceKey] of Object.entries(param)) out[target] = String(record[sourceKey] ?? "");
  return out;
}
