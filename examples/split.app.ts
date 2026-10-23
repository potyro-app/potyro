// split.app.ts
// Splitting costs with the people you share a flat, a trip or a dinner with. Made for the till: Add
// expense is the bar at the bottom. Above the expenses, the answer ("You're owed €42.85") and the
// shortest way to square it, one row per payment ("Tom owes you €12") with Settle on it; it opens
// on the group you were last in.
//
// Stresses: money in whole minor units (KA-26), `member` fields — the people in the shared space and
// the guests named before they join (`ctx.people`, `ctx.guests`), not a table of names the app
// maintains (KA-19) — the app-wide selection (`ctx.scope`), an
// `aggregate` view folding every expense into what each person is owed, and `ctx.caps.ai` reading a
// receipt into lines that the person then checks and assigns in one form (docs/23): the AI fills the
// form, the person decides.
//
// Splitting a bill is the archetypal shared app: it is worth nothing on one device, everyone must
// agree on the arithmetic to the cent, and the moment two people disagree about who paid for dinner
// the app has failed. So the money never leaves whole minor units, the split helpers hand out the
// remainder in a fixed order (`splitEvenly`, `splitByShares` — every device lands on the same
// cents), and who is in it comes from the space's membership rather than typed names that drift.
// A trip is planned before everyone has the app, so a group can name its guests — "Ana", "Tom" — and
// expenses name them like anyone else; whoever joins says which guest they are, and every expense that
// named the guest names them from then on. A guest is in the groups that name them: the flat's bills
// are not the Lisbon friends' business.
//
// Written in English; its translations are catalogs, examples/files/split/locales/<lang>.po (docs/30),
// every language but English a model's draft (#297). Amounts go through
// `ctx.format.money`, so a Pole reads "12,50 €" whichever box the app runs in — and the QuickJS
// fallback, which has no `Intl`, can format them at all. The names are people's, so they are never
// translated: "You" is the app's.
import { defineApp, splitByShares, splitEvenly, type AiValue, type Ctx, type Resolved } from "potyro";

/** A member value arrives resolved (a person) or as the account id it is stored as. */
const idOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return String((v as { id?: unknown }).id ?? "");
  return "";
};

const nameOf = (id: string, ctx: Ctx): string => {
  if (id === ctx.me?.id) return ctx.t("You");
  const person = ctx.people.find((p) => p.id === id) ?? ctx.space?.members.find((m) => m.id === id);
  return person?.name ?? ctx.t("Someone");
};

const money = (minor: number, ctx: Ctx): string => ctx.format.money(minor, "EUR");
const minorOf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

/** A record's group as a record: read with it, or the selected one when only its id came. */
const groupOf = (v: unknown, ctx: Ctx): Resolved | undefined => {
  if (v && typeof v === "object" && "people" in v) return v as unknown as Resolved;
  const id = idOf(v);
  return id && id === String(ctx.scope.group?.id ?? "") ? ctx.scope.group : undefined;
};

/**
 * Everyone in a group right now: the space's people (just you, solo — KA-19), and the guests the group
 * names who have not joined yet. A guest someone claimed reads as them, so they are counted once; a
 * guest taken off the list is not counted at all.
 */
const everyone = (ctx: Ctx, group?: unknown): string[] => {
  const members = ctx.people.filter((p) => !p.guest).map((p) => p.id);
  const open = new Set(ctx.people.filter((p) => p.guest).map((p) => p.id));
  const named = (Array.isArray(groupOf(group, ctx)?.people) ? (groupOf(group, ctx)!.people as unknown[]) : []).map(idOf).filter((id) => open.has(id));
  const out = [...new Set([...members, ...named].filter(Boolean))];
  return out.length ? out : [ctx.me?.id ?? ""].filter(Boolean);
};

/**
 * Who paid. Said by the expense; else whoever wrote it down, which is who paid nine times out of ten;
 * else — for sample records nobody wrote, in an app nobody else is in (a demo) or a group of one —
 * you. Without the last two, a sample expense would be paid by nobody and owed by everybody.
 */
function payerOf(expense: Resolved, ctx: Ctx): string {
  const said = idOf(expense.paidBy) || (typeof expense.createdBy === "string" ? expense.createdBy : "");
  if (said) return said;
  if (!ctx.space && ctx.me?.id) return ctx.me.id;
  const here = everyone(ctx, expense.group);
  return here.length === 1 ? here[0]! : "";
}

