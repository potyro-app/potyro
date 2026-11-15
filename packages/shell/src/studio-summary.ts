// What a version's card says changed, written by the host from the app itself (#72).
//
// A person made an app in four turns and was told "Made “Wine Cellar”.", "Applied 1 edit.",
// "Applied 6 edits.", "Applied 3 edits.": the turn that added the button they had asked for never
// said so. A count of edits says nothing to someone who does not read code, and asking the model
// harder is an instruction, not a mechanism. So the host compares the app before and after — pages,
// the buttons on them, filters, the kinds of record and their fields — and says each difference in
// the app's own words, with where to find it. What the model itself said still leads; a host line
// is left out only when the model's words already name the same things.
//
// Pure: definitions in, sentences out. The engine (studio-engine.ts) loads the definitions.

import { plural, t } from "@lingui/core/macro";
import { fmt } from "@potyro/i18n";
import { guideSteps, humanizeKey, localize, pickLanguage, type AppDefinition, type Language, type Localized } from "potyro";
import { NEEDS_PLATFORM, withoutAssumed } from "@potyro/generator/agent";
import { withoutNotDone } from "@potyro/generator/backends";

/** The parts of an app a card speaks of, its words already in the person's language. */
export type Described = Localized<Pick<AppDefinition, "name" | "pages" | "entities" | "quickActions" | "guide">>;

/** A loaded app as the card describes it: its words in the first of `prefs` it carries, else its own. */
export function describedIn(app: AppDefinition, prefs: readonly Language[]): Described {
  return localize(app, pickLanguage(prefs, app));
}

/** One sentence of the host's, and the app's words it names (`names`) — what the model's prose is checked for. */
export interface ChangeLine {
  text: string;
  names: string[];
}

interface Named {
  key: string;
  label: string;
  /** Everything declared about it but its label and its functions: a difference is a change. */
  shape?: string;
}

interface Difference {
  added: Named[];
  removed: Named[];
  renamed: Array<[was: Named, now: Named]>;
  changed: Named[];
}

type DescribedPage = Described["pages"][number];
type DescribedEntity = Described["entities"][string];

const pageTitle = (p: DescribedPage): string => (typeof p.title === "string" && p.title.trim() ? p.title : humanizeKey(p.id));

/** A page's buttons have no id: they are known by what they say. */
const pageButtons = (p: DescribedPage): Named[] => (p.actions ?? []).map((a) => ({ key: a.label, label: a.label }));

function pageFilters(p: DescribedPage): Named[] {
  const views: unknown[] = [p.view, ...(p.layout?.items ?? []).map((i) => i.view)];
  const seen = new Map<string, Named>();
  for (const view of views) {
    const filters = (view as { filters?: Array<{ label: string; param: string }> } | undefined)?.filters;
    for (const f of filters ?? []) if (!seen.has(f.param)) seen.set(f.param, { key: f.param, label: f.label });
  }
  return [...seen.values()];
}

const entityLabel = (key: string, e: DescribedEntity | undefined): string => e?.label || humanizeKey(key);

const recordButtons = (e: DescribedEntity): Named[] =>
  Object.entries(e.actions ?? {}).map(([key, a]) => ({ key, label: (typeof a === "object" && a.label) || humanizeKey(key) }));

const fieldsOf = (e: DescribedEntity): Named[] =>
  Object.entries(e.fields ?? {}).map(([key, f]) => {
    const { label, ...rest } = f as { label?: string } & Record<string, unknown>;
    return { key, label: label || humanizeKey(key), shape: JSON.stringify(rest) };
  });

const quickButtons = (d: Described): Named[] => (d.quickActions ?? []).map((q) => ({ key: q.id, label: q.label }));

/** `byWords`: the things are known only by what they say, so one gone and one new is a rename. */
function difference(before: Named[], after: Named[], byWords = false): Difference {
  const was = new Map(before.map((n) => [n.key, n]));
  const now = new Map(after.map((n) => [n.key, n]));
  const out: Difference = { added: after.filter((n) => !was.has(n.key)), removed: before.filter((n) => !now.has(n.key)), renamed: [], changed: [] };
  for (const n of after) {
    const old = was.get(n.key);
    if (!old) continue;
    if (old.label !== n.label) out.renamed.push([old, n]);
    else if (old.shape !== n.shape) out.changed.push(n);
  }
  if (byWords && out.added.length === 1 && out.removed.length === 1) {
    out.renamed.push([out.removed[0]!, out.added[0]!]);
    out.added = [];
    out.removed = [];
  }
  return out;
}

/** An app's word as the card writes it; each language has its own quotation marks. */
export const quoted = (word: string): string => t({ message: `“${word}”`, comment: "A word of the person's app quoted in a sentence of Potyro's: use this language's quotation marks" });

const listed = (things: readonly Named[]): string => fmt.list(things.map((n) => quoted(n.label)));

const labels = (things: readonly Named[], ...also: string[]): string[] => [...things.map((n) => n.label), ...also];

