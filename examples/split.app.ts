// split.app.ts
// Stresses: money in whole minor units (KA-26), `member` fields — the people in the shared space,
// not a table of names the app maintains (KA-19) — the app-wide selection (`ctx.scope`), and an
// `aggregate` view folding every expense into what each person is owed.
//
// Splitting a bill is the archetypal shared app: it is worth nothing on one device, everyone must
// agree on the arithmetic to the cent, and the moment two people disagree about who paid for dinner
// the app has failed. So the money never leaves whole minor units, the split helpers hand out the
// remainder in a fixed order (`splitEvenly`, `splitByShares` — every device lands on the same
// cents), and who is in it comes from the space's membership rather than typed names that drift.
import { defineApp, formatMoney, splitByShares, splitEvenly, type Ctx, type Resolved } from "karta";

/** A member value arrives resolved (a person) or as the account id it is stored as. */
const idOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return String((v as { id?: unknown }).id ?? "");
  return "";
};

const nameOf = (id: string, ctx: Ctx): string => {
  if (id === ctx.me?.id) return "You";
  const person = ctx.space?.members.find((m) => m.id === id);
  return person?.name ?? "Someone";
};

const money = (minor: number): string => formatMoney(minor, "EUR");

/** Everyone in the group right now — the app's people are the space's people (KA-19). */
const everyone = (ctx: Ctx): string[] => {
  const members = (ctx.space?.members ?? []).map((m) => m.id).filter(Boolean);
  return members.length ? members : [ctx.me?.id ?? ""].filter(Boolean);
};

/** Who owes what for one expense, to the cent. Empty only when the shares name nobody. */
function sharesOf(expense: Resolved, ctx: Ctx): { id: string; owes: number }[] {
  const amount = typeof expense.amount === "number" ? expense.amount : 0;
  if (expense.split === "shares") {
    const rows = (Array.isArray(expense.shares) ? expense.shares : []) as { person?: unknown; share?: unknown }[];
    const people = rows.map((r) => idOf(r.person)).filter(Boolean);
    const weights = rows.filter((r) => idOf(r.person)).map((r) => Number(r.share) || 0);
    return splitByShares(amount, weights).map((owes, i) => ({ id: people[i]!, owes }));
  }
  const listed = (Array.isArray(expense.between) ? expense.between : []).map(idOf).filter(Boolean);
  // Nobody listed reads as everyone here, which is what "split equally" means when you have not
  // said otherwise — and is the only reading that does not quietly drop an expense somebody paid.
  // (Expenses written before the form filled this in for you have an empty list; so does one whose
  // list was cleared by hand.) A listed set always wins, so an expense that names its people keeps
  // them even as the group grows.
  const people = listed.length ? listed : everyone(ctx);
  return splitEvenly(amount, people.length).map((owes, i) => ({ id: people[i]!, owes }));
}

/** Everyone's net position: what they paid, less what was theirs to pay, plus what they settled. */
function netBalances(expenses: Resolved[], payments: Resolved[], ctx: Ctx): Map<string, number> {
  const net = new Map<string, number>();
  const move = (id: string, by: number): void => {
    if (id) net.set(id, (net.get(id) ?? 0) + by);
  };
  for (const e of expenses) {
    const shares = sharesOf(e, ctx);
    // Only a `shares` split can still name nobody, and one of those is an expense half filled in:
    // crediting whoever paid for it would tell the others they owe them for it.
    if (shares.length === 0) continue;
    move(idOf(e.paidBy), typeof e.amount === "number" ? e.amount : 0);
    for (const s of shares) move(s.id, -s.owes);
  }
  // Paying someone back moves the debt, it does not create one.
  for (const p of payments) {
    const amount = typeof p.amount === "number" ? p.amount : 0;
    move(idOf(p.from), amount);
    move(idOf(p.to), -amount);
  }
  return net;
}

/**
 * The shortest set of payments that clears the board: the biggest debtor pays the biggest creditor
 * until nobody is owed anything. Not the only answer, but a deterministic one — and three payments
 * between four people beats everyone paying everyone.
 */
