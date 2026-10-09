// Does a generated app survive being changed three times, and what did finding out cost?
//
// `run-eval.ts` measures generation: one prompt, one app, no data, no history. Every failure that has
// actually reached a user came from the step after that — changing an app that already holds their
// records — and those failures are invisible to a structural gate. The app compiles, validates,
// renders, and then either loses the data or silently does nothing.
//
// So this runs the real loop: generate, PUT RECORDS IN IT, modify, migrate, check; three times over,
// each modification applied to whatever the last one produced.
//
// ## What is checked, and why these five
//
// 1. WORKS — compiles, validates, and `smokeApp` runs every computed, filter, action, binding and
//    custom view without throwing. The existing bar.
// 2. RECORDS SURVIVED — every record that existed before the modification is still STORED. Checked
//    against the store rather than through a query, because that is the difference between "the app
//    still lists it" and "it is still there".
// 3. VALUES SURVIVED — every stored FIELD VALUE is still what it was, or a migration step in the
//    chain that actually ran accounts for the change. This is the check `reachableIds` cannot make:
//    a record keeps its place on the list screen and loses its notes, and reachability calls that a
//    pass. See `data-safety.ts`.
// 4. STILL REACHABLE — every surviving record can still be got to from some page. Stored and
//    unreachable is a product failure too; it is simply a different one.
// 5. NOTHING EMPTIED — no page filtered every seeded record away. This is how "validates and does
//    nothing" shows itself: a group page that can never match, a count stuck at 0/0.
//
// Plus THE FEATURE APPEARED, where a scenario supplies `expect` — behavioural, name-agnostic, and
// the only check here that reads on intent rather than on damage.
//
// A model never judges the result. Every number below is mechanical, which is the point: this exists
// to answer whether the product is reliable, and an answer produced by asking a model whether a
// model did well would not be worth having. Where a check genuinely cannot decide — a chain that ran
// a `transform`, an unattributable value change — the verdict is `review` and a person fills in
// `humanScore`. A blank field somebody has to complete is more honest than a pass nobody earned.
//
// ## The repair loop mirrors the PRODUCT, not the harness's convenience
//
// The Studio repairs a structurally-invalid app once, automatically, before the user sees anything
// (`withGen` in studio.tsx). So exactly one repair is included here, per stage. Measuring without it
// would report failures nobody experiences; measuring with more would report a reliability the
// product does not offer.
//
// ## Every call is accounted for
//
// This corpus is paid for by the call. Each step records what was sent, what came back, how long it
// took, and what the backend said it cost — or `null`, meaning nobody knows, never an estimate. The
// run stops gracefully when a `CallBudget` limit is reached and reports what it had, because a
// partial answer to "is this safe" is worth a great deal and an unbounded bill is not.

import type { AppDefinition, Id, Migration, Resolved } from "potyro";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { MemoryStore, migrationChain, type Store } from "@potyro/store";
import type { ModelBackend } from "./backend.js";
import { loadApp, scoreSource } from "./score.js";
import { smokeApp, seedRecords, paramsForPage } from "./smoke.js";
import type { AssertContext, ModifyScenario } from "./modify-scenarios.js";
import {
  compareData,
  entitiesToRead,
  snapshotData,
  type DataSafetyReport,
  type DataSnapshot,
} from "./data-safety.js";
import { CallBudget, callModel, type ModelCall } from "./model-call.js";

const UI: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const NAV: NavBridge = { navigate: () => {} };

/**
 * `clean` — every mechanical check passed.
 * `review` — nothing failed outright, but something could not be decided without a person.
 * `failed` — a check failed: invalid source, a throw, an emptied page, a lost record, a missed feature.
 */
export type StepVerdict = "clean" | "review" | "failed";

/** A human's score for one modification, per the review rubric. Null until somebody fills it in. */
export interface HumanReview {
  /** 0 broken/unrelated · 1 runs but misses the request · 2 usable with gaps · 3 genuinely good. */
  score: 0 | 1 | 2 | 3 | null;
  note: string;
}

