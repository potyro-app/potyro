// places.app.ts
// Your map of places: the ones you love, the ones you have been to and the ones friends told you
// about, in lists you can share ("Date night", "Sunday"). Save a spot where you stand, log a visit —
// what you ordered, who you were with — and rank it against the places of its own kind ("better or
// worse than Ramen Kaido?"), never a café against a bar. Your visits become a timeline to look back on.
//
// Stresses: geo field + map view, an optional app-wide scope (the list you are looking at), JS
// filters for "open now" and "within N km", an interactive ranking that asks questions through
// `ctx.ui.sheet`, actions with input (a visit), a migration (visited → status) — arbitrary logic, no DSL.
//
// In six languages (#303). Every language but English is a model's draft (#297). A function sees an
// enum's stored value, never its label (docs/20 Q5), so the places that put a category or a status
// into words say it through `kindName` / `statusName`, beside the fields' own `labels`.
import { defineApp, type Ctx, type MigrationStep, type Resolved } from "potyro";

type HourRow = { day: string; from: string; to: string };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};
const isOpenNow = (hours: HourRow[], at: Date) => {
  const day = DAYS[at.getDay()];
  const mins = at.getHours() * 60 + at.getMinutes();
  return hours.some((r) => r.day === day && hm(r.from) <= mins && mins <= hm(r.to));
};
const distanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const KINDS = ["restaurant", "bar", "cafe", "pizza", "bakery", "museum", "park", "viewpoint", "shop", "stay", "other"];
const KIND_GLYPH: Record<string, string> = { restaurant: "🍽️", bar: "🍸", cafe: "☕", pizza: "🍕", bakery: "🥐", museum: "🖼️", park: "🌳", viewpoint: "👀", shop: "🛍️", stay: "🏨", other: "📍" };
const KIND_COLOR: Record<string, string> = { restaurant: "#C0574D", bar: "#8E5BB5", cafe: "#A0703C", pizza: "#D9822B", bakery: "#E4A93C", museum: "#5B6EE1", park: "#3C9A5F", viewpoint: "#2E9AA6", shop: "#D45D8F", stay: "#5FB0E4", other: "#7A8794" };

/** A category in the person's language: the same words as `kind`'s labels below. */
const kindName = (kind: unknown, ctx: Ctx): string => {
  switch (kind) {
    case "restaurant":
      return ctx.t({ en: "restaurant", "pt-BR": "restaurante", de: "Restaurant", es: "restaurante", pl: "restauracja", it: "ristorante" });
    case "bar":
      return ctx.t({ en: "bar", "pt-BR": "bar", de: "Bar", es: "bar", pl: "bar", it: "bar" });
    case "cafe":
      return ctx.t({ en: "cafe", "pt-BR": "café", de: "Café", es: "cafetería", pl: "kawiarnia", it: "caffè" });
    case "pizza":
      return ctx.t({ en: "pizza", "pt-BR": "pizzaria", de: "Pizzeria", es: "pizzería", pl: "pizzeria", it: "pizzeria" });
    case "bakery":
      return ctx.t({ en: "bakery", "pt-BR": "padaria", de: "Bäckerei", es: "panadería", pl: "piekarnia", it: "panetteria" });
    case "museum":
      return ctx.t({ en: "museum", "pt-BR": "museu", de: "Museum", es: "museo", pl: "muzeum", it: "museo" });
    case "park":
      return ctx.t({ en: "park", "pt-BR": "parque", de: "Park", es: "parque", pl: "park", it: "parco" });
    case "viewpoint":
      return ctx.t({ en: "viewpoint", "pt-BR": "mirante", de: "Aussichtspunkt", es: "mirador", pl: "punkt widokowy", it: "belvedere" });
    case "shop":
      return ctx.t({ en: "shop", "pt-BR": "loja", de: "Laden", es: "tienda", pl: "sklep", it: "negozio" });
    case "stay":
      return ctx.t({ en: "place to stay", "pt-BR": "hospedagem", de: "Unterkunft", es: "alojamiento", pl: "nocleg", it: "alloggio" });
    case "other":
      return ctx.t({ en: "other", "pt-BR": "outro", de: "Sonstiges", es: "otro", pl: "inne", it: "altro" });
    default:
      return ctx.t({ en: "unknown", "pt-BR": "sem categoria", de: "ohne Kategorie", es: "sin categoría", pl: "bez kategorii", it: "senza categoria" });
  }
};

/** The plural, for "#2 of your cafés". */
const kindPlural = (kind: unknown, ctx: Ctx): string => {
  switch (kind) {
    case "restaurant":
      return ctx.t({ en: "restaurants", "pt-BR": "restaurantes", de: "Restaurants", es: "restaurantes", pl: "restauracji", it: "ristoranti" });
    case "bar":
      return ctx.t({ en: "bars", "pt-BR": "bares", de: "Bars", es: "bares", pl: "barów", it: "bar" });
    case "cafe":
      return ctx.t({ en: "cafés", "pt-BR": "cafés", de: "Cafés", es: "cafeterías", pl: "kawiarni", it: "caffè" });
    case "pizza":
      return ctx.t({ en: "pizzerias", "pt-BR": "pizzarias", de: "Pizzerien", es: "pizzerías", pl: "pizzerii", it: "pizzerie" });
    case "bakery":
      return ctx.t({ en: "bakeries", "pt-BR": "padarias", de: "Bäckereien", es: "panaderías", pl: "piekarni", it: "panetterie" });
    case "park":
      return ctx.t({ en: "parks", "pt-BR": "parques", de: "Parks", es: "parques", pl: "parków", it: "parchi" });
    default:
      return ctx.t({ en: "places like it", "pt-BR": "lugares do tipo", de: "Orte dieser Art", es: "sitios de este tipo", pl: "miejsc tego typu", it: "posti di questo tipo" });
  }
};

