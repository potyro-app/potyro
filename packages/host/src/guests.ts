// The app's guests as the host keeps them (docs/04 §Guests): the log read once and folded, kept in
// memory so a pass can read it synchronously, and refreshed when someone else changes it.
//
// One per open app. The runtime makes it (it has the store and the identity) and hands it to every
// `ctx` it builds; the shell reaches it through the runtime for the People panel and the claim. App
// code reaches it only through `ctx.guests`, which checks the rules here before anything is written —
// and the fold checks them again on every device, so a copy that skipped this changes nothing.

import type { Id, Person, Space } from "potyro";
import {
  EMPTY_PEOPLE,
  claimOf,
  cleanGuestName,
  finalPerson,
  foldPeople,
  isGuestId,
  newGuestId,
  openGuests,
  readPeople,
  subscribePeople,
  writePeople,
  type GuestEntry,
  type PeopleOp,
  type PeopleOpInput,
  type PeopleState,
  type Store,
} from "@potyro/store";

/** Who is asking, read when it is needed: membership changes while an app is open. */
export interface GuestWho {
  me?: Person;
  space?: Space;
}

const LOCAL: Person = { id: "local", name: "Me" };

/** Where a ctx keeps its app's guest book: host-internal, never sent into a sealed box. */
export const GUEST_BOOK: unique symbol = Symbol.for("potyro.guestBook") as never;

/** The guest book a host ctx carries, if it was built with one. */
export function guestBookOf(ctx: unknown): GuestBook | undefined {
  return ctx && typeof ctx === "object" ? ((ctx as Record<symbol, unknown>)[GUEST_BOOK] as GuestBook | undefined) : undefined;
}

export class GuestBook {
  private ops: PeopleOp[] = [];
  private folded: { key: string; state: PeopleState } = { key: "", state: EMPTY_PEOPLE };
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private closed = false;
  /** False until the log has been read once. */
  loaded = false;
  /** Settles once the log has been read (a store that cannot be read counts as no guests). */
  readonly ready: Promise<void>;

  constructor(
    private readonly store: Store,
    private readonly who: () => GuestWho,
  ) {
    this.ready = this.reload();
    this.unsubscribe = subscribePeople(store, () => void this.reload());
  }

  private me(): Person {
    return this.who().me ?? LOCAL;
  }

  /** The app's owners: a shared app's admins; a solo app's only person, you. */
  private admins(): Set<string> {
    const { space } = this.who();
    return space ? new Set(space.members.filter((m) => m.role === "admin").map((m) => m.id)) : new Set([this.me().id]);
  }

  /** Read the log again and tell whoever listens. */
  async reload(): Promise<void> {
    try {
      this.ops = await readPeople(this.store);
    } catch {
      // A store being closed under us, or a space not here yet: what we had stands.
    }
    this.folded = { key: "", state: EMPTY_PEOPLE };
    this.loaded = true;
    if (!this.closed) for (const cb of [...this.listeners]) cb();
  }

  /** What the log adds up to now — folded again only when the owners changed. */
  state(): PeopleState {
    const admins = this.admins();
    const key = [...admins].sort().join(",");
    if (this.folded.key !== key || this.folded.state === EMPTY_PEOPLE) this.folded = { key, state: foldPeople(this.ops, admins) };
    return this.folded.state;
  }

  /** The guests a field can name now: nobody claimed them, nobody removed them. */
  open(): Person[] {
    return openGuests(this.state());
  }

  /** Everyone a `member` field can name now: the members (or you, solo), then the open guests. */
  people(): Person[] {
    const { space } = this.who();
    const me = this.me();
    const members: Person[] = space ? space.members.map((m) => ({ id: m.id, name: m.name })) : [{ id: me.id, name: me.name }];
    if (space && !members.some((m) => m.id === me.id)) members.push({ id: me.id, name: me.name });
    return [...members, ...this.open()];
  }

