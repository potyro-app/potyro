// What's in my kitchen: photograph a fridge shelf, the shopping on the table or a receipt, and what
// is on it becomes a list sorted by what goes off first — with a reminder the day before, a tally of
// what was used and what was thrown away, and "What can I cook?" for what expires first.
//
// The reading is one `ctx.caps.ai.extract` (docs/23) into a plain shape; the food sense — how long a
// kind of food keeps where it is kept, which printed dates to believe, when to remind — is the
// app's own (shelf-life.ts), the same every time. A date the app guessed says it is a guess wherever
// it is shown. The person checks everything in a form before it is saved: a model reads, a person
// decides.
//
// Every screen is a built-in view, on purpose: a friend who opens this app from a share link runs it
// sealed, and a sealed app's custom views do not render. So the whole app works for them too.
//
// In six languages (docs/20); every language but English is a model's draft (#297). Records — the
// name of a yogurt — are never translated.

import { defineApp, type Ctx, type Resolved } from "potyro";
import { ideaShareText, whatCanICook } from "./cook.js";
import { FIELDS } from "./fields.js";
import { addFromPhoto, demo } from "./read.js";
import { byExpiry, finishedIn, freshness, lastMonths, remindAt, toDate, wasteShare } from "./shelf-life.js";
import { expiryText, finishedText, FRESHNESS_WORDS, REMINDER_BODY, reminderText, reminderTitle, rowText } from "./words.js";

const inKitchen = (r: Resolved) => (r.status ?? "in") === "in";

/** Used it / threw it away: the item leaves the kitchen list and counts on the Waste page. */
const finish = (status: "used" | "wasted") => async (r: Resolved, ctx: Ctx) => {
  await ctx.patch("item", String(r.id), { status, finished: ctx.now() });
  ctx.ui.toast(
    status === "used"
      ? ctx.t({ en: "Used: {name}. Nice.", "pt-BR": "Usado: {name}. Boa!", de: "Verbraucht: {name}. Gut so.", es: "Usado: {name}. ¡Bien!", pl: "Zużyte: {name}. Super.", it: "Usato: {name}. Ottimo." }, { name: String(r.name) })
      : ctx.t(
          { en: "Thrown away: {name}. It counts on Waste.", "pt-BR": "Jogado fora: {name}. Conta em Desperdício.", de: "Weggeworfen: {name}. Es zählt unter Verschwendung.", es: "Tirado: {name}. Cuenta en Desperdicio.", pl: "Wyrzucone: {name}. Liczy się w Marnowaniu.", it: "Buttato: {name}. Conta in Spreco." },
          { name: String(r.name) },
        ),
  );
};

const WASTE_TITLE = { en: "Waste", "pt-BR": "Desperdício", de: "Verschwendung", es: "Desperdicio", pl: "Marnowanie", it: "Spreco" };

