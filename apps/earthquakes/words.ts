// How the feed and a quake read, in six languages (docs/20). Every language but English is a model's
// draft (#297). A place name comes from EMSC in English and is a record: it is never translated.

import type { Ctx, Words } from "potyro";
import type { LiveState } from "./live.js";
import type { Strength } from "./quakes.js";

export type Say = Pick<Ctx, "t" | "format">;

export const STRENGTH_WORDS: Record<Strength, Words> = {
  minor: { en: "Minor", "pt-BR": "Fraco", de: "Schwach", es: "Menor", pl: "Słabe", it: "Lieve" },
  light: { en: "Light", "pt-BR": "Leve", de: "Leicht", es: "Ligero", pl: "Lekkie", it: "Leggero" },
  moderate: { en: "Moderate", "pt-BR": "Moderado", de: "Mittel", es: "Moderado", pl: "Umiarkowane", it: "Moderato" },
  strong: { en: "Strong", "pt-BR": "Forte", de: "Stark", es: "Fuerte", pl: "Silne", it: "Forte" },
  major: { en: "Major", "pt-BR": "Muito forte", de: "Sehr stark", es: "Mayor", pl: "Bardzo silne", it: "Molto forte" },
};

/** The status line's first words, by state. */
export const STATE_WORDS: Record<LiveState | "demo" | "demo-done", Words> = {
  off: { en: "Not live", "pt-BR": "Fora do ar", de: "Nicht live", es: "Sin conexión en vivo", pl: "Nie na żywo", it: "Non in diretta" },
  connecting: { en: "Connecting…", "pt-BR": "Conectando…", de: "Verbinde …", es: "Conectando…", pl: "Łączenie…", it: "Connessione…" },
  live: { en: "Live", "pt-BR": "Ao vivo", de: "Live", es: "En vivo", pl: "Na żywo", it: "In diretta" },
  retrying: { en: "Connection lost — trying again", "pt-BR": "Conexão perdida — tentando de novo", de: "Verbindung weg — neuer Versuch", es: "Conexión perdida — reintentando", pl: "Utracono połączenie — ponawiam", it: "Connessione persa — riprovo" },
  paused: { en: "Paused while you were away", "pt-BR": "Pausado enquanto você estava fora", de: "Pausiert, während du weg warst", es: "En pausa mientras no estabas", pl: "Wstrzymano, gdy cię nie było", it: "In pausa mentre eri via" },
  offline: { en: "You're offline", "pt-BR": "Você está sem internet", de: "Du bist offline", es: "Estás sin conexión", pl: "Jesteś offline", it: "Sei offline" },
  unreachable: { en: "Can't reach EMSC right now", "pt-BR": "Não foi possível alcançar o EMSC agora", de: "EMSC ist gerade nicht erreichbar", es: "No se puede contactar con el EMSC ahora", pl: "Nie można teraz połączyć się z EMSC", it: "EMSC non è raggiungibile ora" },
  denied: { en: "Not allowed to connect", "pt-BR": "Conexão não permitida", de: "Verbindung nicht erlaubt", es: "Conexión no permitida", pl: "Brak zgody na połączenie", it: "Connessione non consentita" },
  blocked: { en: "This copy can't reach EMSC", "pt-BR": "Esta cópia não consegue alcançar o EMSC", de: "Diese Kopie kann EMSC nicht erreichen", es: "Esta copia no puede contactar con el EMSC", pl: "Ta kopia nie może połączyć się z EMSC", it: "Questa copia non può raggiungere EMSC" },
  demo: { en: "Demo — a replay", "pt-BR": "Demonstração — uma reprise", de: "Demo — eine Wiederholung", es: "Demo — una repetición", pl: "Demo — powtórka", it: "Demo — una replica" },
  "demo-done": { en: "Demo finished", "pt-BR": "Demonstração terminada", de: "Demo zu Ende", es: "Demo terminada", pl: "Demo zakończone", it: "Demo finita" },
};