  /** Every guest id there has ever been, removed ones too: what a stored value may still name. */
  everIds(): Set<string> {
    return new Set(this.state().guests.keys());
  }

  /** Guest ids a value may be SET to now: every one not removed (a claimed one reads as its person). */
  settableIds(): Set<string> {
    return new Set([...this.state().guests.values()].filter((g) => !g.removed).map((g) => g.id));
  }

  /**
   * What a stored guest id names: the guest itself while it is a placeholder, or the person who claimed
   * it (or it was folded into). `null` for an id that is not a guest's. Before the log has been read
   * a guest id names an unnamed guest, never nothing.
   */
  resolve(id: Id, findMember: (id: Id) => Person | undefined): Person | null {
    if (!isGuestId(id)) return null;
    const state = this.state();
    const own = state.guests.get(id);
    if (!own) return { id, name: "…", guest: true };
    const end = finalPerson(state, id);
    if (end.guest) return { id: end.guest.id, name: end.guest.name, guest: true };
    return findMember(end.id) ?? { id: end.id, name: own.name };
  }

  entry(id: Id): GuestEntry | undefined {
    return this.state().guests.get(id);
  }

  /** The guest you said you are, if any. */
  mine(): GuestEntry | undefined {
    return claimOf(this.state(), this.me().id);
  }

  /** Whether you may change this app at all (a view-only invite may not). */
  canWrite(): boolean {
    return (this.who().space?.role ?? "admin") !== "reader";
  }

  /** Whether you may rename, remove or fold in this guest: you added it, or you own the app. */
  canManage(id: Id): boolean {
    const g = this.entry(id);
    if (!g || !this.canWrite()) return false;
    const me = this.me().id;
    return g.by === me || this.admins().has(me);
  }

  private async write(op: PeopleOpInput): Promise<void> {
    if (this.closed) throw new Error("This app was closed.");
    await writePeople(this.store, op, this.me().id);
    await this.reload();
  }

  private mustWrite(): void {
    if (!this.canWrite()) throw new Error("You can only view this app, so you can't change who is in it.");
  }

  private mustManage(id: Id): GuestEntry {
    const g = this.entry(id);
    if (!g) throw new Error("There is no such guest in this app.");
    if (!this.canManage(id)) throw new Error(`Only whoever added ${g.name}, or the app's owner, can change them.`);
    return g;
  }

  async add(name: string): Promise<Person> {
    this.mustWrite();
    const clean = cleanGuestName(name);
    const id = newGuestId();
    await this.write({ kind: "add", guest: id, name: clean });
    return { id, name: clean, guest: true };
  }

  async rename(id: Id, name: string): Promise<void> {
    this.mustManage(id);
    await this.write({ kind: "rename", guest: id, name: cleanGuestName(name) });
  }

  async remove(id: Id): Promise<void> {
    this.mustManage(id);
    await this.write({ kind: "remove", guest: id });
  }

  /** "This is me": every record naming the guest names you from now on. Shell UI only, never `ctx`. */
  async claim(id: Id): Promise<void> {
    this.mustWrite();
    const g = this.entry(id);
    if (!g || g.removed) throw new Error("There is no such guest in this app.");
    if (g.claimedBy !== undefined || g.linkedTo !== undefined) throw new Error(`${g.name} is already someone in this app.`);
    const mine = this.mine();
    if (mine) throw new Error(`You are already ${mine.name} here.`);
    await this.write({ kind: "claim", guest: id });
  }

  /** Fold a guest into a member or another guest (a duplicate). Shell UI only: the owner or the guest's creator. */
  async link(id: Id, to: Id): Promise<void> {
    const g = this.mustManage(id);
    if (g.claimedBy !== undefined || g.linkedTo !== undefined) throw new Error(`${g.name} is already someone in this app.`);
    if (id === to) throw new Error("A guest cannot be folded into themselves.");
    await this.write({ kind: "link", guest: id, to });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.closed = true;
    this.listeners.clear();
    this.unsubscribe();
  }
}
