// Requests for Ask (#213) against the example apps, for `eval:ask`: what a person would really type,
// with what the device would know when they typed it. Read the transcripts, not only the counts —
// "a proposal with 5 rows" says nothing about whether the five restaurants exist.

import type { AppDefinition } from "karta";
import type { AskContext } from "./agent/ask.js";

export interface AskCase {
  id: string;
  /** File under examples/, or an app defined here — apps unlike the examples, so the checks are not tuned to them. */
  app: string | AppDefinition;
  request: string;
  context?: AskContext;
  /** A paste the person brought, as another AI would have written it. */
  material?: { label: string; text: string };
  /** What a good answer looks like, for the person reading the transcript. */
  expect: string;
}

const CUNEO: AskContext = {
  today: "2026-09-25",
  language: "en",
  area: { lat: 44.3845, lng: 7.5427, radiusKm: 3, label: "the area the map shows" },
};

// Apps a person might make in the Studio that look nothing like the examples. Plain definitions: the
// harness needs their shape, not their pages.
const BOOKS = {
  id: "books",
  name: "Reading list",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    book: {
      label: "Book",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        author: { type: "text" },
        year: { type: "number", integer: true },
        genre: { type: "enum", options: ["novel", "short stories", "essays", "poetry", "non-fiction"] },
        pages: { type: "number", integer: true },
        read: { type: "boolean", default: false },
        myRating: { type: "number", min: 1, max: 5, label: "My rating" },
      },
    },
  },
  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book" } }],
} as unknown as AppDefinition;

const EVENTS = {
  id: "gigs",
  name: "Gigs",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    gig: {
      label: "Gig",
      displayField: "artist",
      fields: {
        artist: { type: "text", required: true },
        date: { type: "datetime", precision: "minute" },
        venue: { type: "text" },
        city: { type: "text" },
        ticketUrl: { type: "url", label: "Tickets" },
        going: { type: "boolean", default: false },
      },
    },
  },
  pages: [{ id: "all", title: "Gigs", view: { type: "list", entity: "gig" } }],
} as unknown as AppDefinition;

const WISHLIST = {
  id: "wishlist",
  name: "Wishlist",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    product: {
      label: "Product",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        brand: { type: "text" },
        price: { type: "money", currency: "EUR" },
        screen: { type: "text", label: "Screen" },
        link: { type: "url" },
        bought: { type: "boolean", default: false },
      },
    },
  },
  pages: [{ id: "all", title: "Wishlist", view: { type: "list", entity: "product" } }],
} as unknown as AppDefinition;

const PLAIN: AskContext = { today: "2026-09-26", language: "en" };

const PPL_PASTE = `Here's a solid Push/Pull/Legs split for hypertrophy 💪

**Push (Day 1)**
| Exercise | Sets | Reps | Rest |
|---|---|---|---|
| Barbell Bench Press | 4 | 6–8 | 2–3 min |
| Seated Dumbbell Shoulder Press | 3 | 8–10 | 90 s |
| Incline Dumbbell Press | 3 | 10–12 | 90 s |
| Cable Lateral Raise | 3 | 12–15 | 60 s |
| Rope Triceps Pushdown | 3 | 12–15 | 60 s |

**Pull (Day 2)**
| Exercise | Sets | Reps | Rest |
|---|---|---|---|
| Deadlift | 3 | 5 | 3 min |
| Weighted Pull-Up | 4 | 6–8 | 2 min |
| Chest-Supported Row | 3 | 8–10 | 90 s |
| Face Pull | 3 | 15 | 60 s |
| Incline Dumbbell Curl | 3 | 10–12 | 60 s |

**Legs (Day 3)**
- Back Squat — 4×6–8, rest 3 min
- Romanian Deadlift — 3×8–10, rest 2 min
- Bulgarian Split Squat — 3×10 each leg, 90 s
- Leg Curl — 3×12, 60 s
- Standing Calf Raise — 4×12–15, 60 s

Tip: add weight when you hit the top of the rep range on all sets!`;

const BOOKS_PASTE = `Great choice — Italian literature has so much to offer. A few I'd start with:

1) "The Leopard" (Il Gattopardo) by Giuseppe Tomasi di Lampedusa, 1958 — a Sicilian prince watches his world end.
2) Italo Calvino — *Invisible Cities*, 1972. Short, dreamlike, perfect for dipping in.
3) Elsa Morante's "History" (La Storia), published 1974.
4) If you like crime: "The Day of the Owl" by Leonardo Sciascia (1961).

Honourable mention: Eco's The Name of the Rose, though you've probably read it!`;

