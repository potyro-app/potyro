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
// In six languages (#303); every language but English is a model's draft (#297). Amounts go through
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
  if (id === ctx.me?.id) return ctx.t({ en: "You", "pt-BR": "Você", de: "Du", es: "Tú", pl: "Ty", it: "Tu" });
  const person = ctx.people.find((p) => p.id === id) ?? ctx.space?.members.find((m) => m.id === id);
  return person?.name ?? ctx.t({ en: "Someone", "pt-BR": "Alguém", de: "Jemand", es: "Alguien", pl: "Ktoś", it: "Qualcuno" });
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

// ---- categories: a guess from the words, which the person can always change ----

/** Words that say what an expense was, in the six languages the app speaks. First match wins. */
const KEYWORDS: [string, RegExp][] = [
  ["stay", /hotel|hostel|airbnb|apartment|apartamento|wohnung|unterkunft|alojamiento|nocleg|alloggio|pousada|room|quarto|zimmer/i],
  ["transport", /taxi|uber|bolt|tram|train|trem|zug|tren|pociąg|treno|bus|ônibus|metro|u-bahn|flight|voo|flug|vuelo|lot|volo|fuel|petrol|gasolina|benzin|paliwo|benzina|parking|tuk/i],
  ["groceries", /grocer|supermarket|mercado|supermercado|supermarkt|lidl|aldi|biedronka|żabka|pingo|continente|carrefour|rewe|edeka|shop|compras|einkauf|zakupy|spesa/i],
  ["bills", /internet|rent|aluguel|miete|alquiler|czynsz|affitto|electric|luz|strom|prąd|gas|water|água|wasser|agua|woda|acqua|phone|bill|conta|rechnung|factura|rachunek|bolletta|netflix|spotify|insurance/i],
  ["food", /dinner|lunch|breakfast|brunch|jantar|almoço|café|coffee|kaffee|abendessen|mittag|cena|comida|obiad|kolacja|pranzo|restaurant|restaurante|tasca|pizza|sushi|bar|beer|cerveja|bier|wine|vinho|wein|vino|wino|pastel|nata|ice cream|gelato|lody|sorvete|snack|takeaway|kebab/i],
  ["fun", /museum|museu|museo|muzeum|ticket|bilhete|eintritt|entrada|bilet|biglietto|cinema|kino|concert|show|fado|tour|boat|barco|surf|bike|game|party|festa|party|fiesta|impreza/i],
];

