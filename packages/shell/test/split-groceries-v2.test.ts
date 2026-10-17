// Split 2.0 and Groceries 3.0: the arithmetic and the memory they add, their sample data, and what
// becomes of a device that still holds the records an older version wrote.

import { describe, expect, it } from "vitest";
import split from "../../../examples/split.app.ts";
import groceries from "../../../examples/groceries.app.ts";
import type { AppDefinition, Space } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import type { NavBridge, UiBridge } from "@potyro/host";
import { compose } from "../src/compose.js";
import { seedIfEmpty } from "../src/seed.js";
import { migrateOnLoad } from "../src/migrate-on-load.js";

const nav: NavBridge = { navigate: () => {} };
const ANA = { id: "co_ana", name: "Ana" };
const BO = { id: "co_bo", name: "Bo" };
const CY = { id: "co_cy", name: "Cy" };
const ME = { id: "co_me", name: "Me" };
/** The guest book reads its log once a tick after opening, and again after each write. */
const settled = () => new Promise((r) => setTimeout(r, 20));

function quietUi(over: Partial<UiBridge> = {}): UiBridge & { toasts: string[] } {
  const toasts: string[] = [];
  return { toasts, toast: (m) => toasts.push(m), confirm: async () => false, prompt: async () => null, pick: async () => null, ...over };
}

async function open(app: AppDefinition, id: string, opts: { seed?: (s: MemoryStore) => Promise<void>; ui?: UiBridge; space?: Space; me?: { id: string; name: string } } = {}) {
  const store = new MemoryStore();
  await store.open(id);
  await opts.seed?.(store);
  const { runtime } = await compose({ app, provenance: "trusted", store, caps: new FakeCapabilities(), ui: opts.ui ?? quietUi(), nav, me: opts.me, space: opts.space });
  return { store, runtime };
}

const threeOfUs: Space = { id: "space", role: "admin", members: [{ ...ANA, role: "admin" }, { ...BO, role: "writer" }, { ...CY, role: "writer" }], invite: async () => "https://example.test/#join=x" };

