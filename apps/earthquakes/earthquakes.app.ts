// Earthquakes, live: every earthquake EMSC reports, on a map the moment it is reported, with the
// strongest of the last day, the ones near you, and an alert when a strong one is close.
//
// The feed is EMSC's public WebSocket (wss://www.seismicportal.eu/standing_order/websocket, docs/28);
// the last day is filled in from EMSC's catalogue when it starts. Data: EMSC, CC BY 4.0.
//
// Every screen is a built-in view, on purpose: a friend who opens this from a share link runs it
// sealed — its connections only to the host it declares, after one question — and a sealed app's
// custom views do not render. The status line at the top of the map and the list is an aggregate
// view over one `feed` record the app keeps up to date.
//
// The demo plays real earlier earthquakes through the same path on this device: no network, no
// question, so a share-link demo and the tests work without EMSC.
//
// In six languages (docs/20); every language but English is a model's draft (#297).

import { defineApp, type AggregateRow, type Ctx, type FilterChip, type Resolved } from "potyro";
import { alertSettings, clearDemo, editAlerts, isDemoRunning, liveState, playDemo, quakeLine, stopWatching, wasStartedHere, watchLive, type FeedState } from "./feed.js";
import { distanceKm, EMSC_HOST, strength, STRENGTH_COLOURS, STRENGTHS, toDate } from "./quakes.js";
import { agoText, awayText, magText, STATE_HINTS, STATE_WORDS, STRENGTH_WORDS } from "./words.js";

const DAY_MS = 86_400_000;

const FILTERS: FilterChip[] = [
  { label: { en: "From magnitude", "pt-BR": "A partir da magnitude", de: "Ab Magnitude", es: "Desde la magnitud", pl: "Od magnitudy", it: "Da magnitudo" }, param: "min", type: "number", placeholder: { en: "Magnitude from…", "pt-BR": "Magnitude a partir de…", de: "Magnitude ab …", es: "Magnitud desde…", pl: "Magnituda od…", it: "Magnitudo da…" } },
  { label: { en: "Last 24 h", "pt-BR": "Últimas 24 h", de: "Letzte 24 Std.", es: "Últimas 24 h", pl: "Ostatnie 24 godz.", it: "Ultime 24 h" }, param: "day", type: "boolean" },
];

/** The chips: at least this strong, and (when ticked) in the last day. */
function chipFilter(r: Resolved, ctx: Ctx): boolean {
  const { min, day } = ctx.params as { min?: number; day?: boolean };
  if (typeof min === "number" && Number(r.mag) < min) return false;
  if (day && ctx.now().getTime() - (toDate(r.time)?.getTime() ?? 0) > DAY_MS) return false;
  return true;
}

const byTime = (a: Resolved, b: Resolved) => (toDate(b.time)?.getTime() ?? 0) - (toDate(a.time)?.getTime() ?? 0);

const ACTIONS = {
  watch: { label: { en: "Watch live", "pt-BR": "Ver ao vivo", de: "Live verfolgen", es: "Ver en vivo", pl: "Oglądaj na żywo", it: "Segui in diretta" }, icon: "▶", run: watchLive },
  stop: { label: { en: "Stop", "pt-BR": "Parar", de: "Stopp", es: "Parar", pl: "Zatrzymaj", it: "Ferma" }, icon: "■", run: stopWatching },
  demo: {
    label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" },
    icon: "✨",
    run: async (ctx: Ctx) => {
      const demos = await ctx.query("quake", { filter: (r) => r.demo === true, limit: 1 });
      if (!demos.length) return playDemo(ctx);
      const pick = await ctx.ui.menu({
        title: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" },
        items: [
          { id: "play", icon: "✨", label: { en: "Play the demo again", "pt-BR": "Ver a demo de novo", de: "Demo noch einmal", es: "Ver la demo otra vez", pl: "Odtwórz demo jeszcze raz", it: "Rivedi la demo" }, detail: { en: "Real earthquakes from earlier, replayed here. Nothing is sent.", "pt-BR": "Terremotos reais de antes, repetidos aqui. Nada é enviado.", de: "Echte Erdbeben von früher, hier nachgespielt. Nichts wird gesendet.", es: "Terremotos reales de antes, repetidos aquí. No se envía nada.", pl: "Prawdziwe trzęsienia z przeszłości, odtworzone tutaj. Nic nie jest wysyłane.", it: "Terremoti veri di prima, riprodotti qui. Non viene inviato nulla." } },
          { id: "clear", icon: "🧹", destructive: true, label: { en: "Clear the demo", "pt-BR": "Limpar a demo", de: "Demo löschen", es: "Borrar la demo", pl: "Usuń demo", it: "Cancella la demo" } },
        ],
      });
      if (pick === "play") await playDemo(ctx);
      if (pick === "clear") await clearDemo(ctx);
    },
  },
};

