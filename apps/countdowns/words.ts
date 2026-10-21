// Everything Countdowns says on its screens, in its six languages (#303). Every language but English
// is a model's draft (#297). The screens say these through `ctx.t`.
import type { Words } from "potyro";

export const W = {
  appName: { en: "Countdowns", "pt-BR": "Contagens", de: "Countdowns", es: "Cuentas atrás", pl: "Odliczania", it: "Conti alla rovescia" },
  soon: { en: "Soon", "pt-BR": "Em breve", de: "Bald", es: "Pronto", pl: "Wkrótce", it: "Presto" },
  event: { en: "Event", "pt-BR": "Evento", de: "Ereignis", es: "Evento", pl: "Wydarzenie", it: "Evento" },
  fTitle: { en: "What", "pt-BR": "O quê", de: "Was", es: "Qué", pl: "Co", it: "Cosa" },
  fTitlePlaceholder: { en: "Lisbon trip", "pt-BR": "Viagem a Lisboa", de: "Reise nach Lissabon", es: "Viaje a Lisboa", pl: "Wyjazd do Lizbony", it: "Viaggio a Lisbona" },
  fDate: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" },
  fIcon: { en: "Emoji", "pt-BR": "Emoji", de: "Emoji", es: "Emoji", pl: "Emoji", it: "Emoji" },
  fIconHelp: { en: "One, if you like: ✈️ 🎂 🎓", "pt-BR": "Um, se quiser: ✈️ 🎂 🎓", de: "Eins, wenn du magst: ✈️ 🎂 🎓", es: "Uno, si quieres: ✈️ 🎂 🎓", pl: "Jedno, jeśli chcesz: ✈️ 🎂 🎓", it: "Uno, se vuoi: ✈️ 🎂 🎓" },
  fNote: { en: "Note", "pt-BR": "Nota", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" },
  add: { en: "Add an event", "pt-BR": "Adicionar evento", de: "Ereignis hinzufügen", es: "Añadir evento", pl: "Dodaj wydarzenie", it: "Aggiungi evento" },
  save: { en: "Add", "pt-BR": "Adicionar", de: "Hinzufügen", es: "Añadir", pl: "Dodaj", it: "Aggiungi" },
  added: { en: "Counting down to {title}", "pt-BR": "Contando até {title}", de: "Countdown bis {title}", es: "Cuenta atrás hasta {title}", pl: "Odliczanie do: {title}", it: "Conto alla rovescia per {title}" },

  // ---- the hero ----
  days: {
    en: "{n, plural, one {day} other {days}}",
    "pt-BR": "{n, plural, one {dia} other {dias}}",
    de: "{n, plural, one {Tag} other {Tage}}",
    es: "{n, plural, one {día} other {días}}",
    pl: "{n, plural, one {dzień} few {dni} many {dni} other {dnia}}",
    it: "{n, plural, one {giorno} other {giorni}}",
  },
  until: { en: "until {title}", "pt-BR": "até {title}", de: "bis {title}", es: "hasta {title}", pl: "do: {title}", it: "a {title}" },
  today: { en: "Today!", "pt-BR": "Hoje!", de: "Heute!", es: "¡Hoy!", pl: "Dzisiaj!", it: "Oggi!" },
  tomorrow: { en: "Tomorrow", "pt-BR": "Amanhã", de: "Morgen", es: "Mañana", pl: "Jutro", it: "Domani" },
  isToday: { en: "{title} is today", "pt-BR": "{title} é hoje", de: "{title} ist heute", es: "{title} es hoy", pl: "{title} jest dzisiaj", it: "{title} è oggi" },

  // ---- the rows ----
  inDays: {
    en: "{n, plural, =0 {today} one {tomorrow} other {in # days}}",
    "pt-BR": "{n, plural, =0 {hoje} one {amanhã} other {em # dias}}",
    de: "{n, plural, =0 {heute} one {morgen} other {in # Tagen}}",
    es: "{n, plural, =0 {hoy} one {mañana} other {en # días}}",
    pl: "{n, plural, =0 {dzisiaj} one {jutro} few {za # dni} many {za # dni} other {za # dnia}}",
    it: "{n, plural, =0 {oggi} one {domani} other {tra # giorni}}",
  },
  agoDays: {
    en: "{n, plural, one {yesterday} other {# days ago}}",
    "pt-BR": "{n, plural, one {ontem} other {há # dias}}",
    de: "{n, plural, one {gestern} other {vor # Tagen}}",
    es: "{n, plural, one {ayer} other {hace # días}}",
    pl: "{n, plural, one {wczoraj} few {# dni temu} many {# dni temu} other {# dnia temu}}",
    it: "{n, plural, one {ieri} other {# giorni fa}}",
  },
  ago: { en: "ago", "pt-BR": "atrás", de: "her", es: "atrás", pl: "temu", it: "fa" },
  upNext: { en: "Up next", "pt-BR": "A seguir", de: "Als Nächstes", es: "A continuación", pl: "Następne", it: "In arrivo" },
  past: {
    en: "{n, plural, one {# past event} other {# past events}}",
    "pt-BR": "{n, plural, one {# evento passado} other {# eventos passados}}",
    de: "{n, plural, one {# vergangenes Ereignis} other {# vergangene Ereignisse}}",
    es: "{n, plural, one {# evento pasado} other {# eventos pasados}}",
    pl: "{n, plural, one {# minione wydarzenie} few {# minione wydarzenia} many {# minionych wydarzeń} other {# minionego wydarzenia}}",
    it: "{n, plural, one {# evento passato} other {# eventi passati}}",
  },
  show: { en: "Show", "pt-BR": "Mostrar", de: "Anzeigen", es: "Mostrar", pl: "Pokaż", it: "Mostra" },
  hide: { en: "Hide", "pt-BR": "Ocultar", de: "Ausblenden", es: "Ocultar", pl: "Ukryj", it: "Nascondi" },

  // ---- empty ----
  emptyTitle: { en: "Nothing to count down to yet", "pt-BR": "Nada para contar ainda", de: "Noch nichts zum Herunterzählen", es: "Nada que contar todavía", pl: "Jeszcze nie ma do czego odliczać", it: "Ancora niente da aspettare" },
  emptyBody: {
    en: "A trip, a birthday, an exam, a launch. Add the date and watch the days go down.",
    "pt-BR": "Uma viagem, um aniversário, uma prova, um lançamento. Adicione a data e veja os dias diminuírem.",
    de: "Eine Reise, ein Geburtstag, eine Prüfung, ein Start. Trag das Datum ein und sieh die Tage schwinden.",
    es: "Un viaje, un cumpleaños, un examen, un lanzamiento. Añade la fecha y mira cómo bajan los días.",
    pl: "Wyjazd, urodziny, egzamin, premiera. Dodaj datę i patrz, jak ubywa dni.",
    it: "Un viaggio, un compleanno, un esame, un lancio. Aggiungi la data e guarda i giorni scendere.",
  },

  // ---- the tile ----
  tileNone: { en: "Nothing soon", "pt-BR": "Nada em breve", de: "Nichts in Kürze", es: "Nada pronto", pl: "Nic wkrótce", it: "Niente a breve" },
  tileTitle: {
    en: "{n, plural, =0 {Today: {title}} one {# day to {title}} other {# days to {title}}}",
    "pt-BR": "{n, plural, =0 {Hoje: {title}} one {# dia para {title}} other {# dias para {title}}}",
    de: "{n, plural, =0 {Heute: {title}} one {# Tag bis {title}} other {# Tage bis {title}}}",
    es: "{n, plural, =0 {Hoy: {title}} one {# día para {title}} other {# días para {title}}}",
    pl: "{n, plural, =0 {Dzisiaj: {title}} one {# dzień do: {title}} few {# dni do: {title}} many {# dni do: {title}} other {# dnia do: {title}}}",
    it: "{n, plural, =0 {Oggi: {title}} one {# giorno a {title}} other {# giorni a {title}}}",
  },

  // ---- reminders ----
  reminderTitle: { en: "Today: {title}", "pt-BR": "Hoje: {title}", de: "Heute: {title}", es: "Hoy: {title}", pl: "Dzisiaj: {title}", it: "Oggi: {title}" },

  // ---- the demo ----
  demoTrip: { en: "Lisbon trip", "pt-BR": "Viagem a Lisboa", de: "Reise nach Lissabon", es: "Viaje a Lisboa", pl: "Wyjazd do Lizbony", it: "Viaggio a Lisbona" },
  demoBirthday: { en: "Mum's birthday", "pt-BR": "Aniversário da mãe", de: "Mamas Geburtstag", es: "Cumpleaños de mamá", pl: "Urodziny mamy", it: "Compleanno della mamma" },
  demoExam: { en: "Driving test", "pt-BR": "Prova de direção", de: "Fahrprüfung", es: "Examen de conducir", pl: "Egzamin na prawo jazdy", it: "Esame di guida" },
  demoPast: { en: "Moved in", "pt-BR": "Mudança", de: "Eingezogen", es: "Mudanza", pl: "Przeprowadzka", it: "Trasloco" },
} satisfies Record<string, Words>;