/** A status in words: the same as `status`'s labels. */
const statusName = (s: unknown, ctx: Ctx): string => {
  if (s === "favourite") return ctx.t({ en: "favourite", "pt-BR": "favorito", de: "Lieblingsort", es: "favorito", pl: "ulubione", it: "preferito" });
  if (s === "been") return ctx.t({ en: "been", "pt-BR": "já fui", de: "war schon da", es: "ya fui", pl: "byłem", it: "ci sono stato" });
  return ctx.t({ en: "want to go", "pt-BR": "quero ir", de: "will hin", es: "quiero ir", pl: "chcę iść", it: "voglio andarci" });
};

const visited = (p: Resolved): boolean => p.status === "been" || p.status === "favourite";

/** The line under a place's name: its kind, and whether it is open — or that nobody knows. */
function placeLine(p: Resolved, ctx: Ctx): string {
  const hours = (p.openingHours as HourRow[] | undefined) ?? [];
  const open = !hours.length
    ? ctx.t({ en: "hours unknown", "pt-BR": "horário desconhecido", de: "Öffnungszeiten unbekannt", es: "horario desconocido", pl: "godziny nieznane", it: "orari sconosciuti" })
    : p.openNow
      ? ctx.t({ en: "open now", "pt-BR": "aberto agora", de: "jetzt geöffnet", es: "abierto ahora", pl: "teraz otwarte", it: "aperto ora" })
      : ctx.t({ en: "closed", "pt-BR": "fechado", de: "geschlossen", es: "cerrado", pl: "zamknięte", it: "chiuso" });
  return `${KIND_GLYPH[String(p.kind)] ?? "📍"} ${kindName(p.kind, ctx)} · ${open}`;
}

/**
 * Rank a place among the places of its own kind you have been to, by asking: "Better or worse than X?"
 * — a binary search, so ten cafés take three or four questions, never ten. Ranks are 1, 2, 3… within
 * the kind, rewritten after every placement.
 */
async function rankPlace(p: Resolved, ctx: Ctx): Promise<void> {
  const others = (await ctx.query("place"))
    .filter((o) => o.id !== p.id && o.kind === p.kind && visited(o) && typeof o.rankInKind === "number")
    .sort((a, b) => a.rankInKind - b.rankInKind);
  let lo = 0;
  let hi = others.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const other = others[mid]!;
    const answer = await ctx.ui.sheet({
      title: ctx.t({ en: "{name}: better or worse than {other}?", "pt-BR": "{name}: melhor ou pior que {other}?", de: "{name}: besser oder schlechter als {other}?", es: "{name}: ¿mejor o peor que {other}?", pl: "{name}: lepsze czy gorsze niż {other}?", it: "{name}: meglio o peggio di {other}?" }, { name: String(p.name), other: String(other.name) }),
      items: [
        { id: "better", icon: "👍", label: { en: "Better", "pt-BR": "Melhor", de: "Besser", es: "Mejor", pl: "Lepsze", it: "Meglio" } },
        { id: "worse", icon: "👎", label: { en: "Worse", "pt-BR": "Pior", de: "Schlechter", es: "Peor", pl: "Gorsze", it: "Peggio" } },
      ],
    });
    if (!answer) return; // closed: nothing changes
    if (answer === "better") hi = mid;
    else lo = mid + 1;
  }
  const order = [...others.slice(0, lo), p, ...others.slice(lo)];
  for (let i = 0; i < order.length; i++) {
    if (order[i]!.rankInKind !== i + 1 || order[i]!.id === p.id) await ctx.patch("place", order[i]!.id, { rankInKind: i + 1 });
  }
  ctx.ui.toast(ctx.t({ en: "#{n} of your {kinds}", "pt-BR": "#{n} entre seus {kinds}", de: "Platz {n} deiner {kinds}", es: "#{n} de tus {kinds}", pl: "#{n} wśród twoich {kinds}", it: "#{n} tra i tuoi {kinds}" }, { n: lo + 1, kinds: kindPlural(p.kind, ctx) }));
}