/**
 * What is different between two versions of an app, a sentence per place, most findable first: its
 * name, pages, the buttons on them, the app's main buttons, each record's buttons, filters, then fields.
 * Empty when nothing a person would look for differs — a change to how something is worked out.
 */
export function describeChange(before: Described, after: Described): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const say = (text: string, names: string[]): void => void lines.push({ text, names });
  const renames = (d: Difference, sentence: (was: string, now: string) => string, ...also: string[]): void => {
    for (const [was, now] of d.renamed) say(sentence(quoted(was.label), quoted(now.label)), [now.label, ...also]);
  };

  if (before.name !== after.name && after.name) {
    const now = quoted(after.name);
    say(t`The app is now called ${now}.`, [after.name]);
  }

  // Pages. One that is hidden is reached from a row, not from the app's pages: its coming is not news.
  const pages = difference(
    before.pages.map((p) => ({ key: p.id, label: pageTitle(p) })),
    after.pages.filter((p) => !p.hidden || before.pages.some((b) => b.id === p.id)).map((p) => ({ key: p.id, label: pageTitle(p) })),
  );
  if (pages.added.length) {
    const names = listed(pages.added);
    say(plural(pages.added.length, { one: `New page: ${names}.`, other: `New pages: ${names}.` }), labels(pages.added));
  }
  if (pages.removed.length) {
    const names = listed(pages.removed);
    say(plural(pages.removed.length, { one: `Removed the page ${names}.`, other: `Removed the pages ${names}.` }), labels(pages.removed));
  }
  renames(pages, (was, now) => t`The page ${was} is now called ${now}.`);

  const kept = after.pages.flatMap((p) => {
    const old = before.pages.find((b) => b.id === p.id);
    return old ? [{ old, now: p, title: pageTitle(p), page: quoted(pageTitle(p)) }] : [];
  });

  for (const { old, now, title, page } of kept) {
    const d = difference(pageButtons(old), pageButtons(now), true);
    if (d.added.length) {
      const names = listed(d.added);
      say(plural(d.added.length, { one: `New on the ${page} page: a ${names} button.`, other: `New on the ${page} page: the buttons ${names}.` }), labels(d.added, title));
    }
    if (d.removed.length) {
      const names = listed(d.removed);
      say(
        plural(d.removed.length, { one: `Removed from the ${page} page: the ${names} button.`, other: `Removed from the ${page} page: the buttons ${names}.` }),
        labels(d.removed, title),
      );
    }
    renames(d, (was, to) => t`On the ${page} page, ${was} is now called ${to}.`, title);
  }

  const quick = difference(quickButtons(before), quickButtons(after));
  if (quick.added.length) {
    const names = listed(quick.added);
    say(t`New among the app’s main buttons: ${names}.`, labels(quick.added));
  }
  if (quick.removed.length) {
    const names = listed(quick.removed);
    say(t`Removed from the app’s main buttons: ${names}.`, labels(quick.removed));
  }
  renames(quick, (was, now) => t`Among the app’s main buttons, ${was} is now called ${now}.`);

  const kinds = Object.keys(after.entities).filter((k) => !after.entities[k]!.hidden);
  const newKinds = kinds.filter((k) => !(k in before.entities)).map((k) => ({ key: k, label: entityLabel(k, after.entities[k]) }));
  if (newKinds.length) {
    const names = listed(newKinds);
    say(t`The app now also keeps: ${names}.`, labels(newKinds));
  }
  const both = kinds.flatMap((k) => {
    const old = before.entities[k];
    const label = entityLabel(k, after.entities[k]);
    return old ? [{ old, now: after.entities[k]!, label, entity: quoted(label) }] : [];
  });

  for (const { old, now, label, entity } of both) {
    const d = difference(recordButtons(old), recordButtons(now));
    if (d.added.length) {
      const names = listed(d.added);
      say(
        plural(d.added.length, { one: `New on each record of ${entity}: a ${names} button.`, other: `New on each record of ${entity}: the buttons ${names}.` }),
        labels(d.added, label),
      );
    }
    if (d.removed.length) {
      const names = listed(d.removed);
      say(
        plural(d.removed.length, { one: `Removed from the records of ${entity}: the ${names} button.`, other: `Removed from the records of ${entity}: the buttons ${names}.` }),
        labels(d.removed, label),
      );
    }
    renames(d, (was, to) => t`In ${entity}, ${was} is now called ${to}.`, label);
  }

  for (const { old, now, title, page } of kept) {
    const d = difference(pageFilters(old), pageFilters(now));
    if (d.added.length) {
      const names = listed(d.added);
      say(plural(d.added.length, { one: `New on the ${page} page: a ${names} filter.`, other: `New on the ${page} page: the filters ${names}.` }), labels(d.added, title));
    }
    if (d.removed.length) {
      const names = listed(d.removed);
      say(
        plural(d.removed.length, { one: `Removed from the ${page} page: the ${names} filter.`, other: `Removed from the ${page} page: the filters ${names}.` }),
        labels(d.removed, title),
      );
    }
    renames(d, (was, to) => t`On the ${page} page, ${was} is now called ${to}.`, title);
  }

  for (const { old, now, label, entity } of both) {
    const d = difference(fieldsOf(old), fieldsOf(now));
    if (d.added.length) {
      const names = listed(d.added);
      say(plural(d.added.length, { one: `New in ${entity}: a ${names} field.`, other: `New in ${entity}: the fields ${names}.` }), labels(d.added, label));
    }
    if (d.removed.length) {
      const names = listed(d.removed);
      say(plural(d.removed.length, { one: `Removed from ${entity}: the ${names} field.`, other: `Removed from ${entity}: the fields ${names}.` }), labels(d.removed, label));
    }
    if (d.changed.length) {
      const names = listed(d.changed);
      say(plural(d.changed.length, { one: `Changed in ${entity}: the ${names} field.`, other: `Changed in ${entity}: the fields ${names}.` }), labels(d.changed, label));
    }
    renames(d, (was, to) => t`In ${entity}, ${was} is now called ${to}.`, label);
  }

  // The app's own guide (#80): that it changed, and where it is read — never the steps again.
  const [guideWas, guideNow] = [guideSteps(before.guide), guideSteps(after.guide)];
  if (guideWas.join("\n") !== guideNow.join("\n")) {
    const menu = t({ message: "How to use it", comment: "App menu: the app's own short guide, the steps to use it" });
    const entry = quoted(menu);
    if (!guideWas.length) say(t`The app now has a guide: ${entry}, in its menu.`, [menu]);
    else if (!guideNow.length) say(t`The app no longer has a guide.`, [menu]);
    else say(t`Its guide (${entry}, in the app’s menu) is updated to match.`, [menu]);
  }
  return lines;
}

