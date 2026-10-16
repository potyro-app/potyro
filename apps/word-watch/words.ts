// How the feed reads, in six languages (docs/20). Every language but English is a model's draft (#297).
// A post's text and a watched word are records: never translated.

import type { Ctx, Words } from "potyro";
import type { LiveState } from "./live.js";

export type Say = Pick<Ctx, "t" | "format">;
export type FeedState = LiveState | "demo" | "demo-done";

export const STATE_WORDS: Record<FeedState, Words> = {
  off: { en: "Not live", "pt-BR": "Fora do ar", de: "Nicht live", es: "Sin conexión en vivo", pl: "Nie na żywo", it: "Non in diretta" },
  connecting: { en: "Connecting…", "pt-BR": "Conectando…", de: "Verbinde …", es: "Conectando…", pl: "Łączenie…", it: "Connessione…" },
  live: { en: "Live", "pt-BR": "Ao vivo", de: "Live", es: "En vivo", pl: "Na żywo", it: "In diretta" },
  retrying: { en: "Connection lost — trying again", "pt-BR": "Conexão perdida — tentando de novo", de: "Verbindung weg — neuer Versuch", es: "Conexión perdida — reintentando", pl: "Utracono połączenie — ponawiam", it: "Connessione persa — riprovo" },
  paused: { en: "Paused while you were away", "pt-BR": "Pausado enquanto você estava fora", de: "Pausiert, während du weg warst", es: "En pausa mientras no estabas", pl: "Wstrzymano, gdy cię nie było", it: "In pausa mentre eri via" },
  offline: { en: "You're offline", "pt-BR": "Você está sem internet", de: "Du bist offline", es: "Estás sin conexión", pl: "Jesteś offline", it: "Sei offline" },
  unreachable: { en: "Can't reach Bluesky right now", "pt-BR": "Não foi possível alcançar o Bluesky agora", de: "Bluesky ist gerade nicht erreichbar", es: "No se puede contactar con Bluesky ahora", pl: "Nie można teraz połączyć się z Bluesky", it: "Bluesky non è raggiungibile ora" },
  denied: { en: "Not allowed to connect", "pt-BR": "Conexão não permitida", de: "Verbindung nicht erlaubt", es: "Conexión no permitida", pl: "Brak zgody na połączenie", it: "Connessione non consentita" },
  blocked: { en: "This copy can't reach Bluesky", "pt-BR": "Esta cópia não consegue alcançar o Bluesky", de: "Diese Kopie kann Bluesky nicht erreichen", es: "Esta copia no puede contactar con Bluesky", pl: "Ta kopia nie może połączyć się z Bluesky", it: "Questa copia non può raggiungere Bluesky" },
  demo: { en: "Demo — made-up posts", "pt-BR": "Demonstração — posts inventados", de: "Demo — erfundene Beiträge", es: "Demo — publicaciones inventadas", pl: "Demo — wymyślone wpisy", it: "Demo — post inventati" },
  "demo-done": { en: "Demo finished", "pt-BR": "Demonstração terminada", de: "Demo zu Ende", es: "Demo terminada", pl: "Demo zakończone", it: "Demo finita" },
};