describe("Split", () => {
  it("splits a receipt line by line: a line names who had it, a line naming nobody is everyone's", async () => {
    const { runtime } = await open(split as unknown as AppDefinition, "split", { me: ANA, space: threeOfUs });
    const group = await runtime.ctx.create("group", { name: "Lisbon" });
    await runtime.setScope("group", group.id);
    const e = await runtime.ctx.create("expense", {
      description: "Tasca",
      amount: 6400,
      paidBy: ANA.id,
      split: "items",
      group: group.id,
      items: [
        { name: "Polvo", price: 1800, people: [BO.id] },
        { name: "Bacalhau", price: 1450, people: [ANA.id, CY.id] },
        { name: "Vinho", price: 1600, people: [] },
        { name: "Água", price: 250, people: [] },
      ],
    });
    const row = (await runtime.ctx.get("expense", e.id))!;
    // Bo 1800 + a third of Vinho and Água; Ana and Cy 725 each + a third; the 1300 not on any line is
    // everyone's too, the odd cents going to the first member, so the parts add up to 64.00 exactly.
    expect(row.check).toMatch(/not on any line/);
    expect(String(row.breakdown).split(" · ").sort()).toEqual(["Bo €28.49", "Cy €17.74", "You €17.77"].sort());
    const balances = await balancesOf(runtime);
    expect(balances).toContain("Bo → You");
  });

  it("splits by exact amounts, and what they leave over is everyone's", async () => {
    const { runtime } = await open(split as unknown as AppDefinition, "split", { me: ANA, space: threeOfUs });
    const group = await runtime.ctx.create("group", { name: "Flat" });
    await runtime.setScope("group", group.id);
    const e = await runtime.ctx.create("expense", { description: "Taxi", amount: 3000, paidBy: BO.id, split: "exact", group: group.id, exact: [{ person: ANA.id, amount: 2000 }, { person: CY.id, amount: 700 }] });
    const row = (await runtime.ctx.get("expense", e.id))!;
    expect(String(row.breakdown).split(" · ").sort()).toEqual(["Bo €1.00", "Cy €8.00", "You €21.00"].sort());
    expect(row.kind).toBe("transport"); // guessed from "Taxi"
  });

  it("settles up from a suggested transfer: the payment it records clears the board", async () => {
    let form: Record<string, unknown> | undefined;
    const ui = quietUi({
      sheet: async <T,>(o: { items: { id: T }[] }) => o.items[0]!.id,
      form: async (o) => ((form = o.initial), o.initial ?? null),
    });
    const { runtime } = await open(split as unknown as AppDefinition, "split", { me: ANA, space: threeOfUs, ui });
    const group = await runtime.ctx.create("group", { name: "Dinner" });
    await runtime.setScope("group", group.id);
    await runtime.ctx.create("expense", { description: "Dinner", amount: 9000, paidBy: ANA.id, split: "equally", between: [ANA.id, BO.id, CY.id], group: group.id });
    const page = runtime.definition.pages.find((p) => p.id === "group")!;
    await page.actions![0]!.run(runtime.ctx);
    expect(form).toMatchObject({ from: BO.id, to: ANA.id, amount: 3000 });
    await page.actions![0]!.run(runtime.ctx);
    await page.actions![0]!.run(runtime.ctx);
    const payments = await runtime.ctx.query("payment");
    expect(payments).toHaveLength(2);
    expect(await balancesOf(runtime)).toEqual([]);
  });

  it("a balance row's Settle goes straight to the payment when there is one transfer to make", async () => {
    let sheets = 0;
    const ui = quietUi({ sheet: async () => ((sheets += 1), null), form: async (o) => o.initial ?? null });
    const twoOfUs: Space = { ...threeOfUs, members: threeOfUs.members.slice(0, 2) };
    const { runtime } = await open(split as unknown as AppDefinition, "split", { me: ANA, space: twoOfUs, ui });
    const group = await runtime.ctx.create("group", { name: "Taxi" });
    await runtime.setScope("group", group.id);
    await runtime.ctx.create("expense", { description: "Taxi", amount: 2000, paidBy: ANA.id, split: "equally", between: [ANA.id, BO.id], group: group.id });
    const view = runtime.definition.pages.find((p) => p.id === "group")!.layout!.items[0]!.view as unknown as { rows: (r: unknown[], c: unknown) => Promise<{ label: string; action?: { key: string; id: string } }[]> };
    const row = (await view.rows(await runtime.ctx.query("expense"), runtime.ctx)).find((r) => r.label === "Bo → You")!;
    expect(row.action).toMatchObject({ key: "settle", id: group.id });
    await runtime.runAction("group", row.action!.key, row.action!.id);
    expect(sheets).toBe(0);
    expect(await runtime.ctx.query("payment")).toMatchObject([{ amount: 1000 }]);
    expect(await balancesOf(runtime)).toEqual([]);
  });

  it("first run: Lisbon names its three guests and everyone owes something; the flat, alone, owes nobody", async () => {
    const { runtime } = await open(split as unknown as AppDefinition, "split", { me: ME, seed: (s) => seedIfEmpty(s, "split", ME.id, async () => undefined) });
    await settled();
    expect(runtime.ctx.people.map((p) => p.name)).toEqual(["Me", "Ana", "Tom", "Inês"]);
    const groups = await runtime.ctx.query("group");
    expect(groups.map((g) => g.name)).toEqual(["Lisbon weekend", "Flat"]);
    await runtime.setScope("group", groups[0]!.id);
    const tasca = (await runtime.ctx.query("expense")).find((e) => e.description === "Tasca da Esquina")!;
    expect(tasca.split).toBe("items");
    expect(tasca.check).toMatch(/to the cent/);
    // Tom paid the taxi and Ana the fado; you paid the flat — so the guests owe you, and the way out names them.
    const lisbon = await balancesOf(runtime);
    expect(lisbon).toEqual(expect.arrayContaining(["You", "Ana", "Tom", "Inês"]));
    expect(lisbon.some((l) => / → You$/.test(l))).toBe(true);
    // The guests are Lisbon's: the flat's bills are still nobody's business but yours.
    await runtime.setScope("group", groups[1]!.id);
    expect(await balancesOf(runtime)).toEqual([]);
    const flat = (await runtime.ctx.query("expense")).filter((e) => (e.group as { id?: string })?.id === groups[1]!.id).map((e) => e.description);
    expect(flat).toEqual(expect.arrayContaining(["Groceries", "Internet"]));
  });

  it("Invite names the others now: each is a guest the group lists, and shares its costs", async () => {
    const ui = quietUi({ sheet: async () => "names" as never, form: async () => ({ names: "Ana, Tom and Inês, ana" }) });
    const { runtime } = await open(split as unknown as AppDefinition, "split", { me: ME, ui });
    const group = await runtime.ctx.create("group", { name: "Porto" });
    await runtime.setScope("group", group.id);
    await runtime.ctx.create("expense", { description: "Dinner", amount: 4000, paidBy: ME.id, group: group.id });
    expect(await balancesOf(runtime)).toEqual([]);
    const invite = runtime.definition.pages.find((p) => p.id === "group")!.actions!.findIndex((a) => a.label === "Invite");
    await runtime.runPageAction("group", invite);
    await settled();
    // Three guests, not four: "ana" is Ana.
    expect(runtime.ctx.people.filter((p) => p.guest).map((p) => p.name)).toEqual(["Ana", "Tom", "Inês"]);
    expect(ui.toasts.at(-1)).toBe("Ana, Tom, and Inês can be in expenses now");
    // The dinner was written before they were named, with nobody listed: it is everyone's now.
    const lines = await balancesOf(runtime);
    expect(lines).toEqual(expect.arrayContaining(["You", "Ana", "Tom", "Inês"]));
    // A new expense's "Between" starts with all four of them.
    const between = await (split.entities.expense.fields.between as unknown as { default: (c: unknown) => Promise<string[]> }).default(runtime.ctx);
    const named = new Map(runtime.ctx.people.map((p) => [p.id, p.name]));
    expect(between.map((id) => named.get(id)).sort()).toEqual(["Ana", "Inês", "Me", "Tom"].sort());
  });

  it("a demo link's records name nobody, and still read as yours rather than as nobody's", async () => {
    const { runtime } = await open(split as unknown as AppDefinition, "split", { seed: (s) => seedIfEmpty(s, "split", undefined, async () => undefined) });
    const [lisbon] = await runtime.ctx.query("group");
    await runtime.setScope("group", lisbon!.id);
    const { rows } = await runtime.queryPage("group#1");
    expect(rows.length).toBe(9);
    expect(rows.every((e) => e.yourShare !== "€0.00")).toBe(true);
  });

  it("migrates 1.x records: an old expense keeps its split and gains an empty category", async () => {
    const store = new MemoryStore();
    await store.open("split-old");
    await store.insert("group", { name: "Flat" });
    await store.insert("expense", { description: "Internet", amount: 3900, split: "equally", between: [], shares: [] });
    await store.kvSet("__appVersion", "1.3.0");
    const { ran } = await migrateOnLoad(store, split as unknown as AppDefinition);
    expect(ran.map((m) => m.to)).toEqual(["1.4.0", "2.0.0"]);
    const [e] = await store.all("expense");
    expect(e).toMatchObject({ split: "equally", category: null, exact: [], items: [] });
  });
});

