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
//
// In six languages (#303); every language but English is a model's draft (#297). Amounts go through
// `ctx.format.money`, so a Pole reads "12,50 €" and the sealed box, which has no `Intl`, can format
// them at all. The names are the space's people, so they are never translated: "You" is the app's.
import { defineApp, splitByShares, splitEvenly, type Ctx, type Resolved } from "potyro";

/** A member value arrives resolved (a person) or as the account id it is stored as. */
const idOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return String((v as { id?: unknown }).id ?? "");
  return "";
};

const nameOf = (id: string, ctx: Ctx): string => {
  if (id === ctx.me?.id) return ctx.t({ en: "You", "pt-BR": "Você", de: "Du", es: "Tú", pl: "Ty", it: "Tu" });
  const person = ctx.space?.members.find((m) => m.id === id);
  return person?.name ?? ctx.t({ en: "Someone", "pt-BR": "Alguém", de: "Jemand", es: "Alguien", pl: "Ktoś", it: "Qualcuno" });
};

const money = (minor: number, ctx: Ctx): string => ctx.format.money(minor, "EUR");

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
  name: { en: "Split", "pt-BR": "Dividir", de: "Aufteilen", es: "Dividir", pl: "Podział", it: "Dividi" },
  icon: "🧾",
  version: "1.3.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#3C9A8F" },
  permissions: { sync: true },

  // The group is the app's selection, in the header, and every page follows it. `required` because
  // an expense with no group is an expense nobody can be asked to pay.
  scope: { entity: "group", label: { en: "Group", "pt-BR": "Grupo", de: "Gruppe", es: "Grupo", pl: "Grupa", it: "Gruppo" }, required: true },

  entities: {
    group: {
      label: { en: "Group", "pt-BR": "Grupo", de: "Gruppe", es: "Grupo", pl: "Grupa", it: "Gruppo" },
      icon: "🏠",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Flat", "pt-BR": "Apê", de: "WG", es: "Piso", pl: "Mieszkanie", it: "Casa" },
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
        // The space's members, so the list is who is actually here — no names to keep in step.
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
        split: {
          type: "enum",
          label: { en: "Split", "pt-BR": "Divisão", de: "Aufteilung", es: "Reparto", pl: "Podział", it: "Ripartizione" },
          options: ["equally", "shares"],
          labels: {
            equally: { en: "equally", "pt-BR": "em partes iguais", de: "gleichmäßig", es: "a partes iguales", pl: "po równo", it: "in parti uguali" },
            shares: { en: "shares", "pt-BR": "por cotas", de: "nach Anteilen", es: "por partes", pl: "według udziałów", it: "a quote" },
          },
          default: "equally",
          help: {
            en: "Equally between the people below, or by shares",
            "pt-BR": "Em partes iguais entre as pessoas abaixo, ou por cotas",
            de: "Gleichmäßig unter den Leuten unten, oder nach Anteilen",
            es: "A partes iguales entre las personas de abajo, o por partes",
            pl: "Po równo między osoby poniżej albo według udziałów",
            it: "In parti uguali tra le persone qui sotto, o a quote",
          },
        },
        between: {
          type: "member",
          label: { en: "Between", "pt-BR": "Entre", de: "Geteilt unter", es: "Entre", pl: "Między", it: "Tra" },
          many: true,
          help: { en: "Who was in on it", "pt-BR": "Quem participou", de: "Wer dabei war", es: "Quién participó", pl: "Kto brał udział", it: "Chi c'era" },
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
        note: { type: "text", multiline: true, label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
        group: { type: "relation", to: "group", hidden: true, default: (ctx) => ctx.scope.group?.id },
      },
      groups: [
        { title: { en: "Expense", "pt-BR": "Despesa", de: "Ausgabe", es: "Gasto", pl: "Wydatek", it: "Spesa" }, fields: ["description", "amount", "paidBy", "when"] },
        { title: { en: "Who pays", "pt-BR": "Quem paga", de: "Wer zahlt", es: "Quién paga", pl: "Kto płaci", it: "Chi paga" }, fields: ["split", "between", "shares"] },
        { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["note"], collapsed: true },
      ],
      computed: {
        /** "You 12,50 · Ana 12,50" — the arithmetic, spelled out, on the expense itself. */
        breakdown: (expense: Resolved, ctx: Ctx) =>
          sharesOf(expense, ctx)
            .map((s) => `${nameOf(s.id, ctx)} ${money(s.owes, ctx)}`)
            .join(" · ") || ctx.t({ en: "Nobody yet", "pt-BR": "Ninguém ainda", de: "Noch niemand", es: "Nadie todavía", pl: "Jeszcze nikt", it: "Ancora nessuno" }),
        yourShare: (expense: Resolved, ctx: Ctx) => money(sharesOf(expense, ctx).find((s) => s.id === ctx.me?.id)?.owes ?? 0, ctx),
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
        group: { type: "relation", to: "group", hidden: true, default: (ctx) => ctx.scope.group?.id },
      },
    },
  },

  quickActions: [
    // No `open`: you have just filled the expense in, so its page has nothing to tell you. Landing
    // back on the group is landing on the answer — what everyone now owes.
    {
      id: "new-expense",
      label: { en: "Add expense", "pt-BR": "Adicionar despesa", de: "Ausgabe hinzufügen", es: "Añadir gasto", pl: "Dodaj wydatek", it: "Aggiungi spesa" },
      icon: "🧾",
      entity: "expense",
      mode: "form",
    },
    {
      id: "settle",
      label: { en: "Settle up", "pt-BR": "Acertar as contas", de: "Ausgleichen", es: "Saldar cuentas", pl: "Rozlicz się", it: "Salda i conti" },
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
      // Both halves of Splitwise's group screen on one page (#105): where everyone stands, then
      // what it is made of.
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "expense",
              title: { en: "Balances", "pt-BR": "Saldos", de: "Salden", es: "Saldos", pl: "Salda", it: "Saldi" },
              emptyText: {
                en: "Nobody owes anybody.",
                "pt-BR": "Ninguém deve nada a ninguém.",
                de: "Niemand schuldet jemandem etwas.",
                es: "Nadie le debe nada a nadie.",
                pl: "Nikt nikomu nic nie jest winien.",
                it: "Nessuno deve niente a nessuno.",
              },
              // An aggregate has no `filter` of its own: the fold IS the filter, and it is handed
              // every expense the app holds — including the other groups'.
              rows: async (all, ctx) => {
                const expenses = all.filter((e) => inGroup(e, ctx));
                const payments = (await ctx.query("payment")).filter((p) => inGroup(p, ctx));
                const net = netBalances(expenses, payments, ctx);
                const people = [...net.entries()].filter(([, v]) => v !== 0);
                // You and someone else take different verbs in most languages ("du schuldest",
                // "Ana schuldet"), so each line has two forms.
                const owed = (me: boolean): string =>
                  me
                    ? ctx.t({ en: "you are owed", "pt-BR": "você tem a receber", de: "du bekommst noch", es: "te deben", pl: "masz do odebrania", it: "devi ricevere" })
                    : ctx.t({ en: "is owed", "pt-BR": "tem a receber", de: "bekommt noch", es: "le deben", pl: "ma do odebrania", it: "deve ricevere" });
                const owes = (me: boolean): string =>
                  me
                    ? ctx.t({ en: "you owe", "pt-BR": "você deve", de: "du schuldest", es: "debes", pl: "masz do oddania", it: "devi" })
                    : ctx.t({ en: "owes", "pt-BR": "deve", de: "schuldet", es: "debe", pl: "ma do oddania", it: "deve" });
                return [
                  ...people
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, v]) => ({
                      id,
                      label: nameOf(id, ctx),
                      value: money(Math.abs(v), ctx),
                      detail: v > 0 ? owed(id === ctx.me?.id) : owes(id === ctx.me?.id),
                      tone: (id === ctx.me?.id ? (v > 0 ? "positive" : "negative") : "neutral") as "positive" | "negative" | "neutral",
                      group: ctx.t({
                        en: "Where everyone stands",
                        "pt-BR": "Como está cada um",
                        de: "Wer wo steht",
                        es: "Cómo está cada uno",
                        pl: "Kto ile",
                        it: "La situazione di ognuno",
                      }),
                    })),
                  // The way out of it, in as few payments as possible.
                  ...settlements(net).map((s) => ({
                    id: `${s.from}->${s.to}`,
                    label: `${nameOf(s.from, ctx)} → ${nameOf(s.to, ctx)}`,
                    value: money(s.amount, ctx),
                    tone: "neutral" as const,
                    group: ctx.t({ en: "To settle up", "pt-BR": "Para acertar", de: "Zum Ausgleichen", es: "Para saldar", pl: "Do rozliczenia", it: "Da saldare" }),
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
                // "You paid" and "Ana paid" are two forms in most languages. Polish says it in the
                // present ("Płaci Ana"): its past tense would need the payer's gender, which the app
                // does not know.
                secondary: (e: Resolved, ctx: Ctx) => {
                  const payer = idOf(e.paidBy);
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
              },
              onOpen: { page: "expense", param: { expenseId: "id" } },
              emptyText: {
                en: "No expenses yet. Add the first one below.",
                "pt-BR": "Nenhuma despesa ainda. Adicione a primeira aqui embaixo.",
                de: "Noch keine Ausgaben. Füge unten die erste hinzu.",
                es: "Aún no hay gastos. Añade el primero aquí abajo.",
                pl: "Jeszcze nie ma wydatków. Dodaj pierwszy poniżej.",
                it: "Ancora nessuna spesa. Aggiungi la prima qui sotto.",
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
        sections: [
          { title: { en: "Expense", "pt-BR": "Despesa", de: "Ausgabe", es: "Gasto", pl: "Wydatek", it: "Spesa" }, fields: ["amount", "paidBy", "when"] },
          { title: { en: "Split", "pt-BR": "Divisão", de: "Aufteilung", es: "Reparto", pl: "Podział", it: "Ripartizione" }, fields: ["split", "between", "shares", "breakdown"] },
          { title: { en: "Notes", "pt-BR": "Observações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["note"] },
        ],
      },
    },
  ],
});