const guessCategory = (text: unknown): string => KEYWORDS.find(([, re]) => re.test(String(text ?? "")))?.[0] ?? "other";
const CATEGORY_EMOJI: Record<string, string> = { food: "🍽", groceries: "🛒", transport: "🚕", stay: "🏨", fun: "🎟", bills: "💡", other: "🧾" };

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
      title: ctx.t({ en: "Split a receipt", "pt-BR": "Dividir uma nota", de: "Beleg aufteilen", es: "Dividir un ticket", pl: "Podziel paragon", it: "Dividi uno scontrino" }),
      items: [
        {
          id: "photo",
          icon: "📷",
          label: ctx.t({ en: "Read a photo of it", "pt-BR": "Ler uma foto", de: "Foto lesen lassen", es: "Leer una foto", pl: "Odczytaj ze zdjęcia", it: "Leggi una foto" }),
          detail: ctx.t({
            en: "AI reads the lines; you check them before anything is saved",
            "pt-BR": "A IA lê as linhas; você confere antes de salvar",
            de: "Die KI liest die Zeilen; du prüfst sie, bevor etwas gespeichert wird",
            es: "La IA lee las líneas; tú las revisas antes de guardar",
            pl: "AI odczyta pozycje; sprawdzisz je przed zapisem",
            it: "L'IA legge le righe; tu le controlli prima di salvare",
          }),
        },
        { id: "type", icon: "⌨", label: ctx.t({ en: "Type the lines", "pt-BR": "Digitar as linhas", de: "Zeilen eintippen", es: "Escribir las líneas", pl: "Wpisz pozycje", it: "Scrivi le righe" }) },
      ],
    });
    if (!how) return;
    if (how === "photo") {
      const [file] = await ctx.files.import({ folder: "receipts", accept: "image/*" });
      if (!file) return; // the person closed the picker
      const bytes = await ctx.files.bytes(file);
      if (bytes) photo = await ctx.media.put(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.mime || "image/jpeg" }));
      const bar = ctx.ui.progress(ctx.t({ en: "Reading the receipt…", "pt-BR": "Lendo a nota…", de: "Beleg wird gelesen…", es: "Leyendo el ticket…", pl: "Czytam paragon…", it: "Leggo lo scontrino…" }));
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
      name: ctx.t({ en: "Rest of the bill (tax, tip)", "pt-BR": "Resto da conta (taxa, gorjeta)", de: "Rest der Rechnung (Steuer, Trinkgeld)", es: "Resto (impuestos, propina)", pl: "Reszta rachunku (podatek, napiwek)", it: "Resto del conto (tasse, mancia)" }),
      price: total - sum,
      people: [],
    });
  const add = ctx.t({ en: "Add expense", "pt-BR": "Adicionar despesa", de: "Ausgabe hinzufügen", es: "Añadir gasto", pl: "Dodaj wydatek", it: "Aggiungi spesa" });
  const filled = await ctx.ui.form<{ description: string; items: { name: string; price: number; people?: string[] }[] }>({
    title: ctx.t({ en: "Who had what?", "pt-BR": "Quem pediu o quê?", de: "Wer hatte was?", es: "¿Quién tomó qué?", pl: "Kto co zamawiał?", it: "Chi ha preso cosa?" }),
    submit: add,
    fields: {
      description: {
        type: "text",
        required: true,
        label: ctx.t({ en: "Where", "pt-BR": "Onde", de: "Wo", es: "Dónde", pl: "Gdzie", it: "Dove" }),
        placeholder: ctx.t({ en: "Dinner", "pt-BR": "Jantar", de: "Abendessen", es: "Cena", pl: "Kolacja", it: "Cena" }),
      },
      items: {
        type: "list",
        label: ctx.t({ en: "Lines", "pt-BR": "Linhas", de: "Zeilen", es: "Líneas", pl: "Pozycje", it: "Righe" }),
        help: ctx.t({
          en: "Leave a line with nobody named and everyone shares it",
          "pt-BR": "Uma linha sem ninguém marcado é de todos",
          de: "Eine Zeile ohne Namen teilen sich alle",
          es: "Una línea sin nadie marcado es de todos",
          pl: "Pozycja bez nikogo jest wspólna",
          it: "Una riga senza nessuno è di tutti",
        }),
        of: {
          name: { type: "text", required: true, label: ctx.t({ en: "What", "pt-BR": "O quê", de: "Was", es: "Qué", pl: "Co", it: "Cosa" }) },
          price: { type: "money", currency: "EUR", required: true, min: 0, label: ctx.t({ en: "Price", "pt-BR": "Preço", de: "Preis", es: "Precio", pl: "Cena", it: "Prezzo" }) },
          people: { type: "member", many: true, label: ctx.t({ en: "Who had it", "pt-BR": "Quem pediu", de: "Wer", es: "Quién", pl: "Kto", it: "Chi" }) },
        },
      },
    },
    initial: { description: read?.shop ?? "", items: lines },
  });
  if (!filled) return;
  const items = (filled.items ?? []).filter((l) => l.name && minorOf(l.price) > 0).map((l) => ({ name: l.name, price: minorOf(l.price), people: l.people ?? [] }));
  if (!items.length) {
    ctx.ui.toast(ctx.t({ en: "No lines with a price, so nothing to add.", "pt-BR": "Nenhuma linha com preço; nada a adicionar.", de: "Keine Zeile mit Preis, also nichts hinzuzufügen.", es: "Ninguna línea con precio; nada que añadir.", pl: "Brak pozycji z ceną, nic do dodania.", it: "Nessuna riga con prezzo, niente da aggiungere." }));
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
    category: guessCategory(filled.description) === "other" ? "food" : guessCategory(filled.description),
    ...(photo ? { receipt: photo } : {}),
  });
  ctx.ui.toast(ctx.t({ en: "{n, plural, one {Added, # line} other {Added, # lines}}", "pt-BR": "{n, plural, one {Adicionada, # linha} other {Adicionada, # linhas}}", de: "{n, plural, one {Hinzugefügt, # Zeile} other {Hinzugefügt, # Zeilen}}", es: "{n, plural, one {Añadido, # línea} other {Añadido, # líneas}}", pl: "{n, plural, one {Dodano, # pozycja} few {Dodano, # pozycje} many {Dodano, # pozycji} other {Dodano, # pozycji}}", it: "{n, plural, one {Aggiunta, # riga} other {Aggiunta, # righe}}" }, { n: items.length }));
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
      ? ctx.t({ en: "Settle up", "pt-BR": "Acertar as contas", de: "Ausgleichen", es: "Saldar cuentas", pl: "Rozlicz się", it: "Salda i conti" })
      : ctx.t({ en: "All square 🎉", "pt-BR": "Tudo certo 🎉", de: "Alles ausgeglichen 🎉", es: "Cuentas saldadas 🎉", pl: "Wszystko rozliczone 🎉", it: "Tutto in pari 🎉" }),
    items: [
      ...moves.map((m, i) => ({
        id: String(i),
        icon: "💸",
        label: `${nameOf(m.from, ctx)} → ${nameOf(m.to, ctx)}`,
        detail: money(m.amount, ctx),
      })),
      { id: other, icon: "＋", label: ctx.t({ en: "Record another payment", "pt-BR": "Registrar outro pagamento", de: "Andere Zahlung eintragen", es: "Registrar otro pago", pl: "Zapisz inną płatność", it: "Registra un altro pagamento" }) },
    ],
  });
  if (choice == null) return;
  const move = choice === other ? null : moves[Number(choice)];
  const filled = await ctx.ui.form<{ from: string; to: string; amount: number; note?: string }>({
    title: ctx.t({ en: "Record a payment", "pt-BR": "Registrar pagamento", de: "Zahlung eintragen", es: "Registrar pago", pl: "Zapisz płatność", it: "Registra pagamento" }),
    submit: ctx.t({ en: "Record it", "pt-BR": "Registrar", de: "Eintragen", es: "Registrar", pl: "Zapisz", it: "Registra" }),
    fields: {
      from: { type: "member", required: true, label: ctx.t({ en: "From", "pt-BR": "De", de: "Von", es: "De", pl: "Od", it: "Da" }) },
      to: { type: "member", required: true, label: ctx.t({ en: "To", "pt-BR": "Para", de: "An", es: "Para", pl: "Dla", it: "A" }) },
      amount: { type: "money", currency: "EUR", required: true, min: 0, label: ctx.t({ en: "Amount", "pt-BR": "Valor", de: "Betrag", es: "Importe", pl: "Kwota", it: "Importo" }) },
      note: { type: "text", label: ctx.t({ en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" }) },
    },
    initial: move ? { from: move.from, to: move.to, amount: move.amount } : { from: ctx.me?.id },
  });
  if (!filled || minorOf(filled.amount) <= 0) return;
  await ctx.create("payment", {
    from: filled.from,
    to: filled.to,
    amount: minorOf(filled.amount),
    when: ctx.now(),
    note: filled.note || ctx.t({ en: "Settling up", "pt-BR": "Acertando as contas", de: "Ausgleich", es: "Saldando cuentas", pl: "Rozliczenie", it: "Saldo dei conti" }),
    group: ctx.scope.group?.id,
  });
  // It happened: say so. (Asking "send them a reminder?" here asked for money just paid.)
  ctx.ui.toast(ctx.t({ en: "Payment recorded", "pt-BR": "Pagamento registrado", de: "Zahlung eingetragen", es: "Pago registrado", pl: "Płatność zapisana", it: "Pagamento registrato" }));
}

/**
 * Bring people in — the first thing a split needs. Two ways, because the trip is often planned before
 * everyone has the app: name them now ("Ana, Tom") so expenses can name them from the first coffee,
 * or send the link. Whoever joins later says which name is theirs (the shell asks), so the two meet.
 */
async function invite(ctx: Ctx): Promise<void> {
  const how = await ctx.ui.sheet<string>({
    title: ctx.t({ en: "Who's coming?", "pt-BR": "Quem vem?", de: "Wer ist dabei?", es: "¿Quién viene?", pl: "Kto jedzie?", it: "Chi viene?" }),
    items: [
      {
        id: "names",
        icon: "✍",
        label: ctx.t({ en: "Name them now", "pt-BR": "Dizer os nomes agora", de: "Jetzt mit Namen eintragen", es: "Escribir sus nombres ya", pl: "Wpisz ich imiona teraz", it: "Scrivi ora i nomi" }),
        detail: ctx.t({
          en: "Ana, Tom… they can join later and say which one they are",
          "pt-BR": "Ana, Tom… eles podem entrar depois e dizer quem são",
          de: "Ana, Tom… sie können später dazukommen und sagen, wer sie sind",
          es: "Ana, Tom… pueden unirse después y decir quién es quién",
          pl: "Ana, Tom… mogą dołączyć później i wskazać, kim są",
          it: "Ana, Tom… possono unirsi dopo e dire chi sono",
        }),
      },
      {
        id: "link",
        icon: "🔗",
        label: ctx.t({ en: "Send a link", "pt-BR": "Mandar um link", de: "Einen Link schicken", es: "Mandar un enlace", pl: "Wyślij link", it: "Manda un link" }),
        detail: ctx.t({ en: "Whoever opens it is in, no account needed", "pt-BR": "Quem abrir entra, sem conta", de: "Wer ihn öffnet, ist dabei, ohne Konto", es: "Quien lo abra entra, sin cuenta", pl: "Kto go otworzy, dołącza, bez konta", it: "Chi lo apre è dentro, senza account" }),
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
    title: ctx.t({ en: "Who's coming?", "pt-BR": "Quem vem?", de: "Wer ist dabei?", es: "¿Quién viene?", pl: "Kto jedzie?", it: "Chi viene?" }),
    submit: ctx.t({ en: "Add them", "pt-BR": "Adicionar", de: "Hinzufügen", es: "Añadir", pl: "Dodaj", it: "Aggiungi" }),
    fields: {
      names: {
        type: "text",
        required: true,
        label: ctx.t({ en: "Names", "pt-BR": "Nomes", de: "Namen", es: "Nombres", pl: "Imiona", it: "Nomi" }),
        placeholder: "Ana, Tom…",
        help: ctx.t({ en: "Separate them with commas", "pt-BR": "Separe com vírgulas", de: "Mit Kommas getrennt", es: "Sepáralos con comas", pl: "Oddziel je przecinkami", it: "Separali con virgole" }),
      },
    },
  });
  if (!filled?.names) return;
  // Commas, and the language's own "and": "Ana, Tom and Inês" is three people.
  const and = ctx.t({ en: "and", "pt-BR": "e", de: "und", es: "y", pl: "i", it: "e" });
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
      { en: "{names} can be in expenses now", "pt-BR": "{names} já podem entrar nas despesas", de: "{names} können jetzt in Ausgaben stehen", es: "{names} ya pueden estar en los gastos", pl: "{names} mogą już być w wydatkach", it: "{names} possono già stare nelle spese" },
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
      ctx.t({
        en: "Open ⋯ and choose Share to invite people. No account needed.",
        "pt-BR": "Abra ⋯ e escolha Compartilhar para convidar. Sem conta.",
        de: "Öffne ⋯ und wähle Teilen, um Leute einzuladen. Ohne Konto.",
        es: "Abre ⋯ y elige Compartir para invitar. Sin cuenta.",
        pl: "Otwórz ⋯ i wybierz Udostępnij, by zaprosić. Bez konta.",
        it: "Apri ⋯ e scegli Condividi per invitare. Senza account.",
      }),
    );
    return;
  }
  await ctx.ui.share({
    url: link,
    title: String(ctx.scope.group?.name ?? ""),
    text: ctx.t({
      en: "Join {group} on Split so we can share costs. No account needed.",
      "pt-BR": "Entre em {group} no Dividir para dividirmos as contas. Sem conta.",
      de: "Komm zu {group} in Aufteilen, damit wir Kosten teilen. Ohne Konto.",
      es: "Únete a {group} en Dividir para repartir gastos. Sin cuenta.",
      pl: "Dołącz do {group} w Podziale, żebyśmy dzielili koszty. Bez konta.",
      it: "Entra in {group} su Dividi per dividere le spese. Senza account.",
    }, { group: String(ctx.scope.group?.name ?? "") }),
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
  name: { en: "Split", "pt-BR": "Dividir", de: "Aufteilen", es: "Dividir", pl: "Podział", it: "Dividi" },
  icon: "🧾",
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
        ? ctx.t({ en: "You are owed {amount}", "pt-BR": "Você tem {amount} a receber", de: "Du bekommst {amount}", es: "Te deben {amount}", pl: "Masz do odebrania {amount}", it: "Devi ricevere {amount}" }, { amount })
        : you < 0
          ? ctx.t({ en: "You owe {amount}", "pt-BR": "Você deve {amount}", de: "Du schuldest {amount}", es: "Debes {amount}", pl: "Masz do oddania {amount}", it: "Devi {amount}" }, { amount })
          : ctx.t({ en: "All square", "pt-BR": "Tudo certo", de: "Alles ausgeglichen", es: "Cuentas saldadas", pl: "Wszystko rozliczone", it: "Tutto in pari" });
    const next = settlements(net).find((s) => s.from === ctx.me?.id || s.to === ctx.me?.id);
    const latest = [...expenses].sort((a, b) => new Date(String(b.when ?? 0)).getTime() - new Date(String(a.when ?? 0)).getTime())[0];
    return {
      title,
      lines: [
        String(group.name ?? ""),
        next ? `${nameOf(next.from, ctx)} → ${nameOf(next.to, ctx)} ${money(next.amount, ctx)}` : latest ? `${CATEGORY_EMOJI[String(latest.category || guessCategory(latest.description))] ?? "🧾"} ${String(latest.description ?? "")} ${money(minorOf(latest.amount), ctx)}` : "",
      ].filter(Boolean),
    };
  },

  // The group is the app's selection, in the header, and every page follows it. `required` because
  // an expense with no group is an expense nobody can be asked to pay.
  scope: { entity: "group", label: { en: "Group", "pt-BR": "Grupo", de: "Gruppe", es: "Grupo", pl: "Grupa", it: "Gruppo" }, required: true },

  entities: {
    group: {
      label: { en: "Group", "pt-BR": "Grupo", de: "Gruppe", es: "Grupo", pl: "Grupa", it: "Gruppo" },
      icon: "👥",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Lisbon weekend", "pt-BR": "Fim de semana em Lisboa", de: "Wochenende in Lissabon", es: "Finde en Lisboa", pl: "Weekend w Lizbonie", it: "Weekend a Lisbona" },
        },
        note: {
          type: "text",
          multiline: true,
          label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" },
          help: {
            en: "What this group is for",
            "pt-BR": "Para que serve este grupo",
            de: "Wofür diese Gruppe da ist",
            es: "Para qué es este grupo",
            pl: "Do czego jest ta grupa",
            it: "A cosa serve questo gruppo",
          },
        },
        // The others before they have the app (docs/04 §Guests): names that expenses can name, and
        // that share this group's costs. Whoever joins says which one they are, and every expense that
        // named them names them from then on. Members are always in; a guest is in the groups that list them.
        people: {
          type: "member",
          many: true,
          label: { en: "Not joined yet", "pt-BR": "Ainda não entraram", de: "Noch nicht dabei", es: "Aún no se han unido", pl: "Jeszcze nie dołączyli", it: "Non ancora entrati" },
          help: {
            en: "Name the others with Invite; whoever joins later says which one they are",
            "pt-BR": "Diga os nomes dos outros em Convidar; quem entrar depois diz quem é",
            de: "Trag die anderen über Einladen ein; wer später dazukommt, sagt, wer er ist",
            es: "Escribe a los demás con Invitar; quien se una después dice quién es",
            pl: "Wpisz pozostałych przez Zaproś; kto dołączy później, wskaże, kim jest",
            it: "Scrivi gli altri con Invita; chi si unisce dopo dice chi è",
          },
        },
      },
      actions: {
        // What a row under "To settle up" runs (the row cannot say which transfer it is, so with one
        // transfer it goes straight to the payment, and with several it asks which).
        settle: {
          label: { en: "Settle up", "pt-BR": "Acertar as contas", de: "Ausgleichen", es: "Saldar cuentas", pl: "Rozlicz się", it: "Salda i conti" },
          icon: "💸",
          // From a row of the balances, the row says which payment (`input`); else you choose.
          run: (_group, ctx, input) => settleUp(ctx, true, input),
        },
      },
    },

    expense: {
      label: { en: "Expense", "pt-BR": "Despesa", de: "Ausgabe", es: "Gasto", pl: "Wydatek", it: "Spesa" },
      icon: "🧾",
      displayField: "description",
      fields: {
        description: {
          type: "text",
          required: true,
          label: { en: "Description", "pt-BR": "Descrição", de: "Beschreibung", es: "Descripción", pl: "Opis", it: "Descrizione" },
          placeholder: { en: "Dinner", "pt-BR": "Jantar", de: "Abendessen", es: "Cena", pl: "Kolacja", it: "Cena" },
        },
        amount: {
          type: "money",
          currency: "EUR",
          required: true,
          min: 0,
          label: { en: "Amount", "pt-BR": "Valor", de: "Betrag", es: "Importe", pl: "Kwota", it: "Importo" },
        },
        // The group's people — members, and the guests named before they joined — never typed names.
        paidBy: {
          type: "member",
          label: { en: "Paid by", "pt-BR": "Pago por", de: "Bezahlt von", es: "Pagado por", pl: "Kto zapłacił", it: "Pagato da" },
          default: (ctx) => ctx.me?.id,
        },
        when: {
          type: "datetime",
          precision: "day",
          default: (ctx) => ctx.now(),
          label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" },
        },
        category: {
          type: "enum",
          label: { en: "Category", "pt-BR": "Categoria", de: "Kategorie", es: "Categoría", pl: "Kategoria", it: "Categoria" },
          options: ["food", "groceries", "transport", "stay", "fun", "bills", "other"],
          colors: { food: "orange", groceries: "green", transport: "blue", stay: "purple", fun: "pink", bills: "yellow", other: "grey" },
          labels: {
            food: { en: "🍽 food & drink", "pt-BR": "🍽 comida e bebida", de: "🍽 Essen & Trinken", es: "🍽 comida y bebida", pl: "🍽 jedzenie i picie", it: "🍽 cibo e bevande" },
            groceries: { en: "🛒 groceries", "pt-BR": "🛒 mercado", de: "🛒 Einkauf", es: "🛒 súper", pl: "🛒 zakupy", it: "🛒 spesa" },
            transport: { en: "🚕 transport", "pt-BR": "🚕 transporte", de: "🚕 Fahrten", es: "🚕 transporte", pl: "🚕 transport", it: "🚕 trasporti" },
            stay: { en: "🏨 stay", "pt-BR": "🏨 hospedagem", de: "🏨 Unterkunft", es: "🏨 alojamiento", pl: "🏨 nocleg", it: "🏨 alloggio" },
            fun: { en: "🎟 fun", "pt-BR": "🎟 passeios", de: "🎟 Freizeit", es: "🎟 ocio", pl: "🎟 rozrywka", it: "🎟 svago" },
            bills: { en: "💡 bills", "pt-BR": "💡 contas", de: "💡 Rechnungen", es: "💡 facturas", pl: "💡 rachunki", it: "💡 bollette" },
            other: { en: "🧾 other", "pt-BR": "🧾 outros", de: "🧾 Sonstiges", es: "🧾 otros", pl: "🧾 inne", it: "🧾 altro" },
          },
          help: {
            en: "Left empty, it is guessed from what it was for",
            "pt-BR": "Se vazio, é deduzido pela descrição",
            de: "Leer gelassen, wird sie aus dem Wofür erraten",
            es: "Si lo dejas vacío, se deduce de la descripción",
            pl: "Puste pole zostanie zgadnięte z opisu",
            it: "Se vuoto, si deduce dalla descrizione",
          },
          control: "picker",
        },
        split: {
          type: "enum",
          label: { en: "Split", "pt-BR": "Divisão", de: "Aufteilung", es: "Reparto", pl: "Podział", it: "Ripartizione" },
          options: ["equally", "shares", "exact", "items"],
          labels: {
            equally: { en: "equally", "pt-BR": "em partes iguais", de: "gleichmäßig", es: "a partes iguales", pl: "po równo", it: "in parti uguali" },
            shares: { en: "by shares", "pt-BR": "por cotas", de: "nach Anteilen", es: "por partes", pl: "według udziałów", it: "a quote" },
            exact: { en: "exact amounts", "pt-BR": "valores exatos", de: "genaue Beträge", es: "importes exactos", pl: "dokładne kwoty", it: "importi esatti" },
            items: { en: "line by line", "pt-BR": "item por item", de: "Zeile für Zeile", es: "línea a línea", pl: "pozycja po pozycji", it: "riga per riga" },
          },
          default: "equally",
          help: {
            en: "Equally between the people below, by shares, by exact amounts, or line by line from a receipt",
            "pt-BR": "Em partes iguais entre as pessoas abaixo, por cotas, por valores exatos ou item por item de uma nota",
            de: "Gleichmäßig unter den Leuten unten, nach Anteilen, nach genauen Beträgen oder Zeile für Zeile vom Beleg",
            es: "A partes iguales entre las personas de abajo, por partes, por importes exactos o línea a línea de un ticket",
            pl: "Po równo między osoby poniżej, według udziałów, dokładnymi kwotami albo pozycja po pozycji z paragonu",
            it: "In parti uguali tra le persone qui sotto, a quote, a importi esatti o riga per riga da uno scontrino",
          },
        },
        between: {
          type: "member",
          label: { en: "Between", "pt-BR": "Entre", de: "Geteilt unter", es: "Entre", pl: "Między", it: "Tra" },
          many: true,
          help: { en: "Who was in on it", "pt-BR": "Quem participou", de: "Wer dabei war", es: "Quién participó", pl: "Kto brał udział", it: "Chi c'era" },
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
          label: { en: "By shares", "pt-BR": "Por cotas", de: "Nach Anteilen", es: "Por partes", pl: "Według udziałów", it: "A quote" },
          help: {
            en: "Two shares for a couple, one each for the rest",
            "pt-BR": "Duas cotas para um casal, uma para cada um dos outros",
            de: "Zwei Anteile für ein Paar, einer für alle anderen",
            es: "Dos partes para una pareja, una para cada uno de los demás",
            pl: "Dwa udziały dla pary, po jednym dla reszty",
            it: "Due quote per una coppia, una a testa per gli altri",
          },
          of: {
            person: { type: "member", label: { en: "Person", "pt-BR": "Pessoa", de: "Person", es: "Persona", pl: "Osoba", it: "Persona" } },
            share: {
              type: "number",
              integer: true,
              min: 0,
              default: 1,
              label: { en: "Share", "pt-BR": "Cotas", de: "Anteile", es: "Partes", pl: "Udziały", it: "Quote" },
            },
          },
        },
        exact: {
          type: "list",
          label: { en: "Exact amounts", "pt-BR": "Valores exatos", de: "Genaue Beträge", es: "Importes exactos", pl: "Dokładne kwoty", it: "Importi esatti" },
          help: {
            en: "What each person's part was; anything left over is shared by everyone",
            "pt-BR": "A parte de cada um; o que sobrar é de todos",
            de: "Wie viel auf wen entfällt; was übrig bleibt, teilen sich alle",
            es: "La parte de cada uno; lo que sobre es de todos",
            pl: "Część każdej osoby; reszta jest wspólna",
            it: "La parte di ciascuno; quello che avanza è di tutti",
          },
          of: {
            person: { type: "member", label: { en: "Person", "pt-BR": "Pessoa", de: "Person", es: "Persona", pl: "Osoba", it: "Persona" } },
            amount: { type: "money", currency: "EUR", min: 0, label: { en: "Amount", "pt-BR": "Valor", de: "Betrag", es: "Importe", pl: "Kwota", it: "Importo" } },
          },
        },
        items: {
          type: "list",
          label: { en: "Lines", "pt-BR": "Linhas", de: "Zeilen", es: "Líneas", pl: "Pozycje", it: "Righe" },
          help: {
            en: "A line with nobody named is everyone's",
            "pt-BR": "Uma linha sem ninguém marcado é de todos",
            de: "Eine Zeile ohne Namen gehört allen",
            es: "Una línea sin nadie marcado es de todos",
            pl: "Pozycja bez nikogo jest wspólna",
            it: "Una riga senza nessuno è di tutti",
          },
          of: {
            name: { type: "text", label: { en: "What", "pt-BR": "O quê", de: "Was", es: "Qué", pl: "Co", it: "Cosa" } },
            price: { type: "money", currency: "EUR", min: 0, label: { en: "Price", "pt-BR": "Preço", de: "Preis", es: "Precio", pl: "Cena", it: "Prezzo" } },
            people: { type: "member", many: true, label: { en: "Who had it", "pt-BR": "Quem pediu", de: "Wer", es: "Quién", pl: "Kto", it: "Chi" } },
          },
        },
        receipt: { type: "media", accept: "image", full: true, label: { en: "Receipt", "pt-BR": "Nota", de: "Beleg", es: "Ticket", pl: "Paragon", it: "Scontrino" } },
        note: { type: "text", multiline: true, label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
        group: { type: "relation", to: "group", hidden: true, label: { en: "Group", "pt-BR": "Grupo", de: "Gruppe", es: "Grupo", pl: "Grupa", it: "Gruppo" }, default: (ctx) => ctx.scope.group?.id },
      },
      groups: [
        { title: { en: "Expense", "pt-BR": "Despesa", de: "Ausgabe", es: "Gasto", pl: "Wydatek", it: "Spesa" }, fields: ["amount", "description", "category", "paidBy", "when"] },
        { title: { en: "Who pays", "pt-BR": "Quem paga", de: "Wer zahlt", es: "Quién paga", pl: "Kto płaci", it: "Chi paga" }, fields: ["split", "between", "shares", "exact", "items"] },
        { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["receipt", "note"], collapsed: true },
      ],
      computed: {
        /** The category it has, or the one its words suggest. */
        kind: {
          label: { en: "Category", "pt-BR": "Categoria", de: "Kategorie", es: "Categoría", pl: "Kategoria", it: "Categoria" },
          labels: {
            food: { en: "🍽 food & drink", "pt-BR": "🍽 comida e bebida", de: "🍽 Essen & Trinken", es: "🍽 comida y bebida", pl: "🍽 jedzenie i picie", it: "🍽 cibo e bevande" },
            groceries: { en: "🛒 groceries", "pt-BR": "🛒 mercado", de: "🛒 Einkauf", es: "🛒 súper", pl: "🛒 zakupy", it: "🛒 spesa" },
            transport: { en: "🚕 transport", "pt-BR": "🚕 transporte", de: "🚕 Fahrten", es: "🚕 transporte", pl: "🚕 transport", it: "🚕 trasporti" },
            stay: { en: "🏨 stay", "pt-BR": "🏨 hospedagem", de: "🏨 Unterkunft", es: "🏨 alojamiento", pl: "🏨 nocleg", it: "🏨 alloggio" },
            fun: { en: "🎟 fun", "pt-BR": "🎟 passeios", de: "🎟 Freizeit", es: "🎟 ocio", pl: "🎟 rozrywka", it: "🎟 svago" },
            bills: { en: "💡 bills", "pt-BR": "💡 contas", de: "💡 Rechnungen", es: "💡 facturas", pl: "💡 rachunki", it: "💡 bollette" },
            other: { en: "🧾 other", "pt-BR": "🧾 outros", de: "🧾 Sonstiges", es: "🧾 otros", pl: "🧾 inne", it: "🧾 altro" },
          },
          value: (e: Resolved) => String(e.category || guessCategory(e.description)),
        },
        /** "You 12,50 · Ana 12,50" — the arithmetic, spelled out, on the expense itself. */
        breakdown: {
          label: { en: "Breakdown", "pt-BR": "Divisão", de: "Aufteilung", es: "Desglose", pl: "Podział", it: "Ripartizione" },
          value: (expense: Resolved, ctx: Ctx) =>
            sharesOf(expense, ctx)
              .map((s) => `${nameOf(s.id, ctx)} ${money(s.owes, ctx)}`)
              .join(" · ") || ctx.t({ en: "Nobody yet", "pt-BR": "Ninguém ainda", de: "Noch niemand", es: "Nadie todavía", pl: "Jeszcze nikt", it: "Ancora nessuno" }),
        },
        /** For exact amounts and lines: whether they add up to what was paid, and by how much they do not. */
        check: {
          label: { en: "Adds up?", "pt-BR": "Fecha?", de: "Geht es auf?", es: "¿Cuadra?", pl: "Czy się zgadza?", it: "Torna?" },
          value: (expense: Resolved, ctx: Ctx) => {
            if (expense.split !== "exact" && expense.split !== "items") return "—";
            const rows = (expense.split === "exact" ? expense.exact : expense.items) as { amount?: unknown; price?: unknown }[] | undefined;
            const listed = (rows ?? []).reduce((n, r) => n + minorOf(r.amount ?? r.price), 0);
            const rest = minorOf(expense.amount) - listed;
            return rest === 0
              ? ctx.t({ en: "✓ to the cent", "pt-BR": "✓ até o centavo", de: "✓ auf den Cent", es: "✓ al céntimo", pl: "✓ co do grosza", it: "✓ al centesimo" })
              : ctx.t(
                  {
                    en: "{rest} not on any line: shared by everyone",
                    "pt-BR": "{rest} fora das linhas: dividido entre todos",
                    de: "{rest} in keiner Zeile: teilen sich alle",
                    es: "{rest} fuera de las líneas: lo comparten todos",
                    pl: "{rest} poza pozycjami: dzielone na wszystkich",
                    it: "{rest} fuori dalle righe: diviso tra tutti",
                  },
                  { rest: money(Math.abs(rest), ctx) },
                );
          },
        },
        yourShare: { label: { en: "Your share", "pt-BR": "Sua parte", de: "Dein Anteil", es: "Tu parte", pl: "Twoja część", it: "La tua quota" }, value: (expense: Resolved, ctx: Ctx) => money(sharesOf(expense, ctx).find((s) => s.id === ctx.me?.id)?.owes ?? 0, ctx) },
      },
    },

    payment: {
      label: { en: "Payment", "pt-BR": "Pagamento", de: "Zahlung", es: "Pago", pl: "Płatność", it: "Pagamento" },
      icon: "💸",
      displayField: "note",
      fields: {
        from: { type: "member", label: { en: "From", "pt-BR": "De", de: "Von", es: "De", pl: "Od", it: "Da" }, default: (ctx) => ctx.me?.id },
        to: { type: "member", label: { en: "To", "pt-BR": "Para", de: "An", es: "Para", pl: "Dla", it: "A" } },
        amount: {
          type: "money",
          currency: "EUR",
          required: true,
          min: 0,
          label: { en: "Amount", "pt-BR": "Valor", de: "Betrag", es: "Importe", pl: "Kwota", it: "Importo" },
        },
        when: {
          type: "datetime",
          precision: "day",
          default: (ctx) => ctx.now(),
          label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" },
        },
        note: {
          type: "text",
          label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" },
          placeholder: { en: "Settling up", "pt-BR": "Acertando as contas", de: "Ausgleich", es: "Saldando cuentas", pl: "Rozliczenie", it: "Saldo dei conti" },
        },
        group: { type: "relation", to: "group", hidden: true, label: { en: "Group", "pt-BR": "Grupo", de: "Gruppe", es: "Grupo", pl: "Grupa", it: "Gruppo" }, default: (ctx) => ctx.scope.group?.id },
      },
    },
  },

  quickActions: [
    // No `open`: you have just filled the expense in, so its page has nothing to tell you. Landing
    // back on the group is landing on the answer — what everyone now owes.
    {
      id: "new-expense",
      label: { en: "Add expense", "pt-BR": "Adicionar despesa", de: "Ausgabe hinzufügen", es: "Añadir gasto", pl: "Dodaj wydatek", it: "Aggiungi spesa" },
      icon: "＋",
      entity: "expense",
      mode: "form",
    },
    {
      id: "settle",
      label: { en: "Record a payment", "pt-BR": "Registrar pagamento", de: "Zahlung eintragen", es: "Registrar pago", pl: "Zapisz płatność", it: "Registra pagamento" },
      icon: "💸",
      entity: "payment",
      mode: "form",
    },
  ],

  pages: [
    {
      id: "group",
      // "Expenses", not the group's name: the header's chip already says which group you are in,
      // and a tab labelled "Flat" next to a tab labelled "Payments" reads like two unrelated things.
      title: { en: "Expenses", "pt-BR": "Despesas", de: "Ausgaben", es: "Gastos", pl: "Wydatki", it: "Spese" },
      icon: "🧾",
      // The answer first (#105, Splitwise's group screen): where you stand, in the header; then who
      // owes whom and the way out of it; then what it is made of, by day.
      summary: [
        {
          // No label: the figure is the whole phrase ("You're owed €42.85"); which way it goes is the point.
          value: async (_rows, ctx) => {
            const you = (await standing(ctx)).net.get(ctx.me?.id ?? "") ?? 0;
            if (you === 0) return ctx.t({ en: "All square 🎉", "pt-BR": "Tudo certo 🎉", de: "Ausgeglichen 🎉", es: "En paz 🎉", pl: "Na zero 🎉", it: "In pari 🎉" });
            return you > 0
              ? ctx.t({ en: "You're owed {amount}", "pt-BR": "Você tem a receber {amount}", de: "Du bekommst {amount}", es: "Te deben {amount}", pl: "Masz do odebrania {amount}", it: "Devi ricevere {amount}" }, { amount: money(you, ctx) })
              : ctx.t({ en: "You owe {amount}", "pt-BR": "Você deve {amount}", de: "Du schuldest {amount}", es: "Debes {amount}", pl: "Masz do oddania {amount}", it: "Devi {amount}" }, { amount: money(-you, ctx) });
          },
        },
        {
          label: { en: "Spent together", "pt-BR": "Gasto juntos", de: "Zusammen ausgegeben", es: "Gastado juntos", pl: "Wydane razem", it: "Speso insieme" },
          value: (rows, ctx) => money(rows.filter((e) => inGroup(e, ctx)).reduce((n, e) => n + minorOf(e.amount), 0), ctx),
        },
      ],
      primaryAction: "new-expense",
      // Settling is each row's Settle below (and Payments' own page); here only what adds to the group.
      actions: [
        { label: { en: "Split a receipt", "pt-BR": "Dividir uma nota", de: "Beleg aufteilen", es: "Dividir un ticket", pl: "Podziel paragon", it: "Dividi uno scontrino" }, icon: "📷", run: fromReceipt },
        { label: { en: "Invite", "pt-BR": "Convidar", de: "Einladen", es: "Invitar", pl: "Zaproś", it: "Invita" }, icon: "👋", run: invite },
      ],
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "expense",
              title: { en: "To settle up", "pt-BR": "Para acertar", de: "Zum Ausgleichen", es: "Para saldar", pl: "Do rozliczenia", it: "Da saldare" },
              // Alone, there is nobody to owe: the empty balances are where the group starts — ask the others in.
              emptyText: (ctx) =>
                everyone(ctx, ctx.scope.group).some((id) => id !== ctx.me?.id)
                  ? ctx.t({ en: "Nobody owes anybody. 🎉", "pt-BR": "Ninguém deve nada a ninguém. 🎉", de: "Niemand schuldet jemandem etwas. 🎉", es: "Nadie le debe nada a nadie. 🎉", pl: "Nikt nikomu nic nie jest winien. 🎉", it: "Nessuno deve niente a nessuno. 🎉" })
                  : ctx.t({
                      en: "Just you so far. Tap Invite to name who's coming, or send them the link: no account needed.",
                      "pt-BR": "Por enquanto só você. Toque em Convidar para dizer quem vem, ou mande o link: sem conta.",
                      de: "Bisher nur du. Tippe auf Einladen, um einzutragen, wer dabei ist, oder schick den Link: ohne Konto.",
                      es: "De momento solo tú. Toca Invitar para decir quién viene, o manda el enlace: sin cuenta.",
                      pl: "Na razie tylko ty. Stuknij Zaproś, by wpisać, kto jedzie, albo wyślij link: bez konta.",
                      it: "Per ora solo tu. Tocca Invita per dire chi viene, o manda il link: senza account.",
                    }),
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
                    {
                      en: "{dir, select, toMe {{from} owes you} fromMe {You owe {to}} other {{from} owes {to}}}",
                      "pt-BR": "{dir, select, toMe {{from} te deve} fromMe {Você deve a {to}} other {{from} deve a {to}}}",
                      de: "{dir, select, toMe {{from} schuldet dir} fromMe {Du schuldest {to}} other {{from} schuldet {to}}}",
                      es: "{dir, select, toMe {{from} te debe} fromMe {Le debes a {to}} other {{from} le debe a {to}}}",
                      pl: "{dir, select, toMe {{from} ma ci oddać} fromMe {Oddajesz: {to}} other {{from} oddaje: {to}}}",
                      it: "{dir, select, toMe {{from} ti deve} fromMe {Devi a {to}} other {{from} deve a {to}}}",
                    },
                    { dir: s.to === me ? "toMe" : s.from === me ? "fromMe" : "other", from: nameOf(s.from, ctx), to: nameOf(s.to, ctx) },
                  ),
                  value: money(s.amount, ctx),
                  tone: (s.to === me ? "positive" : s.from === me ? "negative" : "neutral") as "positive" | "negative" | "neutral",
                  // Tap Settle on the row: the payment is filled in from it, to confirm.
                  ...(ctx.scope.group
                    ? { action: { entity: "group", id: String(ctx.scope.group.id), key: "settle", label: ctx.t({ en: "Settle", "pt-BR": "Acertar", de: "Ausgleichen", es: "Saldar", pl: "Rozlicz", it: "Salda" }), input: { from: s.from, to: s.to } } }
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
                    {
                      en: "{who, select, me {You paid} other {{name} paid}} · your share {share}",
                      "pt-BR": "{who, select, me {Você pagou} other {{name} pagou}} · sua parte {share}",
                      de: "{who, select, me {Du hast bezahlt} other {{name} hat bezahlt}} · dein Anteil {share}",
                      es: "{who, select, me {Pagaste tú} other {Pagó {name}}} · tu parte {share}",
                      pl: "{who, select, me {Płacisz ty} other {Płaci {name}}} · twoja część {share}",
                      it: "{who, select, me {Hai pagato tu} other {Ha pagato {name}}} · la tua quota {share}",
                    },
                    { who: payer === ctx.me?.id ? "me" : "other", name: nameOf(payer, ctx), share: String(e.yourShare) },
                  );
                },
                // The category's emoji leads the row: the feed's rhythm, and what it was at a glance.
                icon: (e: Resolved) => CATEGORY_EMOJI[String(e.kind)] ?? "🧾",
              },
              onOpen: { page: "expense", param: { expenseId: "id" } },
              emptyText: {
                en: "No expenses yet. Add the first one, or split a receipt.",
                "pt-BR": "Nenhuma despesa ainda. Adicione a primeira ou divida uma nota.",
                de: "Noch keine Ausgaben. Füge die erste hinzu oder teile einen Beleg auf.",
                es: "Aún no hay gastos. Añade el primero o divide un ticket.",
                pl: "Jeszcze nie ma wydatków. Dodaj pierwszy albo podziel paragon.",
                it: "Ancora nessuna spesa. Aggiungi la prima o dividi uno scontrino.",
              },
            },
          },
        ],
      },
    },

    {
      // Where the money went: by category, by person, and over the days.
      id: "where",
      title: { en: "Where it went", "pt-BR": "Para onde foi", de: "Wohin es ging", es: "A dónde fue", pl: "Na co poszło", it: "Dove è finito" },
      icon: "📊",
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
                  label: { en: "Spent together", "pt-BR": "Gasto juntos", de: "Zusammen ausgegeben", es: "Gastado juntos", pl: "Wydane razem", it: "Speso insieme" },
                  value: (rows, ctx) => money(rows.reduce((n, e) => n + minorOf(e.amount), 0), ctx),
                },
                {
                  label: { en: "Your part of it", "pt-BR": "Sua parte", de: "Dein Teil davon", es: "Tu parte", pl: "Twoja część", it: "La tua parte" },
                  value: (rows, ctx) => money(rows.reduce((n, e) => n + (sharesOf(e, ctx).find((s) => s.id === ctx.me?.id)?.owes ?? 0), 0), ctx),
                },
                {
                  label: { en: "Expenses", "pt-BR": "Despesas", de: "Ausgaben", es: "Gastos", pl: "Wydatki", it: "Spese" },
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
              title: { en: "By category", "pt-BR": "Por categoria", de: "Nach Kategorie", es: "Por categoría", pl: "Według kategorii", it: "Per categoria" },
              emptyText: { en: "Nothing spent yet.", "pt-BR": "Nada gasto ainda.", de: "Noch nichts ausgegeben.", es: "Aún no se ha gastado nada.", pl: "Jeszcze nic nie wydano.", it: "Ancora niente speso." },
              series: (rows, ctx) => {
                const total = new Map<string, number>();
                for (const e of rows) total.set(String(e.kind), (total.get(String(e.kind)) ?? 0) + minorOf(e.amount));
                const said: Record<string, string> = {
                  food: ctx.t({ en: "🍽 food", "pt-BR": "🍽 comida", de: "🍽 Essen", es: "🍽 comida", pl: "🍽 jedzenie", it: "🍽 cibo" }),
                  groceries: ctx.t({ en: "🛒 groceries", "pt-BR": "🛒 mercado", de: "🛒 Einkauf", es: "🛒 súper", pl: "🛒 zakupy", it: "🛒 spesa" }),
                  transport: ctx.t({ en: "🚕 transport", "pt-BR": "🚕 transporte", de: "🚕 Fahrten", es: "🚕 transporte", pl: "🚕 transport", it: "🚕 trasporti" }),
                  stay: ctx.t({ en: "🏨 stay", "pt-BR": "🏨 hospedagem", de: "🏨 Unterkunft", es: "🏨 alojamiento", pl: "🏨 nocleg", it: "🏨 alloggio" }),
                  fun: ctx.t({ en: "🎟 fun", "pt-BR": "🎟 passeios", de: "🎟 Freizeit", es: "🎟 ocio", pl: "🎟 rozrywka", it: "🎟 svago" }),
                  bills: ctx.t({ en: "💡 bills", "pt-BR": "💡 contas", de: "💡 Rechnungen", es: "💡 facturas", pl: "💡 rachunki", it: "💡 bollette" }),
                  other: ctx.t({ en: "🧾 other", "pt-BR": "🧾 outros", de: "🧾 Sonstiges", es: "🧾 otros", pl: "🧾 inne", it: "🧾 altro" }),
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
              title: { en: "Who paid", "pt-BR": "Quem pagou", de: "Wer bezahlt hat", es: "Quién pagó", pl: "Kto płacił", it: "Chi ha pagato" },
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
      title: { en: "Payments", "pt-BR": "Pagamentos", de: "Zahlungen", es: "Pagos", pl: "Płatności", it: "Pagamenti" },
      icon: "💸",
      actions: [{ label: { en: "Settle up", "pt-BR": "Acertar", de: "Ausgleichen", es: "Saldar", pl: "Rozlicz", it: "Salda" }, icon: "💸", run: settleUp }],
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
        emptyText: {
          en: "Nothing settled yet.",
          "pt-BR": "Nada acertado ainda.",
          de: "Noch nichts ausgeglichen.",
          es: "Aún no se ha saldado nada.",
          pl: "Jeszcze nic nie rozliczono.",
          it: "Ancora niente di saldato.",
        },
      },
    },

    {
      id: "expense",
      title: { en: "Expense", "pt-BR": "Despesa", de: "Ausgabe", es: "Gasto", pl: "Wydatek", it: "Spesa" },
      hidden: true,
      view: {
        type: "detail",
        entity: "expense",
        param: "expenseId",
        // The receipt, when there is one, is the picture: the thing everyone checks the lines against.
        media: "receipt",
        facts: ["kind"],
        sections: [
          { title: { en: "Expense", "pt-BR": "Despesa", de: "Ausgabe", es: "Gasto", pl: "Wydatek", it: "Spesa" }, fields: ["amount", "paidBy", "when", "category"] },
          { title: { en: "Split", "pt-BR": "Divisão", de: "Aufteilung", es: "Reparto", pl: "Podział", it: "Ripartizione" }, fields: ["split", "between", "shares", "exact", "items", "check", "breakdown"] },
          { title: { en: "Notes", "pt-BR": "Observações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["note"] },
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
