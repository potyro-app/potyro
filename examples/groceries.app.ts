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
// putting a new item in its usual aisle possible — plain functions over the records, no AI, no network.
//
// Shared: `sync`, so the household sees one list, and a row says who added it.
//
// Also: an app in six languages (#302, #303). Every word is a map, and each device shows the
// person's — "Zakupy" on a Polish phone, "Einkäufe" on a German one — over the same records. The
// items and aisles people type are records, so they are never translated. Every language but
// English is a model's draft (#297), not yet read by a native speaker.
import { defineApp, type Ctx, type Resolved } from "potyro";

// ---- the app's own small dictionary: an emoji and an aisle for the staples, in six languages ----

/** Aisle kinds, and the words that name one in each language — matched against YOUR aisle names. */
const AISLE_WORDS: [string, RegExp][] = [
  ["produce", /produce|fruit|veg|hortifr|frutas|verdur|obst|gemüse|warzyw|owoc|frutta/i],
  ["bakery", /baker|bread|padaria|pão|bäcker|brot|panader|pan\b|piekar|pieczyw|panett|forno/i],
  ["dairy", /dairy|milk|egg|latic|leite|ovo|milch|molkerei|käse|lácteo|huevo|nabiał|jaj|latticin|uova/i],
  ["meat", /meat|fish|carne|peix|fleisch|fisch|pescad|mięs|ryb|pesce/i],
  ["pantry", /pantry|despensa|mercearia|vorrat|trocken|spiżar|sucho|dispensa|scaffal/i],
  ["frozen", /frozen|congel|tiefk|mroż|surgel/i],
  ["drinks", /drink|bebida|getränk|napoj|napój|bevand/i],
  ["household", /household|clean|limpeza|casa|haushalt|putz|hogar|limpieza|chemia|dom|pulizia/i],
];

