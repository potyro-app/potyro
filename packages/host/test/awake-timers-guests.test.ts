// `ctx.ui.keepAwake`, `ctx.ui.timer` and guests (`ctx.people`, `ctx.guests`) — docs/04. The same app,
// trusted (direct) and in both sealed runners, must behave the same: the shell owns the screen and
// the countdowns, the host owns who is in the app, and app code only ever asks.

import { describe, expect, it } from "vitest";
import { defineApp, type Person, type PotyroApp } from "potyro";
import { MemoryStore, type Store } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, GuestBook, type LoadedApp, type MakeCtxBase, type TimerBridge, type TimerData, type UiBridge } from "../src/index.js";
import { RUNNERS } from "./runners.js";

const ME: Person = { id: "acct_ana", name: "Ana" };

// One app, written once in plain JS so the sealed runners get exactly what the direct one does.
const ACTIONS = {
  awake: async (_r: unknown, ctx: any) => {
    const h = ctx.ui.keepAwake();
    ctx.ui.toast("held");
    h.release();
    h.release(); // twice is fine
  },
  hold: async (_r: unknown, ctx: any) => {
    ctx.ui.keepAwake();
  },
  rest: async (_r: unknown, ctx: any) => {
    const t = await ctx.ui.timer({ label: { en: "Rest", pl: "Odpoczynek" }, seconds: 90, id: "rest" });
    ctx.ui.toast(`${t.id}:${t.label}:${t.left}:${t.endsAt instanceof Date}:${t.paused}`);
    const all = await ctx.ui.timers();
    await all[0].pause();
    ctx.ui.toast(`n=${all.length}`);
  },
  badTimer: async (_r: unknown, ctx: any) => {
    await ctx.ui.timer({ label: "x", seconds: 0 });
  },
  addTom: async (r: { id: string }, ctx: any) => {
    const g = await ctx.guests.add("Tom");
    await ctx.patch("expense", r.id, { paidBy: g.id });
    ctx.ui.toast(`guest=${g.guest === true}`);
  },
  people: async (_r: unknown, ctx: any) => {
    ctx.ui.toast(ctx.people.map((p: Person) => p.name + (p.guest ? "*" : "")).join(","));
  },
};

const DEF = {
  id: "split",
  name: "Split",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { expense: { fields: { what: { type: "text" }, paidBy: { type: "member" } }, actions: ACTIONS } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "expense" } }],
  reminders: [],
};

const BUNDLE = `globalThis.__potyroApp = ${JSON.stringify({ ...DEF, entities: { expense: { ...DEF.entities.expense, actions: {} } } }).replace(
  '"actions":{}',
  `"actions":{${Object.entries(ACTIONS)
    .map(([k, f]) => `${JSON.stringify(k)}: ${f.toString()}`)
    .join(",")}}`,
)};`;

/** A shell stand-in for the countdowns: what was started, and what the chip was told to do. */
function fakeTimers(now = 1_000_000) {
  const kept = new Map<string, TimerData>();
  const verbs: string[] = [];
  const bridge: TimerBridge = {
    start: async (o) => {
      const d: TimerData = { id: o.id ?? "t1", label: o.label, seconds: o.seconds, endsAt: new Date(now + o.seconds * 1000).toISOString(), left: o.seconds, paused: false };
      kept.set(d.id, d);
      return d;
    },
    list: async () => [...kept.values()],
    control: async (id, verb) => {
      verbs.push(`${id}:${verb}`);
      const d = kept.get(id);
      if (d && verb === "pause") kept.set(id, { ...d, paused: true, endsAt: null });
      if (verb === "cancel") kept.delete(id);
    },
  };
  return { bridge, kept, verbs };
}

interface Rig {
  ctx: ReturnType<ReturnType<typeof createHost>["makeCtx"]>;
  again: () => Rig["ctx"];
  loaded: LoadedApp;
  store: Store;
  book: GuestBook;
  toasts: string[];
  holds: { held: number; released: number };
  timers: ReturnType<typeof fakeTimers>;
}

type Make = (store: Store) => Promise<{ host: ReturnType<typeof createHost>; loaded: LoadedApp }>;

const direct: Make = async () => {
  const host = createHost();
  return { host, loaded: await host.load({ kind: "module", app: defineApp(DEF as never) as PotyroApp }) };
};

const sealed =
  (runner: (typeof RUNNERS)[number]): Make =>
  async (store) => {
    const host = createHost({ loadIsolated: await runner.loader(store) });
    return { host, loaded: await host.load({ kind: "bundle", code: BUNDLE, provenance: "untrusted" }) };
  };

async function rig(make: Make, extra: Partial<MakeCtxBase> = {}, ui: Partial<UiBridge> = {}): Promise<Rig> {
  const store = new MemoryStore();
  await store.open("split");
  const { host, loaded } = await make(store);
  const toasts: string[] = [];
  const holds = { held: 0, released: 0 };
  const timers = fakeTimers();
  const book = new GuestBook(store, () => ({ me: ME, space: extra.space }));
  await book.ready;
  const bridge: UiBridge = {
    toast: (m) => void toasts.push(m),
    confirm: async () => true,
    prompt: async () => null,
    pick: async () => null,
    keepAwake: () => {
      holds.held++;
      return { release: () => void holds.released++ };
    },
    timers: timers.bridge,
    ...ui,
  };
  const again = () => host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui: bridge, nav: { navigate: () => {} }, me: ME, guests: book, language: "en", ...extra });
  return { ctx: again(), again, loaded, store, book, toasts, holds, timers };
}

