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
  name: "Draw & Guess",
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
      label: "Game",
      icon: "🏆",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Winner" },
        date: { type: "datetime", precision: "minute", label: "Played" },
        players: { type: "text", label: "Scores" },
        place: { type: "number", label: "Your place" },
        score: { type: "number", label: "Your score" },
      },
    },
  },
  pages: [
    {
      id: "play",
      title: "Play",
      icon: "✏️",
      // An invite link opens this page with the game's code (docs/24 §11): it fills the box, and the
      // person taps Join. Nothing joins by itself.
      link: { params: ["code"] },
      view: { type: "custom", entity: "game", mount: mountPlay },
    },
    {
      id: "games",
      title: "Past games",
      icon: "🏆",
      view: {
        type: "list",
        entity: "game",
        sort: (a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")),
        display: { primary: "title", secondary: "players" },
        emptyText: "Finished games land here, with everyone's scores.",
      },
    },
  ],
});
