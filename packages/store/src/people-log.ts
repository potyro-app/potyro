// Placeholder people — "guests" (docs/04 §Guests): the log they live in, and what it adds up to.
//
// A guest is a name someone gave a person who has not joined yet ("Tom"), so a group can be set up
// first. Records name it like a member, by id. When the person joins they CLAIM it, and every record
// naming the guest reads as them from then on — nothing is rewritten, which is what makes it safe
// with copies that are offline, with history, and with `createdBy` (KA-18), which no claim touches.
//
// ## Where it lives
//
// In a shared app, in the space's message log under a reserved thread. That is exactly what this
// needs, already: an append-only map one key per entry (two people adding a guest at once cannot
// collide), an author and a time that come from the signed transaction rather than from anything a
// copy wrote (so "Ana claimed Tom" cannot be written by Tom's phone on Ana's behalf), an order that
// survives wrong clocks (the hybrid clock), and no route from `ctx` — app code changes guests only
// through the host (`ctx.guests`), which applies the rules below before it writes.
//
// In a solo app, in one kv key: there is one writer, this device, so its own word is the author.
// `copyStoreData` carries guests between the two (`copyPeople`), when an app starts or stops syncing.
//
// ## The rules (applied when the log is read, so a copy that wrote past them changes nothing)
//
// - `add` makes a guest; the first add of an id wins, and its author is the guest's creator.
// - `rename` and `remove` take only from the guest's creator or an owner (admin).
// - `claim` says "I am this guest": only for yourself (the author is who is claimed for), only a
//   guest nobody has claimed, and one guest per person — the first claim wins.
// - `link` folds a guest into someone (a member, or another guest — a duplicate "Tom"): only from
//   the guest's creator or an owner, and never into a loop.

import type { Id, Person } from "potyro";
import type { Store, Unsubscribe } from "./types.js";
import { ulid } from "./ulid.js";

/** The thread, in a synced store's message log, that guests ride. Never shown as a conversation. */
export const PEOPLE_THREAD = "potyro:people";
/** A solo store's guests: one kv key, outside `ctx.storage`'s own `kv:` prefix. */
export const PEOPLE_KV = "people:log";
/** Guest ids say what they are, so a stray one is never mistaken for an account. */
export const GUEST_PREFIX = "guest_";
/** The longest name a guest may have. */
export const GUEST_NAME_MAX = 60;
/** Links followed before a chain is called a loop. */
const MAX_HOPS = 16;

/** One change to the guests, as written. */
export type PeopleOpInput =
  | { kind: "add"; guest: Id; name: string }
  | { kind: "rename"; guest: Id; name: string }
  | { kind: "remove"; guest: Id }
  | { kind: "claim"; guest: Id }
  | { kind: "link"; guest: Id; to: Id };

/** One change as read: who made it, and when. `by` is the signing account in a synced store. */
export type PeopleOp = PeopleOpInput & { by: string; at: Date };

export interface GuestEntry {
  id: Id;
  name: string;
  /** Who added it. */
  by: string;
  removed: boolean;
  /** The account that said "this is me". */
  claimedBy?: string;
  /** Folded into someone else by its creator or an owner. */
  linkedTo?: Id;
}

/** What the log adds up to. */
export interface PeopleState {
  guests: ReadonlyMap<Id, GuestEntry>;
}

export const EMPTY_PEOPLE: PeopleState = { guests: new Map() };

export const isGuestId = (id: unknown): id is string => typeof id === "string" && id.startsWith(GUEST_PREFIX);

export function newGuestId(): Id {
  return `${GUEST_PREFIX}${ulid()}`;
}

/** A guest's name, tidied, or why it cannot be one. */
export function cleanGuestName(name: unknown): string {
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!n) throw new Error("A guest needs a name.");
  if (n.length > GUEST_NAME_MAX) throw new Error(`A guest's name is at most ${GUEST_NAME_MAX} characters.`);
  return n;
}

function parseOp(raw: unknown): PeopleOpInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const guest = o.guest;
  if (!isGuestId(guest)) return null;
  switch (o.kind) {
    case "add":
    case "rename":
      return typeof o.name === "string" && o.name.trim() ? { kind: o.kind, guest, name: o.name.trim().slice(0, GUEST_NAME_MAX) } : null;
    case "remove":
    case "claim":
      return { kind: o.kind, guest };
    case "link":
      return typeof o.to === "string" && o.to && o.to !== guest ? { kind: "link", guest, to: o.to } : null;
    default:
      return null;
  }
}

/**
 * Fold the log into who the guests are. `admins` are the app's owners now (a solo app: you). Pure, and
 * the same on every device, because the log is read in one order everywhere.
 */
