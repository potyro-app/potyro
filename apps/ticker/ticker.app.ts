// Ticker: a watchlist of live prices — crypto as it trades on Coinbase, currencies at the ECB's
// reference rate — with the change since yesterday, a sparkline of the last hour, a chart per symbol
// and alerts that ring once when a price crosses a line you set.
//
// Crypto comes over Coinbase Exchange's public WebSocket (wss://ws-feed.exchange.coinbase.com,
// docs/28), many ticks a second, written at most every 3 seconds per symbol (feed.ts). Currencies:
// no public keyless WebSocket exists for them, so the ECB's rates are fetched from Frankfurter every
// 30 minutes — they change once a working day — and the app says so where it shows one.
//
// Every screen is a built-in view, so a friend who opens it from a share link (sealed) gets all of
// it; the demo plays a made-up market through the same path, nothing sent anywhere.
//
// In six languages (docs/20); every language but English is a model's draft (#297).

import { defineApp, type AggregateRow, type Ctx, type Resolved } from "potyro";
import { addSymbol, clearDemo, isDemoRunning, liveState, playDemo, removeSymbol, setAlert, stopWatching, wasStartedHere, watchLive } from "./feed.js";
import { COINBASE_REST_HOST, COINBASE_WS_HOST, FX_HOST, toDate } from "./prices.js";
import { agoText, changeText, ECB_NOTE, priceText, STATE_HINTS, STATE_WORDS, type FeedState } from "./words.js";

const ACTIONS = {
  watch: { label: { en: "Watch live", "pt-BR": "Ver ao vivo", de: "Live verfolgen", es: "Ver en vivo", pl: "Oglądaj na żywo", it: "Segui in diretta" }, icon: "▶", run: watchLive },
  stop: { label: { en: "Stop", "pt-BR": "Parar", de: "Stopp", es: "Parar", pl: "Zatrzymaj", it: "Ferma" }, icon: "■", run: stopWatching },
  add: { label: { en: "Add", "pt-BR": "Adicionar", de: "Hinzufügen", es: "Añadir", pl: "Dodaj", it: "Aggiungi" }, icon: "＋", run: addSymbol },
  demo: {
    label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" },
    icon: "✨",
    run: async (ctx: Ctx) => {
      const demos = await ctx.query("point", { filter: (r) => r.demo === true, limit: 1 });
      if (!demos.length) return playDemo(ctx);
      const pick = await ctx.ui.menu({
        title: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" },
        items: [
          { id: "play", icon: "✨", label: { en: "Play the demo again", "pt-BR": "Ver a demo de novo", de: "Demo noch einmal", es: "Ver la demo otra vez", pl: "Odtwórz demo jeszcze raz", it: "Rivedi la demo" }, detail: { en: "A made-up market, played here. Nothing is sent.", "pt-BR": "Um mercado inventado, tocado aqui. Nada é enviado.", de: "Ein erfundener Markt, hier abgespielt. Nichts wird gesendet.", es: "Un mercado inventado, reproducido aquí. No se envía nada.", pl: "Wymyślony rynek odtwarzany tutaj. Nic nie jest wysyłane.", it: "Un mercato inventato, riprodotto qui. Non viene inviato nulla." } },
          { id: "clear", icon: "🧹", destructive: true, label: { en: "Clear the demo", "pt-BR": "Limpar a demo", de: "Demo löschen", es: "Borrar la demo", pl: "Usuń demo", it: "Cancella la demo" } },
        ],
      });
      if (pick === "play") await playDemo(ctx);
      if (pick === "clear") await clearDemo(ctx);
    },
  },
};

const GLYPH: Record<FeedState, string> = { off: "○", connecting: "◌", live: "●", retrying: "↻", paused: "❚❚", offline: "⚠", unreachable: "⚠", denied: "⚠", blocked: "⚠", demo: "✨", "demo-done": "✨" };
const TONE: Partial<Record<FeedState, AggregateRow["tone"]>> = { live: "positive", demo: "positive", offline: "negative", unreachable: "negative", denied: "negative", blocked: "negative" };

function effectiveState(feed: Resolved | undefined): FeedState {
  if (!wasStartedHere()) return "off";
  const recorded = (feed?.state as FeedState | undefined) ?? "off";
  if (recorded === "demo" && !isDemoRunning()) return "demo-done";
  if (recorded !== "demo" && recorded !== "demo-done") return liveState();
  return recorded;
}