function settlements(net: Map<string, number>): { from: string; to: string; amount: number }[] {
  const owed = [...net.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const owes = [...net.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  const credit = owed.map(([id, v]) => ({ id, v }));
  const debit = owes.map(([id, v]) => ({ id, v: -v }));
  while (i < credit.length && j < debit.length) {
    const amount = Math.min(credit[i]!.v, debit[j]!.v);
    if (amount > 0) out.push({ from: debit[j]!.id, to: credit[i]!.id, amount });
    credit[i]!.v -= amount;
    debit[j]!.v -= amount;
    if (credit[i]!.v === 0) i += 1;
    if (debit[j]!.v === 0) j += 1;
  }
  return out;
}

/** This group's records. Everything is scoped: another group's dinner is not your business. */
const inGroup = (record: Resolved, ctx: Ctx): boolean => idOf(record.group) === String(ctx.scope.group?.id ?? "");

export default defineApp({
  id: "split",
  name: "Split",
  icon: "🧾",
  version: "1.2.0",
  schemaVersion: 1,
  theme: { accent: "#3C9A8F" },
  permissions: { sync: true },

  // The group is the app's selection, in the header, and every page follows it. `required` because
  // an expense with no group is an expense nobody can be asked to pay.
  scope: { entity: "group", label: "Group", required: true },

  entities: {
    group: {
      label: "Group",
      icon: "🏠",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, placeholder: "Flat" },
        note: { type: "text", multiline: true, help: "What this group is for" },
      },
    },

    expense: {
      label: "Expense",
      icon: "🧾",
      displayField: "description",
      fields: {
        description: { type: "text", required: true, placeholder: "Dinner" },
        amount: { type: "money", currency: "EUR", required: true, min: 0 },
        // The space's members, so the list is who is actually here — no names to keep in step.
        paidBy: { type: "member", label: "Paid by", default: (ctx) => ctx.me?.id },
        when: { type: "datetime", precision: "day", default: (ctx) => ctx.now() },
        split: {
          type: "enum",
          label: "Split",
          options: ["equally", "shares"],
          default: "equally",
          help: "Equally between the people below, or by shares",
        },
        between: {
          type: "member",
          label: "Between",
          many: true,
          help: "Who was in on it",
          // Everyone in the group, because that is what "split equally" means nine times out of ten
          // — and an expense that starts with nobody in it credits whoever paid and charges no one,
          // which is how two people who each paid for dinner end up both being "owed" in full.
          // Captured at creation: someone who joins next month was not at this dinner.
          //
          // EXCEPT when you are the only one here. "Split between me" is not a split — you cannot
          // owe yourself — so it is left unset, which `sharesOf` reads as "everyone, whoever that
          // is when the maths runs". Otherwise every expense written before you shared the app is
          // invisible to the person you shared it with: they see it in the list with a share of
          // €0.00, which reads as a broken app rather than as a decision about who was there.
          default: (ctx) => {
            const ids = (ctx.space?.members ?? []).map((m) => m.id).filter(Boolean);
            return ids.length > 1 ? ids : [];
          },
        },
        shares: {
          type: "list",
          label: "By shares",
          help: "Two shares for a couple, one each for the rest",
          of: {
            person: { type: "member" },
            share: { type: "number", integer: true, min: 0, default: 1 },
          },
        },
        note: { type: "text", multiline: true },
        group: { type: "relation", to: "group", hidden: true, default: (ctx) => ctx.scope.group?.id },
      },
      groups: [
        { title: "Expense", fields: ["description", "amount", "paidBy", "when"] },
        { title: "Who pays", fields: ["split", "between", "shares"] },
        { title: "More", fields: ["note"], collapsed: true },
      ],
      computed: {
        /** "You 12,50 · Ana 12,50" — the arithmetic, spelled out, on the expense itself. */
        breakdown: (expense: Resolved, ctx: Ctx) =>
          sharesOf(expense, ctx)
            .map((s) => `${nameOf(s.id, ctx)} ${money(s.owes)}`)
            .join(" · ") || "Nobody yet",
        yourShare: (expense: Resolved, ctx: Ctx) => money(sharesOf(expense, ctx).find((s) => s.id === ctx.me?.id)?.owes ?? 0),
      },
    },

    payment: {
      label: "Payment",
      icon: "💸",
      displayField: "note",
      fields: {
        from: { type: "member", label: "From", default: (ctx) => ctx.me?.id },
        to: { type: "member", label: "To" },
        amount: { type: "money", currency: "EUR", required: true, min: 0 },
        when: { type: "datetime", precision: "day", default: (ctx) => ctx.now() },
        note: { type: "text", placeholder: "Settling up" },
        group: { type: "relation", to: "group", hidden: true, default: (ctx) => ctx.scope.group?.id },
      },
    },
  },

  quickActions: [
    // No `open`: you have just filled the expense in, so its page has nothing to tell you. Landing
    // back on the group is landing on the answer — what everyone now owes.
    { id: "new-expense", label: "Add expense", icon: "🧾", entity: "expense", mode: "form" },
    { id: "settle", label: "Settle up", icon: "💸", entity: "payment", mode: "form" },
  ],

  pages: [
    {
      id: "group",
      // "Expenses", not the group's name: the header's chip already says which group you are in,
      // and a tab labelled "Flat" next to a tab labelled "Payments" reads like two unrelated things.
      title: "Expenses",
      icon: "🧾",
      // Both halves of Splitwise's group screen on one page (#105): where everyone stands, then
      // what it is made of.
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "expense",
              title: "Balances",
              emptyText: "Nobody owes anybody.",
              // An aggregate has no `filter` of its own: the fold IS the filter, and it is handed
              // every expense the app holds — including the other groups'.
              rows: async (all, ctx) => {
                const expenses = all.filter((e) => inGroup(e, ctx));
                const payments = (await ctx.query("payment")).filter((p) => inGroup(p, ctx));
                const net = netBalances(expenses, payments, ctx);
                const people = [...net.entries()].filter(([, v]) => v !== 0);
                return [
                  ...people
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, v]) => ({
                      id,
                      label: nameOf(id, ctx),
                      value: money(Math.abs(v)),
                      detail: v > 0 ? (id === ctx.me?.id ? "you are owed" : "is owed") : id === ctx.me?.id ? "you owe" : "owes",
                      tone: (id === ctx.me?.id ? (v > 0 ? "positive" : "negative") : "neutral") as "positive" | "negative" | "neutral",
                      group: "Where everyone stands",
                    })),
                  // The way out of it, in as few payments as possible.
                  ...settlements(net).map((s) => ({
                    id: `${s.from}->${s.to}`,
                    label: `${nameOf(s.from, ctx)} → ${nameOf(s.to, ctx)}`,
                    value: money(s.amount),
                    tone: "neutral" as const,
                    group: "To settle up",
                  })),
                ];
              },
            },
          },
          {
            view: {
              type: "list",
              entity: "expense",
              filter: inGroup,
              sort: (a, b) => new Date(String(b.when ?? 0)).getTime() - new Date(String(a.when ?? 0)).getTime(),
              money: "amount",
              display: {
                primary: "description",
                secondary: (e: Resolved, ctx: Ctx) => `${nameOf(idOf(e.paidBy), ctx)} paid · your share ${e.yourShare}`,
              },
              onOpen: { page: "expense", param: { expenseId: "id" } },
              emptyText: "No expenses yet. Add the first one below.",
            },
          },
        ],
      },
    },

    {
      id: "history",
      title: "Payments",
      icon: "💸",
      view: {
        type: "list",
        entity: "payment",
        filter: inGroup,
        sort: (a, b) => new Date(String(b.when ?? 0)).getTime() - new Date(String(a.when ?? 0)).getTime(),
        money: "amount",
        display: {
          primary: (p: Resolved, ctx: Ctx) => `${nameOf(idOf(p.from), ctx)} → ${nameOf(idOf(p.to), ctx)}`,
          secondary: "note",
        },
        emptyText: "Nothing settled yet.",
      },
    },

    {
      id: "expense",
      title: "Expense",
      hidden: true,
      view: {
        type: "detail",
        entity: "expense",
        param: "expenseId",
        sections: [
          { title: "Expense", fields: ["amount", "paidBy", "when"] },
          { title: "Split", fields: ["split", "between", "shares", "breakdown"] },
          { title: "Notes", fields: ["note"] },
        ],
      },
    },
  ],
});
