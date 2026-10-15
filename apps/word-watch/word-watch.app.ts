// Word Watch: pick a few words, and every public Bluesky post that mentions one of them arrives as it
// is written — who wrote it, what it says, a tap away from the post itself on bsky.app — with how
// often each word comes up, minute by minute.
//
// The stream is Bluesky's public Jetstream (wss://jetstream2.us-east.bsky.network/subscribe, docs/28),
// every new post on the network; the app looks for your words on this device and keeps only the posts
// that have them (feed.ts, watch.ts). Handles come from Bluesky's public AppView. Text only: no images,
// no links followed, and posts their authors marked adult are left out.
//
// Every screen is a built-in view, so a friend who opens it from a share link (sealed) gets all of
// it; the demo plays invented posts through the same matcher with nothing sent anywhere.
//
// In six languages (docs/20); every language but English is a model's draft (#297).

import { defineApp, type AggregateRow, type Ctx, type Resolved } from "potyro";
import { addWord, clearDemo, isDemoRunning, liveState, playDemo, removeWord, stopWatching, toggleWord, wasStartedHere, watchLive, wordMinutes } from "./feed.js";
import { JETSTREAM_HOST, PROFILE_HOST, sparkline, toDate } from "./watch.js";
import { agoText, lastHourText, perMinuteText, STATE_HINTS, STATE_WORDS, type FeedState } from "./words.js";