/** What everyone owes for each line of an itemized bill: a line with nobody named is everyone's. */
function itemShares(expense: Resolved, ctx: Ctx): Map<string, number> {
  const owes = new Map<string, number>();
  for (const line of (Array.isArray(expense.items) ? expense.items : []) as { price?: unknown; people?: unknown }[]) {
    const named = (Array.isArray(line.people) ? line.people : []).map(idOf).filter(Boolean);
    const people = named.length ? named : everyone(ctx, expense.group);
    splitEvenly(minorOf(line.price), people.length).forEach((cents, i) => owes.set(people[i]!, (owes.get(people[i]!) ?? 0) + cents));
  }
  return owes;
}

/** Who owes what for one expense, to the cent. Empty only when the split names nobody. */
function sharesOf(expense: Resolved, ctx: Ctx): { id: string; owes: number }[] {
  const amount = minorOf(expense.amount);
  if (expense.split === "shares") {
    const rows = (Array.isArray(expense.shares) ? expense.shares : []) as { person?: unknown; share?: unknown }[];
    const people = rows.map((r) => idOf(r.person)).filter(Boolean);
    const weights = rows.filter((r) => idOf(r.person)).map((r) => Number(r.share) || 0);
    return splitByShares(amount, weights).map((owes, i) => ({ id: people[i]!, owes }));
  }
  if (expense.split === "exact" || expense.split === "items") {
    const owes =
      expense.split === "items"
        ? itemShares(expense, ctx)
        : new Map(
            ((Array.isArray(expense.exact) ? expense.exact : []) as { person?: unknown; amount?: unknown }[])
              .filter((r) => idOf(r.person))
              .map((r) => [idOf(r.person), minorOf(r.amount)] as const),
          );
    // What the lines do not account for — a tip, a rounding, a line typed wrong — is everyone's,
    // in the same fixed order, so the shares always add up to what was paid.
    const rest = amount - [...owes.values()].reduce((a, b) => a + b, 0);
    if (rest !== 0) {
      const people = everyone(ctx, expense.group);
      splitEvenly(Math.abs(rest), people.length).forEach((cents, i) => owes.set(people[i]!, (owes.get(people[i]!) ?? 0) + Math.sign(rest) * cents));
    }
    return [...owes.entries()].map(([id, cents]) => ({ id, owes: cents }));
  }
  const listed = (Array.isArray(expense.between) ? expense.between : []).map(idOf).filter(Boolean);
  // Nobody listed reads as everyone here, which is what "split equally" means when you have not
  // said otherwise — and is the only reading that does not quietly drop an expense somebody paid.
  // (Expenses written before the form filled this in for you have an empty list; so does one whose
  // list was cleared by hand.) A listed set always wins, so an expense that names its people keeps
  // them even as the group grows.
  const people = listed.length ? listed : everyone(ctx, expense.group);
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
    move(payerOf(e, ctx), minorOf(e.amount));
    for (const s of shares) move(s.id, -s.owes);
  }
  // Paying someone back moves the debt, it does not create one.
  for (const p of payments) {
    const amount = minorOf(p.amount);
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

/** The group's expenses, payments and where everyone stands. */
async function standing(ctx: Ctx): Promise<{ expenses: Resolved[]; payments: Resolved[]; net: Map<string, number> }> {
  const expenses = (await ctx.query("expense")).filter((e) => inGroup(e, ctx));
  const payments = (await ctx.query("payment")).filter((p) => inGroup(p, ctx));
  return { expenses, payments, net: netBalances(expenses, payments, ctx) };
}

// ---- categories: what the person picked; "other" until they do ----

const CATEGORY_ICON: Record<string, string> = { food: "utensils", groceries: "shopping-cart", transport: "car", stay: "hotel", fun: "ticket", bills: "lightbulb", other: "receipt" };

/** What a receipt is read into. A line without a price is not an item; the total checks the lines. */
const RECEIPT = {
  shop: "text?",
  total: "number?",
  items: [{ name: "text", price: "number" }],
} as const;

/**
 * Split a receipt line by line. The photo goes to the AI service and nothing else does; what comes
 * back fills ONE form — every line, its price and who had it — which the person checks, corrects
 * and confirms. Without AI (none set up, or it could not read the photo) the same form opens empty,
 * to be typed: the app works without it.
 */
async function fromReceipt(ctx: Ctx): Promise<void> {
  let read: AiValue<typeof RECEIPT> | null = null;
  let photo: Awaited<ReturnType<Ctx["media"]["put"]>> | undefined;
  const ai = ctx.caps.ai;
  if (ai) {
    const how = await ctx.ui.sheet({
      title: ctx.t("Split a receipt"),
      items: [
        {
          id: "photo",
          icon: "camera",
          label: ctx.t("Read a photo of it"),
          detail: ctx.t("AI reads the lines; you check them before anything is saved"),
        },
        { id: "type", icon: "keyboard", label: ctx.t("Type the lines") },
      ],
    });
    if (!how) return;
    if (how === "photo") {
      const [file] = await ctx.files.import({ folder: "receipts", accept: "image/*" });
      if (!file) return; // the person closed the picker
      const bytes = await ctx.files.bytes(file);
      if (bytes) photo = await ctx.media.put(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.mime || "image/jpeg" }));
      const bar = ctx.ui.progress(ctx.t("Reading the receipt…"));
      try {
        read = await ai.extract({
          image: file,
          instructions:
            "A shop or restaurant receipt. One item per line bought, with its final price for that line. Skip subtotals, tax lines, payment and change lines. `total` is the amount actually paid.",
          schema: RECEIPT,
        });
      } catch (e) {
        ctx.ui.toast(e instanceof Error ? e.message : String(e));
      } finally {
        bar.done();
      }
    }
  }
  const lines = (read?.items ?? []).map((l) => ({ name: l.name, price: Math.round(l.price * 100), people: [] as string[] }));
  const sum = lines.reduce((n, l) => n + l.price, 0);
  const total = read?.total ? Math.round(read.total * 100) : 0;
  if (total > sum)
    lines.push({
      name: ctx.t("Rest of the bill (tax, tip)"),
      price: total - sum,
      people: [],
    });
  const add = ctx.t("Add expense");
  const filled = await ctx.ui.form<{ description: string; items: { name: string; price: number; people?: string[] }[] }>({
    title: ctx.t("Who had what?"),
    submit: add,
    fields: {
      description: {
        type: "text",
        required: true,
        label: ctx.t("Where"),
        placeholder: ctx.t("Dinner"),
      },
      items: {
        type: "list",
        label: ctx.t("Lines"),
        help: ctx.t("Leave a line with nobody named and everyone shares it"),
        of: {
          name: { type: "text", required: true, label: ctx.t("What") },
          price: { type: "money", currency: "EUR", required: true, min: 0, label: ctx.t("Price") },
          people: { type: "member", many: true, label: ctx.t("Who had it") },
        },
      },
    },
    initial: { description: read?.shop ?? "", items: lines },
  });
  if (!filled) return;
  const items = (filled.items ?? []).filter((l) => l.name && minorOf(l.price) > 0).map((l) => ({ name: l.name, price: minorOf(l.price), people: l.people ?? [] }));
  if (!items.length) {
    ctx.ui.toast(ctx.t("No lines with a price, so nothing to add."));
    return;
  }
  await ctx.create("expense", {
    description: filled.description,
    amount: items.reduce((n, l) => n + l.price, 0),
    paidBy: ctx.me?.id,
    when: ctx.now(),
    split: "items",
    items,
    group: ctx.scope.group?.id,
    category: "food",
    ...(photo ? { receipt: photo } : {}),
  });
  ctx.ui.toast(ctx.t("{n, plural, one {Added, # line} other {Added, # lines}}", { n: items.length }));
}

