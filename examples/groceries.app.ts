// groceries.app.ts
// A shared household shopping list that remembers. Tick things as they go in the basket; "Done
// shopping" puts them away, and next week they are one tap from the list again — your usuals, in the
// aisle they were in last time.
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

/** Back on the list, at the end of its aisle, unticked. */
async function putOnList(ctx: Ctx, item: Resolved, items: readonly Resolved[]): Promise<void> {
  const aisle = relId(item.aisle);
  const last = Math.max(-1, ...items.filter((i) => onList(i) && relId(i.aisle) === aisle).map((i) => Number(i.position) || 0));
  await ctx.patch("item", item.id, { onList: true, bought: false, position: last + 1 });
}

/**
 * "Done shopping": what went in the basket leaves the list and goes into memory — how many times it
 * has been bought, and when. Something typed again that was already remembered is folded into the
 * remembered one, so "Milk" is one usual, not three.
 */
async function doneShopping(ctx: Ctx): Promise<void> {
  const items = await ctx.query("item");
  const basket = items.filter((i) => onList(i) && i.bought);
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
        en: "{n, plural, one {Put # thing away} other {Put # things away}}. They're in Usuals for next time.",
        "pt-BR": "{n, plural, one {# item guardado} other {# itens guardados}}. Estão em Habituais para a próxima.",
        de: "{n, plural, one {# Sache weggeräumt} other {# Sachen weggeräumt}}. Sie stehen beim nächsten Mal unter Üblich.",
        es: "{n, plural, one {# cosa guardada} other {# cosas guardadas}}. Están en Habituales para la próxima.",
        pl: "{n, plural, one {Odłożono # rzecz} few {Odłożono # rzeczy} many {Odłożono # rzeczy} other {Odłożono # rzeczy}}. Czekają w Stałych na następny raz.",
        it: "{n, plural, one {# cosa messa via} other {# cose messe via}}. Sono nei Soliti per la prossima volta.",
      },
      { n: basket.length },
    ),
  );
}

/** The usuals that are not on the list, most usual first: one sheet, tick several, done. */
async function addUsuals(ctx: Ctx): Promise<void> {
  const items = await ctx.query("item");
  const now = ctx.now();
  const usual = items
    .filter((i) => !onList(i) && (Number(i.timesBought) || 0) > 0 && !items.some((o) => onList(o) && norm(o.name) === norm(i.name)))
    .sort((a, b) => usualness(b, now) - usualness(a, now))
    .slice(0, 16);
  if (!usual.length) {
    ctx.ui.toast(
      ctx.t({
        en: "Nothing remembered yet: after Done shopping, what you bought waits here.",
        "pt-BR": "Nada guardado ainda: depois de Compras feitas, o que você comprou fica aqui.",
        de: "Noch nichts gemerkt: Nach Fertig eingekauft wartet hier, was du gekauft hast.",
        es: "Nada recordado aún: tras Compra hecha, lo que compraste te espera aquí.",
        pl: "Nic jeszcze nie zapamiętano: po Gotowe tu czeka to, co kupiłeś.",
        it: "Ancora niente: dopo Spesa fatta, quello che hai comprato aspetta qui.",
      }),
    );
    return;
  }
  const chosen = await ctx.ui.pick(usual, { label: (i) => `${emojiOf(i.name)} ${String(i.name ?? "")}`, multi: true });
  const picked = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
  for (const item of picked) await putOnList(ctx, item, items);
}