const ACTIONS = {
  watch: { label: { en: "Watch live", "pt-BR": "Ver ao vivo", de: "Live verfolgen", es: "Ver en vivo", pl: "Oglądaj na żywo", it: "Segui in diretta" }, icon: "▶", run: watchLive },
  stop: { label: { en: "Stop", "pt-BR": "Parar", de: "Stopp", es: "Parar", pl: "Zatrzymaj", it: "Ferma" }, icon: "■", run: stopWatching },
  demo: {
    label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" },
    icon: "✨",
    run: async (ctx: Ctx) => {
      const demos = await ctx.query("post", { filter: (r) => r.demo === true, limit: 1 });
      if (!demos.length) return playDemo(ctx);
      const pick = await ctx.ui.menu({
        title: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" },
        items: [
          { id: "play", icon: "✨", label: { en: "Play the demo again", "pt-BR": "Ver a demo de novo", de: "Demo noch einmal", es: "Ver la demo otra vez", pl: "Odtwórz demo jeszcze raz", it: "Rivedi la demo" }, detail: { en: "Invented posts, played here. Nothing is sent.", "pt-BR": "Posts inventados, tocados aqui. Nada é enviado.", de: "Erfundene Beiträge, hier abgespielt. Nichts wird gesendet.", es: "Publicaciones inventadas, reproducidas aquí. No se envía nada.", pl: "Wymyślone wpisy odtwarzane tutaj. Nic nie jest wysyłane.", it: "Post inventati, riprodotti qui. Non viene inviato nulla." } },
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

/** The status line: what the stream is doing, how many matched, the last match. */
function statusRows(rows: Resolved[], ctx: Ctx): AggregateRow[] {
  const feed = rows[0];
  const state = effectiveState(feed);
  const n = Number(feed?.count ?? 0);
  const out: AggregateRow[] = [
    {
      id: "state",
      label: `${GLYPH[state]} ${ctx.t(STATE_WORDS[state])}`,
      detail: ctx.t(STATE_HINTS[state]),
      value:
        (state === "live" || state === "demo") && n > 0
          ? ctx.t({ en: "{n, plural, one {# match} other {# matches}}", "pt-BR": "{n, plural, one {# menção} other {# menções}}", de: "{n, plural, one {# Treffer} other {# Treffer}}", es: "{n, plural, one {# mención} other {# menciones}}", pl: "{n, plural, one {# trafienie} few {# trafienia} other {# trafień}}", it: "{n, plural, one {# menzione} other {# menzioni}}" }, { n })
          : undefined,
      tone: TONE[state] ?? "neutral",
    },
  ];
  return out;
}

const STATUS_VIEW = { type: "aggregate" as const, entity: "feed", rows: statusRows };

/** Each word: how often right now, a sparkline of the last 15 minutes, the last hour. */
function perWordRows(rows: Resolved[], ctx: Ctx): AggregateRow[] {
  const now = new Date();
  const words = [...new Set(rows.map((r) => String(r.wordId)))];
  return words
    .map((id) => {
      const word = String(rows.find((r) => r.wordId === id)?.word ?? "");
      const last15 = wordMinutes(rows, id, now, 15);
      const hour = wordMinutes(rows, id, now, 60).reduce((a, b) => a + b, 0);
      // The minute that is still going is not a fair "a minute": the last whole one is.
      const rate = last15.at(-2) ?? 0;
      return { id, word, hour, row: { id, label: `“${word}”`, value: perMinuteText(rate, ctx), detail: `${sparkline(last15)}  ${lastHourText(hour, ctx)}` } satisfies AggregateRow };
    })
    .sort((a, b) => b.hour - a.hour)
    .map((x) => x.row);
}

const EMPTY_POSTS = {
  en: "Posts that mention your words land here as they are written. Add words under Words, then “Watch live” — or try “Demo”.",
  "pt-BR": "Os posts que mencionam suas palavras chegam aqui assim que são escritos. Adicione palavras em Palavras e toque em “Ver ao vivo” — ou teste a “Demo”.",
  de: "Beiträge mit deinen Wörtern landen hier, sobald sie geschrieben werden. Leg unter Wörter welche an, dann „Live verfolgen“ — oder probier die „Demo“.",
  es: "Las publicaciones que mencionan tus palabras llegan aquí en cuanto se escriben. Añade palabras en Palabras y toca «Ver en vivo», o prueba la «Demo».",
  pl: "Wpisy z twoimi słowami trafiają tu, gdy tylko powstaną. Dodaj słowa w zakładce Słowa, potem „Oglądaj na żywo” — albo wypróbuj „Demo”.",
  it: "I post che citano le tue parole arrivano qui appena vengono scritti. Aggiungi parole in Parole, poi “Segui in diretta”, oppure prova la “Demo”.",
};

const byAt = (a: Resolved, b: Resolved) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0);

export default defineApp({
  id: "word-watch",
  name: { en: "Word Watch", "pt-BR": "Vigia de Palavras", de: "Wortwache", es: "Vigía de Palabras", pl: "Słowostróż", it: "Sentinella di Parole" },
  icon: "🦋",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#1d6fe0" },
  nav: "tabs",
  permissions: { network: { hosts: [JETSTREAM_HOST, PROFILE_HOST] } },
  quickActions: [],
  entities: {
    word: {
      label: { en: "Word", "pt-BR": "Palavra", de: "Wort", es: "Palabra", pl: "Słowo", it: "Parola" },
      icon: "🔤",
      displayField: "word",
      fields: {
        word: { type: "text", required: true, label: { en: "Word or phrase", "pt-BR": "Palavra ou frase", de: "Wort oder Ausdruck", es: "Palabra o frase", pl: "Słowo lub fraza", it: "Parola o frase" }, placeholder: { en: "coffee", "pt-BR": "café", de: "Kaffee", es: "café", pl: "kawa", it: "caffè" } },
        on: { type: "boolean", default: true, label: { en: "Watching", "pt-BR": "Acompanhando", de: "Beobachtet", es: "Siguiendo", pl: "Obserwowane", it: "Seguita" } },
        total: { type: "number", integer: true, default: 0, label: { en: "Mentions so far", "pt-BR": "Menções até agora", de: "Erwähnungen bisher", es: "Menciones hasta ahora", pl: "Dotychczasowe wzmianki", it: "Menzioni finora" } },
        lastAt: { type: "datetime", precision: "minute", label: { en: "Last seen", "pt-BR": "Visto por último", de: "Zuletzt gesehen", es: "Visto por última vez", pl: "Ostatnio", it: "Visto l'ultima volta" } },
        demo: { type: "boolean", hidden: true, label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" } },
      },
      actions: {
        toggle: {
          label: { en: "Pause or watch again", "pt-BR": "Pausar ou voltar a acompanhar", de: "Pausieren oder wieder beobachten", es: "Pausar o volver a seguir", pl: "Wstrzymaj lub wznów", it: "Metti in pausa o riprendi" },
          description: "Pause watching this word, or watch it again.",
          run: toggleWord,
        },
        remove: {
          label: { en: "Stop watching", "pt-BR": "Parar de acompanhar", de: "Nicht mehr beobachten", es: "Dejar de seguir", pl: "Przestań obserwować", it: "Smetti di seguire" },
          description: "Remove the word and its counts.",
          run: removeWord,
        },
      },
    },
    post: {
      label: { en: "Post", "pt-BR": "Post", de: "Beitrag", es: "Publicación", pl: "Wpis", it: "Post" },
      icon: "💬",
      displayField: "text",
      fields: {
        text: { type: "text", multiline: true, required: true, label: { en: "Post", "pt-BR": "Post", de: "Beitrag", es: "Publicación", pl: "Wpis", it: "Post" } },
        handle: { type: "text", label: { en: "By", "pt-BR": "De", de: "Von", es: "De", pl: "Autor", it: "Di" } },
        words: { type: "tags", label: { en: "Mentions", "pt-BR": "Menciona", de: "Erwähnt", es: "Menciona", pl: "Wspomina", it: "Cita" } },
        at: { type: "datetime", precision: "minute", label: { en: "Seen", "pt-BR": "Visto", de: "Gesehen", es: "Visto", pl: "Zobaczono", it: "Visto" } },
        link: { type: "url", label: { en: "On Bluesky", "pt-BR": "No Bluesky", de: "Auf Bluesky", es: "En Bluesky", pl: "Na Bluesky", it: "Su Bluesky" } },
        did: { type: "text", hidden: true, label: { en: "Author's id", "pt-BR": "ID do autor", de: "ID des Autors", es: "ID del autor", pl: "ID autora", it: "ID dell'autore" } },
        demo: { type: "boolean", hidden: true, label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" } },
      },
      computed: {
        ago: {
          value: (r, ctx) => {
            const t = toDate(r.at);
            return t ? agoText(t, ctx.now(), ctx) : "";
          },
          label: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" },
        },
      },
    },
    minute: {
      label: { en: "Minute", "pt-BR": "Minuto", de: "Minute", es: "Minuto", pl: "Minuta", it: "Minuto" },
      displayField: "word",
      fields: {
        word: { type: "text", label: { en: "Word", "pt-BR": "Palavra", de: "Wort", es: "Palabra", pl: "Słowo", it: "Parola" } },
        wordId: { type: "text", hidden: true, label: { en: "Word id", "pt-BR": "ID da palavra", de: "Wort-ID", es: "ID de la palabra", pl: "ID słowa", it: "ID della parola" } },
        at: { type: "datetime", precision: "minute", label: { en: "Minute", "pt-BR": "Minuto", de: "Minute", es: "Minuto", pl: "Minuta", it: "Minuto" } },
        count: { type: "number", integer: true, label: { en: "Mentions", "pt-BR": "Menções", de: "Erwähnungen", es: "Menciones", pl: "Wzmianki", it: "Menzioni" } },
        demo: { type: "boolean", hidden: true, label: { en: "Demo", "pt-BR": "Demo", de: "Demo", es: "Demo", pl: "Demo", it: "Demo" } },
      },
    },
    feed: {
      label: { en: "Feed", "pt-BR": "Feed", de: "Feed", es: "Feed", pl: "Kanał", it: "Feed" },
      displayField: "state",
      fields: {
        state: { type: "text", label: { en: "State", "pt-BR": "Estado", de: "Zustand", es: "Estado", pl: "Stan", it: "Stato" } },
        since: { type: "datetime", precision: "minute", label: { en: "Since", "pt-BR": "Desde", de: "Seit", es: "Desde", pl: "Od", it: "Da" } },
        count: { type: "number", integer: true, label: { en: "Matches", "pt-BR": "Menções", de: "Treffer", es: "Menciones", pl: "Trafienia", it: "Menzioni" } },
        lastText: { type: "text", label: { en: "Latest", "pt-BR": "Último", de: "Zuletzt", es: "Último", pl: "Ostatni", it: "Ultimo" } },
        lastWord: { type: "text", label: { en: "Latest word", "pt-BR": "Última palavra", de: "Letztes Wort", es: "Última palabra", pl: "Ostatnie słowo", it: "Ultima parola" } },
      },
    },
  },
  pages: [
    {
      id: "live",
      title: { en: "Live", "pt-BR": "Ao vivo", de: "Live", es: "En vivo", pl: "Na żywo", it: "Diretta" },
      icon: "📡",
      actions: [ACTIONS.watch, ACTIONS.stop, ACTIONS.demo],
      layout: {
        type: "stack",
        items: [
          { view: STATUS_VIEW },
          {
            view: {
              type: "list",
              entity: "post",
              sort: byAt,
              display: {
                primary: (r) => `@${String(r.handle ?? "")}`,
                secondary: (r, ctx) => {
                  const t = toDate(r.at);
                  return `${t ? agoText(t, ctx.now(), ctx) : ""} — ${String(r.text ?? "")}`;
                },
                badges: ["words"],
              },
              emptyText: EMPTY_POSTS,
              onOpen: { page: "post", param: { postId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "trend",
      title: { en: "Per minute", "pt-BR": "Por minuto", de: "Pro Minute", es: "Por minuto", pl: "Na minutę", it: "Al minuto" },
      icon: "📊",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "aggregate",
              entity: "minute",
              title: { en: "Right now", "pt-BR": "Agora", de: "Gerade", es: "Ahora mismo", pl: "Teraz", it: "Adesso" },
              rows: perWordRows,
              emptyText: { en: "No mentions counted yet.", "pt-BR": "Nenhuma menção contada ainda.", de: "Noch keine Erwähnungen gezählt.", es: "Aún no hay menciones contadas.", pl: "Nie policzono jeszcze żadnych wzmianek.", it: "Ancora nessuna menzione contata." },
            },
          },
          {
            view: {
              type: "chart",
              entity: "minute",
              title: { en: "Mentions per minute", "pt-BR": "Menções por minuto", de: "Erwähnungen pro Minute", es: "Menciones por minuto", pl: "Wzmianki na minutę", it: "Menzioni al minuto" },
              subtitle: { en: "All your words, last 30 minutes", "pt-BR": "Todas as suas palavras, últimos 30 minutos", de: "Alle deine Wörter, letzte 30 Minuten", es: "Todas tus palabras, últimos 30 minutos", pl: "Wszystkie twoje słowa, ostatnie 30 minut", it: "Tutte le tue parole, ultimi 30 minuti" },
              series: (rows, ctx) => {
                const now = new Date();
                const ids = [...new Set(rows.map((r) => String(r.wordId)))];
                const sums = Array.from({ length: 30 }, (_, i) => ids.reduce((a, id) => a + (wordMinutes(rows, id, now, 30)[i] ?? 0), 0));
                return sums.map((value, i) => {
                  const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - (29 - i) * 60_000);
                  return { label: i % 5 === 4 ? ctx.format.date(at, { hour: "2-digit", minute: "2-digit" }) : "", value, text: ctx.t({ en: "{n} at {time}", "pt-BR": "{n} às {time}", de: "{n} um {time}", es: "{n} a las {time}", pl: "{n} o {time}", it: "{n} alle {time}" }, { n: value, time: ctx.format.date(at, { hour: "2-digit", minute: "2-digit" }) }) };
                });
              },
              emptyText: { en: "The bars fill in minute by minute once you watch live.", "pt-BR": "As barras se enchem minuto a minuto quando você acompanha ao vivo.", de: "Die Balken füllen sich Minute für Minute, sobald du live verfolgst.", es: "Las barras se llenan minuto a minuto cuando sigues en vivo.", pl: "Słupki zapełniają się minuta po minucie, gdy oglądasz na żywo.", it: "Le barre si riempiono minuto per minuto quando segui in diretta." },
            },
          },
        ],
      },
    },
    {
      id: "words",
      title: { en: "Words", "pt-BR": "Palavras", de: "Wörter", es: "Palabras", pl: "Słowa", it: "Parole" },
      icon: "🔤",
      actions: [{ label: { en: "Add a word", "pt-BR": "Adicionar palavra", de: "Wort hinzufügen", es: "Añadir palabra", pl: "Dodaj słowo", it: "Aggiungi parola" }, icon: "＋", run: addWord }],
      view: {
        type: "list",
        entity: "word",
        sort: (a, b) => Number(b.on !== false) - Number(a.on !== false) || Number(b.total ?? 0) - Number(a.total ?? 0),
        display: {
          primary: (r) => `“${String(r.word ?? "")}”`,
          secondary: (r, ctx) => {
            const t = toDate(r.lastAt);
            const n = Number(r.total ?? 0);
            const seen = ctx.t({ en: "{n, plural, one {# mention} other {# mentions}}", "pt-BR": "{n, plural, one {# menção} other {# menções}}", de: "{n, plural, one {# Erwähnung} other {# Erwähnungen}}", es: "{n, plural, one {# mención} other {# menciones}}", pl: "{n, plural, one {# wzmianka} few {# wzmianki} other {# wzmianek}}", it: "{n, plural, one {# menzione} other {# menzioni}}" }, { n });
            const paused = r.on === false ? ctx.t({ en: "paused", "pt-BR": "pausada", de: "pausiert", es: "en pausa", pl: "wstrzymane", it: "in pausa" }) : "";
            return [seen, t ? ctx.t({ en: "seen {ago}", "pt-BR": "vista {ago}", de: "gesehen {ago}", es: "vista {ago}", pl: "widziane {ago}", it: "vista {ago}" }, { ago: agoText(t, ctx.now(), ctx) }) : "", paused].filter(Boolean).join(" · ");
          },
        },
        emptyText: {
          en: "Tap “Add a word” — “coffee”, “#rain”, a team, a town. Posts that mention any of them are kept; everything else streams past.",
          "pt-BR": "Toque em “Adicionar palavra” — “café”, “#chuva”, um time, uma cidade. Os posts que mencionam alguma delas ficam; o resto passa direto.",
          de: "Tippe auf „Wort hinzufügen“ — „Kaffee“, „#Regen“, ein Verein, eine Stadt. Beiträge, die eins davon erwähnen, bleiben; alles andere zieht vorbei.",
          es: "Toca «Añadir palabra»: «café», «#lluvia», un equipo, una ciudad. Se quedan las publicaciones que mencionan alguna; lo demás pasa de largo.",
          pl: "Stuknij „Dodaj słowo” — „kawa”, „#deszcz”, drużyna, miasto. Wpisy, które o nich wspominają, zostają; reszta przepływa.",
          it: "Tocca “Aggiungi parola”: “caffè”, “#pioggia”, una squadra, una città. Restano i post che ne citano una; il resto scorre via.",
        },
        onOpen: { page: "word", param: { wordId: "id" } },
      },
    },
    {
      id: "post",
      title: { en: "Post", "pt-BR": "Post", de: "Beitrag", es: "Publicación", pl: "Wpis", it: "Post" },
      hidden: true,
      view: {
        type: "detail",
        entity: "post",
        param: "postId",
        sections: [{ fields: ["text", "handle", "words", "ago"] }, { fields: ["link"] }],
      },
    },
    {
      id: "word",
      title: { en: "Word", "pt-BR": "Palavra", de: "Wort", es: "Palabra", pl: "Słowo", it: "Parola" },
      hidden: true,
      view: { type: "detail", entity: "word", param: "wordId", actions: ["toggle", "remove"], sections: [{ fields: ["word", "on", "total", "lastAt"] }] },
    },
  ],
});
