// Does this app survive two people using it at once?
//
// `smoke.ts` runs an app single-user: it seeds records and forces every computed, binding, action,
// reminder and custom view to execute. That catches hallucinated `ctx` calls. It cannot catch
// anything about sharing, because there is only ever one writer.
//
// The first app shared in a public test had TWO independent concurrency defects and neither threw,
// warned, or looked like anything (`docs/17-concurrency-hazards.md`). A single-user gate is blind to
// that entire class by construction.
//
// ## The idea
//
// Run each action from BOTH peers at the same moment, then look at the wreckage. The checks below
// need no knowledge of what the app means — no notion of shopping lists, quantities or ordering.
// That is the point: a check that must be told what to look for can only find hazards someone
// already thought of, and the whole problem is that nobody thinks of them in advance.
//
// ## The one that makes this work
//
// **An action whose effect accumulates when run twice in a ROW must also accumulate when run twice
// AT ONCE.** Run it sequentially twice and measure; run it concurrently twice and measure; compare.
//
// Measuring against a single run would flag every toggle and every "set to a fixed value" action,
// because those legitimately do not accumulate. Measuring sequential-vs-concurrent asks the only
// question that matters — *did concurrency change the outcome?* — and asks it of the app's own
// semantics rather than an assumption about them.

import type { AppDefinition } from "karta";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { createPeerPair, type PeerPair, type Store } from "@karta/store";

const UI: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const NAV: NavBridge = { navigate: () => {} };

/** One thing that goes wrong when two people act at once. */
export interface Hazard {
  kind: "lost-update" | "fused-key" | "divergence" | "corrupt-number";
  entity: string;
  /** The action that provoked it, where one did. */
  action?: string;
  field?: string;
  detail: string;
}

export interface ConcurrencyResult {
  hazards: Hazard[];
  /** Counts, so "nothing found" is distinguishable from "nothing ran". */
  ran: { entities: number; actions: number; pairs: number };
  /** Setup failures — an app that could not be exercised at all, not a clean bill of health. */
  errors: string[];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runtimeFor(app: AppDefinition & { id: string }, store: Store): Promise<KartaRuntime> {
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui: UI, nav: NAV });
}

/** Numeric fields of a record, which is what accumulation and corruption are visible in. */
function numbers(row: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row ?? {})) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

/** Every row's value for one field, by id — the shape both halves of the fusion check need. */
function byId(rows: Record<string, unknown>[], field: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const v = r[field];
    if (v !== undefined && v !== null && typeof v !== "object") out.set(String(r.id), String(v));
  }
  return out;
}

/** Fields whose value is unique across every row — the ones an app may be using to order or key. */
function uniqueFields(rows: Record<string, unknown>[]): string[] {
  if (rows.length < 2) return [];
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  return [...keys].filter((k) => {
    const vals = rows.map((r) => r[k]).filter((v) => v !== undefined && v !== null);
    if (vals.length !== rows.length) return false;
    if (vals.some((v) => typeof v === "object")) return false;
    return new Set(vals.map((v) => String(v))).size === rows.length;
  });
}

/**
 * Two rows that collided onto a value THAT ALREADY EXISTED IN THE COLUMN.
 *
 * The distinction that makes this check worth having, and it took a false positive to find. Two rows
 * arriving at the same *new* value — two plants watered in the same second, both set to `now()` — is
 * a tie, not corruption, and flagging it would train everyone to ignore the gate.
 *
 * A value that was already in the column and is now on two rows is different: a key MOVED and
 * landed on top of another. That is a swap losing half of itself, and it is unrecoverable, because
 * swapping two equal values changes nothing.
 *
 * The first attempt required the shared value to have been on one of the two colliding rows. Wrong:
 * a real three-row swap fused rows 1 and 3 onto row 2's value, and the check stayed silent.
 */
function fusedPairs(
  before: Map<string, string>,
  after: Map<string, string>,
): Array<{ ids: [string, string]; value: string }> {
  const existed = new Set(before.values());
  const out: Array<{ ids: [string, string]; value: string }> = [];
  const ids = [...after.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [x, y] = [ids[i]!, ids[j]!];
      const shared = after.get(x);
      if (shared === undefined || shared !== after.get(y)) continue;
      if (before.get(x) === before.get(y)) continue; // already equal — this run did not fuse them
      if (!existed.has(shared)) continue; // a brand-new value on both: a tie, not a collision
      out.push({ ids: [x, y], value: shared });
    }
  }
  return out;
}

/**
 * Exercise an app with two peers and report what breaks.
 *
 * `seed` creates the records to act on — passed in rather than derived here, so this shares the
 * single-user harness's seeding rather than inventing a second, differently-wrong one.
 */
export async function concurrencySmoke(
  app: AppDefinition & { id: string },
  seed: (runtime: KartaRuntime) => Promise<Record<string, string[]>>,
): Promise<ConcurrencyResult> {
  let pair: PeerPair | null = null;
  try {
    pair = await createPeerPair(app.id);
  } catch (e) {
    return { hazards: [], ran: { entities: 0, actions: 0, pairs: 0 }, errors: [`could not start two peers: ${message(e)}`] };
  }
  try {
    return await concurrencyChecks({
      app,
      pair,
      runA: await runtimeFor(app, pair.a),
      runB: await runtimeFor(app, pair.b),
      seed,
    });
  } catch (e) {
    return { hazards: [], ran: { entities: 0, actions: 0, pairs: 1 }, errors: [message(e)] };
  } finally {
    await pair.close().catch(() => {});
  }
}

export interface ConcurrencyDeps {
  app: AppDefinition & { id: string };
  pair: PeerPair;
  runA: KartaRuntime;
  runB: KartaRuntime;
  seed: (runtime: KartaRuntime) => Promise<Record<string, string[]>>;
}

