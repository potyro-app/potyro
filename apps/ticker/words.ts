// How a price, a change and the feed read, in six languages (docs/20). Every language but English is
// a model's draft (#297). Symbols ("BTC-USD") are codes and stay as they are.

import type { Ctx, Words } from "potyro";
import type { LiveState } from "./live.js";
import { quoteOf } from "./prices.js";

export type Say = Pick<Ctx, "t" | "format">;
export type FeedState = LiveState | "demo" | "demo-done";

export const STATE_WORDS: Record<FeedState, Words> = {
  off: { en: "Not live", "pt-BR": "Fora do ar", de: "Nicht live", es: "Sin conexión en vivo", pl: "Nie na żywo", it: "Non in diretta" },
  connecting: { en: "Connecting…", "pt-BR": "Conectando…", de: "Verbinde …", es: "Conectando…", pl: "Łączenie…", it: "Connessione…" },
  live: { en: "Live", "pt-BR": "Ao vivo", de: "Live", es: "En vivo", pl: "Na żywo", it: "In diretta" },
  retrying: { en: "Connection lost — trying again", "pt-BR": "Conexão perdida — tentando de novo", de: "Verbindung weg — neuer Versuch", es: "Conexión perdida — reintentando", pl: "Utracono połączenie — ponawiam", it: "Connessione persa — riprovo" },
  paused: { en: "Paused while you were away", "pt-BR": "Pausado enquanto você estava fora", de: "Pausiert, während du weg warst", es: "En pausa mientras no estabas", pl: "Wstrzymano, gdy cię nie było", it: "In pausa mentre eri via" },
  offline: { en: "You're offline", "pt-BR": "Você está sem internet", de: "Du bist offline", es: "Estás sin conexión", pl: "Jesteś offline", it: "Sei offline" },
  unreachable: { en: "Can't reach the prices right now", "pt-BR": "Não foi possível obter os preços agora", de: "Die Kurse sind gerade nicht erreichbar", es: "No se pueden obtener los precios ahora", pl: "Nie można teraz pobrać cen", it: "Non riesco a ottenere i prezzi ora" },
  denied: { en: "Not allowed to connect", "pt-BR": "Conexão não permitida", de: "Verbindung nicht erlaubt", es: "Conexión no permitida", pl: "Brak zgody na połączenie", it: "Connessione non consentita" },
  blocked: { en: "This copy can't reach Coinbase", "pt-BR": "Esta cópia não consegue alcançar a Coinbase", de: "Diese Kopie kann Coinbase nicht erreichen", es: "Esta copia no puede contactar con Coinbase", pl: "Ta kopia nie może połączyć się z Coinbase", it: "Questa copia non può raggiungere Coinbase" },
  demo: { en: "Demo — made-up prices", "pt-BR": "Demonstração — preços inventados", de: "Demo — erfundene Kurse", es: "Demo — precios inventados", pl: "Demo — wymyślone ceny", it: "Demo — prezzi inventati" },
  "demo-done": { en: "Demo finished", "pt-BR": "Demonstração terminada", de: "Demo zu Ende", es: "Demo terminada", pl: "Demo zakończone", it: "Demo finita" },
};

const ECB = { en: "Currencies: the ECB's reference rates, which change once a working day — fetched every 30 minutes.", "pt-BR": "Moedas: as taxas de referência do BCE, que mudam uma vez por dia útil — buscadas a cada 30 minutos.", de: "Währungen: die Referenzkurse der EZB, die sich einmal pro Werktag ändern — alle 30 Minuten abgerufen.", es: "Divisas: los tipos de referencia del BCE, que cambian una vez por día hábil; se consultan cada 30 minutos.", pl: "Waluty: kursy referencyjne EBC, zmieniane raz na dzień roboczy — pobierane co 30 minut.", it: "Valute: i tassi di riferimento della BCE, che cambiano una volta per giorno lavorativo — scaricati ogni 30 minuti." };

