// The plan contract: what `plan.json` must look like, and a checker the app runs before it trusts a
// plan — the built-in one at build time (test) and any file loaded later from inside the app.
//
// No imports on purpose: the shell bundles it from the app package's `src/` (#258), where `potyro`,
// `react` and the package's own modules resolve. The validation is written by hand because Zod never
// enters an app bundle.

/** A link on a block: an inline `{ title, url }`, or a pointer into `plan.resources`. */
export interface PlanLink {
  title?: string;
  url?: string;
  resource?: string;
}

/** What one block says this week: the exercise text and where to go for it. */
export interface BlockContent {
  text: string;
  links?: PlanLink[];
}

/** One of the daily blocks, in session order. */
export interface PlanBlock {
  id: string;
  label: string;
  minutes: number;
  /** The generic description from the plan's session table ("Next 1–2 pages of the method book"). */
  source?: string;
}

export interface PlanResource {
  id: string;
  title: string;
  url: string;
  kind?: string;
  why?: string;
  when?: string;
}

/**
 * One row of a phase table. Called a week even when it spans several (`spanWeeks`): advancing is by
 * goal, so a row is the unit you finish or repeat. Blocks not named here inherit the previous row's.
 */
export interface PlanWeek {
  id: string;
  label: string;
  spanWeeks?: number;
  blocks: Record<string, BlockContent>;
  doneWhen: string;
}

export interface PlanPhase {
  id: string;
  title: string;
  span?: string;
  goal: string;
  notes?: string[];
  weeks: PlanWeek[];
}

/** A module week only overrides the blocks it names; the others follow the main plan. */
export interface ModuleWeek {
  id: string;
  blocks: Record<string, BlockContent>;
  doneWhen: string;
}

export interface PlanModule {
  id: string;
  title: string;
  intro?: string;
  /** The main-plan week from which this module makes sense. A soft warning before it. */
  availableFrom?: string;
  /** How long people usually spend in it: [min, max] weeks. */
  suggestedWeeks?: [number, number];
  weeks: ModuleWeek[];
  notes?: string[];
}

export interface Plan {
  id: string;
  title: string;
  version: string;
  rules?: string[];
  blocks: PlanBlock[];
  restDay: { text: string };
  reviewDay: { label: string; text: string };
  resources: PlanResource[];
  phases: PlanPhase[];
  modules: PlanModule[];
}

