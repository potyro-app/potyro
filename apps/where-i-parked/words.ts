// Everything Where I parked says on its screens, in its six languages (#303). Every language but
// English is a model's draft (#297). The screens say these through `ctx.t`.
import type { Words } from "potyro";

export const W = {
  appName: { en: "Where I parked", "pt-BR": "Onde estacionei", de: "Wo ich geparkt habe", es: "Dónde aparqué", pl: "Gdzie zaparkowałem", it: "Dove ho parcheggiato" },

  // ---- no car parked ----
  parkHere: { en: "I parked here", "pt-BR": "Estacionei aqui", de: "Hier geparkt", es: "Aparqué aquí", pl: "Zaparkowałem tutaj", it: "Ho parcheggiato qui" },
  parkHint: {
    en: "One tap keeps the spot. When you come back, it says how far and which way.",
    "pt-BR": "Um toque guarda o lugar. Quando você voltar, ele diz a distância e a direção.",
    de: "Ein Tipp merkt sich den Platz. Wenn du zurückkommst, sagt er dir, wie weit und wohin.",
    es: "Un toque guarda el sitio. Cuando vuelvas, te dice a qué distancia y hacia dónde.",
    pl: "Jedno dotknięcie zapamiętuje miejsce. Gdy wrócisz, powie, jak daleko i w którą stronę.",
    it: "Un tocco ricorda il posto. Quando torni, ti dice quanto è lontano e da che parte.",
  },
  locating: { en: "Finding where you are…", "pt-BR": "Descobrindo onde você está…", de: "Wo bist du gerade…", es: "Buscando dónde estás…", pl: "Ustalam, gdzie jesteś…", it: "Cerco dove sei…" },
  noGeo: {
    en: "This device will not tell apps where it is. The spot is kept without a pin: add a note so you can find it.",
    "pt-BR": "Este aparelho não diz aos apps onde está. O lugar fica guardado sem pino: adicione uma nota para encontrá-lo.",
    de: "Dieses Gerät verrät Apps seinen Standort nicht. Der Platz wird ohne Stecknadel gemerkt: schreib eine Notiz dazu.",
    es: "Este dispositivo no dice a las apps dónde está. El sitio se guarda sin pin: añade una nota para encontrarlo.",
    pl: "To urządzenie nie zdradza aplikacjom, gdzie jest. Miejsce zostaje bez pinezki: dodaj notatkę, by je odnaleźć.",
    it: "Questo dispositivo non dice alle app dove si trova. Il posto resta senza segnaposto: aggiungi una nota per ritrovarlo.",
  },

  // ---- the car is parked ----
  parkedAgo: { en: "Parked {when}", "pt-BR": "Estacionado {when}", de: "Geparkt {when}", es: "Aparcado {when}", pl: "Zaparkowano {when}", it: "Parcheggiato {when}" },
  parkedAt: { en: "Parked at {time}", "pt-BR": "Estacionado às {time}", de: "Geparkt um {time}", es: "Aparcado a las {time}", pl: "Zaparkowano o {time}", it: "Parcheggiato alle {time}" },
  noPin: { en: "No pin — the device did not say where.", "pt-BR": "Sem pino — o aparelho não disse onde.", de: "Keine Stecknadel — das Gerät hat den Ort nicht verraten.", es: "Sin pin — el dispositivo no dijo dónde.", pl: "Bez pinezki — urządzenie nie podało miejsca.", it: "Nessun segnaposto — il dispositivo non ha detto dove." },
  meterEnds: { en: "Meter runs out {when}", "pt-BR": "O parquímetro acaba {when}", de: "Parkzeit läuft {when} ab", es: "El parquímetro acaba {when}", pl: "Parkomat kończy się {when}", it: "Il parchimetro scade {when}" },
  meterOver: { en: "Meter ran out {when}", "pt-BR": "O parquímetro acabou {when}", de: "Parkzeit ist {when} abgelaufen", es: "El parquímetro acabó {when}", pl: "Parkomat skończył się {when}", it: "Il parchimetro è scaduto {when}" },
  findCar: { en: "Find my car", "pt-BR": "Encontrar meu carro", de: "Mein Auto finden", es: "Encontrar mi coche", pl: "Znajdź mój samochód", it: "Trova la mia auto" },
  findAgain: { en: "Where am I now?", "pt-BR": "Onde estou agora?", de: "Wo bin ich jetzt?", es: "¿Dónde estoy ahora?", pl: "Gdzie teraz jestem?", it: "Dove sono adesso?" },
  away: { en: "{distance} to the {direction}", "pt-BR": "{distance} para o {direction}", de: "{distance} nach {direction}", es: "{distance} hacia el {direction}", pl: "{distance} na {direction}", it: "{distance} verso {direction}" },
  here: { en: "You are right by it.", "pt-BR": "Você está bem ao lado.", de: "Du stehst direkt daneben.", es: "Estás justo al lado.", pl: "Jesteś tuż obok.", it: "Sei proprio lì accanto." },
  cannotLocate: { en: "Could not tell where you are right now.", "pt-BR": "Não deu para saber onde você está agora.", de: "Dein Standort ließ sich gerade nicht bestimmen.", es: "No se pudo saber dónde estás ahora.", pl: "Nie udało się ustalić, gdzie teraz jesteś.", it: "Non è stato possibile capire dove sei adesso." },
  openMap: { en: "Open in a map", "pt-BR": "Abrir no mapa", de: "In einer Karte öffnen", es: "Abrir en un mapa", pl: "Otwórz w mapie", it: "Apri in una mappa" },
  found: { en: "Found it", "pt-BR": "Encontrei", de: "Gefunden", es: "Lo encontré", pl: "Znalazłem", it: "Trovata" },
  foundToast: { en: "Good. The spot is in your history.", "pt-BR": "Ótimo. O lugar está no seu histórico.", de: "Gut. Der Platz steht im Verlauf.", es: "Bien. El sitio está en tu historial.", pl: "Dobrze. Miejsce jest w historii.", it: "Bene. Il posto è nella cronologia." },

  // ---- the small follow-ups ----
  addNote: { en: "Add a note", "pt-BR": "Adicionar nota", de: "Notiz hinzufügen", es: "Añadir una nota", pl: "Dodaj notatkę", it: "Aggiungi una nota" },
  notePrompt: { en: "Where exactly? (level, row, a landmark)", "pt-BR": "Onde exatamente? (andar, fila, um ponto de referência)", de: "Wo genau? (Ebene, Reihe, ein Merkpunkt)", es: "¿Dónde exactamente? (planta, fila, una referencia)", pl: "Gdzie dokładnie? (poziom, rząd, punkt orientacyjny)", it: "Dove esattamente? (piano, fila, un punto di riferimento)" },
  editNote: { en: "Change the note", "pt-BR": "Mudar a nota", de: "Notiz ändern", es: "Cambiar la nota", pl: "Zmień notatkę", it: "Cambia la nota" },
  addPhoto: { en: "Add a photo", "pt-BR": "Adicionar foto", de: "Foto hinzufügen", es: "Añadir una foto", pl: "Dodaj zdjęcie", it: "Aggiungi una foto" },
  noCamera: { en: "This device does not let apps take photos.", "pt-BR": "Este aparelho não deixa os apps tirarem fotos.", de: "Dieses Gerät lässt Apps keine Fotos machen.", es: "Este dispositivo no deja que las apps hagan fotos.", pl: "To urządzenie nie pozwala aplikacjom robić zdjęć.", it: "Questo dispositivo non permette alle app di scattare foto." },
  setMeter: { en: "Set the meter", "pt-BR": "Marcar o parquímetro", de: "Parkzeit setzen", es: "Poner el parquímetro", pl: "Ustaw parkomat", it: "Imposta il parchimetro" },
  meterTitle: { en: "When does the parking run out?", "pt-BR": "Quando o estacionamento acaba?", de: "Wann läuft die Parkzeit ab?", es: "¿Cuándo acaba el aparcamiento?", pl: "Kiedy kończy się parkowanie?", it: "Quando scade il parcheggio?" },
  meterLabel: { en: "Runs out at", "pt-BR": "Acaba às", de: "Läuft ab um", es: "Acaba a las", pl: "Kończy się o", it: "Scade alle" },
  meterTimer: { en: "Parking meter", "pt-BR": "Parquímetro", de: "Parkuhr", es: "Parquímetro", pl: "Parkomat", it: "Parchimetro" },
  save: { en: "Save", "pt-BR": "Salvar", de: "Speichern", es: "Guardar", pl: "Zapisz", it: "Salva" },

  // ---- pages, fields, tile ----
  park: { en: "Park", "pt-BR": "Estacionar", de: "Parken", es: "Aparcar", pl: "Parkuj", it: "Parcheggia" },
  map: { en: "Map", "pt-BR": "Mapa", de: "Karte", es: "Mapa", pl: "Mapa", it: "Mappa" },
  history: { en: "History", "pt-BR": "Histórico", de: "Verlauf", es: "Historial", pl: "Historia", it: "Cronologia" },
  historyEmpty: { en: "Spots you found again will be listed here.", "pt-BR": "Os lugares que você reencontrou vão aparecer aqui.", de: "Plätze, die du wiedergefunden hast, stehen dann hier.", es: "Los sitios que volviste a encontrar aparecerán aquí.", pl: "Miejsca, które odnalazłeś, pojawią się tutaj.", it: "I posti che hai ritrovato saranno elencati qui." },
  spot: { en: "Spot", "pt-BR": "Lugar", de: "Platz", es: "Sitio", pl: "Miejsce", it: "Posto" },
  location: { en: "Location", "pt-BR": "Localização", de: "Standort", es: "Ubicación", pl: "Położenie", it: "Posizione" },
  at: { en: "Parked", "pt-BR": "Estacionado em", de: "Geparkt", es: "Aparcado", pl: "Zaparkowano", it: "Parcheggiato" },
  note: { en: "Note", "pt-BR": "Nota", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" },
  photo: { en: "Photo", "pt-BR": "Foto", de: "Foto", es: "Foto", pl: "Zdjęcie", it: "Foto" },
  meter: { en: "Meter runs out", "pt-BR": "Parquímetro acaba", de: "Parkzeit endet", es: "Parquímetro acaba", pl: "Parkomat kończy się", it: "Parchimetro scade" },
  foundAt: { en: "Found again", "pt-BR": "Reencontrado", de: "Wiedergefunden", es: "Encontrado", pl: "Odnaleziono", it: "Ritrovata" },
  tileNone: { en: "No car parked", "pt-BR": "Nenhum carro estacionado", de: "Kein Auto geparkt", es: "Ningún coche aparcado", pl: "Brak zaparkowanego auta", it: "Nessuna auto parcheggiata" },
  tileParked: { en: "Parked {when}", "pt-BR": "Estacionado {when}", de: "Geparkt {when}", es: "Aparcado {when}", pl: "Zaparkowano {when}", it: "Parcheggiato {when}" },
} satisfies Record<string, Words>;