const MAKERS: Array<[string, Make]> = [["direct", direct], ...RUNNERS.map((r) => [r.name, sealed(r)] as [string, Make])];

describe.each(MAKERS)("%s", (_name, make) => {
  it("keepAwake holds the screen through the shell and lets go once", async () => {
    const r = await rig(make);
    const rec = await r.store.insert("expense", { what: "x" });
    await r.loaded.callAction("expense", "awake", rec as never, r.ctx);
    expect(r.toasts).toEqual(["held"]);
    expect(r.holds).toEqual({ held: 1, released: 1 });
    r.loaded.dispose();
  });

  it("a hold the app forgot is let go when the app goes", async () => {
    const r = await rig(make);
    const rec = await r.store.insert("expense", { what: "x" });
    await r.loaded.callAction("expense", "hold", rec as never, r.ctx);
    expect(r.holds.held).toBe(1);
    r.loaded.dispose();
    // Direct: the shell lets go on leaving (keep-awake.ts releaseApp); a sealed box lets go itself.
    if (_name !== "direct") expect(r.holds.released).toBe(1);
  });

  it("timer asks the shell, in the app's language, and its handle works from inside", async () => {
    const r = await rig(make);
    const rec = await r.store.insert("expense", { what: "x" });
    await r.loaded.callAction("expense", "rest", rec as never, r.ctx);
    expect(r.toasts).toEqual(["rest:Rest:90:true:false", "n=1"]);
    expect(r.timers.verbs).toEqual(["rest:pause"]);
    expect([...r.timers.kept.values()][0]).toMatchObject({ id: "rest", label: "Rest", seconds: 90, paused: true });
    await expect(r.loaded.callAction("expense", "badTimer", rec as never, r.ctx)).rejects.toThrow(/seconds/);
    r.loaded.dispose();
  });

  it("guests: added from inside, named by a member field, in ctx.people, and resolved to whoever claims them", async () => {
    const r = await rig(make);
    const rec = await r.store.insert("expense", { what: "Dinner" });
    await r.loaded.callAction("expense", "addTom", rec as never, r.ctx);
    expect(r.toasts).toEqual(["guest=true"]);

    const before = await r.again().get("expense", String(rec.id));
    expect(before!.paidBy).toMatchObject({ name: "Tom", guest: true });
    await r.loaded.callAction("expense", "people", rec as never, r.again());
    expect(r.toasts.at(-1)).toBe("Ana,Tom*");

    // Ana says she is Tom: the record is not rewritten, and it names her now.
    const tom = r.book.open()[0]!;
    await r.book.claim(tom.id);
    expect((await r.store.get("expense", String(rec.id)))!.paidBy).toBe(tom.id);
    expect((await r.again().get("expense", String(rec.id)))!.paidBy).toEqual({ id: ME.id, name: ME.name });
    await r.loaded.callAction("expense", "people", rec as never, r.again());
    expect(r.toasts.at(-1)).toBe("Ana");
    r.loaded.dispose();
  });
});

describe("guests in a shared app", () => {
  const space = { id: "sp", role: "admin" as const, members: [{ ...ME, role: "admin" as const }, { id: "acct_bob", name: "Bob", role: "writer" as const }], invite: async () => "" };

  it("a member field may name a guest, never a made-up id", async () => {
    const r = await rig(direct, { space });
    const tom = await r.ctx.guests.add("Tom");
    await expect(r.again().create("expense", { what: "a", paidBy: tom.id })).resolves.toBeTruthy();
    await expect(r.again().create("expense", { what: "b", paidBy: "guest_madeup" })).rejects.toThrow(/someone in this app/);
    // A guest that was taken off the list cannot be named anew.
    await r.ctx.guests.remove(tom.id);
    await expect(r.again().create("expense", { what: "c", paidBy: tom.id })).rejects.toThrow(/someone in this app/);
  });

  it("only whoever added a guest, or the owner, may rename it — in words", async () => {
    const r = await rig(direct, { space });
    const tom = await r.ctx.guests.add("Tom");
    const bob = new GuestBook(r.store, () => ({ me: { id: "acct_bob", name: "Bob" }, space: { ...space, role: "writer" } }));
    await bob.ready;
    await expect(bob.rename(tom.id, "Tommy")).rejects.toThrow(/Only whoever added Tom/);
    await expect(r.ctx.guests.add("   ")).rejects.toThrow(/needs a name/);
    const reader = new GuestBook(r.store, () => ({ me: { id: "acct_bob", name: "Bob" }, space: { ...space, role: "reader" } }));
    await reader.ready;
    await expect(reader.add("Eve")).rejects.toThrow(/only view/);
  });

  it("ctx.people is the members and the open guests", async () => {
    const r = await rig(direct, { space });
    await r.ctx.guests.add("Tom");
    expect(r.again().people.map((p) => p.name)).toEqual(["Ana", "Bob", "Tom"]);
  });
});