/** What to do about each state, under the status line. */
export const STATE_HINTS: Record<LiveState | "demo" | "demo-done", Words> = {
  off: { en: "Tap “Watch live” to follow new earthquakes as EMSC reports them — or “Demo” to see how it looks.", "pt-BR": "Toque em “Ver ao vivo” para acompanhar os novos terremotos assim que o EMSC os informa — ou em “Demo” para ver como fica.", de: "Tippe auf „Live verfolgen“, um neue Erdbeben zu sehen, sobald EMSC sie meldet — oder auf „Demo“, um es auszuprobieren.", es: "Toca «Ver en vivo» para seguir los nuevos terremotos en cuanto el EMSC los informa, o «Demo» para ver cómo queda.", pl: "Stuknij „Oglądaj na żywo”, by śledzić nowe trzęsienia, gdy tylko EMSC je zgłosi — albo „Demo”, by zobaczyć, jak to wygląda.", it: "Tocca “Segui in diretta” per vedere i nuovi terremoti appena EMSC li segnala, oppure “Demo” per vedere come appare." },
  connecting: { en: "Opening the connection to EMSC.", "pt-BR": "Abrindo a conexão com o EMSC.", de: "Die Verbindung zu EMSC wird geöffnet.", es: "Abriendo la conexión con el EMSC.", pl: "Otwieram połączenie z EMSC.", it: "Apro la connessione con EMSC." },
  live: { en: "New earthquakes appear the moment EMSC reports them.", "pt-BR": "Os novos terremotos aparecem assim que o EMSC os informa.", de: "Neue Erdbeben erscheinen, sobald EMSC sie meldet.", es: "Los nuevos terremotos aparecen en cuanto el EMSC los informa.", pl: "Nowe trzęsienia pojawiają się, gdy tylko EMSC je zgłosi.", it: "I nuovi terremoti compaiono appena EMSC li segnala." },
  retrying: { en: "It picks up again by itself.", "pt-BR": "Ele volta sozinho.", de: "Es geht von selbst weiter.", es: "Se reanuda solo.", pl: "Wznowi się samo.", it: "Riprende da solo." },
  paused: { en: "It carries on as soon as you are back.", "pt-BR": "Continua assim que você voltar.", de: "Es geht weiter, sobald du zurück bist.", es: "Sigue en cuanto vuelvas.", pl: "Wznowi się, gdy tylko wrócisz.", it: "Riprende appena torni." },
  offline: { en: "It connects again when you are back online. What you already have stays here.", "pt-BR": "Ele se conecta de novo quando a internet voltar. O que você já tem continua aqui.", de: "Es verbindet sich wieder, wenn du online bist. Was du schon hast, bleibt hier.", es: "Volverá a conectarse cuando tengas conexión. Lo que ya tienes se queda aquí.", pl: "Połączy się znowu, gdy wrócisz do sieci. To, co już masz, zostaje.", it: "Si ricollega quando torni online. Quello che hai già resta qui." },
  unreachable: { en: "Trying again, a little less often each time. The demo works without it.", "pt-BR": "Tentando de novo, um pouco mais espaçado a cada vez. A demonstração funciona sem ele.", de: "Neue Versuche, jedes Mal etwas seltener. Die Demo geht auch ohne.", es: "Reintentando, cada vez con más pausa. La demo funciona sin él.", pl: "Ponawiam, za każdym razem nieco rzadziej. Demo działa i bez tego.", it: "Riprovo, ogni volta un po' meno spesso. La demo funziona anche senza." },
  denied: { en: "Tap “Watch live” to be asked again.", "pt-BR": "Toque em “Ver ao vivo” para ser perguntado de novo.", de: "Tippe auf „Live verfolgen“, um noch einmal gefragt zu werden.", es: "Toca «Ver en vivo» para que se te pregunte otra vez.", pl: "Stuknij „Oglądaj na żywo”, by zapytać ponownie.", it: "Tocca “Segui in diretta” per ricevere di nuovo la domanda." },
  blocked: { en: "The demo still works.", "pt-BR": "A demonstração continua funcionando.", de: "Die Demo funktioniert trotzdem.", es: "La demo sigue funcionando.", pl: "Demo nadal działa.", it: "La demo funziona comunque." },
  demo: { en: "Real earthquakes from earlier, replayed on this device. Nothing is sent anywhere.", "pt-BR": "Terremotos reais de antes, repetidos neste aparelho. Nada é enviado.", de: "Echte Erdbeben von früher, auf diesem Gerät nachgespielt. Nichts wird gesendet.", es: "Terremotos reales de antes, repetidos en este dispositivo. No se envía nada.", pl: "Prawdziwe trzęsienia z przeszłości, odtwarzane na tym urządzeniu. Nic nie jest wysyłane.", it: "Terremoti veri di prima, riprodotti su questo dispositivo. Non viene inviato nulla." },
  "demo-done": { en: "“Watch live” follows the real feed; “Clear the demo” removes the sample quakes.", "pt-BR": "“Ver ao vivo” acompanha o feed real; “Limpar a demo” tira os terremotos de exemplo.", de: "„Live verfolgen“ zeigt den echten Feed; „Demo löschen“ entfernt die Beispielbeben.", es: "«Ver en vivo» sigue el feed real; «Borrar la demo» quita los terremotos de ejemplo.", pl: "„Oglądaj na żywo” pokazuje prawdziwy kanał; „Usuń demo” usuwa przykładowe trzęsienia.", it: "“Segui in diretta” mostra il feed vero; “Cancella la demo” toglie i terremoti di esempio." },
};