/**
 * Settle up, from the transfers that clear the board: tap one, confirm the amount, and it is recorded
 * as a payment — the balances move at once. When the money comes to you, the app offers a message to
 * send asking for it (payments themselves happen outside: no bank is ever connected).
 */
async function settleUp(ctx: Ctx, direct = false, given?: unknown): Promise<void> {
  const { net } = await standing(ctx);
  const moves = settlements(net);
  const other = "__other";
  // A row's Settle names its payment: straight to the form, filled in from it.
  const asked = given && typeof given === "object" ? (given as { from?: unknown; to?: unknown }) : undefined;
  const named = asked ? moves.findIndex((m) => m.from === asked.from && m.to === asked.to) : -1;
  const choice = named >= 0 ? String(named) : direct && moves.length === 1 ? "0" : await ctx.ui.sheet<string>({
    title: moves.length
      ? ctx.t("Settle up")
      : ctx.t("All square 🎉"),
    items: [
      ...moves.map((m, i) => ({
        id: String(i),
        icon: "banknote",
        label: `${nameOf(m.from, ctx)} → ${nameOf(m.to, ctx)}`,
        detail: money(m.amount, ctx),
      })),
      { id: other, icon: "plus", label: ctx.t("Record another payment") },
    ],
  });
  if (choice == null) return;
  const move = choice === other ? null : moves[Number(choice)];
  const filled = await ctx.ui.form<{ from: string; to: string; amount: number; note?: string }>({
    title: ctx.t("Record a payment"),
    submit: ctx.t("Record it"),
    fields: {
      from: { type: "member", required: true, label: ctx.t("From") },
      to: { type: "member", required: true, label: ctx.t("To") },
      amount: { type: "money", currency: "EUR", required: true, min: 0, label: ctx.t("Amount") },
      note: { type: "text", label: ctx.t("Note") },
    },
    initial: move ? { from: move.from, to: move.to, amount: move.amount } : { from: ctx.me?.id },
  });
  if (!filled || minorOf(filled.amount) <= 0) return;
  await ctx.create("payment", {
    from: filled.from,
    to: filled.to,
    amount: minorOf(filled.amount),
    when: ctx.now(),
    note: filled.note || ctx.t("Settling up"),
    group: ctx.scope.group?.id,
  });
  // It happened: say so. (Asking "send them a reminder?" here asked for money just paid.)
  ctx.ui.toast(ctx.t("Payment recorded"));
}

