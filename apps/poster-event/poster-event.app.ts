// Poster to Calendar: photograph a poster, a flyer, a ticket or an invitation, and it becomes an event
// in your calendar — with a reminder, a calendar file for the phone, and a message for friends.
//
// The reading is one `ctx.caps.ai.extract` (docs/23) into a plain shape; the calendar sense — the
// year of a date printed without one, "8pm" and "20h30", doors against start, an end past midnight,
// a printed timezone — is worked out by the app's own functions (dates.ts), the same way every time.
// The person always checks the event in a form before it is saved: a model reads, a person decides.
//
// Every screen is a built-in view, on purpose: a friend who opens this app from a share link runs it
// sealed, and a sealed app's custom views do not render. So the whole app works for them too —
// reading posters included, after they say yes to the AI question.
//
// In six languages (docs/20); every language but English is a model's draft (#297). Records — a
// band's name, a venue — are never translated.

import { defineApp, type Ctx, type Resolved } from "potyro";
import { buildIcs, icsName, remindAt } from "./calendar.js";
import { toDate } from "./dates.js";
import { FIELDS } from "./fields.js";
import { readPoster, demo } from "./read.js";
import { bucket, doorsText, endTime, over, pastBucket, reminderText, rowText, shareText, startTime, whenText } from "./words.js";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The event as a .ics file in the app's folder, then out of the app — where a phone opens it in its calendar. */
async function addToCalendar(r: Resolved, ctx: Ctx): Promise<void> {
  const start = toDate(r.start);
  if (!start) {
    ctx.ui.toast({ en: "Add a date first.", "pt-BR": "Adicione uma data primeiro.", de: "Zuerst ein Datum eintragen.", es: "Añade una fecha primero.", pl: "Najpierw dodaj datę.", it: "Prima aggiungi una data." });
    return;
  }
  const now = ctx.now();
  const title = str(r.title) || "Event";
  const notes = [str(r.description), doorsText(r, ctx), str(r.price)].filter(Boolean).join("\n");
  const ics = buildIcs(
    {
      uid: `${String(r.id)}@poster-to-calendar.potyro`,
      title,
      start,
      end: toDate(r.end),
      allDay: Boolean(r.allDay),
      venue: str(r.venue),
      address: str(r.address),
      description: notes,
      link: str(r.link) || null,
      alarm: remindAt(r, now),
      alarmText: [title, str(r.venue)].filter(Boolean).join(" · "),
    },
    now,
  );
  const path = `calendar/${icsName(title, start)}`;
  await ctx.files.write(path, ics, { mime: "text/calendar" });
  await ctx.files.export(path);
  ctx.ui.toast({
    en: "Open the file to add it to your calendar.",
    "pt-BR": "Abra o arquivo para pôr o evento na sua agenda.",
    de: "Öffne die Datei, um den Termin in deinen Kalender zu übernehmen.",
    es: "Abre el archivo para añadirlo a tu calendario.",
    pl: "Otwórz plik, żeby dodać wydarzenie do kalendarza.",
    it: "Apri il file per aggiungerlo al tuo calendario.",
  });
}