const STATE_GLYPH: Record<FeedState, string> = {
  off: "○",
  connecting: "◌",
  live: "●",
  retrying: "↻",
  paused: "❚❚",
  offline: "⚠",
  unreachable: "⚠",
  denied: "⚠",
  blocked: "⚠",
  demo: "✨",
  "demo-done": "✨",
};
const TONE: Partial<Record<FeedState, AggregateRow["tone"]>> = { live: "positive", demo: "positive", offline: "negative", unreachable: "negative", denied: "negative", blocked: "negative" };

/** What the feed is doing, read from its record — but a fresh copy of the app has started nothing. */
function effectiveState(feed: Resolved | undefined): FeedState {
  if (!wasStartedHere()) return "off";
  const recorded = (feed?.state as FeedState | undefined) ?? "off";
  if (recorded === "demo" && !isDemoRunning()) return "demo-done";
  if (recorded !== "demo" && recorded !== "demo-done") return liveState();
  return recorded;
}

/** The status line: the feed, the latest quake, and the alert. */
async function statusRows(rows: Resolved[], ctx: Ctx): Promise<AggregateRow[]> {
  const feed = rows[0];
  const state = effectiveState(feed);
  const n = Number(feed?.count ?? 0);
  const out: AggregateRow[] = [
    {
      id: "state",
      label: `${STATE_GLYPH[state]} ${ctx.t(STATE_WORDS[state])}`,
      detail: ctx.t(STATE_HINTS[state]),
      value: (state === "live" || state === "demo") && n > 0 ? ctx.t({ en: "{n} new", "pt-BR": "{n} novos", de: "{n} neu", es: "{n} nuevos", pl: "{n} nowych", it: "{n} nuovi" }, { n }) : undefined,
      tone: TONE[state] ?? "neutral",
    },
  ];
  const lastAt = toDate(feed?.lastAt);
  if (feed?.lastPlace && lastAt && state !== "off") {
    out.push({
      id: "latest",
      label: ctx.t({ en: "Latest: {place}", "pt-BR": "Último: {place}", de: "Zuletzt: {place}", es: "Último: {place}", pl: "Ostatnie: {place}", it: "Ultimo: {place}" }, { place: String(feed.lastPlace) }),
      detail: agoText(lastAt, new Date(), ctx),
      value: magText(Number(feed.lastMag), ctx),
    });
  }
  const alerts = await alertSettings(ctx);
  out.push({
    id: "alerts",
    label: ctx.t({ en: "Alerts near you", "pt-BR": "Alertas perto de você", de: "Warnungen in deiner Nähe", es: "Alertas cerca de ti", pl: "Alerty w pobliżu", it: "Avvisi vicino a te" }),
    detail: ctx.t({ en: "Change them under Near me.", "pt-BR": "Mude em Perto de mim.", de: "Ändern unter In meiner Nähe.", es: "Cámbialas en Cerca de mí.", pl: "Zmień w zakładce W pobliżu.", it: "Cambiali in Vicino a me." }),
    value: alerts.on && alerts.home ? `${magText(alerts.above, ctx)}+ · ${ctx.format.number(alerts.withinKm)} km` : ctx.t({ en: "Off", "pt-BR": "Desligados", de: "Aus", es: "Desactivadas", pl: "Wyłączone", it: "Disattivati" }),
  });
  return out;
}

const STATUS_VIEW = { type: "aggregate" as const, entity: "feed", rows: statusRows };

const QUAKE_DISPLAY = {
  // The magnitude first: it is what a glance down the list is for.
  primary: (r: Resolved, ctx: Ctx) => `${magText(Number(r.mag), ctx)} · ${String(r.place)}`,
  secondary: (r: Resolved, ctx: Ctx) => quakeLine(r, ctx),
  badges: ["strength"],
};

