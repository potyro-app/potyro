// The eval corpus (KA-06): natural-language prompts spanning the field / view / logic surface.
// A model backend turns each into one `.app.ts`; the harness scores compile/validate/render. These
// are intentionally varied (simple → relational → computed → reminders → geo/map → nested lists).

import type { GenPrompt } from "./backend.js";

export const PROMPTS: GenPrompt[] = [
  { id: "todo", description: "A simple todo list: each task has a title and a done checkbox; show a list.", tags: ["fields", "list"] },
  { id: "notes", description: "A notes app with a title and multiline body; list them newest first.", tags: ["fields", "list", "sort"] },
  { id: "books", description: "Track books with title, author, and a 0–5 rating; show a gallery.", tags: ["fields", "gallery"] },
  { id: "movies", description: "A watchlist of movies with title, year, genre (enum), and a 'watched' boolean; a list filtered to unwatched.", tags: ["enum", "filter"] },
  { id: "contacts", description: "Contacts with name, email, phone, and tags; a searchable list.", tags: ["fields", "tags"] },
  { id: "expenses", description: "Expenses with amount, category (enum), and date; a computed monthly total.", tags: ["number", "computed", "datetime"] },
  { id: "habits", description: "A habit tracker: name, target-per-week, and a computed streak; a list showing the streak.", tags: ["computed", "list"] },
  { id: "workouts", description: "Log workouts: date, type, and a list of sets each with reps and weight; a detail view.", tags: ["nested-list", "detail"] },
  { id: "recipes", description: "Recipes with a name, servings, and ingredients (name + quantity); a computed total quantity.", tags: ["nested-list", "computed"] },
  { id: "plants", description: "Plants with last-watered date and interval; a computed next-watering date and an 'overdue' flag.", tags: ["datetime", "computed"] },
  { id: "plants-reminder", description: "Plants that remind you to water them: a reminder scheduled for the next-watering date.", tags: ["reminder", "datetime"] },
  { id: "places", description: "Saved places with a name and a geo location; a map view.", tags: ["geo", "map"] },
  { id: "places-open", description: "Restaurants with opening hours and a computed 'open now'; a list you can filter to open ones.", tags: ["computed", "filter"] },
  { id: "budget", description: "A budget with categories, each with a limit and a computed spent-so-far from transactions.", tags: ["relation", "computed"] },
  { id: "reading", description: "A reading tracker: books with total pages and current page, and a computed percent complete.", tags: ["number", "computed"] },
  { id: "inventory", description: "Home inventory: items with name, quantity, location, and a photo; a gallery.", tags: ["media", "gallery"] },
  { id: "tasks-due", description: "Tasks with a due date and priority (enum); a list sorted by due date with an 'add task' form.", tags: ["enum", "datetime", "sort"] },
  { id: "journal", description: "A daily journal: entries with a date, mood (enum), and text; a calendar view by date.", tags: ["enum", "calendar"] },
  { id: "subscriptions", description: "Track subscriptions: name, monthly cost, renewal date; a computed yearly total.", tags: ["number", "computed"] },
  { id: "guests", description: "An event guest list: name, RSVP status (enum), plus-ones; a computed head count.", tags: ["enum", "computed"] },
  { id: "trips", description: "Trips with a destination, start/end dates, and a computed number of nights.", tags: ["datetime", "computed"] },
  { id: "bookmarks", description: "Bookmarks with a title, url, and tags; a list grouped feel with badges.", tags: ["url", "tags"] },
  { id: "pantry", description: "A pantry: ingredients with quantity and a 'low stock' computed flag; a list filtered to low stock.", tags: ["computed", "filter"] },
  { id: "gym-prs", description: "Track personal records per exercise, with an action to log a new PR that updates the record.", tags: ["action", "relation"] },
];