export const STATE_HINTS: Record<FeedState, Words> = {
  off: { en: "Tap “Watch live” for live prices — or “Demo” to see how it looks. Add symbols with “Add”.", "pt-BR": "Toque em “Ver ao vivo” para preços ao vivo — ou em “Demo” para ver como fica. Adicione ativos com “Adicionar”.", de: "Tippe auf „Live verfolgen“ für Live-Kurse — oder auf „Demo“, um es auszuprobieren. Mit „Hinzufügen“ kommen Werte dazu.", es: "Toca «Ver en vivo» para precios en directo, o «Demo» para ver cómo queda. Añade valores con «Añadir».", pl: "Stuknij „Oglądaj na żywo”, by widzieć ceny na żywo — albo „Demo”, by zobaczyć, jak to wygląda. Dodawaj symbole przez „Dodaj”.", it: "Tocca “Segui in diretta” per i prezzi in diretta, oppure “Demo” per vedere come appare. Aggiungi simboli con “Aggiungi”." },
  connecting: { en: "Opening the connection to Coinbase.", "pt-BR": "Abrindo a conexão com a Coinbase.", de: "Die Verbindung zu Coinbase wird geöffnet.", es: "Abriendo la conexión con Coinbase.", pl: "Otwieram połączenie z Coinbase.", it: "Apro la connessione con Coinbase." },
  live: { en: "Crypto: every trade on Coinbase, shown at most every 3 seconds. ", "pt-BR": "Cripto: cada negociação na Coinbase, mostrada no máximo a cada 3 segundos. ", de: "Krypto: jeder Handel auf Coinbase, höchstens alle 3 Sekunden angezeigt. ", es: "Cripto: cada operación en Coinbase, mostrada como mucho cada 3 segundos. ", pl: "Krypto: każda transakcja na Coinbase, pokazywana najwyżej co 3 sekundy. ", it: "Cripto: ogni scambio su Coinbase, mostrato al massimo ogni 3 secondi. " },
  retrying: { en: "It picks up again by itself.", "pt-BR": "Ele volta sozinho.", de: "Es geht von selbst weiter.", es: "Se reanuda solo.", pl: "Wznowi się samo.", it: "Riprende da solo." },
  paused: { en: "It carries on as soon as you are back.", "pt-BR": "Continua assim que você voltar.", de: "Es geht weiter, sobald du zurück bist.", es: "Sigue en cuanto vuelvas.", pl: "Wznowi się, gdy tylko wrócisz.", it: "Riprende appena torni." },
  offline: { en: "It connects again when you are back online. The last prices stay here.", "pt-BR": "Ele se conecta de novo quando a internet voltar. Os últimos preços ficam aqui.", de: "Es verbindet sich wieder, wenn du online bist. Die letzten Kurse bleiben hier.", es: "Volverá a conectarse cuando tengas conexión. Los últimos precios se quedan aquí.", pl: "Połączy się znowu, gdy wrócisz do sieci. Ostatnie ceny zostają.", it: "Si ricollega quando torni online. Gli ultimi prezzi restano qui." },
  unreachable: { en: "Trying again, a little less often each time. The demo works without it.", "pt-BR": "Tentando de novo, um pouco mais espaçado a cada vez. A demonstração funciona sem isso.", de: "Neue Versuche, jedes Mal etwas seltener. Die Demo geht auch ohne.", es: "Reintentando, cada vez con más pausa. La demo funciona sin ello.", pl: "Ponawiam, za każdym razem nieco rzadziej. Demo działa i bez tego.", it: "Riprovo, ogni volta un po' meno spesso. La demo funziona anche senza." },
  denied: { en: "Tap “Watch live” to be asked again.", "pt-BR": "Toque em “Ver ao vivo” para ser perguntado de novo.", de: "Tippe auf „Live verfolgen“, um noch einmal gefragt zu werden.", es: "Toca «Ver en vivo» para que se te pregunte otra vez.", pl: "Stuknij „Oglądaj na żywo”, by zapytać ponownie.", it: "Tocca “Segui in diretta” per ricevere di nuovo la domanda." },
  blocked: { en: "The demo still works.", "pt-BR": "A demonstração continua funcionando.", de: "Die Demo funktioniert trotzdem.", es: "La demo sigue funcionando.", pl: "Demo nadal działa.", it: "La demo funziona comunque." },
  demo: { en: "A made-up market on this device, ticking several times a second. Nothing is sent anywhere.", "pt-BR": "Um mercado inventado neste aparelho, várias vezes por segundo. Nada é enviado.", de: "Ein erfundener Markt auf diesem Gerät, mehrmals pro Sekunde. Nichts wird gesendet.", es: "Un mercado inventado en este dispositivo, varias veces por segundo. No se envía nada.", pl: "Wymyślony rynek na tym urządzeniu, kilka razy na sekundę. Nic nie jest wysyłane.", it: "Un mercato inventato su questo dispositivo, più volte al secondo. Non viene inviato nulla." },
  "demo-done": { en: "“Watch live” shows real prices; “Clear the demo” removes the made-up ones.", "pt-BR": "“Ver ao vivo” mostra preços reais; “Limpar a demo” tira os inventados.", de: "„Live verfolgen“ zeigt echte Kurse; „Demo löschen“ entfernt die erfundenen.", es: "«Ver en vivo» muestra precios reales; «Borrar la demo» quita los inventados.", pl: "„Oglądaj na żywo” pokazuje prawdziwe ceny; „Usuń demo” usuwa wymyślone.", it: "“Segui in diretta” mostra i prezzi veri; “Cancella la demo” toglie quelli inventati." },
};