export type PlanCheck = { ok: true; plan: Plan } | { ok: false; errors: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isId = (x: unknown): x is string => isStr(x) && /^[a-z0-9][a-z0-9-]*$/i.test(x);

/**
 * Check an unknown value against the contract above. Every problem is reported by path, so a plan
 * written by hand can be fixed in one pass rather than one error at a time.
 */
export function validatePlan(input: unknown): PlanCheck {
  const errors: string[] = [];
  const fail = (path: string, msg: string): void => {
    errors.push(`${path}: ${msg}`);
  };
  if (!isObj(input)) return { ok: false, errors: ["plan: must be an object"] };
  const p = input;

  for (const k of ["id", "title", "version"]) if (!isStr(p[k])) fail(k, "required text");
  if (p.rules !== undefined && !(Array.isArray(p.rules) && p.rules.every(isStr))) fail("rules", "must be a list of text");
  if (!isObj(p.restDay) || !isStr(p.restDay.text)) fail("restDay.text", "required text");
  if (!isObj(p.reviewDay) || !isStr(p.reviewDay.label) || !isStr(p.reviewDay.text)) fail("reviewDay", "needs label and text");

  // ---- blocks ----
  const blockIds = new Set<string>();
  if (!Array.isArray(p.blocks) || p.blocks.length === 0) fail("blocks", "at least one block");
  else {
    p.blocks.forEach((b, i) => {
      const at = `blocks[${i}]`;
      if (!isObj(b)) return fail(at, "must be an object");
      if (!isId(b.id)) fail(`${at}.id`, "required id (letters, digits, dashes)");
      else if (blockIds.has(b.id)) fail(`${at}.id`, `duplicate block id "${b.id}"`);
      else blockIds.add(b.id);
      if (!isStr(b.label)) fail(`${at}.label`, "required text");
      if (typeof b.minutes !== "number" || !(b.minutes > 0)) fail(`${at}.minutes`, "must be a positive number");
    });
  }

  // ---- resources ----
  const resourceIds = new Set<string>();
  if (!Array.isArray(p.resources)) fail("resources", "must be a list");
  else {
    p.resources.forEach((r, i) => {
      const at = `resources[${i}]`;
      if (!isObj(r)) return fail(at, "must be an object");
      if (!isId(r.id)) fail(`${at}.id`, "required id");
      else if (resourceIds.has(r.id)) fail(`${at}.id`, `duplicate resource id "${r.id}"`);
      else resourceIds.add(r.id);
      if (!isStr(r.title)) fail(`${at}.title`, "required text");
      if (!isStr(r.url) || !/^https?:\/\//.test(r.url)) fail(`${at}.url`, "must be an http(s) URL");
    });
  }

  const checkBlocks = (at: string, blocks: unknown, requireAll: boolean): void => {
    if (!isObj(blocks)) return fail(at, "must be an object keyed by block id");
    for (const [key, content] of Object.entries(blocks)) {
      const here = `${at}.${key}`;
      if (!blockIds.has(key)) fail(here, `unknown block id "${key}"`);
      if (!isObj(content) || !isStr(content.text)) {
        fail(here, "needs text");
        continue;
      }
      if (content.links === undefined) continue;
      if (!Array.isArray(content.links)) {
        fail(`${here}.links`, "must be a list");
        continue;
      }
      content.links.forEach((l, j) => {
        const lat = `${here}.links[${j}]`;
        if (!isObj(l)) return fail(lat, "must be an object");
        if (isStr(l.resource)) {
          if (!resourceIds.has(l.resource)) fail(lat, `unknown resource "${l.resource}"`);
        } else if (!isStr(l.title) || !isStr(l.url) || !/^https?:\/\//.test(l.url)) {
          fail(lat, "needs { resource } or { title, url }");
        }
      });
    }
    if (requireAll) for (const id of blockIds) if (!(id in blocks)) fail(`${at}.${id}`, "the first week must say what every block does");
  };

  // ---- phases and weeks ----
  const weekIds = new Set<string>();
  if (!Array.isArray(p.phases) || p.phases.length === 0) fail("phases", "at least one phase");
  else {
    let first = true;
    p.phases.forEach((ph, i) => {
      const at = `phases[${i}]`;
      if (!isObj(ph)) return fail(at, "must be an object");
      if (!isId(ph.id)) fail(`${at}.id`, "required id");
      if (!isStr(ph.title)) fail(`${at}.title`, "required text");
      if (!isStr(ph.goal)) fail(`${at}.goal`, "required text");
      if (ph.notes !== undefined && !(Array.isArray(ph.notes) && ph.notes.every(isStr))) fail(`${at}.notes`, "must be a list of text");
      if (!Array.isArray(ph.weeks) || ph.weeks.length === 0) return fail(`${at}.weeks`, "at least one week");
      ph.weeks.forEach((w, j) => {
        const wat = `${at}.weeks[${j}]`;
        if (!isObj(w)) return fail(wat, "must be an object");
        if (!isId(w.id)) fail(`${wat}.id`, "required id");
        else if (weekIds.has(w.id)) fail(`${wat}.id`, `duplicate week id "${w.id}"`);
        else weekIds.add(w.id);
        if (!isStr(w.label)) fail(`${wat}.label`, "required text");
        if (w.spanWeeks !== undefined && !(Number.isInteger(w.spanWeeks) && (w.spanWeeks as number) >= 1)) fail(`${wat}.spanWeeks`, "must be a whole number ≥ 1");
        if (!isStr(w.doneWhen)) fail(`${wat}.doneWhen`, "required text");
        checkBlocks(`${wat}.blocks`, w.blocks, first);
        first = false;
      });
    });
  }

  // ---- modules ----
  if (!Array.isArray(p.modules)) fail("modules", "must be a list (may be empty)");
  else {
    const moduleIds = new Set<string>();
    p.modules.forEach((m, i) => {
      const at = `modules[${i}]`;
      if (!isObj(m)) return fail(at, "must be an object");
      if (!isId(m.id)) fail(`${at}.id`, "required id");
      else if (moduleIds.has(m.id)) fail(`${at}.id`, `duplicate module id "${m.id}"`);
      else moduleIds.add(m.id);
      if (!isStr(m.title)) fail(`${at}.title`, "required text");
      if (m.availableFrom !== undefined && !(isStr(m.availableFrom) && weekIds.has(m.availableFrom))) fail(`${at}.availableFrom`, "must name a week id");
      if (m.suggestedWeeks !== undefined) {
        const s = m.suggestedWeeks;
        if (!(Array.isArray(s) && s.length === 2 && s.every((n) => Number.isInteger(n) && n >= 1) && s[0] <= s[1])) fail(`${at}.suggestedWeeks`, "must be [min, max] whole weeks");
      }
      if (!Array.isArray(m.weeks) || m.weeks.length === 0) return fail(`${at}.weeks`, "at least one week");
      const seen = new Set<string>();
      m.weeks.forEach((w, j) => {
        const wat = `${at}.weeks[${j}]`;
        if (!isObj(w)) return fail(wat, "must be an object");
        if (!isId(w.id)) fail(`${wat}.id`, "required id");
        else if (seen.has(w.id) || weekIds.has(w.id)) fail(`${wat}.id`, `duplicate week id "${w.id}"`);
        else seen.add(w.id);
        if (!isStr(w.doneWhen)) fail(`${wat}.doneWhen`, "required text");
        checkBlocks(`${wat}.blocks`, w.blocks, false);
      });
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, plan: p as unknown as Plan };
}

/** Resolve a link to something clickable; a dangling resource pointer renders as nothing. */
export function resolveLink(plan: Plan, link: PlanLink): { title: string; url: string } | null {
  if (link.resource) {
    const r = plan.resources.find((x) => x.id === link.resource);
    return r ? { title: r.title, url: r.url } : null;
  }
  return link.title && link.url ? { title: link.title, url: link.url } : null;
}

/** The main plan as one ordered sequence of weeks, each knowing its phase. */
export function mainWeeks(plan: Plan): { phase: PlanPhase; week: PlanWeek; index: number }[] {
  const out: { phase: PlanPhase; week: PlanWeek; index: number }[] = [];
  for (const phase of plan.phases) for (const week of phase.weeks) out.push({ phase, week, index: out.length });
  return out;
}

/** The ordinal main-plan week (1-based) a row starts on, counting `spanWeeks`. */
export function startingWeekNumber(plan: Plan, weekId: string): number {
  let n = 1;
  for (const { week } of mainWeeks(plan)) {
    if (week.id === weekId) return n;
    n += week.spanWeeks ?? 1;
  }
  return n;
}

/**
 * Every block's content for a main-plan week: a block the row does not name is inherited from the
 * nearest earlier row that does, so a plan can say "reading continues" by saying nothing.
 */
export function blocksForWeek(plan: Plan, weekId: string): Record<string, BlockContent> {
  const merged: Record<string, BlockContent> = {};
  for (const { week } of mainWeeks(plan)) {
    Object.assign(merged, week.blocks);
    if (week.id === weekId) break;
  }
  return merged;
}