/**
 * The checks themselves, over two runtimes someone else composed.
 *
 * Split out because the shell runs these in a BROWSER against its own composition root, and the
 * alternative — rebuilding the host wiring here for a second time — is how two code paths end up
 * testing subtly different things.
 */
export async function concurrencyChecks({ app, pair, runA, runB, seed }: ConcurrencyDeps): Promise<ConcurrencyResult> {
  const hazards: Hazard[] = [];
  const errors: string[] = [];
  const ran = { entities: 0, actions: 0, pairs: 1 };

  {
    const created = await seed(runA);
    await pair.settle();

    for (const [entity, def] of Object.entries(app.entities)) {
      const ids = created[entity] ?? [];
      if (!ids.length) continue;
      ran.entities++;

      for (const action of Object.keys(def.actions ?? {})) {
        const id = ids[0]!;
        ran.actions++;

        // ---- 1. does this action accumulate at all? Run it twice IN A ROW. ----
        const before = numbers(await pair.a.get(entity, id));
        let sequential: Record<string, number>;
        try {
          await runA.runAction(entity, action, id);
          await runA.runAction(entity, action, id);
          await pair.settle();
          sequential = numbers(await pair.a.get(entity, id));
        } catch (e) {
          errors.push(`${entity}.${action}: ${message(e)}`);
          continue;
        }
        const accumulates = Object.keys(before).filter(
          (f) => sequential[f] !== undefined && sequential[f] !== before[f] && Math.abs(sequential[f]! - before[f]!) > 1e-9,
        );

        // ---- 2. the same two runs, AT ONCE, from two devices ----
        const fresh = ids[1] ?? ids[0]!;
        const base = numbers(await pair.a.get(entity, fresh));
        try {
          await Promise.all([runA.runAction(entity, action, fresh), runB.runAction(entity, action, fresh)]);
        } catch (e) {
          errors.push(`${entity}.${action} (concurrent): ${message(e)}`);
          continue;
        }
        await pair.settle(600);
        const concurrent = numbers(await pair.a.get(entity, fresh));

        for (const f of accumulates) {
          const seqDelta = sequential[f]! - before[f]!;
          const conDelta = (concurrent[f] ?? base[f]!) - base[f]!;
          // Twice in a row moved it by X; twice at once moved it by half. One person's press is gone.
          if (Math.abs(conDelta) + 1e-9 < Math.abs(seqDelta)) {
            hazards.push({
              kind: "lost-update",
              entity,
              action,
              field: f,
              detail:
                `run twice in a row, \`${f}\` moves by ${seqDelta}; run twice at once it moves by ` +
                `${conDelta}. One of the two is silently discarded — the field is read, changed and ` +
                `written back, which last-write-wins cannot make safe.`,
            });
          }
        }

        // ---- 3. numbers that stopped being numbers ----
        const after = (await pair.a.get(entity, fresh)) ?? {};
        for (const f of Object.keys(base)) {
          const v = (after as Record<string, unknown>)[f];
          if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) {
            hazards.push({
              kind: "corrupt-number",
              entity,
              action,
              field: f,
              detail: `\`${f}\` held ${base[f]} and now holds ${JSON.stringify(v)} — arithmetic on a missing value writes NaN, which JSON stores as null.`,
            });
          }
        }
      }

      // ---- 4. did concurrent activity fuse two rows onto one key? ----
      const rowsBefore = (await pair.a.all(entity)) as unknown as Record<string, unknown>[];
      const wasUnique = uniqueFields(rowsBefore);
      // Every pair of rows reordered from both sides at once — the shape that fused two rows in the
      // wild. Actions are the app's own; this drives them through the same records from both peers.
      for (const action of Object.keys(def.actions ?? {})) {
        if (ids.length < 2) break;
        // DIFFERENT records from the two devices, at the same moment. Both devices acting on the
        // SAME record is the obvious conflict and mostly harmless for a swap — it is idempotent.
        // The damage comes from two neighbouring rows being moved at once, each device computing
        // from a view of the order that the other is halfway through changing.
        for (let i = 1; i < ids.length; i++) {
          await Promise.all([
            runA.runAction(entity, action, ids[i]!).catch(() => {}),
            runB.runAction(entity, action, ids[i - 1]!).catch(() => {}),
          ]);
          await pair.settle(200);
        }
      }
      await pair.settle(600);
      const rowsAfter = (await pair.a.all(entity)) as unknown as Record<string, unknown>[];
      for (const f of wasUnique) {
        const fused = fusedPairs(byId(rowsBefore, f), byId(rowsAfter, f));
        if (!fused.length) continue;
        hazards.push({
          kind: "fused-key",
          entity,
          field: f,
          detail:
            `\`${f}\` was unique across every row; after two devices acted at once, ${fused.length} pair(s) ` +
            `collided on a value one of them already held (${fused[0]!.value}). That is a swap losing ` +
            `half of itself, and it is unrecoverable: no later swap can separate two equal keys, so a ` +
            `"move" on those rows does nothing, permanently.`,
        });
      }

      // ---- 5. do both devices even agree? ----
      const seenByA = JSON.stringify((await pair.a.all(entity)).map((r) => r.id).sort());
      const seenByB = JSON.stringify((await pair.b.all(entity)).map((r) => r.id).sort());
      if (seenByA !== seenByB) {
        hazards.push({
          kind: "divergence",
          entity,
          detail: "the two devices do not hold the same set of records. That is a store defect, not an app one.",
        });
      }
    }
  }

  return { hazards, ran, errors };
}

/** True when two people can use this app without silently destroying each other's work. */
export function concurrencyPassed(r: ConcurrencyResult): boolean {
  return r.hazards.length === 0 && r.errors.length === 0 && r.ran.actions > 0;
}
