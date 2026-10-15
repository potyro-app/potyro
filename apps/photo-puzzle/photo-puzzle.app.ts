// Photo Puzzle — take or pick a photo and it becomes a jigsaw: real knobbed pieces you drag onto the
// board, where they click in. Three sizes (12, 20 and 48 pieces), a clock, best times, and a finish
// where the seams fade and the photo is whole again.
//
// Then send it to someone: the puzzle travels inside the app. The photo is a file in the app's own
// folder (`ctx.files`), a `puzzle` record points at it, and sharing the app — a link from
// `ctx.space.invite()`, handed on with `ctx.ui.share` — gives whoever opens it the app, its puzzles and
// their photos (fetched on demand, #255). Their solves come back as `solve` records, so you see their
// time. The app says plainly, before any link exists, that the photo goes to whoever opens it.
//
// The photo comes only through `ctx.caps.camera` (CLAUDE.md rule 2). The pieces are drawn on a canvas
// in plain 2D — no library — so it opens offline from the first time. Custom screens, so it runs as
// your own (trusted) app, and a friend joining it trusts it too.
//
// In six languages (#303); every language but English is a model's draft (#297). Its words are in
// words.ts, said through `ctx.t`. A puzzle's title is a record: made when the photo is taken, in the
// language of the person who took it.
import { defineApp } from "potyro";
import { LEVEL_IDS } from "./jigsaw.js";
import { mountPlay } from "./play.js";
import { mountPuzzles } from "./puzzles.js";
import { LEVEL_NAMES, W } from "./words.js";

export default defineApp({
  id: "photo-puzzle",
  name: W.appName,
  icon: "🧩",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#e2557a" },
  nav: "tabs",
  // A puzzle starts from a photo, a solve from a finished game: nothing to add by hand.
  quickActions: [],
  permissions: { camera: true, haptics: true },
  entities: {
    puzzle: {
      label: W.puzzle,
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: W.fTitle },
        photo: { type: "file", accept: "image/*", folder: "photos", label: W.fPhoto },
        from: { type: "text", label: W.fFrom },
      },
    },
    solve: {
      label: W.solve,
      displayField: "by",
      fields: {
        puzzle: { type: "relation", to: "puzzle", required: true, label: W.puzzle },
        level: { type: "enum", options: [...LEVEL_IDS], labels: LEVEL_NAMES, colors: { easy: "green", medium: "orange", hard: "red" }, label: W.fLevel },
        seconds: { type: "number", integer: true, min: 1, label: W.fSeconds },
        moves: { type: "number", integer: true, min: 0, label: W.fMoves },
        by: { type: "text", label: W.fBy },
      },
    },
  },
  pages: [
    { id: "puzzles", title: W.puzzles, icon: "🧩", view: { type: "custom", entity: "puzzle", mount: mountPuzzles } },
    { id: "play", title: W.play, hidden: true, view: { type: "custom", entity: "puzzle", mount: mountPlay } },
  ],
});