const BLANK_REVIEW = (): HumanReview => ({ score: null, note: "" });

export interface StepResult {
  /** 1-based position in the chain. */
  index: number;
  instruction: string;
  /** The source this modification was applied TO. */
  sourceBefore: string;
  /** The source it produced, or null when it never produced a valid one. */
  sourceAfter: string | null;
  /** The invalid source the repair was given, when one ran. See `CallOutcome.rejected`. */
  rejectedSource?: string;
  /** Every model call this step made, in order: the modify, then the repair if one was needed. */
  calls: ModelCall[];
  /** Needed the one auto-repair the product performs. */
  repaired: boolean;
  /** Compiles + validates. */
  valid: boolean;
  /** What the validator said, before the repair. */
  validationErrors: string[];
  /** What it still said afterwards. Empty when no repair ran, or when the repair worked. */
  remainingErrors: string[];
  /** `smokeApp` ran everything without throwing. */
  works: boolean;
  runtimeErrors: string[];
  /** Pages that filtered every record away. */
  emptyPages: string[];
  /** Every record present before this modification is still STORED. */
  recordsSurvived: boolean;
  /** Every record present before is still reachable from some page. */
  stillReachable: boolean;
  /** Ids that stopped being reachable. The interesting half of a `stillReachable: false`. */
  unreachableIds: string[];
  /** The value-level comparison. Null when the step never got far enough to migrate. */
  data: DataSafetyReport | null;
  /** Reasons the scenario's own assertion failed. Absent when it declares none. */
  featureFailures?: string[];
  verdict: StepVerdict;
  /** Why the verdict is not `clean`, in words, so the review sheet reads without the raw JSON. */
  findings: string[];
  human: HumanReview;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface GenerationResult {
  calls: ModelCall[];
  source: string | null;
  repaired: boolean;
  /** The invalid first draft, when the repair ran. See `CallOutcome.rejected`. */
  rejectedSource?: string;
  errors: string[];
}

export interface ScenarioRun {
  scenario: string;
  attempt: number;
  /** The app the person asked for, verbatim — the first half of what this run is a test of. */
  request: string;
  /** The initial generation. A failure here means the modifications were never reached. */
  generated: boolean;
  generation: GenerationResult;
  /** How many modifications the scenario asked for. `steps.length` is short of it when a chain stopped. */
  plannedSteps: number;
  steps: StepResult[];
  /** Why the chain ended early, or null when it ran to the end. */
  stoppedBecause: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface CallTotals {
  total: number;
  generate: number;
  modify: number;
  repair: number;
  failed: number;
}

export interface UsageTotals {
  /** null when NO call reported it. A partial total would read as a complete one. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** Calls whose cost the backend never reported. While non-zero, `costUsd` is a floor. */
  unmeteredCalls: number;
  /** True when every call reported a cost — i.e. a monetary ceiling was actually enforceable. */
  costEnforceable: boolean;
}

export interface ModifyReport {
  backend: string;
  /** Model ids the backend named, when it named any. Empty means it did not say. */
  models: string[];
  runs: ScenarioRun[];
  calls: CallTotals;
  usage: UsageTotals;
  totals: {
    scenarios: number;
    /** Chains where the app generated AND every modification left it clean. */
    chainsFullyClean: number;
    modifications: number;
    valid: number;
    works: number;
    recordsSurvived: number;
    valuesSurvived: number;
    stillReachable: number;
    noEmptyPages: number;
    needsReview: number;
    /** Of the modifications carrying an assertion, how many demonstrably did the thing. */
    featureChecked: number;
    featurePassed: number;
  };
  /** Why the run stopped, when a budget limit ended it. */
  stoppedBecause: string | null;
  /** True when a limit cut the run short: the numbers describe less than was asked for. */
  partial: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Build a runtime over a store that already holds records. */
async function runtimeFor(app: AppDefinition & { id: string }, store: Store): Promise<PotyroRuntime> {
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui: UI, nav: NAV });
}

/** Every record id currently reachable from any page, which is the only reachability a person has. */
async function reachableIds(runtime: PotyroRuntime, def: AppDefinition): Promise<Set<string>> {
  const seen = new Set<string>();
  // A first record per entity, so a page reached by navigation can be given the param it needs.
  const firstOf = new Map<string, Record<string, unknown>>();
  for (const entity of Object.keys(def.entities ?? {})) {
    try {
      const rows = (await runtime.ctx.query(entity)) as Resolved[];
      if (rows[0]) firstOf.set(entity, rows[0] as unknown as Record<string, unknown>);
    } catch {
      // Unreadable entity: its records simply do not count as reachable.
    }
  }

  for (const page of def.pages ?? []) {
    const view = page.view as { param?: string; entity?: string } | undefined;
    // A detail page shows exactly one record; the list pages are what decide whether a record is
    // findable at all. Everything else is queried WITH its navigation params, because "reachable"
    // means a person can get there, and they get there by tapping a row.
    if (view?.param) continue;
    try {
      const params = paramsForPage(def, page.id, {}, (e) => firstOf.get(e));
      const { rows } = await runtime.queryPage(page.id, params);
      for (const row of rows) if (typeof row.id === "string") seen.add(row.id);
    } catch {
      // A page that throws is already reported by `works`; it contributes no reachability.
    }
  }
  return seen;
}

/**
 * Bring a store's data up to a new definition, exactly as the shell does on load.
 *
 * Uses `migrationChain` from @potyro/store — the same walk `migrateOnLoad` performs — so a migration
 * that would not run in the product does not run here either. A harness that migrated more
 * willingly than the product would report a data-survival rate nobody gets.
 *
 * Returns the chain it ran, because the value-level comparison needs to know what the app DECLARED
 * it was going to do before it can call a change intended or unexplained.
 */
async function migrate(store: Store, def: AppDefinition, fromVersion: string | null): Promise<Migration[]> {
  const chain = migrationChain(def.migrations ?? [], fromVersion);
  if (!chain.length) return chain;
  await store.runMigrations({
    fromAppVersion: fromVersion,
    toAppVersion: def.version,
    fromSchemaVersion: await store.storedSchemaVersion(),
    toSchemaVersion: def.schemaVersion,
    migrations: chain,
  });
  return chain;
}

function assertContext(runtime: PotyroRuntime, def: AppDefinition, before: AppDefinition): AssertContext {
  return {
    definition: def,
    before,
    query: (entity) => runtime.ctx.query(entity) as Promise<Resolved[]>,
    page: async (pageId, params) => (await runtime.queryPage(pageId, params ?? {})).rows,
    entities: Object.keys(def.entities ?? {}),
    pages: (def.pages ?? []).map((p) => p.id),
    display: async (pageId) => {
      const out: string[] = [];
      try {
        const { rows, ctx } = await runtime.queryPage(pageId, {});
        for (const row of rows) {
          for (const path of ["display.primary", "display.secondary"] as const) {
            const v = await runtime.resolveBinding({ kind: "view", page: pageId, path }, row, ctx);
            if (v != null) out.push(String(v));
          }
        }
      } catch {
        // A page that throws is already reported by `works`; it renders nothing here.
      }
      return out;
    },
  };
}

/**
 * Give a newly-added entity some records, and put existing records into it.
 *
 * Without this the harness measures its own omission. Ask for "todo lists" and the modification adds
 * a `list` entity that nothing has ever created a row of — so the list page is empty, the per-list
 * count is 0/0, and both look exactly like the bug this eval exists to detect. A person who asks for
 * lists then makes one and puts things in it, so the harness does too.
 *
 * Only NEW entities are seeded. Re-seeding the originals would bury the records whose survival is
 * the thing being measured — and this runs strictly AFTER the value snapshot for the same reason:
 * it patches existing records, and a harness that compared values across its own writes would
 * report itself as the data loss.
 */
async function seedAddedEntities(
  runtime: PotyroRuntime,
  def: AppDefinition,
  known: Set<string>,
): Promise<void> {
  const added = Object.keys(def.entities ?? {}).filter((e) => !known.has(e));
  if (!added.length) return;

  const createdIds = new Map<string, Id[]>();
  for (const name of added) {
    const fields = def.entities[name]?.fields ?? {};
    const ids: Id[] = [];
    for (let i = 0; i < 2; i++) {
      const data: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) {
        const f = field as { type?: string; required?: boolean };
        if (f.type === "text") data[key] = `${name} ${i + 1}`;
        else if (f.type === "number") data[key] = i + 1;
        else if (f.type === "boolean") data[key] = false;
      }
      try {
        const rec = await runtime.create(name, data);
        ids.push(rec.id as Id);
      } catch {
        // A required field the harness cannot invent. Reported through the checks, not here.
      }
    }
    createdIds.set(name, ids);
  }