export function foldPeople(ops: readonly PeopleOp[], admins: ReadonlySet<string>): PeopleState {
  const guests = new Map<Id, GuestEntry>();
  const claimed = new Set<string>(); // accounts that have claimed a guest
  const may = (g: GuestEntry, by: string): boolean => by === g.by || admins.has(by);
  for (const op of ops) {
    const g = guests.get(op.guest);
    if (op.kind === "add") {
      if (!g) guests.set(op.guest, { id: op.guest, name: op.name, by: op.by, removed: false });
      continue;
    }
    if (!g) continue;
    const settled = g.claimedBy !== undefined || g.linkedTo !== undefined;
    switch (op.kind) {
      case "rename":
        if (may(g, op.by)) guests.set(g.id, { ...g, name: op.name });
        break;
      case "remove":
        if (may(g, op.by)) guests.set(g.id, { ...g, removed: true });
        break;
      case "claim":
        if (!settled && !g.removed && !isGuestId(op.by) && !claimed.has(op.by)) {
          claimed.add(op.by);
          guests.set(g.id, { ...g, claimedBy: op.by });
        }
        break;
      case "link": {
        if (settled || g.removed || !may(g, op.by)) break;
        // Never into a loop: follow where `to` already leads.
        let at: Id | undefined = op.to;
        let loops = false;
        for (let hop = 0; at && hop < MAX_HOPS; hop++) {
          if (at === g.id) {
            loops = true;
            break;
          }
          const next: GuestEntry | undefined = guests.get(at);
          at = next ? (next.claimedBy ?? next.linkedTo) : undefined;
        }
        if (!loops) guests.set(g.id, { ...g, linkedTo: op.to });
        break;
      }
    }
  }
  return { guests };
}

/**
 * Who an id names now: a guest that was claimed or folded in names the person it went to; anything
 * else names itself. `guest` says whether the answer is still a placeholder.
 */
export function finalPerson(state: PeopleState, id: Id): { id: Id; guest?: GuestEntry } {
  let at = id;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const g = state.guests.get(at);
    if (!g) return { id: at };
    const next = g.claimedBy ?? g.linkedTo;
    if (!next) return { id: at, guest: g };
    at = next;
  }
  return { id: at };
}

/** The guests nobody has claimed or folded in and nobody removed: the ones a field can name now. */
export function openGuests(state: PeopleState): Person[] {
  return [...state.guests.values()].filter((g) => !g.removed && g.claimedBy === undefined && g.linkedTo === undefined).map((g) => ({ id: g.id, name: g.name, guest: true as const }));
}

/** The guest an account claimed (or was folded into it), if any. */
export function claimOf(state: PeopleState, account: string): GuestEntry | undefined {
  for (const g of state.guests.values()) if (g.claimedBy === account || g.linkedTo === account) return g;
  return undefined;
}

// ---- reading and writing the log ----

interface KvEntry {
  op: PeopleOpInput;
  by: string;
  at: string;
}

async function readKv(store: Store): Promise<KvEntry[]> {
  const raw = await store.kvGet(PEOPLE_KV);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as KvEntry[]) : [];
  } catch {
    return [];
  }
}

/** Does this store keep a signed log (a synced space)? Then guests ride it; otherwise one kv key. */
const signed = (store: Store): boolean => typeof store.postMessage === "function" && typeof store.messages === "function";

/** Every change to the guests, in the order everyone reads them. */
export async function readPeople(store: Store): Promise<PeopleOp[]> {
  if (signed(store)) {
    const out: PeopleOp[] = [];
    for (const m of await store.messages!(PEOPLE_THREAD)) {
      let op: PeopleOpInput | null = null;
      try {
        op = parseOp(JSON.parse(m.text));
      } catch {
        op = null; // not ours to understand: skipped, never fatal
      }
      if (op && m.by) out.push({ ...op, by: m.by, at: m.at });
    }
    return out;
  }
  return (await readKv(store)).flatMap((e) => {
    const op = parseOp(e?.op);
    return op && typeof e.by === "string" ? [{ ...op, by: e.by, at: new Date(e.at) }] : [];
  });
}

/**
 * Write one change. `me` is the author in a solo store; a synced store takes its author from the
 * signing session and ignores it. Callers check the rules first (the fold checks them again).
 */
export async function writePeople(store: Store, op: PeopleOpInput, me: string): Promise<void> {
  const clean = parseOp(op);
  if (!clean) throw new Error("That change to the guests does not make sense.");
  if (signed(store)) {
    await store.postMessage!(PEOPLE_THREAD, JSON.stringify(clean));
    return;
  }
  const list = await readKv(store);
  list.push({ op: clean, by: me, at: new Date().toISOString() });
  await store.kvSet(PEOPLE_KV, JSON.stringify(list));
}

/** Fires when someone else changes the guests. A solo store has nobody else: its own writes are known. */
export function subscribePeople(store: Store, cb: () => void): Unsubscribe {
  if (signed(store) && store.subscribeMessages) return store.subscribeMessages(PEOPLE_THREAD, cb);
  return () => {};
}

/**
 * Carry the guests from one store to another (`copyStoreData`, an app starting or stopping syncing).
 *
 * What is copied is the RESULT, not the log: into a synced store every entry is signed by whoever
 * copies, so a claim Ana made would read as the copier's own. As adds and links by one author — the
 * creator of everything here — the same guests come out on the other side, claims included.
 */
export async function copyPeople(from: Store, to: Store, me: string, admins: ReadonlySet<string>): Promise<number> {
  const state = foldPeople(await readPeople(from), admins);
  if (!state.guests.size) return 0;
  const there = foldPeople(await readPeople(to), new Set([me]));
  let n = 0;
  for (const g of state.guests.values()) {
    if (there.guests.has(g.id)) continue;
    await writePeople(to, { kind: "add", guest: g.id, name: g.name }, me);
    if (g.removed) await writePeople(to, { kind: "remove", guest: g.id }, me);
    n++;
  }
  for (const g of state.guests.values()) {
    if (there.guests.has(g.id)) continue;
    const to2 = g.claimedBy ?? g.linkedTo;
    if (to2) await writePeople(to, { kind: "link", guest: g.id, to: to2 }, me);
  }
  return n;
}