function statusRows(rows: Resolved[], ctx: Ctx): AggregateRow[] {
  const state = effectiveState(rows[0]);
  const hint = ctx.t(STATE_HINTS[state]) + (state === "live" ? ctx.t(ECB_NOTE) : "");
  return [{ id: "state", label: `${GLYPH[state]} ${ctx.t(STATE_WORDS[state])}`, detail: hint.trim(), tone: TONE[state] ?? "neutral" }];
}

const STATUS_VIEW = { type: "aggregate" as const, entity: "feed", rows: statusRows };

/**
 * "▼ 0.83% in 24 h" — a currency's change is since the day before, with the ECB's day; a crypto price
 * says how old it is only once it is more than a minute old (a stream that stopped), not while it ticks.
 */
function symbolLine(r: Resolved, ctx: Ctx): string {
  const updated = toDate(r.updated);
  if (typeof r.price !== "number") return ctx.t({ en: "No price yet", "pt-BR": "Ainda sem preço", de: "Noch kein Kurs", es: "Aún sin precio", pl: "Brak ceny", it: "Ancora nessun prezzo" });
  const change = changeText(r.change as number | null, ctx);
  const since = r.kind === "fx" ? ctx.t({ en: "since the day before", "pt-BR": "desde o dia anterior", de: "zum Vortag", es: "desde el día anterior", pl: "od poprzedniego dnia", it: "dal giorno prima" }) : ctx.t({ en: "in 24 h", "pt-BR": "em 24 h", de: "in 24 Std.", es: "en 24 h", pl: "w 24 godz.", it: "in 24 h" });
  const stale = updated && Date.now() - updated.getTime() > 60_000;
  const when = updated ? (r.kind === "fx" ? `ECB ${ctx.format.date(updated, { day: "numeric", month: "short" })}` : stale ? agoText(updated, new Date(), ctx) : "") : "";
  return [change ? `${change} ${since}` : "", when].filter(Boolean).join(" · ");
}

const TREND = {
  up: { en: "Up", "pt-BR": "Alta", de: "Steigt", es: "Sube", pl: "Wzrost", it: "Su" },
  down: { en: "Down", "pt-BR": "Baixa", de: "Fällt", es: "Baja", pl: "Spadek", it: "Giù" },
  flat: { en: "Flat", "pt-BR": "Estável", de: "Gleich", es: "Estable", pl: "Bez zmian", it: "Stabile" },
};

