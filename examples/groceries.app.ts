// groceries.app.ts
// A shared household shopping list that remembers. Tick things as they go in the basket; "Done
// shopping" puts them away, and next week they are one tap from the list again — your usuals, in the
// aisle they were in last time.
//
// Made for the moment it is used most: in a shop, phone in one hand. The list opens straight on the
// items, in the aisles' walking order, a tap anywhere on a row ticks it, ticked things fold away into
// "In the basket", and "Done shopping" shows up only once there is something in it. Usuals are not a
// page to visit: they are what the add box offers when you tap it. Several lists ("Weekly shop",
// "Party") are the app's `scope`: the shell switches, makes, renames, copies and deletes them.
//
// Stresses: the `checklist` view (#106) at full stretch — tick in place, quick-add, rename a row by
// tapping it, drag items between aisles, and aisles that are RECORDS you can rename, reorder and
// delete from the list itself. All of that is declared. What the app's own code adds is memory:
// bought items are kept (how often, how lately) instead of deleted, which is what makes "Usuals" and
// putting an item back in its usual aisle possible — plain functions over the records, no AI, no network.
//
// Shared: `sync`, so the household sees one list, and a row says who added it.
//
// Written in English; its translations are catalogs, examples/files/groceries/locales/<lang>.po
// (docs/30), so a device shows the person's ("Zakupy" on a Polish phone) over the same records. The
// items and aisles people type are records, in their own words: never translated, and never guessed
// at from a list of words. Every language but English is a model's draft (#297).
import { defineApp, type Ctx, type Resolved } from "potyro";

const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();
const relId = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as { id?: unknown }).id ?? "") : "");
const onList = (i: Resolved): boolean => i.onList !== false;
const dateOf = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);

/**
 * How much of a usual something is: how often, discounted by how long ago. Bought weekly and last
 * week beats bought often but not since spring.
 */
function usualness(item: Resolved, now: Date): number {
  const times = Number(item.timesBought) || 0;
  const last = dateOf(item.lastBought);
  const weeks = last ? Math.max(0, (now.getTime() - last.getTime()) / (7 * 86_400_000)) : 26;
  return times / (1 + weeks / 4);
}

/** The list being shown, by id ("" before one is chosen). */
const listId = (ctx: Ctx): string => String(ctx.scope.list?.id ?? "");
/** On the list being shown: the rows the list page is made of. */
const onThisList = (i: Resolved, ctx: Ctx): boolean => onList(i) && relId(i.list) === listId(ctx);

/** Back on the list being shown, at the end of its aisle, unticked. */
async function putOnList(ctx: Ctx, item: Resolved, items: readonly Resolved[]): Promise<void> {
  const aisle = relId(item.aisle);
  const last = Math.max(-1, ...items.filter((i) => onThisList(i, ctx) && relId(i.aisle) === aisle).map((i) => Number(i.position) || 0));
  await ctx.patch("item", item.id, { onList: true, bought: false, position: last + 1, list: listId(ctx) || null });
}

/** What the add box offers: the things you buy, most usual first. Remembered across every list. */
async function usualNames(ctx: Ctx): Promise<string[]> {
  const now = ctx.now();
  const seen = new Set<string>();
  return (await ctx.query("item"))
    .filter((i) => !onList(i) && (Number(i.timesBought) || 0) > 0)
    .sort((a, b) => usualness(b, now) - usualness(a, now))
    .map((i) => String(i.name ?? "").trim())
    .filter((n) => n && !seen.has(norm(n)) && seen.add(norm(n)));
}

/**
 * "Done shopping": what went in the basket leaves the list and goes into memory — how many times it
 * has been bought, and when. Something typed again that was already remembered is folded into the
 * remembered one, so "Milk" is one usual, not three.
 */
async function doneShopping(ctx: Ctx): Promise<void> {
  const items = await ctx.query("item");
  const basket = items.filter((i) => onThisList(i, ctx) && i.bought);
  if (!basket.length) {
    ctx.ui.toast(
      ctx.t("Tick what went in the basket first."),
    );
    return;
  }
  const now = ctx.now();
  for (const item of basket) {
    const twin = items.find((i) => i.id !== item.id && !onList(i) && norm(i.name) === norm(item.name));
    if (twin) {
      await ctx.patch("item", twin.id, { lastBought: now, quantity: item.quantity ?? "", aisle: relId(item.aisle) || relId(twin.aisle) || null });
      await ctx.increment("item", twin.id, "timesBought", 1);
      await ctx.delete("item", item.id);
    } else {
      await ctx.patch("item", item.id, { onList: false, bought: false, lastBought: now });
      await ctx.increment("item", item.id, "timesBought", 1);
    }
  }
  ctx.ui.toast(
    ctx.t(
      "{n, plural, one {Put # thing away} other {Put # things away}}. Next time, tap the add box to bring them back.",
      { n: basket.length },
    ),
  );
}