/** Staples: what a name looks like (any of the six languages), its emoji, and the aisle kind it lives in. */
const STAPLES: [RegExp, string, string][] = [
  [/apple|maçã|apfel|manzana|jabł|mela/i, "🍎", "produce"],
  [/banana|banane|plátano|banan/i, "🍌", "produce"],
  [/tomato|tomate|pomidor|pomodor/i, "🍅", "produce"],
  [/lemon|lime|limão|zitrone|limón|cytryn|limon/i, "🍋", "produce"],
  [/orange|laranja|apfelsine|naranja|pomarańcz|arancia/i, "🍊", "produce"],
  [/grape|uva|traube|winogr/i, "🍇", "produce"],
  [/strawberr|morango|erdbeer|fresa|truskaw|fragol/i, "🍓", "produce"],
  [/avocado|abacate|aguacate|awokado/i, "🥑", "produce"],
  [/carrot|cenoura|karotte|möhre|zanahoria|marchew|carot/i, "🥕", "produce"],
  [/potato|batata|kartoffel|patata|ziemniak/i, "🥔", "produce"],
  [/onion|cebola|zwiebel|cebolla|cebul|cipoll/i, "🧅", "produce"],
  [/garlic|alho|knoblauch|\bajo\b|czosn|aglio/i, "🧄", "produce"],
  [/cucumber|pepino|gurke|ogór|cetriol/i, "🥒", "produce"],
  [/pepper|pimento|paprika|pimiento|papryk|peperon/i, "🫑", "produce"],
  [/spinach|lettuce|salad|espinafre|alface|spinat|salat|espinaca|lechuga|szpinak|sałat|spinaci|insalat/i, "🥬", "produce"],
  [/basil|herb|manjericão|basilikum|albahaca|bazyli|basilico/i, "🌿", "produce"],
  [/mushroom|cogumelo|pilz|champi|seta|grzyb|fungh/i, "🍄", "produce"],
  [/sourdough|bread|baguette|pão|brot|brötchen|\bpan\b|chleb|bułk|pane/i, "🥖", "bakery"],
  [/croissant|cornetto|rogal/i, "🥐", "bakery"],
  [/oat milk|oat drink|aveia|hafermilch|avena|owsian|bevanda d'avena/i, "🥛", "dairy"],
  [/milk|leite|milch|leche|mleko|latte/i, "🥛", "dairy"],
  [/yog|iogurte|joghurt|yogur|jogurt/i, "🥣", "dairy"],
  [/egg|ovo|\beier\b|huevo|jajk|jaja|uova|uovo/i, "🥚", "dairy"],
  [/peanut|amendoim|erdnuss|cacahuete|orzesz|arachid/i, "🥜", "pantry"],
  [/butter|manteiga|mantequilla|masło|burro/i, "🧈", "dairy"],
  [/cheese|cheddar|gouda|queijo|käse|queso|\bser\b|formagg|mozzarella|parmesan|feta/i, "🧀", "dairy"],
  [/chicken|frango|hähnchen|huhn|pollo|kurczak/i, "🍗", "meat"],
  [/fish|salmon|peixe|salmão|fisch|lachs|pescado|salmón|ryba|łosoś|pesce|salmone/i, "🐟", "meat"],
  [/toilet|papel higi|klopapier|papel higi|papier toalet|carta igien/i, "🧻", "household"],
  [/coffee|café|kaffee|kawa|caffè/i, "☕", "pantry"],
  [/\btea\b|\bchá\b|\btee\b|\bté\b|herbat|\btè\b/i, "🫖", "pantry"],
  [/rice|arroz|reis|ryż|riso/i, "🍚", "pantry"],
  [/pasta|spaghetti|macarrão|nudeln|makaron/i, "🍝", "pantry"],
  [/oat|aveia|hafer|avena|owsian/i, "🥣", "pantry"],
  [/\boil\b|olive|azeite|óleo|\böl\b|aceite|oliwa|olej|\bolio\b/i, "🫒", "pantry"],
  [/honey|mel\b|honig|miel|miód|miele/i, "🍯", "pantry"],
  [/chickpea|grão|kichererb|garbanzo|ciecierzyc|ceci/i, "🫘", "pantry"],
  [/\btin|\bcan\b|\blata\b|dose|puszk|scatol|passata/i, "🥫", "pantry"],
  [/flour|farinha|mehl|harina|mąk|farina/i, "🌾", "pantry"],
  [/sugar|açúcar|zucker|azúcar|cukier|zucchero/i, "🧂", "pantry"],
  [/chocolate|schokolade|czekolad|cioccolat/i, "🍫", "pantry"],
  [/ice cream|sorvete|eis\b|helado|lody|gelato/i, "🍨", "frozen"],
  [/frozen|\bpeas?\b|berr|congelad|ervilha|erbsen|tiefk|guisante|groszek|mroż|piselli|surgel/i, "🧊", "frozen"],
  [/water|água|wasser|agua|woda|acqua/i, "💧", "drinks"],
  [/beer|cerveja|bier|cerveza|piwo|birra/i, "🍺", "drinks"],
  [/wine|vinho|wein|vino|wino/i, "🍷", "drinks"],
  [/juice|suco|saft|zumo|sok|succo/i, "🧃", "drinks"],
  [/soap|detergent|sabão|detergente|spül|seife|waschmittel|jabón|mydło|płyn|sapone/i, "🧼", "household"],
  [/sponge|esponja|schwamm|gąbk|spugn/i, "🧽", "household"],
  [/bin bag|trash|lixo|müllbeutel|basura|worki|spazzatura/i, "🗑", "household"],
  [/toothpaste|pasta de dente|zahnpasta|pasta de dientes|pasta do zęb|dentifricio/i, "🪥", "household"],
  [/shampoo|szampon/i, "🧴", "household"],
];

const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();
const staple = (name: unknown): [RegExp, string, string] | undefined => STAPLES.find(([re]) => re.test(String(name ?? "")));
/** An item's emoji: from the dictionary, else a basket. */
const emojiOf = (name: unknown): string => staple(name)?.[1] ?? "🧺";
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

/**
 * The aisle a name goes in: where the same thing went last time, else the aisle the dictionary says
 * it lives in — matched against the names of YOUR aisles, so "Obst & Gemüse" and "🥬 Produce" both work.
 * Empty when neither knows: the checklist then asks with one tap ("Tap the aisle for …").
 */
function aisleFor(name: unknown, items: readonly Resolved[], aisles: readonly Resolved[]): string {
  const same = items.filter((i) => norm(i.name) === norm(name) && relId(i.aisle)).sort((a, b) => (dateOf(b.lastBought)?.getTime() ?? 0) - (dateOf(a.lastBought)?.getTime() ?? 0))[0];
  if (same) return relId(same.aisle);
  const kind = staple(name)?.[2];
  const words = AISLE_WORDS.find(([k]) => k === kind)?.[1];
  return words ? (aisles.find((a) => words.test(String(a.name ?? "")))?.id ?? "") : "";
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
      ctx.t({
        en: "Tick what went in the basket first.",
        "pt-BR": "Marque primeiro o que foi para a cesta.",
        de: "Hake zuerst ab, was im Korb ist.",
        es: "Marca primero lo que va en la cesta.",
        pl: "Najpierw odhacz, co jest w koszyku.",
        it: "Prima spunta cosa è nel carrello.",
      }),
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
      {
        en: "{n, plural, one {Put # thing away} other {Put # things away}}. Next time, tap the add box to bring them back.",
        "pt-BR": "{n, plural, one {# item guardado} other {# itens guardados}}. Da próxima vez, toque na caixa de adicionar para trazê-los de volta.",
        de: "{n, plural, one {# Sache weggeräumt} other {# Sachen weggeräumt}}. Nächstes Mal tippst du ins Eingabefeld, um sie zurückzuholen.",
        es: "{n, plural, one {# cosa guardada} other {# cosas guardadas}}. La próxima vez, toca la caja de añadir para recuperarlas.",
        pl: "{n, plural, one {Odłożono # rzecz} few {Odłożono # rzeczy} many {Odłożono # rzeczy} other {Odłożono # rzeczy}}. Następnym razem stuknij pole dodawania, by je przywrócić.",
        it: "{n, plural, one {# cosa messa via} other {# cose messe via}}. La prossima volta tocca la casella per aggiungere e riprendile.",
      },
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
  name: { en: "Groceries", "pt-BR": "Compras", de: "Einkäufe", es: "Compras", pl: "Zakupy", it: "Spesa" },
  icon: "🛒",
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
    const left = (await ctx.query("item")).filter((i) => onList(i) && !i.bought).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    return {
      count: left.length,
      title: ctx.t(
        {
          en: "{n, plural, =0 {All bought} one {# to buy} other {# to buy}}",
          "pt-BR": "{n, plural, =0 {Tudo comprado} one {# para comprar} other {# para comprar}}",
          de: "{n, plural, =0 {Alles gekauft} one {# zu kaufen} other {# zu kaufen}}",
          es: "{n, plural, =0 {Todo comprado} one {# por comprar} other {# por comprar}}",
          pl: "{n, plural, =0 {Wszystko kupione} one {# do kupienia} few {# do kupienia} many {# do kupienia} other {# do kupienia}}",
          it: "{n, plural, =0 {Tutto comprato} one {# da comprare} other {# da comprare}}",
        },
        { n: left.length },
      ),
      lines: left.slice(0, 3).map((i) => `${emojiOf(i.name)} ${String(i.name)}`),
    };
  },

  entities: {
    // A list: "Weekly shop", "Party", "Hardware store". Its items are the items pointing at it.
    list: {
      label: { en: "List", "pt-BR": "Lista", de: "Liste", es: "Lista", pl: "Lista", it: "Lista" },
      icon: "📝",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Weekly shop", "pt-BR": "Compras da semana", de: "Wocheneinkauf", es: "Compra semanal", pl: "Zakupy na tydzień", it: "Spesa settimanale" },
        },
      },
    },

    // The aisles of the shop you actually go to — so the list comes out in walking order.
    aisle: {
      label: { en: "Aisle", "pt-BR": "Seção", de: "Abteilung", es: "Sección", pl: "Dział", it: "Reparto" },
      icon: "🧭",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Produce", "pt-BR": "Hortifrúti", de: "Obst & Gemüse", es: "Frutas y verduras", pl: "Warzywa", it: "Frutta e verdura" },
        },
        order: { type: "number", integer: true, default: 0, hidden: true, label: { en: "Order", "pt-BR": "Ordem", de: "Reihenfolge", es: "Orden", pl: "Kolejność", it: "Ordine" } },
      },
    },

    item: {
      label: { en: "Item", "pt-BR": "Item", de: "Artikel", es: "Artículo", pl: "Produkt", it: "Articolo" },
      icon: "🛒",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Milk", "pt-BR": "Leite", de: "Milch", es: "Leche", pl: "Mleko", it: "Latte" },
        },
        aisle: {
          type: "relation",
          to: "aisle",
          label: { en: "Aisle", "pt-BR": "Seção", de: "Abteilung", es: "Sección", pl: "Dział", it: "Reparto" },
        },
        // The list it is on — the one being shown, when it is added there.
        list: { type: "relation", to: "list", hidden: true, label: { en: "List", "pt-BR": "Lista", de: "Liste", es: "Lista", pl: "Lista", it: "Lista" } },
        quantity: {
          type: "text",
          label: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ilość", it: "Quantità" },
          placeholder: "2 × 1 l", // the same in every language
          help: {
            en: "How much, in your own words",
            "pt-BR": "Quanto, com as suas palavras",
            de: "Wie viel, in deinen eigenen Worten",
            es: "Cuánto, con tus propias palabras",
            pl: "Ile — własnymi słowami",
            it: "Quanto, con parole tue",
          },
        },
        for: {
          type: "member",
          label: { en: "For", "pt-BR": "Para", de: "Für", es: "Para", pl: "Dla", it: "Per" },
          help: {
            en: "Whose it is, when it is not the household's",
            "pt-BR": "De quem é, quando não é da casa",
            de: "Für wen, wenn es nicht für alle ist",
            es: "De quién es, si no es de la casa",
            pl: "Czyje to, jeśli nie wspólne",
            it: "Di chi è, se non è di tutta la casa",
          },
        },
        bought: {
          type: "boolean",
          default: false,
          label: { en: "In the basket", "pt-BR": "Na cesta", de: "Im Korb", es: "En la cesta", pl: "W koszyku", it: "Nel carrello" },
        },
        position: { type: "number", integer: true, default: 0, hidden: true, label: { en: "Position", "pt-BR": "Posição", de: "Position", es: "Posición", pl: "Pozycja", it: "Posizione" } },
        note: {
          type: "text",
          multiline: true,
          label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" },
          placeholder: { en: "The oat one, not barista", "pt-BR": "A de aveia, não a barista", de: "Die mit Hafer, nicht Barista", es: "La de avena, no la barista", pl: "Owsiane, nie barista", it: "Quella d'avena, non barista" },
        },
        // ---- memory: what makes Usuals. Kept by "Done shopping", not typed. ----
        onList: { type: "boolean", default: true, hidden: true, label: { en: "On the list", "pt-BR": "Na lista", de: "Auf der Liste", es: "En la lista", pl: "Na liście", it: "In lista" } },
        timesBought: { type: "number", integer: true, min: 0, default: 0, hidden: true, label: { en: "Times bought", "pt-BR": "Vezes comprado", de: "Wie oft gekauft", es: "Veces comprado", pl: "Ile razy kupione", it: "Volte comprato" } },
        lastBought: { type: "datetime", precision: "day", hidden: true, label: { en: "Last bought", "pt-BR": "Última compra", de: "Zuletzt gekauft", es: "Última compra", pl: "Ostatnio kupione", it: "Ultimo acquisto" } },
      },
      groups: [
        { title: { en: "Item", "pt-BR": "Item", de: "Artikel", es: "Artículo", pl: "Produkt", it: "Articolo" }, fields: ["name", "quantity", "aisle"] },
        { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["note", "for", "bought"], collapsed: true },
      ],
      computed: {
        emoji: { label: { en: "Emoji", "pt-BR": "Emoji", de: "Emoji", es: "Emoji", pl: "Emoji", it: "Emoji" }, value: (i) => emojiOf(i.name) },
        /** "2 × 1 l · Ana": the quieter line under a row. */
        line: { label: { en: "Details", "pt-BR": "Detalhes", de: "Details", es: "Detalles", pl: "Szczegóły", it: "Dettagli" }, value: (i, ctx) => [String(i.quantity ?? ""), addedBy(i, ctx), i.for ? `→ ${String((i.for as { name?: string }).name ?? "")}` : ""].filter(Boolean).join(" · ") },
        memory: {
          label: { en: "Bought", "pt-BR": "Comprado", de: "Gekauft", es: "Comprado", pl: "Kupione", it: "Comprato" },
          value: (i, ctx) => {
            const times = Number(i.timesBought) || 0;
            const last = dateOf(i.lastBought);
            if (!times) return ctx.t({ en: "Not yet", "pt-BR": "Ainda não", de: "Noch nie", es: "Aún no", pl: "Jeszcze nie", it: "Non ancora" });
            return ctx.t(
              {
                en: "{n, plural, one {once} other {# times}}, last {when}",
                "pt-BR": "{n, plural, one {uma vez} other {# vezes}}, a última {when}",
                de: "{n, plural, one {einmal} other {# Mal}}, zuletzt {when}",
                es: "{n, plural, one {una vez} other {# veces}}, la última {when}",
                pl: "{n, plural, one {raz} few {# razy} many {# razy} other {# razy}}, ostatnio {when}",
                it: "{n, plural, one {una volta} other {# volte}}, l'ultima {when}",
              },
              { n: times, when: last ? ctx.format.relative(last, { unit: "day" }) : "—" },
            );
          },
        },
      },
      actions: {
        // One tap from Usuals: back on the list, in the aisle it was in.
        again: {
          label: { en: "Add", "pt-BR": "Adicionar", de: "Hinzufügen", es: "Añadir", pl: "Dodaj", it: "Aggiungi" },
          icon: "＋",
          run: async (item, ctx) => {
            const items = await ctx.query("item");
            const twin = items.find((o) => o.id !== item.id && onList(o) && norm(o.name) === norm(item.name));
            if (twin) {
              ctx.ui.toast(ctx.t({ en: "{name} is already on the list", "pt-BR": "{name} já está na lista", de: "{name} steht schon auf der Liste", es: "{name} ya está en la lista", pl: "{name} już jest na liście", it: "{name} è già in lista" }, { name: String(item.name ?? "") }));
              return;
            }
            await putOnList(ctx, item, items);
            ctx.ui.toast(ctx.t({ en: "{name} is on the list", "pt-BR": "{name} está na lista", de: "{name} steht auf der Liste", es: "{name} está en la lista", pl: "{name} jest na liście", it: "{name} è in lista" }, { name: `${emojiOf(item.name)} ${String(item.name ?? "")}` }));
          },
        },
      },
    },
  },

  pages: [
    {
      id: "shopping",
      title: { en: "List", "pt-BR": "Lista", de: "Liste", es: "Lista", pl: "Lista", it: "Lista" },
      icon: "🛒",
      description: {
        en: "Tick things as they go in the basket. Done shopping puts them away for next time.",
        "pt-BR": "Marque o que vai para a cesta. Compras feitas guarda tudo para a próxima vez.",
        de: "Hak ab, was in den Korb kommt. Fertig eingekauft merkt es sich fürs nächste Mal.",
        es: "Marca lo que va a la cesta. Compra hecha lo guarda para la próxima.",
        pl: "Odhaczaj, co trafia do koszyka. Gotowe zapamięta to na następny raz.",
        it: "Spunta quello che va nel carrello. Spesa fatta lo mette via per la prossima volta.",
      },
      // One line above the list: what is left, and what is in the basket.
      summary: [
        {
          label: { en: "to buy", "pt-BR": "para comprar", de: "zu kaufen", es: "por comprar", pl: "do kupienia", it: "da comprare" },
          value: (rows) => rows.filter((i) => !i.bought).length,
        },
        {
          label: { en: "in the basket", "pt-BR": "na cesta", de: "im Korb", es: "en la cesta", pl: "w koszyku", it: "nel carrello" },
          value: (rows) => rows.filter((i) => i.bought).length,
        },
      ],
      // At the bottom of the screen, and only once something is in the basket.
      primaryAction: 0,
      actions: [
        {
          label: { en: "Done shopping", "pt-BR": "Compras feitas", de: "Fertig eingekauft", es: "Compra hecha", pl: "Gotowe", it: "Spesa fatta" },
          icon: "✓",
          run: doneShopping,
          when: (rows) => rows.some((i) => i.bought),
        },
      ],
      view: {
        type: "checklist",
        entity: "item",
        done: "bought",
        text: "name",
        icon: "emoji",
        detail: "line",
        filter: (i, ctx) => onThisList(i, ctx),
        group: "aisle",
        groupOrder: "order",
        reorder: "position",
        editText: true,
        // Ticked things fold away, so what is left to find stays on screen.
        hideDone: "collapse",
        doneLabel: { en: "In the basket", "pt-BR": "Na cesta", de: "Im Korb", es: "En la cesta", pl: "W koszyku", it: "Nel carrello" },
        // Type a name: earlier ones are offered as you go, and it lands in the aisle it was in last
        // time — or, the first time, where the dictionary says it lives among YOUR aisles.
        quickAdd: {
          remember: ["aisle"],
          defaults: async (text, ctx) => {
            const aisle = aisleFor(text, [], await ctx.query("aisle"));
            return aisle ? { aisle } : {};
          },
          // Tap the box: what you usually buy, one tap each.
          usuals: (_rows, ctx) => usualNames(ctx),
        },
        emptyText: {
          en: "Nothing on the list. Add the first thing below — tap the box for your usuals.",
          "pt-BR": "A lista está vazia. Adicione a primeira coisa aqui embaixo — toque na caixa para ver seus itens de sempre.",
          de: "Die Liste ist leer. Füge unten das Erste hinzu — tippe ins Feld für dein Übliches.",
          es: "La lista está vacía. Añade lo primero aquí abajo — toca la caja para ver lo habitual.",
          pl: "Lista jest pusta. Dodaj pierwszą rzecz poniżej — stuknij pole, by zobaczyć stałe zakupy.",
          it: "La lista è vuota. Aggiungi la prima cosa qui sotto — tocca la casella per i tuoi soliti.",
        },
        onOpen: { page: "item", param: { itemId: "id" } },
      },
    },
    {
      id: "item",
      title: { en: "Item", "pt-BR": "Item", de: "Artikel", es: "Artículo", pl: "Produkt", it: "Articolo" },
      hidden: true,
      view: {
        type: "detail",
        entity: "item",
        param: "itemId",
        cover: "band",
        actions: ["again"],
        sections: [
          { title: { en: "Item", "pt-BR": "Item", de: "Artikel", es: "Artículo", pl: "Produkt", it: "Articolo" }, fields: ["quantity", "aisle", "for", "bought"] },
          { title: { en: "Memory", "pt-BR": "Histórico", de: "Erinnerung", es: "Historial", pl: "Pamięć", it: "Memoria" }, fields: ["memory"] },
          { title: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" }, fields: ["note"] },
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