export default defineApp({
  id: "ticker",
  name: { en: "Ticker", "pt-BR": "Cotações", de: "Kurse", es: "Cotizaciones", pl: "Notowania", it: "Quotazioni" },
  icon: "📈",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#0f766e" },
  nav: "tabs",
  permissions: { network: { hosts: [COINBASE_WS_HOST, COINBASE_REST_HOST, FX_HOST] }, notifications: true, haptics: true },
  quickActions: [],
  entities: {
    symbol: {
      // The feed and the app's own actions (Add, Set an alert, Remove) write these; a form never does (docs/03 editableBy).
      editableBy: "app",
      label: { en: "Symbol", "pt-BR": "Ativo", de: "Wert", es: "Valor", pl: "Symbol", it: "Simbolo" },
      icon: "📈",
      displayField: "code",
      fields: {
        code: { type: "text", required: true, label: { en: "Symbol", "pt-BR": "Código", de: "Kürzel", es: "Símbolo", pl: "Symbol", it: "Simbolo" } },
        name: { type: "text", label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        kind: {
          type: "enum",
          options: ["crypto", "fx"],
          labels: { crypto: { en: "Crypto · Coinbase", "pt-BR": "Cripto · Coinbase", de: "Krypto · Coinbase", es: "Cripto · Coinbase", pl: "Krypto · Coinbase", it: "Cripto · Coinbase" }, fx: { en: "Currency · ECB", "pt-BR": "Moeda · BCE", de: "Währung · EZB", es: "Divisa · BCE", pl: "Waluta · EBC", it: "Valuta · BCE" } },
          label: { en: "Kind", "pt-BR": "Tipo", de: "Art", es: "Tipo", pl: "Rodzaj", it: "Tipo" },
        },
        price: { type: "number", label: { en: "Price", "pt-BR": "Preço", de: "Kurs", es: "Precio", pl: "Cena", it: "Prezzo" } },
        base: { type: "number", hidden: true, label: { en: "Compared with", "pt-BR": "Comparado com", de: "Verglichen mit", es: "Comparado con", pl: "W porównaniu z", it: "Confrontato con" } },
        change: { type: "number", label: { en: "Change (%)", "pt-BR": "Variação (%)", de: "Änderung (%)", es: "Cambio (%)", pl: "Zmiana (%)", it: "Variazione (%)" } },
        trend: { type: "enum", options: ["up", "down", "flat"], colors: { up: "green", down: "red", flat: "grey" }, labels: TREND, label: { en: "Today", "pt-BR": "Hoje", de: "Heute", es: "Hoy", pl: "Dziś", it: "Oggi" } },
        spark: { type: "text", label: { en: "Last hour", "pt-BR": "Última hora", de: "Letzte Stunde", es: "Última hora", pl: "Ostatnia godzina", it: "Ultima ora" } },
        updated: { type: "datetime", precision: "minute", label: { en: "Updated", "pt-BR": "Atualizado", de: "Aktualisiert", es: "Actualizado", pl: "Zaktualizowano", it: "Aggiornato" } },
        above: { type: "number", min: 0, label: { en: "Alert above", "pt-BR": "Alerta acima de", de: "Alarm über", es: "Alerta por encima de", pl: "Alert powyżej", it: "Avviso sopra" } },
        below: { type: "number", min: 0, label: { en: "Alert below", "pt-BR": "Alerta abaixo de", de: "Alarm unter", es: "Alerta por debajo de", pl: "Alert poniżej", it: "Avviso sotto" } },
        demo: { type: "boolean", hidden: true, label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" } },
      },
      computed: {
        shown: {
          value: (r, ctx) => (typeof r.price === "number" ? priceText(r.price, String(r.code), ctx) : "–"),
          label: { en: "Now", "pt-BR": "Agora", de: "Jetzt", es: "Ahora", pl: "Teraz", it: "Ora" },
        },
        line: { value: (r, ctx) => symbolLine(r, ctx), label: { en: "Change", "pt-BR": "Variação", de: "Änderung", es: "Cambio", pl: "Zmiana", it: "Variazione" } },
      },
      actions: {
        alert: { label: { en: "Set an alert", "pt-BR": "Criar alerta", de: "Alarm setzen", es: "Crear alerta", pl: "Ustaw alert", it: "Imposta avviso" }, description: "Set a price above or below which to be told, once.", run: setAlert },
        remove: { label: { en: "Remove", "pt-BR": "Remover", de: "Entfernen", es: "Quitar", pl: "Usuń", it: "Rimuovi" }, description: "Take the symbol off the watchlist.", run: removeSymbol },
      },
    },
    point: {
      editableBy: "app",
      label: { en: "Price point", "pt-BR": "Ponto de preço", de: "Kurspunkt", es: "Punto de precio", pl: "Punkt cenowy", it: "Punto di prezzo" },
      displayField: "code",
      fields: {
        code: { type: "text", label: { en: "Symbol", "pt-BR": "Código", de: "Kürzel", es: "Símbolo", pl: "Symbol", it: "Simbolo" } },
        at: { type: "datetime", precision: "minute", label: { en: "At", "pt-BR": "Em", de: "Um", es: "A las", pl: "O", it: "Alle" } },
        price: { type: "number", label: { en: "Price", "pt-BR": "Preço", de: "Kurs", es: "Precio", pl: "Cena", it: "Prezzo" } },
        demo: { type: "boolean", hidden: true, label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" } },
      },
    },
    alert: {
      editableBy: "app",
      label: { en: "Alert", "pt-BR": "Alerta", de: "Alarm", es: "Alerta", pl: "Alert", it: "Avviso" },
      icon: "🔔",
      displayField: "code",
      fields: {
        code: { type: "text", label: { en: "Symbol", "pt-BR": "Código", de: "Kürzel", es: "Símbolo", pl: "Symbol", it: "Simbolo" } },
        name: { type: "text", label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        direction: { type: "enum", options: ["above", "below"], colors: { above: "green", below: "red" }, labels: { above: { en: "Went above", "pt-BR": "Passou de", de: "Darüber", es: "Superó", pl: "Powyżej", it: "Sopra" }, below: { en: "Dropped below", "pt-BR": "Caiu abaixo", de: "Darunter", es: "Bajó de", pl: "Poniżej", it: "Sotto" } }, label: { en: "What happened", "pt-BR": "O que aconteceu", de: "Was passiert ist", es: "Qué pasó", pl: "Co się stało", it: "Cosa è successo" } },
        level: { type: "number", label: { en: "Line", "pt-BR": "Limite", de: "Grenze", es: "Límite", pl: "Próg", it: "Soglia" } },
        price: { type: "number", label: { en: "Price then", "pt-BR": "Preço na hora", de: "Kurs da", es: "Precio entonces", pl: "Cena wtedy", it: "Prezzo allora" } },
        at: { type: "datetime", precision: "minute", label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" } },
        demo: { type: "boolean", hidden: true, label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" } },
      },
    },
    feed: {
      editableBy: "app",
      label: { en: "Feed", "pt-BR": "Feed", de: "Feed", es: "Feed", pl: "Kanał", it: "Feed" },
      displayField: "state",
      fields: {
        state: { type: "text", label: { en: "State", "pt-BR": "Estado", de: "Zustand", es: "Estado", pl: "Stan", it: "Stato" } },
        since: { type: "datetime", precision: "minute", label: { en: "Since", "pt-BR": "Desde", de: "Seit", es: "Desde", pl: "Od", it: "Da" } },
        fxOk: { type: "boolean", label: { en: "Currencies fetched", "pt-BR": "Moedas obtidas", de: "Währungen geladen", es: "Divisas obtenidas", pl: "Pobrano waluty", it: "Valute scaricate" } },
      },
    },
  },
  pages: [
    {
      id: "watchlist",
      title: { en: "Watchlist", "pt-BR": "Minha lista", de: "Beobachtungsliste", es: "Mi lista", pl: "Obserwowane", it: "Lista" },
      icon: "📈",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.add, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "list",
              entity: "symbol",
              sort: (a, b) => (a.kind === b.kind ? String(a.code).localeCompare(String(b.code)) : a.kind === "crypto" ? -1 : 1),
              display: {
                primary: (r, ctx) => `${String(r.code)}   ${typeof r.price === "number" ? priceText(r.price, String(r.code), ctx) : "–"}`,
                secondary: (r, ctx) => [String(r.spark ?? ""), symbolLine(r, ctx)].filter(Boolean).join("  "),
                badges: ["trend"],
              },
              group: "kind",
              emptyText: {
                en: "Nothing on the watchlist. “Watch live” starts with Bitcoin, Ether and the euro in dollars; “Add” picks others.",
                "pt-BR": "Nada na lista. “Ver ao vivo” começa com Bitcoin, Ether e o euro em dólares; “Adicionar” escolhe outros.",
                de: "Nichts auf der Liste. „Live verfolgen“ beginnt mit Bitcoin, Ether und dem Euro in Dollar; „Hinzufügen“ wählt andere.",
                es: "Nada en la lista. «Ver en vivo» empieza con Bitcoin, Ether y el euro en dólares; «Añadir» elige otros.",
                pl: "Lista jest pusta. „Oglądaj na żywo” zaczyna od bitcoina, etheru i euro w dolarach; „Dodaj” wybiera inne.",
                it: "Niente in lista. “Segui in diretta” parte con Bitcoin, Ether e l'euro in dollari; “Aggiungi” ne sceglie altri.",
              },
              onOpen: { page: "symbol", param: { symbolId: "id", code: "code" } },
            },
          },
        ],
      },
    },
    {
      id: "alerts",
      title: { en: "Alerts", "pt-BR": "Alertas", de: "Alarme", es: "Alertas", pl: "Alerty", it: "Avvisi" },
      icon: "🔔",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "symbol",
              title: { en: "Waiting", "pt-BR": "Aguardando", de: "Wartet", es: "En espera", pl: "Oczekujące", it: "In attesa" },
              rows: (rows, ctx) =>
                rows
                  .filter((r) => typeof r.above === "number" || typeof r.below === "number")
                  .map((r) => ({
                    id: String(r.id),
                    label: String(r.code),
                    value: typeof r.price === "number" ? priceText(r.price, String(r.code), ctx) : undefined,
                    detail: [
                      typeof r.above === "number" ? ctx.t({ en: "above {p}", "pt-BR": "acima de {p}", de: "über {p}", es: "por encima de {p}", pl: "powyżej {p}", it: "sopra {p}" }, { p: priceText(r.above, String(r.code), ctx) }) : "",
                      typeof r.below === "number" ? ctx.t({ en: "below {p}", "pt-BR": "abaixo de {p}", de: "unter {p}", es: "por debajo de {p}", pl: "poniżej {p}", it: "sotto {p}" }, { p: priceText(r.below, String(r.code), ctx) }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  })),
              emptyText: {
                en: "No alerts waiting. Open a symbol on the watchlist and tap “Set an alert”.",
                "pt-BR": "Nenhum alerta aguardando. Abra um ativo da lista e toque em “Criar alerta”.",
                de: "Keine Alarme. Öffne einen Wert auf der Liste und tippe auf „Alarm setzen“.",
                es: "No hay alertas en espera. Abre un valor de la lista y toca «Crear alerta».",
                pl: "Brak oczekujących alertów. Otwórz symbol z listy i stuknij „Ustaw alert”.",
                it: "Nessun avviso in attesa. Apri un simbolo della lista e tocca “Imposta avviso”.",
              },
            },
          },
          {
            title: { en: "Rang", "pt-BR": "Disparados", de: "Ausgelöst", es: "Saltaron", pl: "Zadziałały", it: "Scattati" },
            view: {
              type: "list",
              entity: "alert",
              sort: (a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0),
              display: {
                primary: (r, ctx) => `${String(r.code)} · ${priceText(Number(r.level), String(r.code), ctx)}`,
                secondary: (r, ctx) => {
                  const t = toDate(r.at);
                  return [t ? ctx.format.date(t, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "", ctx.t({ en: "at {p}", "pt-BR": "a {p}", de: "bei {p}", es: "a {p}", pl: "przy {p}", it: "a {p}" }, { p: priceText(Number(r.price), String(r.code), ctx) })].filter(Boolean).join(" · ");
                },
                badges: ["direction"],
              },
              emptyText: { en: "Alerts that rang show here.", "pt-BR": "Os alertas disparados aparecem aqui.", de: "Ausgelöste Alarme stehen hier.", es: "Aquí aparecen las alertas que saltaron.", pl: "Tu pojawiają się alerty, które zadziałały.", it: "Qui compaiono gli avvisi scattati." },
            },
          },
        ],
      },
    },
    {
      id: "symbol",
      title: { en: "Symbol", "pt-BR": "Ativo", de: "Wert", es: "Valor", pl: "Symbol", it: "Simbolo" },
      hidden: true,
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "detail",
              entity: "symbol",
              param: "symbolId",
              actions: ["alert", "remove"],
              sections: [{ fields: ["shown", "line", "name", "kind"] }, { title: { en: "Alerts", "pt-BR": "Alertas", de: "Alarme", es: "Alertas", pl: "Alerty", it: "Avvisi" }, fields: ["above", "below"] }],
            },
          },
          {
            view: {
              type: "chart",
              entity: "point",
              filter: (r, ctx) => r.code === ctx.params.code,
              title: { en: "Above the low", "pt-BR": "Acima da mínima", de: "Über dem Tief", es: "Sobre el mínimo", pl: "Ponad minimum", it: "Sopra il minimo" },
              subtitle: {
                en: "How far each minute's price stood above the lowest shown — a working day a bar for a currency",
                "pt-BR": "Quanto o preço de cada minuto ficou acima do menor mostrado — um dia útil por barra numa moeda",
                de: "Wie weit der Kurs jeder Minute über dem tiefsten gezeigten lag — bei einer Währung ein Werktag pro Balken",
                es: "Cuánto quedó el precio de cada minuto por encima del más bajo mostrado; en una divisa, un día hábil por barra",
                pl: "O ile cena z każdej minuty była wyższa od najniższej pokazanej — przy walucie jeden dzień roboczy na słupek",
                it: "Quanto il prezzo di ogni minuto era sopra il più basso mostrato — per una valuta un giorno lavorativo a barra",
              },
              series: (rows, ctx) => {
                const sorted = [...rows].sort((a, b) => (toDate(a.at)?.getTime() ?? 0) - (toDate(b.at)?.getTime() ?? 0)).slice(-40);
                // Bars from the series' own low — a 0.3 % move is visible, not forty equal bars — and
                // the chart says so: its axis is the distance above that low, in the price's currency.
                const floor = Math.min(...sorted.map((r) => Number(r.price)));
                return sorted.map((r, i) => {
                  const at = toDate(r.at);
                  const code = String(r.code);
                  return {
                    label: i % 8 === 0 && at ? ctx.format.date(at, code.includes("/") ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit" }) : "",
                    value: Number(r.price) - floor,
                    text: priceText(Number(r.price), code, ctx),
                  };
                });
              },
              emptyText: { en: "No prices yet: “Watch live” or “Demo”.", "pt-BR": "Ainda sem preços: “Ver ao vivo” ou “Demo”.", de: "Noch keine Kurse: „Live verfolgen“ oder „Demo“.", es: "Aún sin precios: «Ver en vivo» o «Demo».", pl: "Brak cen: „Oglądaj na żywo” albo „Demo”.", it: "Ancora nessun prezzo: “Segui in diretta” o “Demo”." },
            },
          },
        ],
      },
    },
  ],
});
