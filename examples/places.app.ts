// places.app.ts
// Stresses: geo field + map view, two categorizations, nested opening-hours rows, and
// JS filters for "open now" and "within N km" — arbitrary logic, no DSL.
//
// In six languages (#303). Every language but English is a model's draft (#297). A function sees an
// enum's stored value, never its label (docs/20 Q5), so the two places that put a category into
// words — a pin's second line and the By category page — say it through `kindName`, beside the
// field's own `labels`.
import { defineApp, type Ctx } from "potyro";

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
    case "other":
      return ctx.t({ en: "other", "pt-BR": "outro", de: "Sonstiges", es: "otro", pl: "inne", it: "altro" });
    default:
      return ctx.t({ en: "unknown", "pt-BR": "sem categoria", de: "ohne Kategorie", es: "sin categoría", pl: "bez kategorii", it: "senza categoria" });
  }
};

export default defineApp({
  id: "places",
  name: { en: "Places", "pt-BR": "Lugares", de: "Orte", es: "Lugares", pl: "Miejsca", it: "Luoghi" },
  icon: "📍",
  version: "1.3.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#5FB0E4" },
  permissions: { camera: true, geo: true },
  category: "everyday",
  // The launcher tile (docs/04 §Tile): the places still to visit.
  tile: async (ctx) => {
    const toVisit = (await ctx.query("place")).filter((p) => !p.visited);
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
    };
  },

  entities: {
    place: {
      label: { en: "Place", "pt-BR": "Lugar", de: "Ort", es: "Lugar", pl: "Miejsce", it: "Luogo" },
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        location: {
          type: "geo",
          required: true,
          label: { en: "Location", "pt-BR": "Localização", de: "Standort", es: "Ubicación", pl: "Lokalizacja", it: "Posizione" },
        },
        photo: { type: "media", accept: "image", multiple: true, label: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" } },
        notes: { type: "text", multiline: true, label: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" } },
        kind: {
          type: "enum",
          label: { en: "Kind", "pt-BR": "Tipo", de: "Art", es: "Tipo", pl: "Rodzaj", it: "Tipo" },
          options: ["restaurant", "bar", "cafe", "pizza", "bakery", "other"],
          labels: {
            restaurant: { en: "restaurant", "pt-BR": "restaurante", de: "Restaurant", es: "restaurante", pl: "restauracja", it: "ristorante" },
            bar: { en: "bar", "pt-BR": "bar", de: "Bar", es: "bar", pl: "bar", it: "bar" },
            cafe: { en: "cafe", "pt-BR": "café", de: "Café", es: "cafetería", pl: "kawiarnia", it: "caffè" },
            pizza: { en: "pizza", "pt-BR": "pizzaria", de: "Pizzeria", es: "pizzería", pl: "pizzeria", it: "pizzeria" },
            bakery: { en: "bakery", "pt-BR": "padaria", de: "Bäckerei", es: "panadería", pl: "piekarnia", it: "panetteria" },
            other: { en: "other", "pt-BR": "outro", de: "Sonstiges", es: "otro", pl: "inne", it: "altro" },
          },
        },
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
        visited: {
          type: "boolean",
          default: true,
          label: { en: "Visited", "pt-BR": "Visitado", de: "Besucht", es: "Visitado", pl: "Odwiedzone", it: "Visitato" },
        },
        rating: {
          type: "number",
          min: 0,
          max: 5,
          step: 0.5,
          label: { en: "Rating", "pt-BR": "Nota", de: "Bewertung", es: "Valoración", pl: "Ocena", it: "Voto" },
        },
        openingHours: {
          type: "list",
          label: {
            en: "Opening Hours",
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
            from: { type: "text", label: { en: "From (HH:MM)", "pt-BR": "Das (HH:MM)", de: "Von (HH:MM)", es: "Desde (HH:MM)", pl: "Od (GG:MM)", it: "Dalle (HH:MM)" } },
            to: { type: "text", label: { en: "To (HH:MM)", "pt-BR": "Até (HH:MM)", de: "Bis (HH:MM)", es: "Hasta (HH:MM)", pl: "Do (GG:MM)", it: "Alle (HH:MM)" } },
          },
        },
      },
      computed: {
        // A place nobody has put hours on yet has none: not open, rather than a failure.
        openNow: (p, ctx) => isOpenNow((p.openingHours as HourRow[] | undefined) ?? [], ctx.now()),
      },
      actions: {
        markVisited: {
          label: {
            en: "Mark Visited",
            "pt-BR": "Marcar como visitado",
            de: "Als besucht markieren",
            es: "Marcar como visitado",
            pl: "Oznacz jako odwiedzone",
            it: "Segna come visitato",
          },
          run: async (p, ctx) => {
            await ctx.patch("place", p.id, { visited: true });
          },
        },
      },
    },
  },

  pages: [
    {
      id: "map",
      title: { en: "Map", "pt-BR": "Mapa", de: "Karte", es: "Mapa", pl: "Mapa", it: "Mappa" },
      // A button the APP puts on the page, running an ordinary function (#216). "Show me all of
      // them" is the other half of the built-in "where am I" — and it is app code, not a host
      // feature, which is the point: `ctx.views` reaches the map that is on screen.
      actions: [
        {
          label: { en: "Show all", "pt-BR": "Mostrar todos", de: "Alle zeigen", es: "Ver todos", pl: "Pokaż wszystkie", it: "Mostra tutti" },
          icon: "⤢",
          run: (ctx) => void ctx.views.map("map").fit(),
        },
      ],
      view: {
        type: "map",
        entity: "place",
        geo: "location",
        title: (p) => p.name,
        color: (p) => (p.kind === "bar" ? "#E4A93C" : p.kind === "pizza" ? "#C0574D" : "#5FB0E4"),
        // What a pin says when you tap it. The photo comes first: it, not the name, is what tells
        // you whether this is the place you meant. "Details" opens the record's own page over the
        // map, so reading one never costs you the view you navigated to.
        display: {
          primary: "name",
          secondary: (p, ctx) => {
            const open = p.openNow
              ? ctx.t({ en: "open now", "pt-BR": "aberto agora", de: "jetzt geöffnet", es: "abierto ahora", pl: "teraz otwarte", it: "aperto ora" })
              : ctx.t({ en: "closed", "pt-BR": "fechado", de: "geschlossen", es: "cerrado", pl: "zamknięte", it: "chiuso" });
            return `${kindName(p.kind, ctx)} · ${open}`;
          },
          media: "photo",
          badges: ["vibes"],
        },
        // filter chips in the view chrome write into ctx.params
        filters: [
          { label: { en: "Category", "pt-BR": "Categoria", de: "Kategorie", es: "Categoría", pl: "Kategoria", it: "Categoria" }, param: "kind", from: "kind" },
          { label: { en: "Vibe", "pt-BR": "Clima", de: "Stimmung", es: "Ambiente", pl: "Klimat", it: "Atmosfera" }, param: "vibe", from: "vibes", multi: true },
          {
            label: { en: "Open now", "pt-BR": "Aberto agora", de: "Jetzt geöffnet", es: "Abierto ahora", pl: "Teraz otwarte", it: "Aperto ora" },
            param: "openOnly",
            type: "boolean",
          },
        ],
        filter: (p, ctx) => {
          const { kind, vibe, openOnly } = ctx.params as { kind?: string; vibe?: string[]; openOnly?: boolean };
          if (kind && p.kind !== kind) return false;
          if (vibe?.length && !vibe.some((v) => ((p.vibes as string[] | undefined) ?? []).includes(v))) return false;
          if (openOnly && !p.openNow) return false;
          return true;
        },
      },
    },
    {
      id: "nearby",
      title: { en: "Near me", "pt-BR": "Perto de mim", de: "In meiner Nähe", es: "Cerca de mí", pl: "W pobliżu", it: "Vicino a me" },
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
          secondary: (p, ctx) => {
            const open = p.openNow
              ? ctx.t({ en: "open", "pt-BR": "aberto", de: "geöffnet", es: "abierto", pl: "otwarte", it: "aperto" })
              : ctx.t({ en: "closed", "pt-BR": "fechado", de: "geschlossen", es: "cerrado", pl: "zamknięte", it: "chiuso" });
            return `${kindName(p.kind, ctx)} · ${open}`;
          },
          media: "photo",
          badges: ["vibes"],
        },
      },
    },
    {
      id: "list",
      title: { en: "All places", "pt-BR": "Todos os lugares", de: "Alle Orte", es: "Todos los lugares", pl: "Wszystkie miejsca", it: "Tutti i luoghi" },
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
          value: (rows) => rows.filter((p) => p.visited).length,
        },
      ],
      view: {
        type: "list",
        entity: "place",
        filters: [{ label: { en: "Category", "pt-BR": "Categoria", de: "Kategorie", es: "Categoría", pl: "Kategoria", it: "Categoria" }, param: "kind", from: "kind" }],
        filter: (p, ctx) => {
          const kind = (ctx.params as { kind?: string }).kind;
          return !kind || p.kind === kind;
        },
        sort: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
        // Every category at once, in the enum's order, each folding away (#108). The chips still
        // narrow it to one.
        group: "kind",
        collapsible: true,
        display: {
          primary: "name",
          // The heading already says the category, so the row does not repeat it. "4,5★" in Polish.
          secondary: (p, ctx) => `${typeof p.rating === "number" ? ctx.format.number(p.rating) : "–"}★`,
          media: "photo",
          badges: ["vibes"],
        },
        onOpen: { page: "detail", param: { placeId: "id" } },
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
              label: kindName(kind, ctx),
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
        sections: [
          { title: { en: "Overview", "pt-BR": "Visão geral", de: "Überblick", es: "Resumen", pl: "Przegląd", it: "Panoramica" }, fields: ["photo", "kind", "vibes", "rating"] },
          { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["notes"] },
          { title: { en: "Hours", "pt-BR": "Horários", de: "Öffnungszeiten", es: "Horario", pl: "Godziny", it: "Orari" }, fields: ["openingHours"] },
          { title: { en: "Location", "pt-BR": "Localização", de: "Standort", es: "Ubicación", pl: "Lokalizacja", it: "Posizione" }, fields: ["location"] },
        ],
        actions: ["markVisited"],
      },
    },
  ],

  reminders: [],
});