/** The share dialog (Copy, and the phone's share sheet): the event in a few lines, and its link. */
async function shareEvent(r: Resolved, ctx: Ctx): Promise<void> {
  const link = str(r.link);
  await ctx.ui.share({ title: str(r.title), text: shareText(r, ctx, ctx.now()), ...(/^https?:\/\//i.test(link) ? { url: link } : {}) });
}

export default defineApp({
  id: "poster-event",
  name: { en: "Poster to Calendar", "pt-BR": "Do cartaz à agenda", de: "Plakat in den Kalender", es: "Del cartel al calendario", pl: "Plakat do kalendarza", it: "Dalla locandina al calendario" },
  icon: "🎟️",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#d9603b" },
  nav: "tabs",
  permissions: { ai: true, camera: true, notifications: true },
  // A demo link opens on the sample poster's event (docs/04 §Demo).
  demo,
  quickActions: [
    {
      id: "type-in",
      label: { en: "Type one in", "pt-BR": "Digitar um", de: "Selbst eintragen", es: "Escribir uno", pl: "Wpisz ręcznie", it: "Scrivine uno" },
      icon: "✏️",
      entity: "event",
      mode: "form",
    },
  ],
  entities: {
    event: {
      label: { en: "Event", "pt-BR": "Evento", de: "Termin", es: "Evento", pl: "Wydarzenie", it: "Evento" },
      icon: "🎟️",
      displayField: "title",
      fields: FIELDS,
      groups: [
        { fields: ["title"] },
        { title: { en: "When", "pt-BR": "Quando", de: "Wann", es: "Cuándo", pl: "Kiedy", it: "Quando" }, fields: ["start", "end", "allDay", "doors", "remind"] },
        { title: { en: "Where", "pt-BR": "Onde", de: "Wo", es: "Dónde", pl: "Gdzie", it: "Dove" }, fields: ["venue", "address"] },
        { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["price", "link", "description", "poster"] },
      ],
      computed: {
        when: { value: (r, ctx) => whenText(r, ctx, ctx.now()), label: { en: "Date and time", "pt-BR": "Data e hora", de: "Datum und Uhrzeit", es: "Fecha y hora", pl: "Data i godzina", it: "Data e ora" } },
        reminder: { value: (r, ctx) => reminderText(r, ctx, ctx.now()), label: { en: "Reminder", "pt-BR": "Lembrete", de: "Erinnerung", es: "Recordatorio", pl: "Przypomnienie", it: "Promemoria" } },
      },
      actions: {
        addToCalendar: {
          label: { en: "Add to my calendar", "pt-BR": "Pôr na minha agenda", de: "In meinen Kalender", es: "Añadir a mi calendario", pl: "Dodaj do kalendarza", it: "Aggiungi al calendario" },
          description: "Export the event as a calendar (.ics) file the phone's calendar opens.",
          run: addToCalendar,
        },
        share: {
          label: { en: "Share with friends", "pt-BR": "Compartilhar", de: "Mit Freunden teilen", es: "Compartir con amigos", pl: "Udostępnij znajomym", it: "Condividi con gli amici" },
          description: "Open the share sheet with the event's day, place and link.",
          run: shareEvent,
        },
      },
    },
  },
  pages: [
    {
      id: "upcoming",
      title: { en: "Coming up", "pt-BR": "Próximos", de: "Demnächst", es: "Próximos", pl: "Nadchodzące", it: "In arrivo" },
      icon: "🎟️",
      actions: [{ label: { en: "Read a poster", "pt-BR": "Ler um cartaz", de: "Plakat lesen", es: "Leer un cartel", pl: "Odczytaj plakat", it: "Leggi una locandina" }, icon: "📷", run: readPoster }],
      view: {
        type: "list",
        entity: "event",
        filter: (r, ctx) => !over(r, ctx.now()),
        sort: (a, b) => startTime(a) - startTime(b),
        group: (r, ctx) => bucket(r, ctx, ctx.now()),
        display: { primary: "title", secondary: (r, ctx) => rowText(r, ctx, ctx.now()), media: "poster" },
        emptyText: {
          en: "Photograph a poster, flyer or ticket: it becomes an event with a reminder. Try the sample first under “Read a poster”.",
          "pt-BR": "Fotografe um cartaz, folheto ou ingresso: ele vira um evento com lembrete. Teste antes o exemplo em “Ler um cartaz”.",
          de: "Fotografiere ein Plakat, einen Flyer oder ein Ticket: Daraus wird ein Termin mit Erinnerung. Probier zuerst das Beispiel unter „Plakat lesen“.",
          es: "Haz una foto a un cartel, folleto o entrada: se convierte en un evento con recordatorio. Prueba antes el ejemplo en «Leer un cartel».",
          pl: "Zrób zdjęcie plakatu, ulotki albo biletu: stanie się wydarzeniem z przypomnieniem. Najpierw wypróbuj przykład w „Odczytaj plakat”.",
          it: "Fotografa una locandina, un volantino o un biglietto: diventa un evento con promemoria. Prova prima l'esempio in “Leggi una locandina”.",
        },
        onOpen: { page: "event", param: { eventId: "id" } },
      },
    },
    {
      id: "calendar",
      title: { en: "Calendar", "pt-BR": "Calendário", de: "Kalender", es: "Calendario", pl: "Kalendarz", it: "Calendario" },
      icon: "🗓️",
      view: { type: "calendar", entity: "event", date: "start", title: "title" },
    },
    {
      id: "past",
      title: { en: "Past", "pt-BR": "Passados", de: "Vorbei", es: "Pasados", pl: "Minione", it: "Passati" },
      icon: "🕰️",
      view: {
        type: "list",
        entity: "event",
        filter: (r, ctx) => over(r, ctx.now()),
        sort: (a, b) => endTime(b) - endTime(a),
        group: (r, ctx) => pastBucket(r, ctx),
        display: { primary: "title", secondary: (r, ctx) => rowText(r, ctx, ctx.now()), media: "poster" },
        emptyText: {
          en: "Events you've been to land here once they're over.",
          "pt-BR": "Os eventos vêm para cá depois que acabam.",
          de: "Termine landen hier, sobald sie vorbei sind.",
          es: "Los eventos llegan aquí cuando terminan.",
          pl: "Wydarzenia trafiają tutaj, gdy się skończą.",
          it: "Gli eventi finiscono qui quando sono passati.",
        },
        onOpen: { page: "event", param: { eventId: "id" } },
      },
    },
    {
      id: "event",
      title: { en: "Event", "pt-BR": "Evento", de: "Termin", es: "Evento", pl: "Wydarzenie", it: "Evento" },
      hidden: true,
      view: {
        type: "detail",
        entity: "event",
        param: "eventId",
        actions: ["addToCalendar", "share"],
        sections: [
          // The event card: the poster beside its day and time, then the doors and the reminder.
          { fields: ["poster", "when", "doors", "reminder"] },
          { title: { en: "Where", "pt-BR": "Onde", de: "Wo", es: "Dónde", pl: "Gdzie", it: "Dove" }, fields: ["venue", "address"] },
          { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["price", "link", "description"] },
        ],
      },
    },
  ],
  reminders: [
    {
      id: "before",
      entity: "event",
      when: (r, ctx) => remindAt(r, ctx.now()),
      title: (r) => str(r.title),
      body: (r, ctx) => rowText(r, ctx, ctx.now()),
    },
  ],
});