  // Put half of every existing entity's records into the first new record it can point at — the
  // "and then I moved some todos into it" half of the request.
  for (const [name, entity] of Object.entries(def.entities ?? {})) {
    if (added.includes(name)) continue;
    for (const [key, field] of Object.entries(entity.fields ?? {})) {
      const f = field as { type?: string; to?: string; many?: boolean };
      if (f.type !== "relation" || !f.to || !createdIds.get(f.to)?.length) continue;
      const target = createdIds.get(f.to)![0]!;
      let rows: Resolved[] = [];
      try {
        rows = (await runtime.ctx.query(name)) as Resolved[];
      } catch {
        continue;
      }
      for (const row of rows.slice(0, Math.ceil(rows.length / 2))) {
        try {
          await runtime.ctx.patch(name, row.id as Id, { [key]: f.many ? [target] : target });
        } catch {
          // Same as above: a failure here shows up as a feature/empty-page finding.
        }
      }
    }
  }
}

interface CallOutcome {
  source: string | null;
  calls: ModelCall[];
  repaired: boolean;
  /** What the validator said about the FIRST answer. */
  errors: string[];
  /** What it still said after the repair. Empty when none ran, or when the repair worked. */
  remaining: string[];
  /**
   * The invalid source the repair was handed.
   *
   * Kept because "source before and after every model call" includes the repair call, and reviewing
   * a repair without seeing what it was repairing tells you nothing about whether it was a good one.
   */
  rejected?: string;
}