export const STATE_HINTS: Record<FeedState, Words> = {
  off: { en: "Add a few words under Words, then tap “Watch live” — or “Demo” to see how it looks.", "pt-BR": "Adicione algumas palavras em Palavras e toque em “Ver ao vivo” — ou em “Demo” para ver como fica.", de: "Leg unter Wörter ein paar Wörter an und tippe auf „Live verfolgen“ — oder auf „Demo“, um es auszuprobieren.", es: "Añade unas palabras en Palabras y toca «Ver en vivo», o «Demo» para ver cómo queda.", pl: "Dodaj kilka słów w zakładce Słowa i stuknij „Oglądaj na żywo” — albo „Demo”, by zobaczyć, jak to wygląda.", it: "Aggiungi qualche parola in Parole e tocca “Segui in diretta”, oppure “Demo” per vedere come appare." },
  connecting: { en: "Opening the connection to Bluesky.", "pt-BR": "Abrindo a conexão com o Bluesky.", de: "Die Verbindung zu Bluesky wird geöffnet.", es: "Abriendo la conexión con Bluesky.", pl: "Otwieram połączenie z Bluesky.", it: "Apro la connessione con Bluesky." },
  live: { en: "Every new public post on Bluesky passes by; the ones with your words stay.", "pt-BR": "Todo post público novo do Bluesky passa por aqui; ficam os que têm suas palavras.", de: "Jeder neue öffentliche Beitrag auf Bluesky kommt vorbei; die mit deinen Wörtern bleiben.", es: "Pasan todas las publicaciones públicas nuevas de Bluesky; se quedan las que tienen tus palabras.", pl: "Przepływa tu każdy nowy publiczny wpis z Bluesky; zostają te z twoimi słowami.", it: "Passano tutti i nuovi post pubblici di Bluesky; restano quelli con le tue parole." },
  retrying: { en: "It picks up again by itself.", "pt-BR": "Ele volta sozinho.", de: "Es geht von selbst weiter.", es: "Se reanuda solo.", pl: "Wznowi się samo.", it: "Riprende da solo." },
  paused: { en: "It carries on as soon as you are back. Posts from while you were away are not caught up.", "pt-BR": "Continua assim que você voltar. Os posts de quando você estava fora não são recuperados.", de: "Es geht weiter, sobald du zurück bist. Beiträge aus der Zwischenzeit werden nicht nachgeholt.", es: "Sigue en cuanto vuelvas. Las publicaciones de mientras no estabas no se recuperan.", pl: "Wznowi się, gdy wrócisz. Wpisów z czasu twojej nieobecności nie nadrabia.", it: "Riprende appena torni. I post di quando eri via non vengono recuperati." },
  offline: { en: "It connects again when you are back online.", "pt-BR": "Ele se conecta de novo quando a internet voltar.", de: "Es verbindet sich wieder, wenn du online bist.", es: "Volverá a conectarse cuando tengas conexión.", pl: "Połączy się znowu, gdy wrócisz do sieci.", it: "Si ricollega quando torni online." },
  unreachable: { en: "Trying again, a little less often each time. The demo works without it.", "pt-BR": "Tentando de novo, um pouco mais espaçado a cada vez. A demonstração funciona sem ele.", de: "Neue Versuche, jedes Mal etwas seltener. Die Demo geht auch ohne.", es: "Reintentando, cada vez con más pausa. La demo funciona sin él.", pl: "Ponawiam, za każdym razem nieco rzadziej. Demo działa i bez tego.", it: "Riprovo, ogni volta un po' meno spesso. La demo funziona anche senza." },
  denied: { en: "Tap “Watch live” to be asked again.", "pt-BR": "Toque em “Ver ao vivo” para ser perguntado de novo.", de: "Tippe auf „Live verfolgen“, um noch einmal gefragt zu werden.", es: "Toca «Ver en vivo» para que se te pregunte otra vez.", pl: "Stuknij „Oglądaj na żywo”, by zapytać ponownie.", it: "Tocca “Segui in diretta” per ricevere di nuovo la domanda." },
  blocked: { en: "The demo still works.", "pt-BR": "A demonstração continua funcionando.", de: "Die Demo funktioniert trotzdem.", es: "La demo sigue funcionando.", pl: "Demo nadal działa.", it: "La demo funziona comunque." },
  demo: { en: "Invented posts, played on this device. Nothing is sent anywhere.", "pt-BR": "Posts inventados, tocados neste aparelho. Nada é enviado.", de: "Erfundene Beiträge, auf diesem Gerät abgespielt. Nichts wird gesendet.", es: "Publicaciones inventadas, reproducidas en este dispositivo. No se envía nada.", pl: "Wymyślone wpisy odtwarzane na tym urządzeniu. Nic nie jest wysyłane.", it: "Post inventati, riprodotti su questo dispositivo. Non viene inviato nulla." },
  "demo-done": { en: "“Watch live” follows the real Bluesky; “Clear the demo” removes the sample posts.", "pt-BR": "“Ver ao vivo” acompanha o Bluesky de verdade; “Limpar a demo” tira os posts de exemplo.", de: "„Live verfolgen“ zeigt das echte Bluesky; „Demo löschen“ entfernt die Beispielbeiträge.", es: "«Ver en vivo» sigue el Bluesky real; «Borrar la demo» quita las publicaciones de ejemplo.", pl: "„Oglądaj na żywo” pokazuje prawdziwe Bluesky; „Usuń demo” usuwa przykładowe wpisy.", it: "“Segui in diretta” mostra il vero Bluesky; “Cancella la demo” toglie i post di esempio." },
};

/** "just now", "4 min ago", "3 h ago". */
export function agoText(time: Date, now: Date, say: Say): string {
  const min = Math.max(0, Math.round((now.getTime() - time.getTime()) / 60_000));
  if (min < 1) return say.t({ en: "just now", "pt-BR": "agora mesmo", de: "gerade eben", es: "ahora mismo", pl: "przed chwilą", it: "proprio ora" });
  if (min < 60) return say.t({ en: "{n} min ago", "pt-BR": "há {n} min", de: "vor {n} Min.", es: "hace {n} min", pl: "{n} min temu", it: "{n} min fa" }, { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return say.t({ en: "{n} h ago", "pt-BR": "há {n} h", de: "vor {n} Std.", es: "hace {n} h", pl: "{n} godz. temu", it: "{n} h fa" }, { n: h });
  return say.format.date(time, { day: "numeric", month: "short" });
}

/** "12 a minute". */
export const perMinuteText = (n: number, say: Say): string =>
  say.t({ en: "{n} a minute", "pt-BR": "{n} por minuto", de: "{n} pro Minute", es: "{n} por minuto", pl: "{n} na minutę", it: "{n} al minuto" }, { n: say.format.number(n) });

/** "48 in the last hour". */
export const lastHourText = (n: number, say: Say): string =>
  say.t(
    { en: "{n, plural, one {# in the last hour} other {# in the last hour}}", "pt-BR": "{n, plural, one {# na última hora} other {# na última hora}}", de: "{n} in der letzten Stunde", es: "{n, plural, one {# en la última hora} other {# en la última hora}}", pl: "{n} w ostatniej godzinie", it: "{n, plural, one {# nell'ultima ora} other {# nell'ultima ora}}" },
    { n },
  );