/** Bring the household in: the shell mints the link (an app could otherwise hand its list away silently). */
async function shareList(ctx: Ctx): Promise<void> {
  const link = ctx.space?.invite ? await ctx.space.invite().catch(() => "") : "";
  if (!link) {
    ctx.ui.toast(
      ctx.t({
        en: "Open ⋯ and choose Share to shop together. No account needed.",
        "pt-BR": "Abra ⋯ e escolha Compartilhar para fazer compras juntos. Sem conta.",
        de: "Öffne ⋯ und wähle Teilen, um gemeinsam einzukaufen. Ohne Konto.",
        es: "Abre ⋯ y elige Compartir para comprar juntos. Sin cuenta.",
        pl: "Otwórz ⋯ i wybierz Udostępnij, by robić zakupy razem. Bez konta.",
        it: "Apri ⋯ e scegli Condividi per fare la spesa insieme. Senza account.",
      }),
    );
    return;
  }
  await ctx.ui.share({
    url: link,
    text: ctx.t({
      en: "Our shopping list: add what we need, tick what you buy.",
      "pt-BR": "Nossa lista de compras: adicione o que falta, marque o que comprar.",
      de: "Unsere Einkaufsliste: trag ein, was fehlt, hak ab, was du kaufst.",
      es: "Nuestra lista de la compra: añade lo que falta, marca lo que compres.",
      pl: "Nasza lista zakupów: dopisz, czego brakuje, odhacz, co kupisz.",
      it: "La nostra lista della spesa: aggiungi cosa manca, spunta cosa compri.",
    }),
  });
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
  version: "3.0.0",
  // 3.0.0: a bought item is remembered instead of deleted. A copy before it would show every
  // remembered item back on the list, so the data version moves and an older copy waits (KA-22).
  schemaVersion: 3,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#5B9C5B", background: { image: "art/market.webp" } },
  permissions: { sync: true },
  category: "everyday",
  // Nothing to add by a button: the list has its own add row, and Usuals one tap per row.
  quickActions: [],
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
        order: { type: "number", integer: true, default: 0, hidden: true },
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
        position: { type: "number", integer: true, default: 0, hidden: true },
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
        emoji: (i) => emojiOf(i.name),
        /** "🥛 · 2 × 1 l · Ana": the quieter line under a row. */
        line: (i, ctx) => [emojiOf(i.name), String(i.quantity ?? ""), addedBy(i, ctx), i.for ? `→ ${String((i.for as { name?: string }).name ?? "")}` : ""].filter(Boolean).join(" · "),
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
        // A new name has no aisle: put it where it went last time, or where the dictionary says.
        file: {
          label: { en: "Put in its aisle", "pt-BR": "Pôr na seção", de: "In die Abteilung", es: "Poner en su sección", pl: "Przydziel dział", it: "Metti nel reparto" },
          icon: "🧭",
          run: async (item, ctx) => {
            const aisle = aisleFor(item.name, await ctx.query("item"), await ctx.query("aisle"));
            if (aisle) await ctx.patch("item", item.id, { aisle });
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
      summary: [
        {
          label: { en: "Shopping with", "pt-BR": "Comprando com", de: "Einkaufen mit", es: "Comprando con", pl: "Zakupy z", it: "Spesa con" },
          // Alone, the header says where the household comes in.
          value: (_rows, ctx) => {
            const others = (ctx.space?.members ?? []).filter((m) => m.id !== ctx.me?.id).map((m) => m.name);
            return others.length
              ? ctx.format.list(others)
              : ctx.t({ en: "Just you: tap Share", "pt-BR": "Só você: toque em Compartilhar", de: "Nur du: tippe auf Teilen", es: "Solo tú: toca Compartir", pl: "Tylko ty: stuknij Udostępnij", it: "Solo tu: tocca Condividi" });
          },
        },
      ],
      primaryAction: 0,
      actions: [
        { label: { en: "Done shopping", "pt-BR": "Compras feitas", de: "Fertig eingekauft", es: "Compra hecha", pl: "Gotowe", it: "Spesa fatta" }, icon: "✓", run: doneShopping },
        { label: { en: "Usuals", "pt-BR": "Habituais", de: "Üblich", es: "Habituales", pl: "Stałe", it: "Soliti" }, icon: "⭐", run: addUsuals },
        { label: { en: "Share", "pt-BR": "Compartilhar", de: "Teilen", es: "Compartir", pl: "Udostępnij", it: "Condividi" }, icon: "👋", run: shareList },
      ],
      view: {
        type: "checklist",
        entity: "item",
        done: "bought",
        text: "name",
        detail: "line",
        filter: (i) => i.onList !== false,
        group: "aisle",
        groupOrder: "order",
        reorder: "position",
        editText: true,
        quickAdd: true,
        emptyText: {
          en: "Nothing on the list. Add the first thing below, or bring back your usuals.",
          "pt-BR": "A lista está vazia. Adicione a primeira coisa aqui embaixo ou traga seus habituais.",
          de: "Die Liste ist leer. Füge unten das Erste hinzu oder hol dir dein Übliches.",
          es: "La lista está vacía. Añade lo primero aquí abajo o recupera tus habituales.",
          pl: "Lista jest pusta. Dodaj pierwszą rzecz poniżej albo przywróć stałe.",
          it: "La lista è vuota. Aggiungi la prima cosa qui sotto o riprendi i tuoi soliti.",
        },
        onOpen: { page: "item", param: { itemId: "id" } },
      },
    },
    {
      // Everything you have bought, most usual first: one tap puts it back on the list.
      id: "usuals",
      title: { en: "Usuals", "pt-BR": "Habituais", de: "Üblich", es: "Habituales", pl: "Stałe", it: "Soliti" },
      icon: "⭐",
      description: {
        en: "What you buy, most often first. Tap Add and it is back on the list, in its aisle.",
        "pt-BR": "O que você compra, do mais frequente. Toque em Adicionar e volta à lista, na seção certa.",
        de: "Was du kaufst, das Häufigste zuerst. Tippe auf Hinzufügen, und es steht wieder auf der Liste.",
        es: "Lo que compras, lo más frecuente primero. Toca Añadir y vuelve a la lista, en su sección.",
        pl: "To, co kupujesz, najczęstsze najpierw. Stuknij Dodaj, a wróci na listę, do swojego działu.",
        it: "Quello che compri, il più frequente prima. Tocca Aggiungi e torna in lista, nel suo reparto.",
      },
      view: {
        type: "list",
        entity: "item",
        filter: (i) => i.onList === false,
        sort: (a, b, ctx) => usualness(b, ctx.now()) - usualness(a, ctx.now()) || String(a.name).localeCompare(String(b.name)),
        display: {
          primary: (i) => `${emojiOf(i.name)}  ${String(i.name ?? "")}`,
          secondary: "memory",
          lead: "none",
        },
        rowActions: ["again"],
        onOpen: { page: "item", param: { itemId: "id" } },
        emptyText: {
          en: "Nothing remembered yet. After Done shopping, what you bought waits here.",
          "pt-BR": "Nada guardado ainda. Depois de Compras feitas, o que você comprou fica aqui.",
          de: "Noch nichts gemerkt. Nach Fertig eingekauft wartet hier, was du gekauft hast.",
          es: "Nada recordado aún. Tras Compra hecha, lo que compraste te espera aquí.",
          pl: "Nic jeszcze nie zapamiętano. Po Gotowe tu czeka to, co kupiłeś.",
          it: "Ancora niente. Dopo Spesa fatta, quello che hai comprato aspetta qui.",
        },
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
        actions: ["again", "file"],
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