/** "Ana" for a row someone else added, in a list more than one person writes to. */
function addedBy(item: Resolved, ctx: Ctx): string {
  const by = typeof item.createdBy === "string" ? item.createdBy : "";
  if (!by || by === ctx.me?.id || (ctx.space?.members.length ?? 1) < 2) return "";
  return ctx.space?.members.find((m) => m.id === by)?.name ?? "";
}

export default defineApp({
  id: "groceries",
  name: "Groceries",
  icon: "shopping-cart",
  version: "4.0.0",
  // 3.0.0: a bought item is remembered instead of deleted. A copy before it would show every
  // remembered item back on the list, so the data version moves and an older copy waits (KA-22).
  // 4.0.0: items belong to a list. A copy before it would show every list's items as one, so the
  // data version moves again.
  schemaVersion: 4,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  // No picture: a list is read in a shop, and a photo behind it only costs contrast.
  theme: { accent: "#5B9C5B" },
  permissions: { sync: true },
  category: "everyday",
  // Nothing to add by a button: the list has its own add box, and the usuals are one tap in it.
  quickActions: [],
  // One list at a time — the shell's switcher makes, renames, copies and deletes them.
  scope: { entity: "list", required: true },
  // The launcher tile (docs/04 §Tile): what is still to buy, in the order the list has it.
  tile: async (ctx) => {
    // One list's worth: the one being shown when there is one, else the first — the weekly shop, for
    // most people. Every list summed would be a number nobody shops by.
    const lists = await ctx.query("list");
    const list = listId(ctx) || String(lists[0]?.id ?? "");
    const left = (await ctx.query("item"))
      .filter((i) => onList(i) && !i.bought && relId(i.list) === list)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    return {
      count: left.length,
      title: ctx.t(
        "{n, plural, =0 {All bought} one {# to buy} other {# to buy}}",
        { n: left.length },
      ),
      lines: left.slice(0, 3).map((i) => String(i.name)),
    };
  },

  entities: {
    // A list: "Weekly shop", "Party", "Hardware store". Its items are the items pointing at it.
    list: {
      label: "List",
      icon: "notebook-pen",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: "Name",
          placeholder: "Weekly shop",
        },
      },
    },

    // The aisles of the shop you actually go to — so the list comes out in walking order.
    aisle: {
      label: "Aisle",
      icon: "compass",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: "Name",
          placeholder: "Produce",
        },
        order: { type: "number", integer: true, default: 0, hidden: true, label: "Order" },
      },
    },

    item: {
      label: "Item",
      icon: "shopping-cart",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: "Name",
          placeholder: "Milk",
        },
        aisle: {
          type: "relation",
          to: "aisle",
          label: "Aisle",
        },
        // The list it is on — the one being shown, when it is added there.
        list: { type: "relation", to: "list", hidden: true, label: "List" },
        quantity: {
          type: "text",
          label: "Quantity",
          placeholder: "2 × 1 l", // the same in every language
          help: "How much, in your own words",
        },
        for: {
          type: "member",
          label: "For",
          help: "Whose it is, when it is not the household's",
        },
        bought: {
          type: "boolean",
          default: false,
          label: "In the basket",
        },
        position: { type: "number", integer: true, default: 0, hidden: true, label: "Position" },
        note: {
          type: "text",
          multiline: true,
          label: "Note",
          placeholder: "The oat one, not barista",
        },
        // ---- memory: what makes Usuals. Kept by "Done shopping", not typed. ----
        onList: { type: "boolean", default: true, hidden: true, label: "On the list" },
        timesBought: { type: "number", integer: true, min: 0, default: 0, hidden: true, label: "Times bought" },
        lastBought: { type: "datetime", precision: "day", hidden: true, label: "Last bought" },
      },
      groups: [
        { title: "Item", fields: ["name", "quantity", "aisle"] },
        { title: "More", fields: ["note", "for", "bought"], collapsed: true },
      ],
      computed: {
        /** "2 × 1 l · Ana": the quieter line under a row. */
        line: { label: "Details", value: (i, ctx) => [String(i.quantity ?? ""), addedBy(i, ctx), i.for ? `→ ${String((i.for as { name?: string }).name ?? "")}` : ""].filter(Boolean).join(" · ") },
        memory: {
          label: "Bought",
          value: (i, ctx) => {
            const times = Number(i.timesBought) || 0;
            const last = dateOf(i.lastBought);
            if (!times) return ctx.t("Not yet");
            return ctx.t(
              "{n, plural, one {once} other {# times}}, last {when}",
              { n: times, when: last ? ctx.format.relative(last, { unit: "day" }) : "—" },
            );
          },
        },
      },
      actions: {
        // One tap from Usuals: back on the list, in the aisle it was in.
        again: {
          label: "Add",
          icon: "plus",
          run: async (item, ctx) => {
            const items = await ctx.query("item");
            const twin = items.find((o) => o.id !== item.id && onList(o) && norm(o.name) === norm(item.name));
            if (twin) {
              ctx.ui.toast(ctx.t("{name} is already on the list", { name: String(item.name ?? "") }));
              return;
            }
            await putOnList(ctx, item, items);
            ctx.ui.toast(ctx.t("{name} is on the list", { name: String(item.name ?? "") }));
          },
        },
      },
    },
  },

  pages: [
    {
      id: "shopping",
      title: "List",
      icon: "shopping-cart",
      description: "Tick things as they go in the basket. Done shopping puts them away for next time.",
      // One line above the list: what is left, and what is in the basket.
      summary: [
        {
          label: "to buy",
          value: (rows) => rows.filter((i) => !i.bought).length,
        },
        {
          label: "in the basket",
          value: (rows) => rows.filter((i) => i.bought).length,
        },
      ],
      // At the bottom of the screen, and only once something is in the basket.
      primaryAction: 0,
      actions: [
        {
          label: "Done shopping",
          icon: "check",
          run: doneShopping,
          when: (rows) => rows.some((i) => i.bought),
        },
      ],
      view: {
        type: "checklist",
        entity: "item",
        done: "bought",
        text: "name",
        detail: "line",
        filter: (i, ctx) => onThisList(i, ctx),
        group: "aisle",
        groupOrder: "order",
        reorder: "position",
        editText: true,
        // Ticked things fold away, so what is left to find stays on screen.
        hideDone: "collapse",
        doneLabel: "In the basket",
        // Type a name: earlier ones are offered as you go, and it lands in the aisle it was in last
        // time. A new one asks once, with a tap on its aisle: the app learns from you, in your words.
        quickAdd: {
          remember: ["aisle"],
          // Tap the box: what you usually buy, one tap each.
          usuals: (_rows, ctx) => usualNames(ctx),
        },
        emptyText: "Nothing on the list. Add the first thing below — tap the box for your usuals.",
        onOpen: { page: "item", param: { itemId: "id" } },
      },
    },
    {
      id: "item",
      title: "Item",
      hidden: true,
      view: {
        type: "detail",
        entity: "item",
        param: "itemId",
        cover: "band",
        actions: ["again"],
        sections: [
          { title: "Item", fields: ["quantity", "aisle", "for", "bought"] },
          { title: "Memory", fields: ["memory"] },
          { title: "Note", fields: ["note"] },
        ],
      },
    },
  ],

  migrations: [
    {
      from: "1.0.0",
      to: "2.0.0",
      // v1 kept the aisle as an enum, so an existing item points at an option, not a record. The
      // items keep everything else and arrive at the top of the list, under no heading, where one
      // tap on an aisle files each — which is the same flow a new item goes through.
      steps: [
        { op: "setDefaultForExisting", entity: "item", field: "aisle", value: null },
        { op: "addField", entity: "item", field: "position", default: 0 },
      ],
    },
    // Devices that last opened 2.1.0 or 2.2.0: their records did not change until 3.0.0.
    { from: "2.0.0", to: "2.3.0", steps: [] },
    { from: "2.1.0", to: "2.3.0", steps: [] },
    { from: "2.2.0", to: "2.3.0", steps: [] },
    {
      from: "3.0.0",
      to: "4.0.0",
      // Lists. Everything already there was one list, and stays one: the list it is now on.
      steps: [
        { op: "addRecord", entity: "list", id: "list-1", values: { name: "Shopping" } },
        { op: "addField", entity: "item", field: "list", default: "list-1" },
      ],
    },
    {
      from: "2.3.0",
      to: "3.0.0",
      // Bought things are remembered now. Everything already there is on the list, as it was, and
      // has not been bought through the app yet.
      steps: [
        { op: "addField", entity: "item", field: "onList", default: true },
        { op: "addField", entity: "item", field: "timesBought", default: 0 },
      ],
    },
  ],
});