/** "Save this spot": where you stand, a name and a kind, in one sheet. */
async function saveHere(ctx: Ctx): Promise<void> {
  let here: { lat: number; lng: number } | undefined;
  try {
    here = await ctx.caps.geo?.current();
  } catch {
    here = undefined;
  }
  if (!here) {
    ctx.ui.toast(ctx.t({ en: "Can't tell where you are. Use “Add here” on the map instead.", "pt-BR": "Não consigo saber onde você está. Use “Adicionar aqui” no mapa.", de: "Dein Standort ist nicht bekannt. Nimm „Hier hinzufügen“ auf der Karte.", es: "No sé dónde estás. Usa «Añadir aquí» en el mapa.", pl: "Nie wiem, gdzie jesteś. Użyj „Dodaj tutaj” na mapie.", it: "Non so dove sei. Usa “Aggiungi qui” sulla mappa." }));
    return;
  }
  const form = await ctx.ui.form<{ name: string; kind: string; status: string; notes: string }>({
    title: { en: "Save this spot", "pt-BR": "Salvar este lugar", de: "Diesen Ort speichern", es: "Guardar este sitio", pl: "Zapisz to miejsce", it: "Salva questo posto" },
    fields: {
      name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
      kind: { type: "enum", options: KINDS, default: "cafe", labels: Object.fromEntries(KINDS.map((k) => [k, kindName(k, ctx)])), label: { en: "Kind", "pt-BR": "Tipo", de: "Art", es: "Tipo", pl: "Rodzaj", it: "Tipo" } },
      status: {
        type: "enum",
        options: ["want to go", "been", "favourite"],
        default: "been",
        labels: Object.fromEntries(["want to go", "been", "favourite"].map((s) => [s, statusName(s, ctx)])),
        label: { en: "Status", "pt-BR": "Situação", de: "Status", es: "Estado", pl: "Status", it: "Stato" },
      },
      notes: { type: "text", multiline: true, label: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" } },
    },
    initial: { kind: "cafe", status: "been" },
    submit: { en: "Save", "pt-BR": "Salvar", de: "Speichern", es: "Guardar", pl: "Zapisz", it: "Salva" },
  });
  if (!form) return;
  const place = await ctx.create("place", { ...form, location: { lat: here.lat, lng: here.lng } });
  ctx.navigate("detail", { placeId: place.id });
}


// `visited` (a yes/no) became `status` in 2.0.0: visited → been, not yet → want to go. One migration
// from every earlier version, so a device that last opened any of them lands in the same place.
const TO_STATUS: MigrationStep[] = [
  { op: "addField", entity: "place", field: "status", default: "been" },
  { transform: (r) => ("visited" in r ? { ...r, status: (r as { visited?: unknown }).visited === false ? "want to go" : "been" } : r) },
  { op: "dropField", entity: "place", field: "visited" },
];

export default defineApp({
  id: "places",
  name: { en: "Places", "pt-BR": "Lugares", de: "Orte", es: "Lugares", pl: "Miejsca", it: "Luoghi" },
  icon: "📍",
  version: "2.0.0",
  schemaVersion: 2,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#5FB0E4" },
  permissions: { camera: true, geo: true },
  category: "everyday",
  nav: "tabs",
  // The list you are looking at — "Date night", "Sunday" — or all of them. Choosing one narrows the
  // map and the lists; a new place is filed in it.
  scope: { entity: "collection", label: { en: "List", "pt-BR": "Lista", de: "Liste", es: "Lista", pl: "Lista", it: "Lista" } },
  quickActions: [
    { id: "add-place", label: { en: "Add: Place", "pt-BR": "Adicionar: Lugar", de: "Hinzufügen: Ort", es: "Añadir: Lugar", pl: "Dodaj: Miejsce", it: "Aggiungi: Luogo" }, icon: "📍", entity: "place", mode: "form" },
  ],
  // The launcher tile (docs/04 §Tile): the places still to visit.
  tile: async (ctx) => {
    const places = await ctx.query("place");
    const toVisit = places.filter((p) => p.status === "want to go");
    const last = (await ctx.query("visit")).sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime())[0];
    return {
      count: toVisit.length,
      title: ctx.t(
        {
          en: "{n, plural, =0 {Everywhere visited} one {# to visit} other {# to visit}}",
          "pt-BR": "{n, plural, =0 {Tudo visitado} one {# para visitar} other {# para visitar}}",
          de: "{n, plural, =0 {Überall gewesen} one {# zu besuchen} other {# zu besuchen}}",
          es: "{n, plural, =0 {Todo visitado} one {# por visitar} other {# por visitar}}",
          pl: "{n, plural, =0 {Wszędzie byłeś} one {# do odwiedzenia} few {# do odwiedzenia} many {# do odwiedzenia} other {# do odwiedzenia}}",
          it: "{n, plural, =0 {Visitato tutto} one {# da visitare} other {# da visitare}}",
        },
        { n: toVisit.length },
      ),
      lines: toVisit.slice(0, 3).map((p) => String(p.name)),
      ...(last?.place?.photo ? { image: (Array.isArray(last.place.photo) ? last.place.photo[0] : last.place.photo) as never } : {}),
    };
  },

  entities: {
    // A list of places you keep together and can share: "Date night", "Lisbon weekend".
    collection: {
      label: { en: "List", "pt-BR": "Lista", de: "Liste", es: "Lista", pl: "Lista", it: "Lista" },
      icon: "🗂️",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" }, placeholder: { en: "Date night", "pt-BR": "Noite a dois", de: "Date-Abend", es: "Noche de cita", pl: "Randka", it: "Serata a due" } },
        emoji: { type: "text", label: "Emoji", placeholder: "🌙" },
        note: { type: "text", label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
      },
    },

    place: {
      label: { en: "Place", "pt-BR": "Lugar", de: "Ort", es: "Lugar", pl: "Miejsce", it: "Luogo" },
      icon: "📍",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        location: {
          type: "geo",
          required: true,
          label: { en: "Location", "pt-BR": "Localização", de: "Standort", es: "Ubicación", pl: "Lokalizacja", it: "Posizione" },
        },
        photo: { type: "media", accept: "image", multiple: true, label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } },
        status: {
          type: "enum",
          options: ["want to go", "been", "favourite"],
          default: "been",
          colors: { "want to go": "yellow", been: "teal", favourite: "pink" },
          labels: {
            "want to go": { en: "want to go", "pt-BR": "quero ir", de: "will hin", es: "quiero ir", pl: "chcę iść", it: "voglio andarci" },
            been: { en: "been", "pt-BR": "já fui", de: "war schon da", es: "ya fui", pl: "byłem", it: "ci sono stato" },
            favourite: { en: "favourite", "pt-BR": "favorito", de: "Lieblingsort", es: "favorito", pl: "ulubione", it: "preferito" },
          },
          label: { en: "Status", "pt-BR": "Situação", de: "Status", es: "Estado", pl: "Status", it: "Stato" },
        },
        kind: {
          type: "enum",
          label: { en: "Kind", "pt-BR": "Tipo", de: "Art", es: "Tipo", pl: "Rodzaj", it: "Tipo" },
          options: KINDS,
          labels: {
            restaurant: { en: "restaurant", "pt-BR": "restaurante", de: "Restaurant", es: "restaurante", pl: "restauracja", it: "ristorante" },
            bar: { en: "bar", "pt-BR": "bar", de: "Bar", es: "bar", pl: "bar", it: "bar" },
            cafe: { en: "cafe", "pt-BR": "café", de: "Café", es: "cafetería", pl: "kawiarnia", it: "caffè" },
            pizza: { en: "pizza", "pt-BR": "pizzaria", de: "Pizzeria", es: "pizzería", pl: "pizzeria", it: "pizzeria" },
            bakery: { en: "bakery", "pt-BR": "padaria", de: "Bäckerei", es: "panadería", pl: "piekarnia", it: "panetteria" },
            museum: { en: "museum", "pt-BR": "museu", de: "Museum", es: "museo", pl: "muzeum", it: "museo" },
            park: { en: "park", "pt-BR": "parque", de: "Park", es: "parque", pl: "park", it: "parco" },
            viewpoint: { en: "viewpoint", "pt-BR": "mirante", de: "Aussichtspunkt", es: "mirador", pl: "punkt widokowy", it: "belvedere" },
            shop: { en: "shop", "pt-BR": "loja", de: "Laden", es: "tienda", pl: "sklep", it: "negozio" },
            stay: { en: "place to stay", "pt-BR": "hospedagem", de: "Unterkunft", es: "alojamiento", pl: "nocleg", it: "alloggio" },
            other: { en: "other", "pt-BR": "outro", de: "Sonstiges", es: "otro", pl: "inne", it: "altro" },
          },
        },
        notes: { type: "text", multiline: true, label: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" } },
        mustOrder: { type: "text", label: { en: "Order this", "pt-BR": "Peça isto", de: "Unbedingt bestellen", es: "Pide esto", pl: "Zamów to", it: "Da ordinare" }, placeholder: { en: "The cardamom bun", "pt-BR": "O pão de cardamomo", de: "Die Kardamomschnecke", es: "El bollo de cardamomo", pl: "Bułka kardamonowa", it: "Il panino al cardamomo" } },
        lists: { type: "relation", to: "collection", many: true, label: { en: "Lists", "pt-BR": "Listas", de: "Listen", es: "Listas", pl: "Listy", it: "Liste" } },
        vibes: {
          type: "tags",
          label: { en: "Vibes", "pt-BR": "Clima", de: "Stimmung", es: "Ambiente", pl: "Klimat", it: "Atmosfera" },
          options: ["cheap", "fancy", "outdoor", "quiet", "late-night", "dog-friendly"],
          labels: {
            cheap: { en: "cheap", "pt-BR": "barato", de: "günstig", es: "barato", pl: "tanie", it: "economico" },
            fancy: { en: "fancy", "pt-BR": "chique", de: "edel", es: "elegante", pl: "eleganckie", it: "elegante" },
            outdoor: { en: "outdoor", "pt-BR": "ao ar livre", de: "draußen", es: "al aire libre", pl: "na świeżym powietrzu", it: "all'aperto" },
            quiet: { en: "quiet", "pt-BR": "tranquilo", de: "ruhig", es: "tranquilo", pl: "ciche", it: "tranquillo" },
            "late-night": { en: "late-night", "pt-BR": "até tarde", de: "bis spät", es: "hasta tarde", pl: "do późna", it: "fino a tardi" },
            "dog-friendly": { en: "dog-friendly", "pt-BR": "aceita cachorro", de: "hundefreundlich", es: "admite perros", pl: "przyjazne psom", it: "cani ammessi" },
          },
        },
        rating: {
          type: "number",
          min: 0,
          max: 5,
          step: 0.5,
          label: { en: "Rating", "pt-BR": "Nota", de: "Bewertung", es: "Valoración", pl: "Ocena", it: "Voto" },
        },
        rankInKind: { type: "number", integer: true, hidden: true, label: { en: "Rank among its kind", "pt-BR": "Posição entre os do tipo", de: "Platz unter seinesgleichen", es: "Puesto entre los de su tipo", pl: "Miejsce wśród podobnych", it: "Posto tra quelli del suo tipo" } },
        openingHours: {
          type: "list",
          label: {
            en: "Opening hours",
            "pt-BR": "Horário de funcionamento",
            de: "Öffnungszeiten",
            es: "Horario",
            pl: "Godziny otwarcia",
            it: "Orari di apertura",
          },
          of: {
            day: {
              type: "enum",
              label: { en: "Day", "pt-BR": "Dia", de: "Tag", es: "Día", pl: "Dzień", it: "Giorno" },
              options: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
              labels: {
                mon: { en: "mon", "pt-BR": "seg", de: "Mo", es: "lun", pl: "pon", it: "lun" },
                tue: { en: "tue", "pt-BR": "ter", de: "Di", es: "mar", pl: "wt", it: "mar" },
                wed: { en: "wed", "pt-BR": "qua", de: "Mi", es: "mié", pl: "śr", it: "mer" },
                thu: { en: "thu", "pt-BR": "qui", de: "Do", es: "jue", pl: "czw", it: "gio" },
                fri: { en: "fri", "pt-BR": "sex", de: "Fr", es: "vie", pl: "pt", it: "ven" },
                sat: { en: "sat", "pt-BR": "sáb", de: "Sa", es: "sáb", pl: "sob", it: "sab" },
                sun: { en: "sun", "pt-BR": "dom", de: "So", es: "dom", pl: "niedz", it: "dom" },
              },
            },
            from: { type: "text", placeholder: "09:00", label: { en: "Opens", "pt-BR": "Abre", de: "Öffnet", es: "Abre", pl: "Otwarcie", it: "Apre" } },
            to: { type: "text", placeholder: "18:00", label: { en: "Closes", "pt-BR": "Fecha", de: "Schließt", es: "Cierra", pl: "Zamknięcie", it: "Chiude" } },
          },
        },
      },
      computed: {
        // A place nobody has put hours on yet has none: not open, rather than a failure. Pages say
        // "hours unknown" for those instead of a false "closed".
        openNow: (p, ctx) => isOpenNow((p.openingHours as HourRow[] | undefined) ?? [], ctx.now()),
        hasHours: (p) => ((p.openingHours as HourRow[] | undefined) ?? []).length > 0,
        // The cover's chip "#2 of your cafés", beside its status and kind.
        rankText: {
          label: "🏅",
          value: (p, ctx) => (typeof p.rankInKind === "number" && visited(p) ? ctx.t({ en: "#{n} of your {kinds}", "pt-BR": "#{n} entre seus {kinds}", de: "Platz {n} deiner {kinds}", es: "#{n} de tus {kinds}", pl: "#{n} wśród twoich {kinds}", it: "#{n} tra i tuoi {kinds}" }, { n: p.rankInKind, kinds: kindPlural(p.kind, ctx) }) : ""),
        },
        // Directions are the map app's job: a link to the spot, not routing of our own.
        directions: {
          label: { en: "Open in a map", "pt-BR": "Abrir num mapa", de: "In einer Karte öffnen", es: "Abrir en un mapa", pl: "Otwórz na mapie", it: "Apri in una mappa" },
          value: (p) => (p.location ? `https://www.openstreetmap.org/?mlat=${p.location.lat}&mlon=${p.location.lng}#map=17/${p.location.lat}/${p.location.lng}` : ""),
        },
      },
      actions: {
        logVisit: {
          label: { en: "Log a visit", "pt-BR": "Registrar visita", de: "Besuch eintragen", es: "Anotar visita", pl: "Zapisz wizytę", it: "Annota una visita" },
          icon: "📸",
          description: "Record a visit to this place: when, what you had, who you were with.",
          input: {
            at: { type: "datetime", required: true, label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" } },
            dish: { type: "text", label: { en: "What you had", "pt-BR": "O que você pediu", de: "Was du hattest", es: "Qué tomaste", pl: "Co jadłeś", it: "Cosa hai preso" } },
            with: { type: "text", label: { en: "Who with", "pt-BR": "Com quem", de: "Mit wem", es: "Con quién", pl: "Z kim", it: "Con chi" } },
            note: { type: "text", multiline: true, label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
          },
          run: async (p, ctx, input) => {
            const { at, dish, with: who, note } = (input ?? {}) as { at?: Date | string; dish?: string; with?: string; note?: string };
            await ctx.create("visit", { place: p.id, at: at ? new Date(at) : ctx.now(), dish: dish ?? "", with: who ?? "", note: note ?? "" });
            if (p.status === "want to go") await ctx.patch("place", p.id, { status: "been" });
            // A first visit to a kind you have others of: where does it stand?
            if (typeof p.rankInKind !== "number") await rankPlace({ ...p, status: "been" } as Resolved, ctx);
          },
        },
        rank: {
          label: { en: "Rank it", "pt-BR": "Classificar", de: "Einordnen", es: "Clasificar", pl: "Oceń na tle innych", it: "Classifica" },
          icon: "🏅",
          description: "Place it among the places of its own kind you have been to, by comparing it with them one at a time.",
          run: async (p, ctx) => {
            await rankPlace(p, ctx);
          },
        },
        favourite: {
          label: { en: "Favourite", "pt-BR": "Favoritar", de: "Lieblingsort", es: "Favorito", pl: "Ulubione", it: "Preferito" },
          icon: "♥",
          run: async (p, ctx) => {
            await ctx.patch("place", p.id, { status: p.status === "favourite" ? "been" : "favourite" });
          },
        },
      },
    },

    // One time you were there: the memory a place keeps.
    visit: {
      label: { en: "Visit", "pt-BR": "Visita", de: "Besuch", es: "Visita", pl: "Wizyta", it: "Visita" },
      icon: "📸",
      displayField: "title",
      fields: {
        place: { type: "relation", to: "place", required: true, label: { en: "Place", "pt-BR": "Lugar", de: "Ort", es: "Lugar", pl: "Miejsce", it: "Luogo" } },
        at: { type: "datetime", required: true, label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" } },
        photo: { type: "media", accept: "image", label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } },
        dish: { type: "text", label: { en: "What you had", "pt-BR": "O que você pediu", de: "Was du hattest", es: "Qué tomaste", pl: "Co jadłeś", it: "Cosa hai preso" } },
        with: { type: "text", label: { en: "Who with", "pt-BR": "Com quem", de: "Mit wem", es: "Con quién", pl: "Z kim", it: "Con chi" } },
        note: { type: "text", multiline: true, label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
      },
      computed: {
        title: (v) => String(v.place?.name ?? "—"),
        // On the place's own page the place goes without saying: what you had, and who with.
        what: (v, ctx) => String(v.dish || ctx.t({ en: "A visit", "pt-BR": "Uma visita", de: "Ein Besuch", es: "Una visita", pl: "Wizyta", it: "Una visita" })),
        company: (v, ctx) => [v.with ? ctx.t({ en: "with {who}", "pt-BR": "com {who}", de: "mit {who}", es: "con {who}", pl: "z: {who}", it: "con {who}" }, { who: String(v.with) }) : "", v.note ?? ""].filter(Boolean).join(" · "),
        // The visit's own photo, else the place's.
        picture: (v) => v.photo ?? (Array.isArray(v.place?.photo) ? v.place.photo[0] : v.place?.photo) ?? null,
      },
    },
  },

  pages: [
    {
      id: "map",
      title: { en: "Map", "pt-BR": "Mapa", de: "Karte", es: "Mapa", pl: "Mapa", it: "Mappa" },
      icon: "🗺️",
      // A button the APP puts on the page, running an ordinary function (#216). "Show me all of
      // them" is the other half of the built-in "where am I" — and it is app code, not a host
      // feature, which is the point: `ctx.views` reaches the map that is on screen.
      actions: [
        {
          label: { en: "Show all", "pt-BR": "Mostrar todos", de: "Alle zeigen", es: "Ver todos", pl: "Pokaż wszystkie", it: "Mostra tutti" },
          icon: "⤢",
          run: (ctx) => void ctx.views.map("map").fit(),
        },
        { label: { en: "Save this spot", "pt-BR": "Salvar este lugar", de: "Diesen Ort speichern", es: "Guardar este sitio", pl: "Zapisz to miejsce", it: "Salva questo posto" }, icon: "📍", run: saveHere },
      ],
      view: {
        type: "map",
        entity: "place",
        geo: "location",
        title: (p) => p.name,
        // A pin's colour is its kind, so a glance at the map says "coffee here, a bar there".
        color: (p) => KIND_COLOR[String(p.kind)] ?? "#5FB0E4",
        // What a pin says when you tap it. The photo comes first: it, not the name, is what tells
        // you whether this is the place you meant. "Details" opens the record's own page over the
        // map, so reading one never costs you the view you navigated to.
        display: {
          // The pin itself is the kind's emoji: ☕ here, 🍸 there.
          icon: (p) => KIND_GLYPH[String(p.kind)] ?? "📍",
          primary: "name",
          secondary: (p, ctx) => placeLine(p, ctx),
          media: "photo",
          badges: ["status", "vibes"],
        },
        // filter chips in the view chrome write into ctx.params
        filters: [
          { label: { en: "Category", "pt-BR": "Categoria", de: "Kategorie", es: "Categoría", pl: "Kategoria", it: "Categoria" }, param: "kind", from: "kind" },
          { label: { en: "Status", "pt-BR": "Situação", de: "Status", es: "Estado", pl: "Status", it: "Stato" }, param: "status", from: "status" },
          { label: { en: "Vibe", "pt-BR": "Clima", de: "Stimmung", es: "Ambiente", pl: "Klimat", it: "Atmosfera" }, param: "vibe", from: "vibes", multi: true },
          {
            label: { en: "Open now", "pt-BR": "Aberto agora", de: "Jetzt geöffnet", es: "Abierto ahora", pl: "Teraz otwarte", it: "Aperto ora" },
            param: "openOnly",
            type: "boolean",
          },
        ],
        filter: (p, ctx) => {
          const { kind, status, vibe, openOnly } = ctx.params as { kind?: string; status?: string; vibe?: string[]; openOnly?: boolean };
          const list = ctx.scope.collection;
          if (list && !((p.lists as Array<{ id: string }> | undefined) ?? []).some((l) => l?.id === list.id)) return false;
          if (kind && p.kind !== kind) return false;
          if (status && p.status !== status) return false;
          if (vibe?.length && !vibe.some((v) => ((p.vibes as string[] | undefined) ?? []).includes(v))) return false;
          if (openOnly && !p.openNow) return false;
          return true;
        },
      },
    },
    {
      id: "list",
      title: { en: "All places", "pt-BR": "Todos os lugares", de: "Alle Orte", es: "Todos los lugares", pl: "Wszystkie miejsca", it: "Tutti i luoghi" },
      icon: "📍",
      description: { en: "Favourites first, by kind. Rank a place against the others of its kind.", "pt-BR": "Favoritos primeiro, por tipo. Classifique um lugar contra os outros do mesmo tipo.", de: "Lieblingsorte zuerst, nach Art. Ordne einen Ort unter seinesgleichen ein.", es: "Favoritos primero, por tipo. Clasifica un sitio frente a los de su tipo.", pl: "Ulubione na początku, według rodzaju. Porównaj miejsce z innymi tego typu.", it: "Preferiti prima, per tipo. Classifica un posto tra quelli del suo tipo." },
      // Figures over the page's filtered rows. Both forms: `op` for a plain aggregate (declarative,
      // so the structural editor can edit it), a `value` function for the one that needs a rule.
      summary: [
        { label: { en: "Places", "pt-BR": "Lugares", de: "Orte", es: "Lugares", pl: "Miejsca", it: "Luoghi" }, op: "count" },
        {
          label: { en: "Average rating", "pt-BR": "Nota média", de: "Ø Bewertung", es: "Valoración media", pl: "Średnia ocena", it: "Voto medio" },
          field: "rating",
          op: "avg",
        },
        {
          label: { en: "Visited", "pt-BR": "Visitados", de: "Besucht", es: "Visitados", pl: "Odwiedzone", it: "Visitati" },
          value: (rows) => rows.filter((p) => visited(p)).length,
        },
      ],
      // A split (#105): on a wide screen a row fills the place on the right; on a phone it opens the
      // place's own page, as any list does.
      layout: {
        type: "split",
        items: [
          {
            view: {
              type: "list",
              entity: "place",
              filters: [
                { label: { en: "Category", "pt-BR": "Categoria", de: "Kategorie", es: "Categoría", pl: "Kategoria", it: "Categoria" }, param: "kind", from: "kind" },
                { label: { en: "Status", "pt-BR": "Situação", de: "Status", es: "Estado", pl: "Status", it: "Stato" }, param: "status", from: "status" },
              ],
              filter: (p, ctx) => {
                const { kind, status } = ctx.params as { kind?: string; status?: string };
                const list = ctx.scope.collection;
                if (list && !((p.lists as Array<{ id: string }> | undefined) ?? []).some((l) => l?.id === list.id)) return false;
                return (!kind || p.kind === kind) && (!status || p.status === status);
              },
              // Favourites, then by your own ranking, then by rating.
              sort: (a, b) =>
                Number(b.status === "favourite") - Number(a.status === "favourite") ||
                (a.rankInKind ?? 99) - (b.rankInKind ?? 99) ||
                (b.rating ?? 0) - (a.rating ?? 0),
              // Every category at once, in the enum's order, each folding away (#108). The chips still
              // narrow it to one.
              group: "kind",
              collapsible: true,
              display: {
                primary: "name",
                // The heading already says the category, so the row does not repeat it. "4,5★" in Polish.
                secondary: (p, ctx) =>
                  [
                    typeof p.rankInKind === "number" && visited(p) ? `#${p.rankInKind}` : "",
                    typeof p.rating === "number" ? `${ctx.format.number(p.rating)}★` : "",
                    statusName(p.status, ctx),
                    p.mustOrder ? `“${p.mustOrder}”` : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                media: "photo",
                badges: ["vibes"],
              },
              rowActions: ["favourite"],
              onOpen: { page: "detail", param: { placeId: "id" } },
            },
          },
          {
            view: { type: "detail", entity: "place", param: "placeId", cover: "banner", facts: ["status", "kind", "rankText"], primaryAction: "logVisit", actions: ["rank", "favourite"] },
          },
        ],
      },
    },
    {
      // Where you have been: every visit on a rail, by month, with its photo.
      id: "memories",
      title: { en: "Memories", "pt-BR": "Memórias", de: "Erinnerungen", es: "Recuerdos", pl: "Wspomnienia", it: "Ricordi" },
      icon: "📸",
      description: { en: "Every visit you logged, what you had and who you were with.", "pt-BR": "Cada visita registrada, o que você pediu e com quem estava.", de: "Jeder Besuch, den du eingetragen hast: was du hattest und mit wem.", es: "Cada visita que anotaste, qué tomaste y con quién.", pl: "Każda zapisana wizyta: co jadłeś i z kim byłeś.", it: "Ogni visita annotata, cosa hai preso e con chi eri." },
      view: {
        type: "timeline",
        entity: "visit",
        date: "at",
        groupBy: "month",
        display: {
          primary: "title",
          secondary: (v, ctx) =>
            [v.dish, v.with ? ctx.t({ en: "with {who}", "pt-BR": "com {who}", de: "mit {who}", es: "con {who}", pl: "z: {who}", it: "con {who}" }, { who: String(v.with) }) : "", v.note].filter(Boolean).join(" · "),
          media: "picture",
        },
        emptyText: { en: "No visits yet. On a place's page, “Log a visit”.", "pt-BR": "Nenhuma visita ainda. Na página de um lugar, “Registrar visita”.", de: "Noch keine Besuche. Auf der Seite eines Orts: „Besuch eintragen“.", es: "Aún no hay visitas. En la página de un sitio, «Anotar visita».", pl: "Brak wizyt. Na stronie miejsca: „Zapisz wizytę”.", it: "Ancora nessuna visita. Nella pagina di un posto, “Annota una visita”." },
      },
    },
    {
      id: "nearby",
      title: { en: "Near me", "pt-BR": "Perto de mim", de: "In meiner Nähe", es: "Cerca de mí", pl: "W pobliżu", it: "Vicino a me" },
      icon: "🧭",
      view: {
        type: "list",
        entity: "place",
        // the "Near me" chip fills ctx.params.me from ctx.caps.geo (view chrome)
        filters: [{ label: { en: "Near me", "pt-BR": "Perto de mim", de: "In meiner Nähe", es: "Cerca de mí", pl: "W pobliżu", it: "Vicino a me" }, param: "me", type: "geo" }],
        filter: (p, ctx) => {
          const me = ctx.params.me as { lat: number; lng: number } | undefined;
          return !!me && distanceKm(p.location, me) <= 2;
        },
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (p, ctx) => placeLine(p, ctx),
          media: "photo",
          badges: ["vibes"],
        },
        onOpen: { page: "detail", param: { placeId: "id" } },
        emptyText: { en: "Tap “Near me” to see what's within 2 km.", "pt-BR": "Toque em “Perto de mim” para ver o que está a até 2 km.", de: "Tippe auf „In meiner Nähe“, um zu sehen, was im Umkreis von 2 km liegt.", es: "Toca «Cerca de mí» para ver lo que hay a menos de 2 km.", pl: "Stuknij „W pobliżu”, by zobaczyć miejsca w promieniu 2 km.", it: "Tocca “Vicino a me” per vedere cosa c'è entro 2 km." },
      },
    },
    {
      // A screen folded out of the WHOLE set rather than out of each record (KA-24). Counting places
      // per category is not per-record arithmetic and is not one figure either, so before the
      // `aggregate` view it could only have been a custom view — and would then have rendered blank
      // for anyone this app was shared with, because custom views are trusted-only.
      //
      // The fold is ordinary TypeScript and runs through the host, so it behaves identically in the
      // isolate. That is the whole claim, and `places-sandbox.spec.ts` checks it untrusted.
      id: "by-kind",
      title: { en: "By category", "pt-BR": "Por categoria", de: "Nach Kategorie", es: "Por categoría", pl: "Według kategorii", it: "Per categoria" },
      icon: "Σ",
      view: {
        type: "aggregate",
        entity: "place",
        title: {
          en: "Places by category",
          "pt-BR": "Lugares por categoria",
          de: "Orte nach Kategorie",
          es: "Lugares por categoría",
          pl: "Miejsca według kategorii",
          it: "Luoghi per categoria",
        },
        emptyText: { en: "No places yet.", "pt-BR": "Nenhum lugar ainda.", de: "Noch keine Orte.", es: "Aún no hay lugares.", pl: "Jeszcze nie ma miejsc.", it: "Ancora nessun luogo." },
        rows: (places, ctx) => {
          const counts = new Map<string, { n: number; rated: number[] }>();
          for (const p of places) {
            const kind = String(p.kind ?? "unknown");
            const bucket = counts.get(kind) ?? { n: 0, rated: [] };
            bucket.n += 1;
            if (typeof p.rating === "number") bucket.rated.push(p.rating);
            counts.set(kind, bucket);
          }
          return [...counts.entries()]
            .sort((a, b) => b[1].n - a[1].n)
            .map(([kind, { n, rated }]) => ({
              id: kind,
              label: `${KIND_GLYPH[kind] ?? "📍"} ${kindName(kind, ctx)}`,
              value: n,
              detail: rated.length
                ? ctx.t(
                    { en: "avg {r}★", "pt-BR": "média {r}★", de: "Ø {r}★", es: "media {r}★", pl: "średnio {r}★", it: "media {r}★" },
                    { r: ctx.format.number(rated.reduce((s, r) => s + r, 0) / rated.length, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
                  )
                : undefined,
              group: ctx.t({ en: "Categories", "pt-BR": "Categorias", de: "Kategorien", es: "Categorías", pl: "Kategorie", it: "Categorie" }),
            }));
        },
      },
    },
    {
      id: "detail",
      title: { en: "Place", "pt-BR": "Lugar", de: "Ort", es: "Lugar", pl: "Miejsce", it: "Luogo" },
      hidden: true,
      view: {
        type: "detail",
        entity: "place",
        param: "placeId",
        cover: "banner",
        facts: ["status", "kind", "rankText"],
        primaryAction: "logVisit",
        sections: [
          { title: { en: "Overview", "pt-BR": "Visão geral", de: "Überblick", es: "Resumen", pl: "Przegląd", it: "Panoramica" }, fields: ["mustOrder", "notes", "vibes", "rating", "lists"] },
          {
            // Every time you were there, on the place's own page: what you had, who with.
            title: { en: "Visits", "pt-BR": "Visitas", de: "Besuche", es: "Visitas", pl: "Wizyty", it: "Visite" },
            related: { entity: "visit", via: "place", view: "timeline", date: "at", display: { primary: "what", secondary: "company" }, limit: 10 },
          },
          { title: { en: "Hours", "pt-BR": "Horários", de: "Öffnungszeiten", es: "Horario", pl: "Godziny", it: "Orari" }, fields: ["openingHours"], collapsible: true },
          { title: { en: "Location", "pt-BR": "Localização", de: "Standort", es: "Ubicación", pl: "Lokalizacja", it: "Posizione" }, fields: ["location", "directions"] },
        ],
        actions: ["rank", "favourite"],
      },
    },
  ],

  migrations: ["1.0.0", "1.1.0", "1.2.0", "1.2.1", "1.3.0"].map((from) => ({ from, to: "2.0.0", steps: TO_STATUS })),

  reminders: [],
});