/**
 * One model call plus, if the source does not validate, the ONE repair the product allows.
 *
 * Returns the calls it made either way — a repair that failed still cost what it cost.
 */
async function callWithRepair(
  backend: ModelBackend,
  budget: CallBudget,
  first: Parameters<typeof callModel>[1],
  prompt: { id: string; description: string },
): Promise<CallOutcome> {
  const calls: ModelCall[] = [];
  if (!budget.canSpend()) return { source: null, calls, repaired: false, errors: [], remaining: [] };

  const attempt = await callModel(backend, first);
  calls.push(attempt.call);
  budget.record(attempt.call);
  if (attempt.source === null) {
    return { source: null, calls, repaired: false, errors: [attempt.call.error ?? "the model call failed"], remaining: [] };
  }

  const score = await scoreSource(attempt.source);
  if (score.validates) return { source: attempt.source, calls, repaired: false, errors: [], remaining: [] };
  if (!backend.repair || !budget.canSpend()) {
    return { source: attempt.source, calls, repaired: false, errors: score.errors, remaining: score.errors };
  }

  const fix = await callModel(backend, { kind: "repair", source: attempt.source, errors: score.errors, prompt });
  calls.push(fix.call);
  budget.record(fix.call);
  if (fix.source === null) {
    return { source: attempt.source, calls, repaired: true, errors: score.errors, remaining: score.errors };
  }
  const rescored = await scoreSource(fix.source);
  return {
    source: fix.source,
    calls,
    repaired: true,
    errors: score.errors,
    remaining: rescored.validates ? [] : rescored.errors,
    rejected: attempt.source,
  };
}

