// Draw & Guess — a Pictionary-style party game. One person draws a word only they can see, everyone
// else watches the drawing appear stroke by stroke and types guesses; the first right guess scores
// for the guesser and the drawer, hint letters show as the clock runs down, and the turn passes on.
//
// Played live in a room on Potyro's rooms relay (`ctx.caps.network.room`, docs/26 and docs/28), which
// is the only channel: nothing about a game is stored on a server. The room's code is the invitation.
// Every device runs the same code (session.ts): the oldest one in the room hosts the game, the
// drawer's device holds the word and judges the guesses, and when the host leaves the next oldest
// carries on. The drawing is a custom view on a canvas, so it runs as your own app; README says how
// a friend who gets the app from you plays.
//
// In six languages, the words to draw too (words.ts); every language but English is a model's draft
// (#297).
import { defineApp } from "potyro";
import { mountPlay } from "./play.js";

export default defineApp({
  id: "draw-guess",
  name: { en: "Draw & Guess", "pt-BR": "Desenhe e Adivinhe", de: "Malen & Raten", es: "Dibuja y Adivina", pl: "Rysuj i Zgaduj", it: "Disegna e Indovina" },
  icon: "✏️",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#ff5a3c" },
  nav: "tabs",
  // Potyro's rooms and nothing else: no other host, no fetch.
  permissions: { network: { rooms: true } },
  entities: {
    game: {
      label: { en: "Game", "pt-BR": "Jogo", de: "Spiel", es: "Partida", pl: "Gra", it: "Partita" },
      icon: "🏆",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: { en: "Winner", "pt-BR": "Vencedor", de: "Gewinner", es: "Ganador", pl: "Zwycięzca", it: "Vincitore" } },
        date: { type: "datetime", precision: "minute", label: { en: "Played", "pt-BR": "Jogado em", de: "Gespielt", es: "Jugada", pl: "Rozegrana", it: "Giocata" } },
        players: { type: "text", label: { en: "Scores", "pt-BR": "Pontos", de: "Punkte", es: "Puntos", pl: "Wyniki", it: "Punteggi" } },
        place: { type: "number", label: { en: "Your place", "pt-BR": "Sua posição", de: "Dein Platz", es: "Tu puesto", pl: "Twoje miejsce", it: "Il tuo posto" } },
        score: { type: "number", label: { en: "Your score", "pt-BR": "Seus pontos", de: "Deine Punkte", es: "Tus puntos", pl: "Twój wynik", it: "Il tuo punteggio" } },
      },
    },
  },
  pages: [
    {
      id: "play",
      title: { en: "Play", "pt-BR": "Jogar", de: "Spielen", es: "Jugar", pl: "Graj", it: "Gioca" },
      icon: "✏️",
      view: { type: "custom", entity: "game", mount: mountPlay },
    },
    {
      id: "games",
      title: { en: "Past games", "pt-BR": "Jogos anteriores", de: "Frühere Spiele", es: "Partidas anteriores", pl: "Poprzednie gry", it: "Partite passate" },
      icon: "🏆",
      view: {
        type: "list",
        entity: "game",
        sort: (a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")),
        display: { primary: "title", secondary: "players" },
        emptyText: {
          en: "Finished games land here, with everyone's scores.",
          "pt-BR": "Os jogos terminados aparecem aqui, com os pontos de todos.",
          de: "Fertige Spiele landen hier, mit allen Punkten.",
          es: "Las partidas terminadas aparecen aquí, con los puntos de todos.",
          pl: "Zakończone gry trafiają tutaj, z wynikami wszystkich.",
          it: "Le partite finite arrivano qui, con i punteggi di tutti.",
        },
      },
    },
  ],
});
