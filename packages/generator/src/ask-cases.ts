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

export const ASK_CASES: AskCase[] = [
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