/** Generate the app, then walk its modifications. One model call per step, plus at most one repair. */
export async function runModifyScenario(
  backend: ModelBackend,
  scenario: ModifyScenario,
  attempt: number,
  budget: CallBudget = new CallBudget(),
): Promise<ScenarioRun> {
  const prompt = { id: scenario.id, description: scenario.description };
  const steps: StepResult[] = [];
  const chainStarted = Date.now();
  const done = (generated: boolean, generation: GenerationResult, stoppedBecause: string | null): ScenarioRun => ({
    scenario: scenario.id,
    attempt,
    request: scenario.description,
    generated,
    generation,
    plannedSteps: scenario.mods.length,
    steps,
    stoppedBecause,
    startedAt: new Date(chainStarted).toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - chainStarted,
  });

  const gen = await callWithRepair(backend, budget, { kind: "generate", prompt }, prompt);
  const generation: GenerationResult = {
    calls: gen.calls,
    source: gen.source,
    repaired: gen.repaired,
    ...(gen.rejected === undefined ? {} : { rejectedSource: gen.rejected }),
    errors: gen.remaining.length ? gen.remaining : gen.errors,
  };
  if (!gen.source) return done(false, generation, budget.stopReason ?? "the app never generated");

  let source = gen.source;
  let app: Awaited<ReturnType<typeof loadApp>>;
  try {
    app = await loadApp(source);
  } catch (e) {
    generation.errors = [...generation.errors, message(e)];
    return done(false, generation, "the generated source does not load");
  }

  // A store that persists ACROSS the modifications, holding records seeded from the first version —
  // which is the whole point. A fresh store per step would make every migration a no-op and every
  // data-loss failure invisible.
  const store = new MemoryStore();
  await store.open(scenario.id);
  let runtime = await runtimeFor(app as never, store);
  await seedRecords(app as never, runtime);
  let version: string = (app as unknown as AppDefinition).version;
  let knownEntities = new Set(Object.keys((app as unknown as AppDefinition).entities ?? {}));
  // Every entity name the store might hold rows under — which is NOT the same as the entities the
  // current definition declares. A modification that renames a table without a migration leaves
  // rows behind under the old key; keeping the name here means the next step is still watching
  // them, instead of losing sight of the data at the exact moment it went astray.
  let storedEntities = new Set(knownEntities);

  for (const [i, mod] of scenario.mods.entries()) {
    if (budget.stopReason) return done(true, generation, budget.stopReason);

    const beforeDef = app as unknown as AppDefinition;
    const stepStarted = Date.now();
    const step: StepResult = {
      index: i + 1,
      instruction: mod.instruction,
      sourceBefore: source,
      sourceAfter: null,
      calls: [],
      repaired: false,
      valid: false,
      validationErrors: [],
      remainingErrors: [],
      works: false,
      runtimeErrors: [],
      emptyPages: [],
      recordsSurvived: false,
      stillReachable: false,
      unreachableIds: [],
      data: null,
      verdict: "failed",
      findings: [],
      human: BLANK_REVIEW(),
      startedAt: new Date(stepStarted).toISOString(),
      endedAt: new Date(stepStarted).toISOString(),
      durationMs: 0,
    };
    let stop: string | null = null;

    try {
      const reachableBefore = await reachableIds(runtime, beforeDef);
      const dataBefore: DataSnapshot = await snapshotData(store, storedEntities);

      const out = await callWithRepair(
        backend,
        budget,
        { kind: "modify", source, instruction: mod.instruction, prompt },
        prompt,
      );
      step.calls = out.calls;
      step.repaired = out.repaired;
      step.validationErrors = out.errors;
      step.remainingErrors = out.remaining;
      if (out.rejected !== undefined) step.rejectedSource = out.rejected;

      // A budget that ran out BEFORE the call means nothing was attempted. Recording a failed step
      // for it would put a spending decision into the failure rate, where it would be read as the
      // model getting something wrong.
      if (!out.calls.length && budget.stopReason) return done(true, generation, budget.stopReason);

      if (!out.source || out.remaining.length) {
        step.findings.push(out.source ? "the source does not validate" : "the model call failed");
        stop = out.source ? "the source does not validate" : (budget.stopReason ?? "the model call failed");
      } else {
        step.valid = true;
        source = out.source;
        step.sourceAfter = out.source;

        const nextApp = await loadApp(source);
        const nextDef = nextApp as unknown as AppDefinition;
        const ran = await migrate(store, nextDef, version);
        version = nextDef.version;
        app = nextApp;

        // Snapshot the stored values NOW — after the migration, before the harness seeds anything
        // of its own. See `seedAddedEntities`.
        const readable = entitiesToRead(dataBefore, nextDef, ran);
        storedEntities = new Set(readable);
        const dataAfter = await snapshotData(store, readable);
        step.data = compareData({
          before: dataBefore,
          after: dataAfter,
          chain: ran,
          beforeDef,
          afterDef: nextDef,
        });
        step.recordsSurvived = step.data.lostRecords.length === 0;

        runtime = await runtimeFor(app as never, store);
        await seedAddedEntities(runtime, nextDef, knownEntities);
        knownEntities = new Set(Object.keys(nextDef.entities ?? {}));

        const reachableAfter = await reachableIds(runtime, nextDef);
        step.unreachableIds = [...reachableBefore].filter((id) => !reachableAfter.has(id));
        step.stillReachable = step.unreachableIds.length === 0;

        // Smoke runs against its OWN store — it seeds a clean one — so it answers "does this app
        // work", separately from "did this app keep the data it was given".
        const smoke = await smokeApp(nextApp as never);
        step.works = smoke.errors.length === 0;
        step.runtimeErrors = smoke.errors;
        step.emptyPages = smoke.emptyPages;

        if (mod.expect) step.featureFailures = await mod.expect(assertContext(runtime, nextDef, beforeDef));

        if (!step.recordsSurvived) {
          stop = `${step.data.lostRecords.length} record(s) are no longer stored`;
        }
      }
    } catch (e) {
      step.runtimeErrors.push(message(e));
      stop ??= "the harness could not evaluate this step";
    }

    scoreStep(step);
    step.endedAt = new Date().toISOString();
    step.durationMs = Date.now() - stepStarted;
    steps.push(step);
    if (stop) return done(true, generation, stop);
  }

  return done(true, generation, budget.stopReason);
}