export default defineApp({
  id: "pantry",
  // "What's in my kitchen" is what it does; the name on the tile and in the header is one word.
  name: { en: "Pantry", "pt-BR": "Despensa", de: "Vorrat", es: "Despensa", pl: "Spiżarnia", it: "Dispensa" },
  icon: "shopping-basket",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#3f8f4f" },
  nav: "tabs",
  permissions: { ai: true, camera: true, notifications: true },
  // A demo link opens on the sample shelf, already read (docs/04 §Demo).
  demo,
  quickActions: [
    {
      id: "add",
      label: { en: "Add by hand", "pt-BR": "Adicionar à mão", de: "Von Hand eintragen", es: "Añadir a mano", pl: "Dodaj ręcznie", it: "Aggiungi a mano" },
      icon: "pencil",
      entity: "item",
      mode: "form",
      open: false,
    },
  ],
  entities: {
    item: {
      label: { en: "Food", "pt-BR": "Alimento", de: "Lebensmittel", es: "Alimento", pl: "Produkt", it: "Alimento" },
      icon: "carrot",
      displayField: "name",
      fields: {
        ...FIELDS,
        photo: { type: "media", accept: "image", label: { en: "From this photo", "pt-BR": "Desta foto", de: "Von diesem Foto", es: "De esta foto", pl: "Z tego zdjęcia", it: "Da questa foto" } },
      },
      groups: [
        { fields: ["name", "amount"] },
        { title: { en: "How long it keeps", "pt-BR": "Quanto tempo dura", de: "Wie lange es hält", es: "Cuánto dura", pl: "Jak długo wytrzyma", it: "Quanto dura" }, fields: ["expires", "guessed", "category", "where"] },
        { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["status", "photo"], collapsed: true },
      ],
      computed: {
        freshness: {
          value: (r, ctx) => freshness(toDate(r.expires), ctx.now()),
          label: { en: "Use", "pt-BR": "Usar", de: "Verbrauchen", es: "Usar", pl: "Zużyć", it: "Da usare" },
          labels: FRESHNESS_WORDS,
        },
        left: {
          value: (r, ctx) => expiryText(r, ctx, ctx.now()),
          label: { en: "Freshness", "pt-BR": "Validade", de: "Frische", es: "Frescura", pl: "Świeżość", it: "Freschezza" },
        },
        reminder: {
          value: (r, ctx) => reminderText(r, ctx, ctx.now()),
          label: { en: "Reminder", "pt-BR": "Lembrete", de: "Erinnerung", es: "Recordatorio", pl: "Przypomnienie", it: "Promemoria" },
        },
      },
      actions: {
        used: {
          label: { en: "Used it", "pt-BR": "Usei", de: "Verbraucht", es: "Lo usé", pl: "Zużyte", it: "Usato" },
          description: "Mark the item as eaten or used up; it leaves the kitchen list.",
          run: finish("used"),
        },
        wasted: {
          label: { en: "Threw it out", "pt-BR": "Joguei fora", de: "Weggeworfen", es: "Lo tiré", pl: "Wyrzucone", it: "Buttato" },
          description: "Mark the item as thrown away; it counts in the waste tally.",
          run: finish("wasted"),
        },
      },
    },
    idea: {
      label: { en: "Idea", "pt-BR": "Ideia", de: "Idee", es: "Idea", pl: "Pomysł", it: "Idea" },
      icon: "cooking-pot",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: { en: "Dish", "pt-BR": "Prato", de: "Gericht", es: "Plato", pl: "Danie", it: "Piatto" } },
        uses: { type: "text", label: { en: "Uses", "pt-BR": "Usa", de: "Mit", es: "Lleva", pl: "Składniki", it: "Usa" } },
        minutes: { type: "number", integer: true, min: 0, unit: { en: "min", "pt-BR": "min", de: "Min.", es: "min", pl: "min", it: "min" }, label: { en: "Time", "pt-BR": "Tempo", de: "Zeit", es: "Tiempo", pl: "Czas", it: "Tempo" } },
        steps: { type: "text", multiline: true, label: { en: "How", "pt-BR": "Como", de: "Wie", es: "Cómo", pl: "Jak", it: "Come" } },
        made: { type: "datetime", precision: "minute", hidden: true, label: { en: "Suggested", "pt-BR": "Sugerida", de: "Vorgeschlagen", es: "Sugerida", pl: "Zaproponowano", it: "Suggerita" } },
        sample: { type: "boolean", hidden: true, label: { en: "Sample", "pt-BR": "Exemplo", de: "Beispiel", es: "Ejemplo", pl: "Przykład", it: "Esempio" } },
      },
      actions: {
        share: {
          label: { en: "Send it to someone", "pt-BR": "Enviar para alguém", de: "Jemandem schicken", es: "Enviárselo a alguien", pl: "Wyślij komuś", it: "Mandala a qualcuno" },
          description: "Open the share sheet with the dish, what it uses and its steps.",
          run: async (r, ctx) => void (await ctx.ui.share({ title: String(r.title ?? ""), text: ideaShareText(r, ctx) })),
        },
      },
    },
  },
  pages: [
    {
      id: "kitchen",
      title: { en: "Kitchen", "pt-BR": "Cozinha", de: "Küche", es: "Cocina", pl: "Kuchnia", it: "Cucina" },
      icon: "shopping-basket",
      summary: [
        {
          label: { en: "Use within 3 days", "pt-BR": "Usar em até 3 dias", de: "In 3 Tagen verbrauchen", es: "Usar en 3 días", pl: "Zużyć w ciągu 3 dni", it: "Da usare entro 3 giorni" },
          value: (rows, ctx) => rows.filter((r) => ["today", "soon"].includes(freshness(toDate(r.expires), ctx.now()))).length,
        },
        {
          label: { en: "Past its date", "pt-BR": "Passou da data", de: "Abgelaufen", es: "Caducado", pl: "Po terminie", it: "Scaduto" },
          value: (rows, ctx) => rows.filter((r) => freshness(toDate(r.expires), ctx.now()) === "expired").length,
        },
      ],
      actions: [
        { label: { en: "Add from a photo", "pt-BR": "Adicionar por foto", de: "Per Foto hinzufügen", es: "Añadir con una foto", pl: "Dodaj ze zdjęcia", it: "Aggiungi da una foto" }, icon: "camera", run: addFromPhoto },
        { label: { en: "What can I cook?", "pt-BR": "O que posso cozinhar?", de: "Was kann ich kochen?", es: "¿Qué puedo cocinar?", pl: "Co mogę ugotować?", it: "Cosa posso cucinare?" }, icon: "cooking-pot", run: whatCanICook },
      ],
      view: {
        type: "list",
        entity: "item",
        filter: (r) => inKitchen(r),
        sort: (a, b) => byExpiry(a, b),
        group: "freshness",
        display: { primary: "name", secondary: (r, ctx) => rowText(r, ctx, ctx.now()), badges: ["category"] },
        emptyText: {
          en: "Photograph a fridge shelf, your shopping or a receipt: everything on it lands here, what goes off first on top. Try the sample under “Add from a photo”.",
          "pt-BR": "Fotografe uma prateleira da geladeira, suas compras ou um recibo: tudo vem para cá, o que vence primeiro no topo. Teste o exemplo em “Adicionar por foto”.",
          de: "Fotografiere ein Kühlschrankfach, deinen Einkauf oder einen Kassenbon: Alles landet hier, was zuerst schlecht wird, steht oben. Probier das Beispiel unter „Per Foto hinzufügen“.",
          es: "Haz una foto a un estante de la nevera, a la compra o a un tique: todo llega aquí, con lo que caduca antes arriba. Prueba el ejemplo en «Añadir con una foto».",
          pl: "Zrób zdjęcie półki w lodówce, zakupów albo paragonu: wszystko trafi tutaj, a to, co psuje się najszybciej, na górę. Wypróbuj przykład w „Dodaj ze zdjęcia”.",
          it: "Fotografa un ripiano del frigo, la spesa o uno scontrino: tutto finisce qui, con ciò che scade prima in cima. Prova l'esempio in “Aggiungi da una foto”.",
        },
        onOpen: { page: "item", param: { itemId: "id" } },
      },
    },
    {
      id: "cook",
      title: { en: "Cook", "pt-BR": "Cozinhar", de: "Kochen", es: "Cocinar", pl: "Gotuj", it: "Cucina" },
      icon: "cooking-pot",
      actions: [{ label: { en: "What can I cook?", "pt-BR": "O que posso cozinhar?", de: "Was kann ich kochen?", es: "¿Qué puedo cocinar?", pl: "Co mogę ugotować?", it: "Cosa posso cucinare?" }, icon: "cooking-pot", run: whatCanICook }],
      view: {
        type: "list",
        entity: "idea",
        sort: (a, b) => (toDate(b.made)?.getTime() ?? 0) - (toDate(a.made)?.getTime() ?? 0),
        display: {
          primary: "title",
          secondary: (r, ctx) =>
            [String(r.uses ?? ""), Number(r.minutes) > 0 ? ctx.t({ en: "{n} min", "pt-BR": "{n} min", de: "{n} Min.", es: "{n} min", pl: "{n} min", it: "{n} min" }, { n: Number(r.minutes) }) : ""]
              .filter(Boolean)
              .join(" · "),
        },
        emptyText: {
          en: "Ideas for what expires first land here. Tap “What can I cook?”.",
          "pt-BR": "As ideias para o que vence primeiro aparecem aqui. Toque em “O que posso cozinhar?”.",
          de: "Ideen für das, was zuerst weg muss, landen hier. Tippe auf „Was kann ich kochen?“.",
          es: "Aquí llegan ideas para lo que caduca antes. Toca «¿Qué puedo cocinar?».",
          pl: "Tu trafiają pomysły na to, co psuje się najszybciej. Stuknij „Co mogę ugotować?”.",
          it: "Qui arrivano le idee per ciò che scade prima. Tocca “Cosa posso cucinare?”.",
        },
        onOpen: { page: "idea", param: { ideaId: "id" } },
      },
    },
    {
      id: "waste",
      title: WASTE_TITLE,
      icon: "trending-down",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "stats",
              entity: "item",
              filter: (r) => !inKitchen(r),
              items: [
                {
                  label: { en: "Thrown away this month", "pt-BR": "Jogado fora neste mês", de: "Diesen Monat weggeworfen", es: "Tirado este mes", pl: "Wyrzucone w tym miesiącu", it: "Buttato questo mese" },
                  value: (rows, ctx) => finishedIn(rows, "wasted", ctx.now()),
                  compare: { value: (rows, ctx) => finishedIn(rows, "wasted", ctx.now(), 1), label: { en: "last month", "pt-BR": "no mês passado", de: "letzten Monat", es: "el mes pasado", pl: "w zeszłym miesiącu", it: "il mese scorso" } },
                },
                {
                  label: { en: "Used this month", "pt-BR": "Usado neste mês", de: "Diesen Monat verbraucht", es: "Usado este mes", pl: "Zużyte w tym miesiącu", it: "Usato questo mese" },
                  value: (rows, ctx) => finishedIn(rows, "used", ctx.now()),
                  compare: { value: (rows, ctx) => finishedIn(rows, "used", ctx.now(), 1), label: { en: "last month", "pt-BR": "no mês passado", de: "letzten Monat", es: "el mes pasado", pl: "w zeszłym miesiącu", it: "il mese scorso" } },
                },
                {
                  label: { en: "Thrown away, last 30 days", "pt-BR": "Jogado fora, últimos 30 dias", de: "Weggeworfen, letzte 30 Tage", es: "Tirado, últimos 30 días", pl: "Wyrzucone, ostatnie 30 dni", it: "Buttato, ultimi 30 giorni" },
                  value: (rows, ctx) => {
                    const share = wasteShare(rows, ctx.now());
                    return share === null ? null : ctx.format.number(share, { style: "percent" });
                  },
                },
              ],
            },
          },
          {
            view: {
              type: "chart",
              entity: "item",
              filter: (r) => r.status === "wasted",
              title: { en: "Thrown away, by month", "pt-BR": "Jogado fora, por mês", de: "Weggeworfen, nach Monat", es: "Tirado, por mes", pl: "Wyrzucone, miesięcznie", it: "Buttato, per mese" },
              subtitle: { en: "Last 6 months", "pt-BR": "Últimos 6 meses", de: "Letzte 6 Monate", es: "Últimos 6 meses", pl: "Ostatnie 6 miesięcy", it: "Ultimi 6 mesi" },
              series: (rows, ctx) =>
                lastMonths(ctx.now(), 6).map((m, i) => {
                  const n = finishedIn(rows, "wasted", ctx.now(), 5 - i);
                  return {
                    label: ctx.format.date(m, { month: "short" }),
                    value: n,
                    text: ctx.t(
                      {
                        en: "{n, plural, one {# thrown away} other {# thrown away}}",
                        "pt-BR": "{n, plural, one {# jogado fora} other {# jogados fora}}",
                        de: "{n} weggeworfen",
                        es: "{n, plural, one {# tirado} other {# tirados}}",
                        pl: "{n, plural, one {# wyrzucony} few {# wyrzucone} many {# wyrzuconych} other {# wyrzuconego}}",
                        it: "{n, plural, one {# buttato} other {# buttati}}",
                      },
                      { n },
                    ),
                  };
                }),
              emptyText: {
                en: "Nothing thrown away yet. When something is, tap “Threw it out” on it and it counts here.",
                "pt-BR": "Nada jogado fora ainda. Quando for, toque em “Joguei fora” e ele conta aqui.",
                de: "Noch nichts weggeworfen. Wenn doch, tippe darauf auf „Weggeworfen“, dann zählt es hier.",
                es: "Aún no has tirado nada. Cuando pase, toca «Lo tiré» y contará aquí.",
                pl: "Jeszcze nic nie wyrzucono. Gdy się zdarzy, stuknij „Wyrzucone”, a policzy się tutaj.",
                it: "Ancora niente di buttato. Quando succede, tocca “Buttato” e conta qui.",
              },
            },
          },
          {
            title: { en: "Lately", "pt-BR": "Recentemente", de: "Zuletzt", es: "Últimamente", pl: "Ostatnio", it: "Di recente" },
            view: {
              type: "timeline",
              entity: "item",
              date: "finished",
              color: "status",
              groupBy: "week",
              filter: (r) => !inKitchen(r),
              display: { primary: "name", secondary: (r, ctx) => finishedText(r, ctx) },
              emptyText: {
                en: "What you use or throw out shows here.",
                "pt-BR": "O que você usa ou joga fora aparece aqui.",
                de: "Was du verbrauchst oder wegwirfst, steht hier.",
                es: "Aquí aparece lo que usas o tiras.",
                pl: "Tu pojawia się to, co zużywasz albo wyrzucasz.",
                it: "Qui compare ciò che usi o butti.",
              },
              onOpen: { page: "item", param: { itemId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "item",
      title: { en: "Food", "pt-BR": "Alimento", de: "Lebensmittel", es: "Alimento", pl: "Produkt", it: "Alimento" },
      hidden: true,
      view: {
        type: "detail",
        entity: "item",
        param: "itemId",
        actions: ["used", "wasted"],
        sections: [
          { fields: ["left", "reminder", "amount"] },
          { title: { en: "How long it keeps", "pt-BR": "Quanto tempo dura", de: "Wie lange es hält", es: "Cuánto dura", pl: "Jak długo wytrzyma", it: "Quanto dura" }, fields: ["expires", "guessed", "category", "where", "status"] },
          { title: { en: "From this photo", "pt-BR": "Desta foto", de: "Von diesem Foto", es: "De esta foto", pl: "Z tego zdjęcia", it: "Da questa foto" }, fields: ["photo"], collapsed: true },
        ],
      },
    },
    {
      id: "idea",
      title: { en: "Idea", "pt-BR": "Ideia", de: "Idee", es: "Idea", pl: "Pomysł", it: "Idea" },
      hidden: true,
      view: {
        type: "detail",
        entity: "idea",
        param: "ideaId",
        actions: ["share"],
        sections: [{ fields: ["uses", "minutes"] }, { title: { en: "How", "pt-BR": "Como", de: "Wie", es: "Cómo", pl: "Jak", it: "Come" }, fields: ["steps"] }],
      },
    },
  ],
  reminders: [
    {
      id: "expires",
      entity: "item",
      when: (r, ctx) => remindAt(r, ctx.now()),
      title: (r, ctx) => reminderTitle(r, ctx, ctx.now()),
      body: (_r, ctx) => ctx.t(REMINDER_BODY),
    },
  ],
});