/**
 * Bring people in — the first thing a split needs. Two ways, because the trip is often planned before
 * everyone has the app: name them now ("Ana, Tom") so expenses can name them from the first coffee,
 * or send the link. Whoever joins later says which name is theirs (the shell asks), so the two meet.
 */
async function invite(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet<string>({
    title: ctx.t("Who's coming?"),
    items: [
      {
        id: "names",
        icon: "pencil",
        label: ctx.t("Name them now"),
        detail: ctx.t("Ana, Tom… they can join later and say which one they are"),
      },
      {
        id: "link",
        icon: "link",
        label: ctx.t("Send a link"),
        detail: ctx.t("Whoever opens it is in, no account needed"),
      },
    ],
  });
  if (how === "names") await nameGuests(ctx);
  else if (how === "link") await sendInvite(ctx);
}

/**
 * The others by name, before they join (`ctx.guests`): each becomes someone an expense can name, and
 * the group lists them, so they share its costs — and only its costs. A name already here is reused,
 * so typing "Ana" twice is one Ana.
 */
async function nameGuests(ctx: Ctx): Promise<void> {
  const group = ctx.scope.group;
  if (!group) return;
  const filled = await ctx.ui.form<{ names: string }>({
    title: ctx.t("Who's coming?"),
    submit: ctx.t("Add them"),
    fields: {
      names: {
        type: "text",
        required: true,
        label: ctx.t("Names"),
        placeholder: "Ana, Tom…",
        help: ctx.t("Separate them with commas"),
      },
    },
  });
  if (!filled?.names) return;
  // Commas, and the language's own "and": "Ana, Tom and Inês" is three people.
  const and = ctx.t("and");
  const typed = String(filled.names)
    .split(new RegExp(`[,;\\n]+|\\s+(?:${and}|&|\\+)\\s+`, "i"))
    .map((n) => n.trim())
    .filter(Boolean);
  // "Ana" and "ana" are one Ana: the first spelling stands.
  const seen = new Set<string>();
  const names = typed.filter((n) => !seen.has(n.toLocaleLowerCase()) && Boolean(seen.add(n.toLocaleLowerCase())));
  if (!names.length) return;
  const known = new Map(ctx.people.map((p) => [p.name.toLocaleLowerCase(), p.id] as const));
  const ids: string[] = [];
  try {
    for (const name of names) ids.push(known.get(name.toLocaleLowerCase()) ?? (await ctx.guests.add(name)).id);
  } catch (e) {
    ctx.ui.toast(e instanceof Error ? e.message : String(e));
    if (!ids.length) return;
  }
  const fresh = (await ctx.get("group", String(group.id))) ?? group;
  const before = (Array.isArray(fresh.people) ? fresh.people : []).map(idOf).filter(Boolean);
  await ctx.patch("group", String(group.id), { people: [...new Set([...before, ...ids])] });
  ctx.ui.toast(
    ctx.t(
      "{names} can be in expenses now",
      { names: ctx.format.list(names) },
    ),
  );
}

/**
 * The link. Inviting is the shell's (an app could otherwise hand its data to someone silently), so
 * this asks it for one and hands that on; no account is needed to open it. Where the shell has not
 * offered one yet — the app has never been shared — it says where to start.
 */
async function sendInvite(ctx: Ctx): Promise<void> {
  const link = ctx.space?.invite ? await ctx.space.invite().catch(() => "") : "";
  if (!link) {
    ctx.ui.toast(
      ctx.t("Open ⋯ and choose Share to invite people. No account needed."),
    );
    return;
  }
  await ctx.ui.share({
    url: link,
    title: String(ctx.scope.group?.name ?? ""),
    text: ctx.t("Join {group} on Split so we can share costs. No account needed.", { group: String(ctx.scope.group?.name ?? "") }),
  });
}