const EMPTY = {
  en: "No earthquakes here yet. Tap “Watch live” to follow EMSC's feed — the last day is filled in first — or “Demo” to see how it looks without connecting.",
  "pt-BR": "Ainda não há terremotos aqui. Toque em “Ver ao vivo” para acompanhar o feed do EMSC — o último dia vem primeiro — ou em “Demo” para ver como fica sem se conectar.",
  de: "Noch keine Erdbeben hier. Tippe auf „Live verfolgen“, um dem Feed von EMSC zu folgen — der letzte Tag wird zuerst geladen — oder auf „Demo“, um es ohne Verbindung zu sehen.",
  es: "Aún no hay terremotos aquí. Toca «Ver en vivo» para seguir el feed del EMSC (primero se carga el último día) o «Demo» para verlo sin conectarte.",
  pl: "Nie ma tu jeszcze trzęsień. Stuknij „Oglądaj na żywo”, by śledzić kanał EMSC — najpierw wczyta się ostatnia doba — albo „Demo”, by zobaczyć to bez łączenia.",
  it: "Ancora nessun terremoto qui. Tocca “Segui in diretta” per seguire il feed di EMSC (prima arriva l'ultimo giorno) oppure “Demo” per vederlo senza collegarti.",
};

export default defineApp({
  id: "earthquakes",
  name: { en: "Earthquakes", "pt-BR": "Terremotos", de: "Erdbeben", es: "Terremotos", pl: "Trzęsienia ziemi", it: "Terremoti" },
  icon: "🌍",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#c2410c" },
  nav: "tabs",
  // The feed and the catalogue are one host. Location and notifications only for the near-me alert.
  permissions: { network: { hosts: [EMSC_HOST] }, geo: true, notifications: true, haptics: true },
  quickActions: [],
  entities: {
    quake: {
      // Only the feed writes these: no Add, Edit or Delete for people (docs/03 editableBy).
      editableBy: "app",
      label: { en: "Earthquake", "pt-BR": "Terremoto", de: "Erdbeben", es: "Terremoto", pl: "Trzęsienie ziemi", it: "Terremoto" },
      icon: "🌍",
      displayField: "place",
      fields: {
        place: { type: "text", required: true, label: { en: "Where", "pt-BR": "Onde", de: "Wo", es: "Dónde", pl: "Gdzie", it: "Dove" } },
        mag: { type: "number", required: true, step: 0.1, label: { en: "Magnitude", "pt-BR": "Magnitude", de: "Magnitude", es: "Magnitud", pl: "Magnituda", it: "Magnitudo" } },
        // Stored rather than computed so that it can wear its colour on a badge and group a list.
        strength: {
          type: "enum",
          options: [...STRENGTHS],
          colors: { major: "purple", strong: "red", moderate: "orange", light: "yellow", minor: "grey" },
          labels: STRENGTH_WORDS,
          label: { en: "Strength", "pt-BR": "Intensidade", de: "Stärke", es: "Intensidad", pl: "Siła", it: "Intensità" },
        },
        magType: { type: "text", label: { en: "Magnitude scale", "pt-BR": "Escala", de: "Skala", es: "Escala", pl: "Skala", it: "Scala" } },
        depth: { type: "number", unit: "km", label: { en: "Depth", "pt-BR": "Profundidade", de: "Tiefe", es: "Profundidad", pl: "Głębokość", it: "Profondità" } },
        time: { type: "datetime", precision: "minute", required: true, label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" } },
        updated: { type: "datetime", precision: "minute", hidden: true, label: { en: "Revised", "pt-BR": "Revisado", de: "Überarbeitet", es: "Revisado", pl: "Zaktualizowano", it: "Rivisto" } },
        where: { type: "geo", label: { en: "On the map", "pt-BR": "No mapa", de: "Auf der Karte", es: "En el mapa", pl: "Na mapie", it: "Sulla mappa" } },
        authority: { type: "text", label: { en: "Located by", "pt-BR": "Localizado por", de: "Geortet von", es: "Localizado por", pl: "Zlokalizowało", it: "Localizzato da" } },
        link: { type: "url", label: { en: "On EMSC", "pt-BR": "No EMSC", de: "Bei EMSC", es: "En el EMSC", pl: "W EMSC", it: "Su EMSC" } },
        uid: { type: "text", hidden: true, label: { en: "EMSC id", "pt-BR": "ID no EMSC", de: "EMSC-ID", es: "ID del EMSC", pl: "ID w EMSC", it: "ID EMSC" } },
        demo: { type: "boolean", hidden: true, label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" } },
      },
      computed: {
        ago: {
          value: (r, ctx) => {
            const t = toDate(r.time);
            return t ? agoText(t, ctx.now(), ctx) : "";
          },
          label: { en: "How long ago", "pt-BR": "Há quanto tempo", de: "Wie lange her", es: "Hace cuánto", pl: "Jak dawno", it: "Quanto tempo fa" },
        },
      },
    },
    feed: {
      editableBy: "app",
      label: { en: "Feed", "pt-BR": "Feed", de: "Feed", es: "Feed", pl: "Kanał", it: "Feed" },
      displayField: "state",
      fields: {
        state: { type: "text", label: { en: "State", "pt-BR": "Estado", de: "Zustand", es: "Estado", pl: "Stan", it: "Stato" } },
        since: { type: "datetime", precision: "minute", label: { en: "Since", "pt-BR": "Desde", de: "Seit", es: "Desde", pl: "Od", it: "Da" } },
        count: { type: "number", integer: true, label: { en: "New", "pt-BR": "Novos", de: "Neu", es: "Nuevos", pl: "Nowe", it: "Nuovi" } },
        lastPlace: { type: "text", label: { en: "Latest", "pt-BR": "Último", de: "Zuletzt", es: "Último", pl: "Ostatnie", it: "Ultimo" } },
        lastMag: { type: "number", label: { en: "Latest magnitude", "pt-BR": "Última magnitude", de: "Letzte Magnitude", es: "Última magnitud", pl: "Ostatnia magnituda", it: "Ultima magnitudo" } },
        lastAt: { type: "datetime", precision: "minute", label: { en: "Latest at", "pt-BR": "Último em", de: "Zuletzt um", es: "Último a las", pl: "Ostatnie o", it: "Ultimo alle" } },
      },
    },
  },
  pages: [
    {
      id: "live",
      title: { en: "Map", "pt-BR": "Mapa", de: "Karte", es: "Mapa", pl: "Mapa", it: "Mappa" },
      icon: "🗺️",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "map",
              entity: "quake",
              geo: "where",
              title: (r, ctx) => `${magText(Number(r.mag), ctx)} · ${String(r.place)}`,
              color: (r) => STRENGTH_COLOURS[strength(Number(r.mag))],
              display: QUAKE_DISPLAY,
              filters: FILTERS,
              filter: chipFilter,
              // The whole Pacific ring of fire and the Mediterranean in one view; the person pans from there.
              camera: { center: [160, 22], zoom: 1.1 },
              locate: false,
              onOpen: { page: "quake", param: { quakeId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "latest",
      title: { en: "Latest", "pt-BR": "Recentes", de: "Neueste", es: "Recientes", pl: "Najnowsze", it: "Recenti" },
      icon: "⏱️",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "list",
              entity: "quake",
              filters: FILTERS,
              filter: chipFilter,
              sort: byTime,
              display: QUAKE_DISPLAY,
              emptyText: EMPTY,
              onOpen: { page: "quake", param: { quakeId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "strongest",
      title: { en: "Strongest", "pt-BR": "Mais fortes", de: "Stärkste", es: "Más fuertes", pl: "Najsilniejsze", it: "Più forti" },
      icon: "📈",
      summary: [
        { label: { en: "In the last 24 h", "pt-BR": "Nas últimas 24 h", de: "In den letzten 24 Std.", es: "En las últimas 24 h", pl: "W ostatnich 24 godz.", it: "Nelle ultime 24 h" }, op: "count" },
        {
          label: { en: "Strongest", "pt-BR": "Mais forte", de: "Stärkstes", es: "Más fuerte", pl: "Najsilniejsze", it: "Più forte" },
          value: (rows, ctx) => (rows.length ? magText(Math.max(...rows.map((r) => Number(r.mag))), ctx) : null),
        },
        {
          label: { en: "Magnitude 5 and up", "pt-BR": "Magnitude 5 ou mais", de: "Ab Magnitude 5", es: "Magnitud 5 o más", pl: "Magnituda 5 i więcej", it: "Magnitudo 5 e oltre" },
          value: (rows) => rows.filter((r) => Number(r.mag) >= 5).length,
        },
      ],
      view: {
        type: "list",
        entity: "quake",
        filter: (r, ctx) => ctx.now().getTime() - (toDate(r.time)?.getTime() ?? 0) <= DAY_MS,
        sort: (a, b) => Number(b.mag) - Number(a.mag) || byTime(a, b),
        display: QUAKE_DISPLAY,
        group: "strength",
        emptyText: {
          en: "Nothing in the last 24 hours yet. “Watch live” on the map fills the last day in.",
          "pt-BR": "Nada nas últimas 24 horas ainda. “Ver ao vivo” no mapa carrega o último dia.",
          de: "Noch nichts in den letzten 24 Stunden. „Live verfolgen“ auf der Karte lädt den letzten Tag.",
          es: "Aún nada en las últimas 24 horas. «Ver en vivo» en el mapa carga el último día.",
          pl: "Na razie nic z ostatnich 24 godzin. „Oglądaj na żywo” na mapie wczyta ostatnią dobę.",
          it: "Ancora niente nelle ultime 24 ore. “Segui in diretta” sulla mappa carica l'ultimo giorno.",
        },
        onOpen: { page: "quake", param: { quakeId: "id" } },
      },
    },
    {
      id: "near",
      title: { en: "Near me", "pt-BR": "Perto de mim", de: "In meiner Nähe", es: "Cerca de mí", pl: "W pobliżu", it: "Vicino a me" },
      icon: "📍",
      actions: [{ label: { en: "Alerts…", "pt-BR": "Alertas…", de: "Warnungen …", es: "Alertas…", pl: "Alerty…", it: "Avvisi…" }, icon: "🔔", run: editAlerts }],
      view: {
        type: "list",
        entity: "quake",
        filters: [
          { label: { en: "Where I am", "pt-BR": "Onde estou", de: "Wo ich bin", es: "Dónde estoy", pl: "Gdzie jestem", it: "Dove sono" }, param: "me", type: "geo" },
          { label: { en: "Within km", "pt-BR": "Raio em km", de: "Umkreis in km", es: "Radio en km", pl: "Promień w km", it: "Entro km" }, param: "km", type: "number", placeholder: { en: "Within km (1000)", "pt-BR": "Raio em km (1000)", de: "Umkreis in km (1000)", es: "Radio en km (1000)", pl: "Promień w km (1000)", it: "Entro km (1000)" } },
        ],
        filter: (r, ctx) => {
          const me = ctx.params.me as { lat: number; lng: number } | undefined;
          const where = r.where as { lat: number; lng: number } | undefined;
          if (!me || !where) return false;
          const km = typeof ctx.params.km === "number" ? ctx.params.km : 1000;
          return distanceKm(where, me) <= km;
        },
        sort: byTime,
        display: {
          primary: "place",
          secondary: (r, ctx) => {
            const me = ctx.params.me as { lat: number; lng: number } | undefined;
            const where = r.where as { lat: number; lng: number } | undefined;
            return [quakeLine(r, ctx), me && where ? awayText(distanceKm(where, me), ctx) : ""].filter(Boolean).join(" · ");
          },
          badges: ["strength"],
        },
        emptyText: (ctx) =>
          ctx.params.me
            ? ctx.t({ en: "No earthquakes on this device that close. Widen “Within km”, or set an alert for the next one.", "pt-BR": "Nenhum terremoto tão perto neste aparelho. Aumente o “Raio em km” ou crie um alerta para o próximo.", de: "Keine Erdbeben so nah auf diesem Gerät. Vergrößere den „Umkreis in km“ oder stell eine Warnung für das nächste ein.", es: "No hay terremotos tan cerca en este dispositivo. Amplía el «Radio en km» o crea una alerta para el próximo.", pl: "Na tym urządzeniu nie ma tak bliskich trzęsień. Zwiększ „Promień w km” albo ustaw alert na następne.", it: "Nessun terremoto così vicino su questo dispositivo. Allarga “Entro km” o imposta un avviso per il prossimo." })
            : ctx.t({ en: "Tap “Where I am” to see the earthquakes near you, nearest first in time. “Alerts…” tells you about a strong one close by while the app is open.", "pt-BR": "Toque em “Onde estou” para ver os terremotos perto de você. “Alertas…” avisa de um forte por perto enquanto o app está aberto.", de: "Tippe auf „Wo ich bin“, um die Erdbeben in deiner Nähe zu sehen. „Warnungen …“ meldet ein starkes in der Nähe, solange die App offen ist.", es: "Toca «Dónde estoy» para ver los terremotos cerca de ti. «Alertas…» te avisa de uno fuerte cercano mientras la app está abierta.", pl: "Stuknij „Gdzie jestem”, by zobaczyć trzęsienia w pobliżu. „Alerty…” powiadomią o silnym w okolicy, gdy aplikacja jest otwarta.", it: "Tocca “Dove sono” per vedere i terremoti vicino a te. “Avvisi…” ti avvisa di uno forte nelle vicinanze mentre l'app è aperta." }),
        onOpen: { page: "quake", param: { quakeId: "id" } },
      },
    },
    {
      id: "quake",
      title: { en: "Earthquake", "pt-BR": "Terremoto", de: "Erdbeben", es: "Terremoto", pl: "Trzęsienie ziemi", it: "Terremoto" },
      hidden: true,
      view: {
        type: "detail",
        entity: "quake",
        param: "quakeId",
        sections: [
          { fields: ["strength", "mag", "ago", "time", "depth"] },
          { title: { en: "Source", "pt-BR": "Fonte", de: "Quelle", es: "Fuente", pl: "Źródło", it: "Fonte" }, fields: ["authority", "magType", "link"] },
        ],
      },
    },
  ],
});