const MAG = { en: "M{mag}", "pt-BR": "M{mag}", de: "M{mag}", es: "M{mag}", pl: "M{mag}", it: "M{mag}" };

/** "M4.7" in the person's own decimal mark. */
export const magText = (mag: number, say: Say): string => say.t(MAG, { mag: say.format.number(mag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });

/** "10 km deep". */
export const depthText = (km: number, say: Say): string =>
  say.t({ en: "{km} km deep", "pt-BR": "{km} km de profundidade", de: "{km} km tief", es: "{km} km de profundidad", pl: "{km} km głębokości", it: "{km} km di profondità" }, { km: say.format.number(Math.round(km)) });

/** "just now", "4 min ago", "3 h ago", "2 days ago" — from `now`. */
export function agoText(time: Date, now: Date, say: Say): string {
  const min = Math.max(0, Math.round((now.getTime() - time.getTime()) / 60_000));
  if (min < 1) return say.t({ en: "just now", "pt-BR": "agora mesmo", de: "gerade eben", es: "ahora mismo", pl: "przed chwilą", it: "proprio ora" });
  if (min < 60) return say.t({ en: "{n} min ago", "pt-BR": "há {n} min", de: "vor {n} Min.", es: "hace {n} min", pl: "{n} min temu", it: "{n} min fa" }, { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return say.t({ en: "{n} h ago", "pt-BR": "há {n} h", de: "vor {n} Std.", es: "hace {n} h", pl: "{n} godz. temu", it: "{n} h fa" }, { n: h });
  return say.t(
    { en: "{n, plural, one {# day ago} other {# days ago}}", "pt-BR": "há {n, plural, one {# dia} other {# dias}}", de: "vor {n, plural, one {# Tag} other {# Tagen}}", es: "hace {n, plural, one {# día} other {# días}}", pl: "{n, plural, one {# dzień} other {# dni}} temu", it: "{n, plural, one {# giorno fa} other {# giorni fa}}" },
    { n: Math.round(h / 24) },
  );
}

/** "1,240 km away". */
export const awayText = (km: number, say: Say): string =>
  say.t({ en: "{km} km away", "pt-BR": "a {km} km", de: "{km} km entfernt", es: "a {km} km", pl: "{km} km stąd", it: "a {km} km" }, { km: say.format.number(Math.round(km)) });

/** The alert's title: "M5.2 earthquake 120 km away". */
export const alertTitle = (mag: number, km: number, say: Say): string =>
  say.t({ en: "{mag} earthquake {away}", "pt-BR": "Terremoto {mag} {away}", de: "Erdbeben {mag}, {away}", es: "Terremoto {mag} {away}", pl: "Trzęsienie {mag}, {away}", it: "Terremoto {mag} {away}" }, { mag: magText(mag, say), away: awayText(km, say) });