/** The button a page puts first: its frequent action, else the one that adds, else its first. */
function firstButton(app: Described, p: DescribedPage): string | null {
  const at = (i: number | undefined): string | null => (i === undefined ? null : (p.actions?.[i]?.label ?? null));
  if (typeof p.primaryAction === "string") return app.quickActions?.find((q) => q.id === p.primaryAction)?.label ?? null;
  return at(p.primaryAction) ?? at(p.add) ?? at(p.actions?.length ? 0 : undefined);
}

/**
 * A new app, said as what it is and the first thing to do in it (#72): its name, its pages, and
 * how to use it — the app's own guide (#80), else the button to start with: one of its main buttons,
 * else the first page's own.
 */
export function describeNewApp(app: Described): string {
  const name = app.name;
  const out = [t`Made “${name}”.`];
  const pages = app.pages.filter((p) => !p.hidden);
  if (pages.length > 1) {
    const names = fmt.list(pages.map((p) => quoted(pageTitle(p))));
    out.push(plural(pages.length, { one: `It has one page: ${names}.`, other: `It has # pages: ${names}.` }));
  }
  const main = app.quickActions?.[0]?.label;
  const withButton = pages.map((p) => ({ p, label: firstButton(app, p) })).find((x) => x.label);
  // The app says how it is used itself (#80): its own steps, in place of the host's guess at a first tap.
  const steps = guideSteps(app.guide);
  if (steps.length) {
    const numbered = steps.map((step, i) => `${i + 1}. ${step}`).join(" ");
    out.push(t`How to use it: ${numbered}`);
  } else if (main) {
    const button = quoted(main);
    out.push(t`To start, tap ${button}.`);
  } else if (withButton) {
    const button = quoted(withButton.label!);
    const page = quoted(pageTitle(withButton.p));
    out.push(t`To start, tap ${button} on the ${page} page.`);
  } else if (app.quickActions === undefined && pages[0]) {
    // No buttons of its own: the app's add button makes the first record.
    const page = quoted(pageTitle(pages[0]));
    out.push(t`To start, add your first entry on the ${page} page.`);
  }
  return out.join(" ");
}

/**
 * The model's own explanation as a card shows it: one paragraph, without the `Not done:` list (said
 * on its own, after), without the `Assumed:` list (shown under it, each guess to tap, #75) and without
 * the lines addressed to the loop.
 */
export function proseForCard(rationale: string | undefined): string {
  if (!rationale) return "";
  return withoutAssumed(withoutNotDone(rationale))
    .split("\n")
    .filter((line) => !line.replace(/^[\s*`_]+/, "").startsWith(NEEDS_PLATFORM))
    .join(" ")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What the card says: the model's words first, then each of the host's sentences its words do not
 * already cover — one is covered when the prose names everything the sentence names.
 */
export function explainChange(prose: string, lines: readonly ChangeLine[]): string {
  const said = prose.toLocaleLowerCase();
  const covered = (line: ChangeLine): boolean => said !== "" && line.names.every((n) => said.includes(n.toLocaleLowerCase()));
  return [prose, ...lines.filter((l) => !covered(l)).map((l) => l.text)].filter(Boolean).join(" ");
}
