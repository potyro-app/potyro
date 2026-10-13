// What the views read (#302): the app's definition as `runtime.definition` hands it over —
// localized, every `Words` slot already its string in the person's language. Views never pick a
// language themselves; these are the definition's own types with that guarantee spelled out.

import type { DurationField, EntityDef, EnumField, Field, LayoutItem, ListField, Localized, MoneyField, NumberField, StatItem, SummaryValue, TagsField } from "potyro";

export type ShownField = Localized<Field>;
export type ShownEntity = Localized<EntityDef>;
export type ShownEnumField = Localized<EnumField>;
export type ShownTagsField = Localized<TagsField>;
export type ShownListField = Localized<ListField>;
export type ShownMoneyField = Localized<MoneyField>;
export type ShownNumberField = Localized<NumberField>;
export type ShownDurationField = Localized<DurationField>;
export type ShownStatItem = Localized<StatItem>;
export type ShownSummaryValue = Localized<SummaryValue>;
export type ShownLayoutItem = Localized<LayoutItem>;

/**
 * What an enum or tags option reads as: its `labels` entry, else the option itself. Records store
 * the option, so this is the only place an option turns into words.
 */
export function optionLabel(field: { labels?: Readonly<Record<string, string>> } | null | undefined, option: string): string {
  return field?.labels?.[option] ?? option;
}