export const ASK_CASES: AskCase[] = [
  // Changing records the person has. The model never sees them: it names them as the person did.
  { id: "edit-books-finished", app: BOOKS, request: "I finished The Leopard, 4 stars", context: PLAIN, expect: "One edit on “The Leopard”: read true, myRating 4. No new book." },
  { id: "edit-wishlist-price", app: WISHLIST, request: "the Kindle Paperwhite is 139 euros now", context: PLAIN, expect: "One edit on “Kindle Paperwhite”: price 139. Nothing else changed." },
  { id: "edit-gigs-not-going", app: EVENTS, request: "I'm not going to the Verdena gig anymore", context: PLAIN, expect: "One edit on the Verdena gig: going false." },
  { id: "edit-workout-sets", app: "workout.app.tsx", request: "change bench press to 4 sets of 6-8", context: PLAIN, expect: "One edit on the bench press exercise: its sets and reps fields, in their rules." },
  { id: "edit-books-author-web", app: BOOKS, request: "fill in the author and year of Invisible Cities", context: PLAIN, expect: "One edit: author Italo Calvino, year 1972, confirmed by what was read." },
  { id: "edit-books-unnamed", app: BOOKS, request: "fill in the missing authors in my list", context: PLAIN, expect: "A short reply: it cannot see the records; which books? No edits guessed." },
  { id: "paste-ppl", app: "workout.app.tsx", request: "add these", material: { label: "what you pasted", text: PPL_PASTE }, context: PLAIN, expect: "15 exercises, day and order from the headings, sets and rep ranges and rest from the tables and list; nothing invented." },
  { id: "paste-books", app: BOOKS, request: "add these to my list", material: { label: "what you pasted", text: BOOKS_PASTE }, context: PLAIN, expect: "4 books (not the honourable mention, or flagged); titles, authors, years from the paste; read false." },
  { id: "books-calvino", app: BOOKS, request: "add 3 novels by Italo Calvino", context: PLAIN, expect: "Real Calvino novels with correct years; myRating empty, read false." },
  { id: "gigs-turin", app: EVENTS, request: "add concerts in Turin in October", context: PLAIN, expect: "Real October 2026 concerts in Turin with dates and venues from listings." },
  { id: "wishlist-ereaders", app: WISHLIST, request: "add 3 e-readers under 150 euros", context: PLAIN, expect: "Real current e-readers with prices under €150 from shops or reviews." },
  {
    id: "places-veg-bare",
    app: "places.app.ts",
    request: "add vegetarian restaurants",
    context: CUNEO,
    expect: "Real vegetarian-friendly restaurants in Cuneo (the map's area), kind restaurant, coordinates in Cuneo; no question back.",
  },
  {
    id: "places-veg-cuneo",
    app: "places.app.ts",
    request: "add vegetarian restaurants in cuneo city",
    context: CUNEO,
    expect: "Real vegetarian-friendly restaurants in Cuneo; no question back.",
  },
  {
    id: "places-cafes-landmark",
    app: "places.app.ts",
    request: "add 5 nice cafés near Piazza Galimberti",
    context: CUNEO,
    expect: "5 cafés around Piazza Galimberti, Cuneo (44.3899, 7.5475), kind cafe.",
  },
  {
    id: "places-pt",
    app: "places.app.ts",
    request: "adicione 3 pizzarias boas em Cuneo",
    context: { ...CUNEO, language: "pt" },
    expect: "3 pizzerias in Cuneo, kind pizza; any prose in Portuguese.",
  },
  {
    id: "workout-ppl",
    app: "workout.app.tsx",
    request: "make me a push/pull/legs program, 5 exercises per day",
    context: { today: "2026-09-25", language: "en" },
    expect: "15 exercise records, day set, order 1..5 per day, sets/rep ranges/rest, cues.",
  },
  {
    id: "recipes-carbonara",
    app: "recipes.app.tsx",
    request: "add a carbonara recipe",
    context: { today: "2026-09-25", language: "en" },
    expect: "A recipe with ingredient rows linked to ingredient records (new ones proposed), quantities, steps.",
  },
  {
    id: "groceries-lasagna",
    app: "groceries.app.ts",
    request: "add what I need to make lasagna for 6",
    context: { today: "2026-09-25", language: "en" },
    expect: "Grocery items with quantities, each in an aisle (existing by name or new).",
  },
  {
    id: "plants-dark-bathroom",
    app: "plants.app.ts",
    request: "add 3 easy plants for a dark bathroom",
    context: { today: "2026-09-25", language: "en" },
    expect: "3 low-light, humidity-loving plants with sensible watering intervals.",
  },
];