/** The balances page's rows, as labels. */
async function balancesOf(runtime: Awaited<ReturnType<typeof open>>["runtime"]): Promise<string[]> {
  const view = runtime.definition.pages.find((p) => p.id === "group")!.layout!.items[0]!.view as unknown as { rows: (r: unknown[], c: unknown) => Promise<{ label: string }[]> };
  return (await view.rows(await runtime.ctx.query("expense"), runtime.ctx)).map((r) => r.label);
}

describe("Groceries", () => {
  const seeded = (s: MemoryStore) => seedIfEmpty(s, "groceries", undefined, async () => undefined);
  const action = (runtime: Awaited<ReturnType<typeof open>>["runtime"], label: string) => runtime.definition.pages.find((p) => p.id === "shopping")!.actions!.find((a) => a.label === label)!;

  /** Opened on the seed's "Weekly shop", as the shell opens it. */
  async function shop() {
    const opened = await open(groceries as unknown as AppDefinition, "groceries", { seed: seeded });
    const lists = await opened.runtime.ctx.query("list");
    const weekly = lists.find((l) => l.name === "Weekly shop")!;
    await opened.runtime.setScope("list", weekly.id);
    return { ...opened, lists, weekly };
  }

  it("Done shopping puts this list's basket into memory, and folds a re-typed usual into the one it already knows", async () => {
    const { runtime, weekly, lists } = await shop();
    // "Coffee beans" is a usual; typed again and ticked, it must stay ONE usual.
    const typed = await runtime.ctx.create("item", { name: "coffee beans", bought: true, list: weekly.id });
    // Another list's basket is that list's business.
    const party = lists.find((l) => l.name === "Party")!;
    const limes = (await runtime.ctx.query("item")).find((i) => i.name === "Limes")!;
    await runtime.ctx.patch("item", limes.id, { bought: true });
    const coffeeBefore = (await runtime.ctx.query("item")).find((i) => i.name === "Coffee beans")!;
    await action(runtime, "Done shopping").run(runtime.ctx);
    const items = await runtime.ctx.query("item");
    expect(items.find((i) => i.id === typed.id)).toBeUndefined();
    const coffee = items.find((i) => i.name === "Coffee beans")!;
    expect(coffee.timesBought).toBe(Number(coffeeBefore.timesBought) + 1);
    const spinach = items.find((i) => i.name === "Spinach")!;
    expect(spinach).toMatchObject({ onList: false, bought: false, timesBought: 5 });
    expect(items.find((i) => i.name === "Limes")).toMatchObject({ onList: true, bought: true });
    expect(items.filter((i) => i.onList !== false && i.bought).map((i) => (i.list as { id: string }).id)).toEqual([party.id]);
  });

  it("Done shopping is offered only once something on the list is in the basket", async () => {
    const { runtime } = await shop();
    const when = action(runtime, "Done shopping").when!;
    const { rows } = await runtime.queryPage("shopping");
    expect(await when(rows, runtime.ctx)).toBe(true); // the seed has Spinach and Rice ticked
    expect(await when(rows.filter((r) => !r.bought), runtime.ctx)).toBe(false);
  });

  it("the list page shows this list's items only, and the figures count them", async () => {
    const { runtime } = await shop();
    const { rows } = await runtime.queryPage("shopping");
    expect(rows.map((r) => r.name)).toContain("Apples");
    expect(rows.map((r) => r.name)).not.toContain("Limes"); // the party's
    expect(rows.map((r) => r.name)).not.toContain("Coffee beans"); // remembered, not on a list
    const summary = runtime.definition.pages.find((p) => p.id === "shopping")!.summary!;
    const value = (i: number) => (summary[i]!.value as (r: typeof rows, c: unknown) => number)(rows, runtime.ctx);
    expect([value(0), value(1)]).toEqual([11, 2]);
  });

  it("usuals: what you buy, most usual first, offered by the add box; Add brings one back to this list", async () => {
    const { runtime, weekly } = await shop();
    const view = runtime.definition.pages.find((p) => p.id === "shopping")!.view as unknown as { quickAdd: { usuals: (r: unknown[], c: unknown) => Promise<string[]> } };
    const usuals = await view.quickAdd.usuals([], runtime.ctx);
    expect(usuals[0]).toBe("Coffee beans"); // 8 times, last week
    expect(usuals).not.toContain("Basil"); // never bought: not a usual yet
    expect(usuals).not.toContain("Milk"); // on the list, not in memory
    const items = await runtime.ctx.query("item");
    expect(items.find((r) => r.name === "Toilet paper")!.emoji).toBe("🧻");
    expect(items.find((r) => r.name === "Cheddar")!.emoji).toBe("🧀");
    expect(items.find((r) => r.name === "Peanut butter")!.emoji).toBe("🥜");
    // From an item's own page, "Add" puts it back at the end of its aisle, on the list being shown.
    const coffee = items.find((r) => r.name === "Coffee beans")!;
    await runtime.runAction("item", "again", coffee.id);
    const back = (await runtime.ctx.get("item", coffee.id))!;
    expect(back).toMatchObject({ onList: true, bought: false });
    expect((back.list as { id: string }).id).toBe(weekly.id);
    const pantry = (await runtime.queryPage("shopping")).rows.filter((i) => (i.aisle as { id?: string })?.id === (back.aisle as { id?: string }).id);
    expect(Math.max(...pantry.map((i) => Number(i.position)))).toBe(back.position);
  });

  it("quick add puts a new name in its aisle: the dictionary's, matched to YOUR aisle names", async () => {
    const { runtime } = await open(groceries as unknown as AppDefinition, "groceries", { seed: seeded });
    const aisles = await runtime.ctx.query("aisle");
    const of = (name: string) => aisles.find((a) => a.name === name)!.id;
    const defaults = (runtime.definition.pages.find((p) => p.id === "shopping")!.view as unknown as { quickAdd: { defaults: (t: string, c: unknown) => Promise<{ aisle?: string }> } }).quickAdd.defaults;
    expect((await defaults("Leite", runtime.ctx)).aisle).toBe(of("Dairy")); // Portuguese, never bought
    expect((await defaults("Brötchen", runtime.ctx)).aisle).toBe(of("Bakery"));
    expect((await defaults("Waschmittel", runtime.ctx)).aisle).toBe(of("Household"));
    expect(await defaults("Something odd", runtime.ctx)).toEqual({}); // the list asks with one tap instead
  });

  it("migrates 2.x records: everything already there stays on the list, and the list is one list", async () => {
    const store = new MemoryStore();
    await store.open("groceries-old");
    await store.insert("item", { name: "Milk", bought: false, position: 0 });
    await store.kvSet("__appVersion", "2.1.0");
    const { ran } = await migrateOnLoad(store, groceries as unknown as AppDefinition);
    expect(ran.map((m) => m.to)).toEqual(["2.3.0", "3.0.0", "4.0.0"]);
    expect((await store.all("item"))[0]).toMatchObject({ onList: true, timesBought: 0, list: "list-1" });
    expect((await store.all("list")).map((l) => l.name)).toEqual(["Shopping"]);
    const { runtime } = await compose({ app: groceries as unknown as AppDefinition, provenance: "trusted", store, caps: new FakeCapabilities(), ui: quietUi(), nav });
    await runtime.setScope("list", "list-1");
    expect((await runtime.queryPage("shopping")).rows.map((r) => r.name)).toEqual(["Milk"]);
  });
});