/** "Today", "Yesterday", "Sat 10 Oct": the heading a day's expenses sit under. */
function dayHeading(when: unknown, ctx: Ctx): string {
  const d = when instanceof Date ? when : new Date(String(when ?? 0));
  if (Number.isNaN(d.getTime())) return "";
  const today = ctx.today();
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86_400_000);
  if (days === 0 || days === -1) return ctx.format.relative(d, { unit: "day" });
  return ctx.format.date(d, { weekday: "short", day: "numeric", month: "short" });
}

export default defineApp({
  id: "split",
  name: "Split",
  icon: "receipt",
  version: "2.0.0",
  // 2.0.0: an expense can be split by exact amounts or line by line, and has a category. A copy
  // before it would read an itemized expense as split equally — two people, two different answers —
  // so the data version moves and an older copy waits for the newer one (KA-22).
  schemaVersion: 2,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  // No picture: splitting a bill needs the numbers, and a photo behind them only costs contrast.
  theme: { accent: "#3C9A8F" },
  // Sync: it is worth nothing on one phone. AI: only when a receipt is read, and only the photo goes.
  permissions: { sync: true, ai: true },
  category: "everyday",
  // The launcher tile (docs/04 §Tile): where you stand in the group, and the next payment that squares it.
  // The home screen has no selection of its own, so it is the selected group, else the first.
  tile: async (ctx) => {
    const group = ctx.scope.group ?? (await ctx.query("group"))[0];
    if (!group) return {};
    const mine = (r: Resolved): boolean => idOf(r.group) === String(group.id);
    const expenses = (await ctx.query("expense")).filter(mine);
    const net = netBalances(expenses, (await ctx.query("payment")).filter(mine), ctx);
    const you = net.get(ctx.me?.id ?? "") ?? 0;
    const amount = money(Math.abs(you), ctx);
    const title =
      you > 0
        ? ctx.t("You are owed {amount}", { amount })
        : you < 0
          ? ctx.t("You owe {amount}", { amount })
          : ctx.t("All square");
    const next = settlements(net).find((s) => s.from === ctx.me?.id || s.to === ctx.me?.id);
    const latest = [...expenses].sort((a, b) => new Date(String(b.when ?? 0)).getTime() - new Date(String(a.when ?? 0)).getTime())[0];
    return {
      title,
      lines: [
        String(group.name ?? ""),
        next ? `${nameOf(next.from, ctx)} → ${nameOf(next.to, ctx)} ${money(next.amount, ctx)}` : latest ? `${String(latest.description ?? "")} ${money(minorOf(latest.amount), ctx)}` : "",
      ].filter(Boolean),
    };
  },

  // The group is the app's selection, in the header, and every page follows it. `required` because
  // an expense with no group is an expense nobody can be asked to pay.
  scope: { entity: "group", label: "Group", required: true },

  entities: {
    group: {
      label: "Group",
      icon: "users",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: "Name",
          placeholder: "Lisbon weekend",
        },
        note: {
          type: "text",
          multiline: true,
          label: "Note",
          help: "What this group is for",
        },
        // The others before they have the app (docs/04 §Guests): names that expenses can name, and
        // that share this group's costs. Whoever joins says which one they are, and every expense that
        // named them names them from then on. Members are always in; a guest is in the groups that list them.
        people: {
          type: "member",
          many: true,
          label: "Not joined yet",
          help: "Name the others with Invite; whoever joins later says which one they are",
        },
      },
      actions: {
        // What a row under "To settle up" runs (the row cannot say which transfer it is, so with one
        // transfer it goes straight to the payment, and with several it asks which).
        settle: {
          label: "Settle up",
          icon: "banknote",
          // From a row of the balances, the row says which payment (`input`); else you choose.
          run: (_group, ctx, input) => settleUp(ctx, true, input),
        },
      },
    },

    expense: {
      label: "Expense",
      icon: "receipt",
      displayField: "description",
      fields: {
        description: {
          type: "text",
          required: true,
          label: "Description",
          placeholder: "Dinner",
        },
        amount: {
          type: "money",
          currency: "EUR",
          required: true,
          min: 0,
          label: "Amount",
        },
        // The group's people — members, and the guests named before they joined — never typed names.
        paidBy: {
          type: "member",
          label: "Paid by",
          default: (ctx) => ctx.me?.id,
        },
        when: {
          type: "datetime",
          precision: "day",
          default: (ctx) => ctx.now(),
          label: "When",
        },
        category: {
          type: "enum",
          label: "Category",
          options: ["food", "groceries", "transport", "stay", "fun", "bills", "other"],
          colors: { food: "orange", groceries: "green", transport: "blue", stay: "purple", fun: "pink", bills: "yellow", other: "grey" },
          labels: {
            food: "🍽 food & drink",
            groceries: "🛒 groceries",
            transport: "🚕 transport",
            stay: "🏨 stay",
            fun: "🎟 fun",
            bills: "💡 bills",
            other: "🧾 other",
          },
          help: "Left empty, it counts as other",
          control: "picker",
        },
        split: {
          type: "enum",
          label: { text: "Split", context: "expense split" },
          options: ["equally", "shares", "exact", "items"],
          labels: {
            equally: "equally",
            shares: "by shares",
            exact: "exact amounts",
            items: "line by line",
          },
          default: "equally",
          help: "Equally between the people below, by shares, by exact amounts, or line by line from a receipt",
        },
        between: {
          type: "member",
          label: "Between",
          many: true,
          help: "Who was in on it",
          // Everyone in the group — its guests too — because that is what "split equally" means nine times out of ten
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
            const ids = everyone(ctx, ctx.scope.group);
            return ids.length > 1 ? ids : [];
          },
        },
        shares: {
          type: "list",
          label: "By shares",
          help: "Two shares for a couple, one each for the rest",
          of: {
            person: { type: "member", label: "Person" },
            share: {
              type: "number",
              integer: true,
              min: 0,
              default: 1,
              label: "Share",
            },
          },
        },
        exact: {
          type: "list",
          label: "Exact amounts",
          help: "What each person's part was; anything left over is shared by everyone",
          of: {
            person: { type: "member", label: "Person" },
            amount: { type: "money", currency: "EUR", min: 0, label: "Amount" },
          },
        },
        items: {
          type: "list",
          label: "Lines",
          help: "A line with nobody named is everyone's",
          of: {
            name: { type: "text", label: "What" },
            price: { type: "money", currency: "EUR", min: 0, label: "Price" },
            people: { type: "member", many: true, label: "Who had it" },
          },
        },
        receipt: { type: "media", accept: "image", full: true, label: "Receipt" },
        note: { type: "text", multiline: true, label: "Note" },
        group: { type: "relation", to: "group", hidden: true, label: "Group", default: (ctx) => ctx.scope.group?.id },
      },
      groups: [
        { title: "Expense", fields: ["amount", "description", "category", "paidBy", "when"] },
        { title: "Who pays", fields: ["split", "between", "shares", "exact", "items"] },
        { title: "More", fields: ["receipt", "note"], collapsed: true },
      ],
      computed: {
        /** The category it has, or the one its words suggest. */
        kind: {
          label: "Category",
          labels: {
            food: "🍽 food & drink",
            groceries: "🛒 groceries",
            transport: "🚕 transport",
            stay: "🏨 stay",
            fun: "🎟 fun",
            bills: "💡 bills",
            other: "🧾 other",
          },
          value: (e: Resolved) => String(e.category || "other"),
        },
        /** "You 12,50 · Ana 12,50" — the arithmetic, spelled out, on the expense itself. */
        breakdown: {
          label: "Breakdown",
          value: (expense: Resolved, ctx: Ctx) =>
            sharesOf(expense, ctx)
              .map((s) => `${nameOf(s.id, ctx)} ${money(s.owes, ctx)}`)
              .join(" · ") || ctx.t("Nobody yet"),
        },
        /** For exact amounts and lines: whether they add up to what was paid, and by how much they do not. */
        check: {
          label: "Adds up?",
          value: (expense: Resolved, ctx: Ctx) => {
            if (expense.split !== "exact" && expense.split !== "items") return "—";
            const rows = (expense.split === "exact" ? expense.exact : expense.items) as { amount?: unknown; price?: unknown }[] | undefined;
            const listed = (rows ?? []).reduce((n, r) => n + minorOf(r.amount ?? r.price), 0);
            const rest = minorOf(expense.amount) - listed;
            return rest === 0
              ? ctx.t("✓ to the cent")
              : ctx.t(
                  "{rest} not on any line: shared by everyone",
                  { rest: money(Math.abs(rest), ctx) },
                );
          },
        },
        yourShare: { label: "Your share", value: (expense: Resolved, ctx: Ctx) => money(sharesOf(expense, ctx).find((s) => s.id === ctx.me?.id)?.owes ?? 0, ctx) },
      },
    },

    payment: {
      label: "Payment",
      icon: "banknote",
      displayField: "note",
      fields: {
        from: { type: "member", label: "From", default: (ctx) => ctx.me?.id },
        to: { type: "member", label: "To" },
        amount: {
          type: "money",
          currency: "EUR",
          required: true,
          min: 0,
          label: "Amount",
        },
        when: {
          type: "datetime",
          precision: "day",
          default: (ctx) => ctx.now(),
          label: "When",
        },
        note: {
          type: "text",
          label: "Note",
          placeholder: "Settling up",
        },
        group: { type: "relation", to: "group", hidden: true, label: "Group", default: (ctx) => ctx.scope.group?.id },
      },
    },
  },

  quickActions: [
    // No `open`: you have just filled the expense in, so its page has nothing to tell you. Landing
    // back on the group is landing on the answer — what everyone now owes.
    {
      id: "new-expense",
      label: "Add expense",
      icon: "plus",
      entity: "expense",
      mode: "form",
    },
    {
      id: "settle",
      label: "Record a payment",
      icon: "banknote",
      entity: "payment",
      mode: "form",
    },
  ],

  pages: [
    {
      id: "group",
      // "Expenses", not the group's name: the header's chip already says which group you are in,
      // and a tab labelled "Flat" next to a tab labelled "Payments" reads like two unrelated things.
      title: "Expenses",
      icon: "receipt",
      // The answer first (#105, Splitwise's group screen): where you stand, in the header; then who
      // owes whom and the way out of it; then what it is made of, by day.
      summary: [
        {
          // No label: the figure is the whole phrase ("You're owed €42.85"); which way it goes is the point.
          value: async (_rows, ctx) => {
            const you = (await standing(ctx)).net.get(ctx.me?.id ?? "") ?? 0;
            if (you === 0) return ctx.t({ text: "All square 🎉", context: "your balance" });
            return you > 0
              ? ctx.t("You're owed {amount}", { amount: money(you, ctx) })
              : ctx.t("You owe {amount}", { amount: money(-you, ctx) });
          },
        },
        {
          label: "Spent together",
          value: (rows, ctx) => money(rows.filter((e) => inGroup(e, ctx)).reduce((n, e) => n + minorOf(e.amount), 0), ctx),
        },
      ],
      primaryAction: "new-expense",
      // Settling is each row's Settle below (and Payments' own page); here only what adds to the group.
      actions: [
        { label: "Split a receipt", icon: "camera", run: fromReceipt },
        { label: "Invite", icon: "hand", run: invite },
      ],
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "expense",
              title: "To settle up",
              // Alone, there is nobody to owe: the empty balances are where the group starts — ask the others in.
              emptyText: (ctx) =>
                everyone(ctx, ctx.scope.group).some((id) => id !== ctx.me?.id)
                  ? ctx.t("Nobody owes anybody. 🎉")
                  : ctx.t("Just you so far. Tap Invite to name who's coming, or send them the link: no account needed."),
              // An aggregate has no `filter` of its own: the fold IS the filter, and it is handed
              // every expense the app holds — including the other groups'.
              rows: async (all, ctx) => {
                const expenses = all.filter((e) => inGroup(e, ctx));
                const payments = (await ctx.query("payment")).filter((p) => inGroup(p, ctx));
                const me = ctx.me?.id ?? "";
                // Where everyone stands IS who pays whom: one row per payment that squares the
                // group, as a sentence ("Tom owes you"), with Settle on it. The fewest payments.
                return settlements(netBalances(expenses, payments, ctx)).map((s) => ({
                  id: `${s.from}->${s.to}`,
                  label: ctx.t(
                    "{dir, select, toMe {{from} owes you} fromMe {You owe {to}} other {{from} owes {to}}}",
                    { dir: s.to === me ? "toMe" : s.from === me ? "fromMe" : "other", from: nameOf(s.from, ctx), to: nameOf(s.to, ctx) },
                  ),
                  value: money(s.amount, ctx),
                  tone: (s.to === me ? "positive" : s.from === me ? "negative" : "neutral") as "positive" | "negative" | "neutral",
                  // Tap Settle on the row: the payment is filled in from it, to confirm.
                  ...(ctx.scope.group
                    ? { action: { entity: "group", id: String(ctx.scope.group.id), key: "settle", label: ctx.t("Settle"), input: { from: s.from, to: s.to } } }
                    : {}),
                }));
              },
            },
          },
          {
            view: {
              type: "list",
              entity: "expense",
              filter: inGroup,
              sort: (a, b) => new Date(String(b.when ?? 0)).getTime() - new Date(String(a.when ?? 0)).getTime(),
              group: (e, ctx) => dayHeading(e.when, ctx),
              money: "amount",
              display: {
                primary: "description",
                // "You paid" and "Ana paid" are two forms in most languages. Polish says it in the
                // present ("Płaci Ana"): its past tense would need the payer's gender, which the app
                // does not know.
                secondary: (e: Resolved, ctx: Ctx) => {
                  const payer = payerOf(e, ctx);
                  return ctx.t(
                    "{who, select, me {You paid} other {{name} paid}} · your share {share}",
                    { who: payer === ctx.me?.id ? "me" : "other", name: nameOf(payer, ctx), share: String(e.yourShare) },
                  );
                },
                // The category's emoji leads the row: the feed's rhythm, and what it was at a glance.
                icon: (e: Resolved) => CATEGORY_ICON[String(e.kind)] ?? "receipt",
              },
              onOpen: { page: "expense", param: { expenseId: "id" } },
              emptyText: "No expenses yet. Add the first one, or split a receipt.",
            },
          },
        ],
      },
    },

    {
      // Where the money went: by category, by person, and over the days.
      id: "where",
      title: "Where it went",
      icon: "chart-bar",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "stats",
              entity: "expense",
              filter: inGroup,
              items: [
                {
                  label: "Spent together",
                  value: (rows, ctx) => money(rows.reduce((n, e) => n + minorOf(e.amount), 0), ctx),
                },
                {
                  label: "Your part of it",
                  value: (rows, ctx) => money(rows.reduce((n, e) => n + (sharesOf(e, ctx).find((s) => s.id === ctx.me?.id)?.owes ?? 0), 0), ctx),
                },
                {
                  label: "Expenses",
                  op: "count",
                },
              ],
            },
          },
          {
            view: {
              type: "chart",
              entity: "expense",
              filter: inGroup,
              title: "By category",
              emptyText: "Nothing spent yet.",
              series: (rows, ctx) => {
                const total = new Map<string, number>();
                for (const e of rows) total.set(String(e.kind), (total.get(String(e.kind)) ?? 0) + minorOf(e.amount));
                const said: Record<string, string> = {
                  food: ctx.t("🍽 food"),
                  groceries: ctx.t("🛒 groceries"),
                  transport: ctx.t("🚕 transport"),
                  stay: ctx.t("🏨 stay"),
                  fun: ctx.t("🎟 fun"),
                  bills: ctx.t("💡 bills"),
                  other: ctx.t("🧾 other"),
                };
                return [...total.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, cents]) => ({ label: said[kind] ?? kind, value: cents / 100, text: money(cents, ctx) }));
              },
            },
          },
          {
            view: {
              type: "chart",
              entity: "expense",
              filter: inGroup,
              title: "Who paid",
              series: (rows, ctx) => {
                const paid = new Map<string, number>();
                for (const e of rows) paid.set(payerOf(e, ctx), (paid.get(payerOf(e, ctx)) ?? 0) + minorOf(e.amount));
                return [...paid.entries()].filter(([id]) => id).map(([id, cents]) => ({ label: nameOf(id, ctx), value: cents / 100, text: money(cents, ctx) }));
              },
            },
          },
        ],
      },
    },

    {
      id: "history",
      title: "Payments",
      icon: "banknote",
      actions: [{ label: { text: "Settle up", context: "payments page" }, icon: "banknote", run: settleUp }],
      primaryAction: 0,
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
        // The receipt, when there is one, is the picture: the thing everyone checks the lines against.
        media: "receipt",
        facts: ["kind"],
        sections: [
          { title: "Expense", fields: ["amount", "paidBy", "when", "category"] },
          { title: { text: "Split", context: "expense split" }, fields: ["split", "between", "shares", "exact", "items", "check", "breakdown"] },
          { title: "Notes", fields: ["note"] },
        ],
      },
    },
  ],

  migrations: [
    // Devices that last opened 1.2.0 or 1.3.0: nothing in their records changed until 2.0.0.
    { from: "1.2.0", to: "1.4.0", steps: [] },
    { from: "1.3.0", to: "1.4.0", steps: [] },
    {
      from: "1.4.0",
      to: "2.0.0",
      // An expense gains a category (none yet: it is guessed from its words until someone picks
      // one), exact amounts and lines (empty: every old expense keeps the split it had).
      steps: [
        { op: "addField", entity: "expense", field: "category", default: null },
        { op: "addField", entity: "expense", field: "exact", default: [] },
        { op: "addField", entity: "expense", field: "items", default: [] },
      ],
    },
  ],
});