/** Turn a step's measurements into a verdict and a list of findings a person can read. */
function scoreStep(step: StepResult): void {
  const findings = step.findings;
  if (!step.valid) {
    if (step.remainingErrors.length) findings.push(...step.remainingErrors.slice(0, 3));
  } else {
    if (!step.works) findings.push(`throws: ${step.runtimeErrors.slice(0, 2).join(" | ")}`);
    if (!step.recordsSurvived) {
      findings.push(`${step.data?.lostRecords.length ?? 0} record(s) no longer stored`);
    }
    if (!step.stillReachable) findings.push(`${step.unreachableIds.length} record(s) unreachable from any page`);
    if (step.emptyPages.length) findings.push(`page(s) show nothing: ${step.emptyPages.join(", ")}`);
    for (const removed of step.data?.removedFields ?? []) {
      findings.push(
        removed.explained
          ? `field ${removed.entity}.${removed.field} removed (${removed.explained})`
          : `field ${removed.entity}.${removed.field} removed with nothing declaring it`,
      );
    }
    for (const entity of step.data?.removedEntities ?? []) findings.push(`entity ${entity} holds no records now`);
    for (const orphan of step.data?.orphanedFields ?? []) {
      findings.push(
        `${orphan.entity}.${orphan.field} still holds values on ${orphan.records} record(s) but the app no longer declares it`,
      );
    }
    if (step.data?.unexplained.length) {
      findings.push(`${step.data.unexplained.length} field value(s) changed with nothing declaring it`);
    }
    if (step.data?.opaqueTransform) {
      findings.push("the migration ran a `transform`, so no value change can be attributed mechanically");
    }
    if (step.featureFailures?.length) findings.push(...step.featureFailures);
  }

  const failed =
    !step.valid ||
    !step.works ||
    !step.recordsSurvived ||
    !step.stillReachable ||
    step.emptyPages.length > 0 ||
    (step.featureFailures?.length ?? 0) > 0;
  step.verdict = failed ? "failed" : step.data && step.data.verdict !== "ok" ? "review" : "clean";
}

