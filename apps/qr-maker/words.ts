// Everything QR Maker says on its screens, in its six languages (#303). Every language but English
// is a model's draft (#297). The screens say these through `ctx.t`.
import type { Words } from "potyro";

export const W = {
  appName: { en: "QR Maker", "pt-BR": "Gerador de QR", de: "QR-Macher", es: "Creador de QR", pl: "Twórca QR", it: "Creatore di QR" },

  // ---- the Make screen ----
  make: { en: "Make", "pt-BR": "Criar", de: "Erstellen", es: "Crear", pl: "Utwórz", it: "Crea" },
  kept: { en: "Kept", "pt-BR": "Guardados", de: "Behalten", es: "Guardados", pl: "Zachowane", it: "Tenuti" },
  kindText: { en: "Text", "pt-BR": "Texto", de: "Text", es: "Texto", pl: "Tekst", it: "Testo" },
  kindLink: { en: "Link", "pt-BR": "Link", de: "Link", es: "Enlace", pl: "Link", it: "Link" },
  kindWifi: { en: "Wi‑Fi", "pt-BR": "Wi‑Fi", de: "WLAN", es: "Wi‑Fi", pl: "Wi‑Fi", it: "Wi‑Fi" },
  kindContact: { en: "Contact", "pt-BR": "Contato", de: "Kontakt", es: "Contacto", pl: "Kontakt", it: "Contatto" },
  kind: { en: "What the code says", "pt-BR": "O que o código diz", de: "Was der Code sagt", es: "Lo que dice el código", pl: "Co mówi kod", it: "Cosa dice il codice" },
  textLabel: { en: "Text", "pt-BR": "Texto", de: "Text", es: "Texto", pl: "Tekst", it: "Testo" },
  textHint: { en: "Anything: a message, a code word, an address", "pt-BR": "Qualquer coisa: uma mensagem, uma senha, um endereço", de: "Alles Mögliche: eine Nachricht, ein Codewort, eine Adresse", es: "Lo que sea: un mensaje, una clave, una dirección", pl: "Cokolwiek: wiadomość, hasło, adres", it: "Qualsiasi cosa: un messaggio, una parola d'ordine, un indirizzo" },
  linkLabel: { en: "Link", "pt-BR": "Link", de: "Link", es: "Enlace", pl: "Link", it: "Link" },
  linkHint: { en: "https://…", "pt-BR": "https://…", de: "https://…", es: "https://…", pl: "https://…", it: "https://…" },
  ssid: { en: "Network name", "pt-BR": "Nome da rede", de: "Netzwerkname", es: "Nombre de la red", pl: "Nazwa sieci", it: "Nome della rete" },
  password: { en: "Password", "pt-BR": "Senha", de: "Passwort", es: "Contraseña", pl: "Hasło", it: "Password" },
  security: { en: "Security", "pt-BR": "Segurança", de: "Sicherheit", es: "Seguridad", pl: "Zabezpieczenie", it: "Sicurezza" },
  securityNone: { en: "Open", "pt-BR": "Aberta", de: "Offen", es: "Abierta", pl: "Otwarta", it: "Aperta" },
  name: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Imię i nazwisko", it: "Nome" },
  phone: { en: "Phone", "pt-BR": "Telefone", de: "Telefon", es: "Teléfono", pl: "Telefon", it: "Telefono" },
  email: { en: "Email", "pt-BR": "E-mail", de: "E-Mail", es: "Correo", pl: "E-mail", it: "E-mail" },
  codeLabel: { en: "The QR code", "pt-BR": "O código QR", de: "Der QR-Code", es: "El código QR", pl: "Kod QR", it: "Il codice QR" },
  empty: { en: "Type something above and the code appears here.", "pt-BR": "Digite algo acima e o código aparece aqui.", de: "Tippe oben etwas ein, und der Code erscheint hier.", es: "Escribe algo arriba y el código aparece aquí.", pl: "Wpisz coś powyżej, a kod pojawi się tutaj.", it: "Scrivi qualcosa sopra e il codice appare qui." },
  tooLong: { en: "That is too long for one QR code.", "pt-BR": "Isso é longo demais para um código QR.", de: "Das ist zu lang für einen QR-Code.", es: "Es demasiado largo para un código QR.", pl: "To za dużo jak na jeden kod QR.", it: "È troppo lungo per un solo codice QR." },
  share: { en: "Share", "pt-BR": "Compartilhar", de: "Teilen", es: "Compartir", pl: "Udostępnij", it: "Condividi" },
  keep: { en: "Keep", "pt-BR": "Guardar", de: "Behalten", es: "Guardar", pl: "Zachowaj", it: "Tieni" },
  save: { en: "Save a copy", "pt-BR": "Salvar uma cópia", de: "Kopie speichern", es: "Guardar una copia", pl: "Zapisz kopię", it: "Salva una copia" },
  keepName: { en: "What should this code be called?", "pt-BR": "Como chamar este código?", de: "Wie soll dieser Code heißen?", es: "¿Cómo se llamará este código?", pl: "Jak nazwać ten kod?", it: "Come chiamare questo codice?" },
  keptToast: { en: "Kept. It is under Kept.", "pt-BR": "Guardado. Está em Guardados.", de: "Behalten. Du findest ihn unter Behalten.", es: "Guardado. Está en Guardados.", pl: "Zachowano. Znajdziesz go w Zachowanych.", it: "Tenuto. Lo trovi in Tenuti." },
  shareText: { en: "A QR code from QR Maker", "pt-BR": "Um código QR do Gerador de QR", de: "Ein QR-Code aus QR-Macher", es: "Un código QR del Creador de QR", pl: "Kod QR z Twórcy QR", it: "Un codice QR dal Creatore di QR" },
  notShared: { en: "It could not be shared.", "pt-BR": "Não foi possível compartilhar.", de: "Es ließ sich nicht teilen.", es: "No se pudo compartir.", pl: "Nie udało się udostępnić.", it: "Non è stato possibile condividerlo." },
  notSaved: { en: "It could not be saved here.", "pt-BR": "Não foi possível salvar aqui.", de: "Es ließ sich hier nicht speichern.", es: "No se pudo guardar aquí.", pl: "Nie udało się tutaj zapisać.", it: "Non è stato possibile salvarlo qui." },

  // ---- the Kept screen ----
  noKept: { en: "Nothing kept yet. Make a code and tap Keep.", "pt-BR": "Nada guardado ainda. Crie um código e toque em Guardar.", de: "Noch nichts behalten. Erstelle einen Code und tippe auf Behalten.", es: "Nada guardado todavía. Crea un código y toca Guardar.", pl: "Nic jeszcze nie zachowano. Utwórz kod i stuknij Zachowaj.", it: "Niente ancora. Crea un codice e tocca Tieni." },
  delete: { en: "Delete", "pt-BR": "Excluir", de: "Löschen", es: "Eliminar", pl: "Usuń", it: "Elimina" },
  deleteAsk: { en: "Delete this code?", "pt-BR": "Excluir este código?", de: "Diesen Code löschen?", es: "¿Eliminar este código?", pl: "Usunąć ten kod?", it: "Eliminare questo codice?" },
  close: { en: "Close", "pt-BR": "Fechar", de: "Schließen", es: "Cerrar", pl: "Zamknij", it: "Chiudi" },
  makeAnother: { en: "Open in Make", "pt-BR": "Abrir em Criar", de: "In Erstellen öffnen", es: "Abrir en Crear", pl: "Otwórz w Utwórz", it: "Apri in Crea" },

  // ---- the tile ----
  tileNone: { en: "No codes kept", "pt-BR": "Nenhum código guardado", de: "Keine Codes behalten", es: "Sin códigos guardados", pl: "Brak zachowanych kodów", it: "Nessun codice tenuto" },
  tileCount: { en: "{n, plural, one {# code kept} other {# codes kept}}", "pt-BR": "{n, plural, one {# código guardado} other {# códigos guardados}}", de: "{n, plural, one {# Code behalten} other {# Codes behalten}}", es: "{n, plural, one {# código guardado} other {# códigos guardados}}", pl: "{n, plural, one {# kod zachowany} few {# kody zachowane} many {# kodów zachowanych} other {# kodu zachowanego}}", it: "{n, plural, one {# codice tenuto} other {# codici tenuti}}" },

  // ---- the demo ----
  demoLink: { en: "Potyro's site", "pt-BR": "Site do Potyro", de: "Potyros Website", es: "El sitio de Potyro", pl: "Strona Potyro", it: "Il sito di Potyro" },
  demoWifi: { en: "Café Guest Wi‑Fi", "pt-BR": "Wi‑Fi do café", de: "Café-Gast-WLAN", es: "Wi‑Fi del café", pl: "Wi‑Fi kawiarni", it: "Wi‑Fi del caffè" },
  demoText: { en: "Door code", "pt-BR": "Código da porta", de: "Türcode", es: "Código de la puerta", pl: "Kod do drzwi", it: "Codice della porta" },
} satisfies Record<string, Words>;