export const ECB_NOTE = ECB;

/** A price in its own currency: "$82,275.79", "5.6679 R$"; a currency pair's rate to four places. */
export function priceText(price: number, code: string, say: Say): string {
  if (code.includes("/")) return say.format.number(price, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  // Money in its currency to the cent; under one unit (a XRP, a DOGE) the cents say nothing, so four places.
  if (price >= 1) return say.format.money(Math.round(price * 100), quoteOf(code));
  return `${say.format.number(price, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${quoteOf(code)}`;
}

/** "▲ 0.67%", "▼ 1.20%", "— 0.00%". */
export function changeText(change: number | null | undefined, say: Say): string {
  if (typeof change !== "number") return "";
  const arrow = change > 0.004 ? "▲" : change < -0.004 ? "▼" : "—";
  return `${arrow} ${say.format.number(Math.abs(change) / 100, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "BTC-USD went above $90,000.00". */
export const alertText = (code: string, dir: "above" | "below", level: number, say: Say): string =>
  dir === "above"
    ? say.t({ en: "{code} went above {level}", "pt-BR": "{code} passou de {level}", de: "{code} ist über {level} gestiegen", es: "{code} superó {level}", pl: "{code} przekroczył {level}", it: "{code} ha superato {level}" }, { code, level: priceText(level, code, say) })
    : say.t({ en: "{code} dropped below {level}", "pt-BR": "{code} caiu abaixo de {level}", de: "{code} ist unter {level} gefallen", es: "{code} bajó de {level}", pl: "{code} spadł poniżej {level}", it: "{code} è sceso sotto {level}" }, { code, level: priceText(level, code, say) });

/** "2 s ago", "4 min ago", "15 Oct". */
export function agoText(time: Date, now: Date, say: Say): string {
  const s = Math.max(0, Math.round((now.getTime() - time.getTime()) / 1000));
  if (s < 5) return say.t({ en: "just now", "pt-BR": "agora mesmo", de: "gerade eben", es: "ahora mismo", pl: "przed chwilą", it: "proprio ora" });
  if (s < 60) return say.t({ en: "{n} s ago", "pt-BR": "há {n} s", de: "vor {n} s", es: "hace {n} s", pl: "{n} s temu", it: "{n} s fa" }, { n: s });
  if (s < 3600) return say.t({ en: "{n} min ago", "pt-BR": "há {n} min", de: "vor {n} Min.", es: "hace {n} min", pl: "{n} min temu", it: "{n} min fa" }, { n: Math.round(s / 60) });
  if (s < 86_400) return say.t({ en: "{n} h ago", "pt-BR": "há {n} h", de: "vor {n} Std.", es: "hace {n} h", pl: "{n} godz. temu", it: "{n} h fa" }, { n: Math.round(s / 3600) });
  return say.format.date(time, { day: "numeric", month: "short" });
}
