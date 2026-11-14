// What a person reads when an action fails (#76).
//
// An action is the app's code, and it fails for three kinds of reason (the host sorts them,
// `actionFailure` in packages/host/src/app-error.ts):
//
//   refused  a write the app's own field does not take — an AI read "Cabernet Sauvignon" off a label
//            and the app tried to store it under a Grape that lists eight others. Said here in the
//            person's language, naming the field and the kind of thing by the app's own labels, and
//            what the field does take
//   said     words the app threw for the person ("Pick a photo first"): shown as they are
//   broke    a bug, or a call that ran out of time: one plain sentence. What exactly broke is in the
//            console and in what the Studio hears, never in front of the person
//
// Nothing here mentions how the app is run. A toast used to begin "realm app error:".

import { t } from "@lingui/core/macro";
import type { ActionFailure } from "@potyro/host";
import { formatMoney, humanizeKey, plainWords, type AppDefinition, type Field, type Localized, type ValueIssue } from "potyro";
import { fmt, i18n, intlLocale } from "@potyro/i18n";

/** More choices than this are not read out in a toast: the form shows them. */
const CHOICES_SAID = 8;

const labelOf = (field: Field | undefined, key: string): string => (field?.label === undefined ? humanizeKey(key) : plainWords(field.label) || humanizeKey(key));

/** An enum's options as the app shows them (`labels`), in the app's language. */
function choices(field: Field | undefined, options: readonly string[]): string[] {
  const labels = field?.type === "enum" || field?.type === "tags" ? field.labels : undefined;
  return options.map((o) => (labels?.[o] === undefined ? o : plainWords(labels[o]) || o));
}

/** The sentence for one broken rule. `field` is the name to say; `declared` the field it is about. */
function ruleWords(issue: Exclude<ValueIssue, { rule: "row" }>, field: string, declared: Field | undefined): string {
  switch (issue.rule) {
    case "options": {
      const all = choices(declared, issue.options);
      if (!all.length || all.length > CHOICES_SAID) {
        return t({ message: `Not saved: ${field} takes one of its listed choices.`, comment: "An app's button tried to save a value its field does not accept. {field} is the field's name in the app, e.g. “Grape (Wine)”" });
      }
      const list = fmt.list(all, { type: "disjunction" });
      return t({ message: `Not saved: ${field} takes ${list}.`, comment: "{field} is a field's name in the app, e.g. “Grape (Wine)”; {list} is its choices, already joined: “Malbec, Merlot or Syrah”" });
    }
    case "text":
      return t({ message: `Not saved: ${field} takes text.`, comment: "{field} is a field's name in the app, e.g. “Notes (Wine)”" });
    case "number":
      return t({ message: `Not saved: ${field} takes a number.`, comment: "{field} is a field's name in the app, e.g. “Year (Wine)”" });
    case "whole":
      return t({ message: `Not saved: ${field} takes a whole number.`, comment: "{field} is a field's name in the app, e.g. “Bottles (Wine)”" });
    case "amount":
      return t({ message: `Not saved: ${field} takes an amount of money.`, comment: "{field} is a field's name in the app, e.g. “Price (Wine)”" });
    case "min": {
      const bound = issue.currency === undefined ? fmt.number(issue.bound) : formatMoney(issue.bound, issue.currency, intlLocale(i18n.locale));
      return t({ message: `Not saved: ${field} takes ${bound} or more.`, comment: "{field} is a field's name in the app; {bound} is the smallest number or amount it accepts" });
    }
    case "max": {
      const bound = issue.currency === undefined ? fmt.number(issue.bound) : formatMoney(issue.bound, issue.currency, intlLocale(i18n.locale));
      return t({ message: `Not saved: ${field} takes ${bound} or less.`, comment: "{field} is a field's name in the app; {bound} is the largest number or amount it accepts" });
    }
    case "yesNo":
      return t({ message: `Not saved: ${field} takes yes or no.`, comment: "{field} is a field's name in the app, e.g. “Opened (Wine)”" });
    case "tags":
      return t({ message: `Not saved: ${field} takes a list of tags.`, comment: "{field} is a field's name in the app, e.g. “Tags (Wine)”" });
    case "date":
      return t({ message: `Not saved: ${field} takes a date.`, comment: "{field} is a field's name in the app, e.g. “Bought (Wine)”" });
    case "place":
      return t({ message: `Not saved: ${field} takes a place.`, comment: "{field} is a field's name in the app, e.g. “Vineyard (Wine)”" });
    case "media":
      return t({ message: `Not saved: ${field} takes a photo or a file.`, comment: "{field} is a field's name in the app, e.g. “Label (Wine)”" });
    case "file":
      return t({ message: `Not saved: ${field} takes a file of this app.`, comment: "{field} is a field's name in the app, e.g. “Sheet (Song)”" });
    case "record":
      return issue.many
        ? t({ message: `Not saved: ${field} takes entries of this app.`, comment: "{field} is a field's name in the app that links to several other entries, e.g. “Pairings (Wine)”" })
        : t({ message: `Not saved: ${field} takes an entry of this app.`, comment: "{field} is a field's name in the app that links to one other entry, e.g. “Cellar (Wine)”" });
    case "person":
    case "member":
      return issue.many
        ? t({ message: `Not saved: ${field} takes people in this app.`, comment: "{field} is a field's name in the app that names several people the app is shared with, e.g. “Tasters (Wine)”" })
        : t({ message: `Not saved: ${field} takes someone in this app.`, comment: "{field} is a field's name in the app that names one person the app is shared with, e.g. “Bought by (Wine)”" });
    case "list":
      return t({ message: `Not saved: ${field} takes a list.`, comment: "{field} is a field's name in the app, e.g. “Tastings (Wine)”" });
  }
}

/**
 * A failed action as one sentence for the person, in Potyro's language and the app's labels.
 * `definition` is the app as it is shown (localized), so a label is already in the app's language.
 */
export function failureWords(failure: ActionFailure, definition: Localized<AppDefinition>): string {
  if (failure.kind === "said") return failure.message;
  if (failure.kind === "broke") return t`That did not work`;
  const entityDef = definition.entities[failure.refusal.entity];
  let declared: Field | undefined = entityDef?.fields?.[failure.refusal.field];
  // A field the app does not declare cannot have been refused by its rule: say the plain sentence.
  if (!entityDef || !declared) return t`That did not work`;
  let field = labelOf(declared, failure.refusal.field);
  let issue = failure.refusal.issue;
  // A cell of a list is named through the list — “Tastings › Score” — and held to its own rule.
  while (issue.rule === "row") {
    const sub: Field | undefined = declared?.type === "list" ? declared.of[issue.key] : undefined;
    field = `${field} › ${labelOf(sub, issue.key)}`;
    declared = sub;
    issue = issue.issue;
  }
  const entity = entityDef.label === undefined ? "" : plainWords(entityDef.label);
  const named = entity
    ? t({ message: `${field} (${entity})`, comment: "How a field is named when something could not be saved: the field's name, then the kind of thing it belongs to, e.g. “Grape (Wine)”" })
    : field;
  return ruleWords(issue, named, declared);
}