export interface RunModifyOptions {
  attempts?: number;
  budget?: CallBudget;
  onProgress?: (run: ScenarioRun) => void;
}

export async function runModifyEval(
  backend: ModelBackend,
  scenarios: ModifyScenario[],
  opts?: RunModifyOptions,
): Promise<ModifyReport> {
  const attempts = opts?.attempts ?? 1;
  const budget = opts?.budget ?? new CallBudget();
  const runs: ScenarioRun[] = [];
  const started = Date.now();

  outer: for (let attempt = 1; attempt <= attempts; attempt++) {
    for (const scenario of scenarios) {
      if (budget.stopReason) break outer;
      const run = await runModifyScenario(backend, scenario, attempt, budget);
      runs.push(run);
      opts?.onProgress?.(run);
    }
  }

  return summarize(backend.name, runs, budget, started);
}

/** Sum a nullable counter across calls: null when nobody reported it, a total when somebody did. */
function sumNullable(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/**
 * Fold a set of runs into the report.
 *
 * Exported because the runner writes a report from runs it drove itself (so it can stream progress
 * and write artifacts per chain) and must not compute the totals a second, differently-wrong way.
 */
export function summarize(
  backend: string,
  runs: ScenarioRun[],
  budget: CallBudget,
  startedMs: number,
): ModifyReport {
  const steps = runs.flatMap((r) => r.steps);
  const calls = [...runs.flatMap((r) => r.generation.calls), ...steps.flatMap((s) => s.calls)];
  const checked = steps.filter((s) => s.featureFailures !== undefined);

  return {
    backend,
    models: [...new Set(calls.map((c) => c.model).filter((m): m is string => m !== null))],
    runs,
    calls: {
      total: calls.length,
      generate: calls.filter((c) => c.kind === "generate").length,
      modify: calls.filter((c) => c.kind === "modify").length,
      repair: calls.filter((c) => c.kind === "repair").length,
      failed: calls.filter((c) => c.failed).length,
    },
    usage: {
      inputTokens: sumNullable(calls.map((c) => c.inputTokens)),
      outputTokens: sumNullable(calls.map((c) => c.outputTokens)),
      costUsd: sumNullable(calls.map((c) => c.costUsd)),
      unmeteredCalls: calls.filter((c) => c.costUsd === null).length,
      costEnforceable: calls.length > 0 && calls.every((c) => c.costUsd !== null),
    },
    totals: {
      scenarios: runs.length,
      // Against what the SCENARIO asked for, not a hardcoded three: a chain that stopped after one
      // modification has one clean step and is not a clean chain.
      chainsFullyClean: runs.filter(
        (r) => r.generated && r.steps.length === r.plannedSteps && r.steps.every((s) => s.verdict === "clean"),
      ).length,
      modifications: steps.length,
      valid: steps.filter((s) => s.valid).length,
      works: steps.filter((s) => s.works).length,
      recordsSurvived: steps.filter((s) => s.recordsSurvived).length,
      valuesSurvived: steps.filter((s) => s.data?.verdict === "ok").length,
      stillReachable: steps.filter((s) => s.stillReachable).length,
      noEmptyPages: steps.filter((s) => s.valid && !s.emptyPages.length).length,
      needsReview: steps.filter((s) => s.verdict === "review").length,
      featureChecked: checked.length,
      featurePassed: checked.filter((s) => (s.featureFailures ?? []).length === 0).length,
    },
    stoppedBecause: budget.stopReason,
    partial: budget.stopReason !== null,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  };
}
