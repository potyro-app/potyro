// The "wild" eval corpus — the market-test counterpart to `prompts.ts`.
//
// PROVENANCE (read this before quoting any number from a run against it):
//   `prompts.ts` is a FEATURE-COVERAGE matrix. Its ids mirror our own examples (recipes, plants,
//   places, workouts) and its tags are Potyro surface areas (nested-list, computed, geo). It answers
//   "does the generator cover what we built" — a regression suite, and biased toward passing.
//
//   This file answers a different question: "does the generator survive what people actually ask
//   for?" The prompts are written in end-user voice — vague, over-stuffed, occasionally demanding
//   things Potyro may not support at all. Several are here PRECISELY because we expect them to fail;
//   the failure boundary is the finding, not a defect in the corpus.
//
//   These are AUTHOR-WRITTEN in a realistic register, not scraped from real posts. Categories are
//   anchored to observed demand (habit/subscription/finance tracking, "when did I last do X"
//   life-logging, home inventory), but nobody should call this a demand sample until real harvested
//   asks replace them. Keep `source: "authored"` honest — flip entries to "harvested" as they are
//   replaced with verbatim user posts, and report the two subsets separately.

import type { GenPrompt } from "./backend.js";

export interface WildPrompt extends GenPrompt {
  /** Where the wording came from. Only "harvested" entries count as a demand sample. */
  source: "authored" | "harvested";
  /** What we suspect the runtime cannot express. Diagnosis aid — never a reason to drop a prompt. */
  risk?: string;
}

export const WILD_PROMPTS: WildPrompt[] = [
  {
    id: "car-maintenance",
    source: "authored",
    description:
      "I want to keep track of my car — oil changes, tire rotations, that kind of thing. I want to see when I last did each one and get told when something's due, based on mileage not dates.",
    tags: ["vehicle", "maintenance"],
    risk: "reminders keyed to an odometer reading rather than a date",
  },
  {
    id: "last-did",
    source: "authored",
    description:
      "Something to remember when I last did stuff — called my mum, watered the plants, changed the water filter, descaled the kettle. I just want to tap the thing and have it record today's date.",
    tags: ["life-logging", "one-tap"],
    risk: "one-tap action that stamps now onto an existing record",
  },
  {
    id: "subscriptions-trials",
    source: "authored",
    description:
      "Track all my subscriptions so I can see what I'm actually paying per month and per year, and warn me before a free trial converts.",
    tags: ["finance", "reminder"],
  },
  {
    id: "meds",
    source: "authored",
    description:
      "Remind me to take my medication twice a day, morning and evening, and let me tick each one off so I can look back and see if I missed any.",
    tags: ["health", "recurring"],
    risk: "recurring intra-day schedule + per-occurrence adherence history",
  },
  {
    id: "baby-log",
    source: "authored",
    description:
      "Track my newborn's feeds, nappies and sleep. Logging has to be fast because I'm doing it one-handed at 3am, and the main thing I need on screen is how long it's been since the last feed.",
    tags: ["health", "one-tap"],
    risk: "live elapsed-time display; speed-of-entry is the actual requirement",
  },
  {
    id: "mood-chart",
    source: "authored",
    description:
      "A mood journal — I rate the day out of 10 and write a couple of lines. I want to see a chart of the last month so I can spot patterns.",
    tags: ["journal", "visualisation"],
    risk: "charting — no chart view type exists",
  },
  {
    id: "groceries-aisle",
    source: "authored",
    description:
      "A shopping list that remembers the stuff I buy every week so I can re-add it in one tap, and groups everything by aisle so I'm not zig-zagging round the shop.",
    tags: ["shopping", "grouping"],
    risk: "grouped list rendering; re-add-from-history",
  },
  {
    id: "climbing",
    source: "authored",
    description:
      "Log my climbing sessions — which routes I tried, the grade, and whether I actually sent it or not. I'd like to see my hardest send this month.",
    tags: ["fitness", "aggregate"],
  },
  {
    id: "freelance-hours",
    source: "authored",
    description:
      "Track hours I work for different clients, each with their own hourly rate, so at the end of the month I know exactly what to invoice each of them.",
    tags: ["work", "money"],
  },
  {
    id: "wine-notes",
    source: "authored",
    description:
      "Keep notes on wines I've tried — a photo of the label, what I paid, and whether I'd buy it again. I want to be able to search by grape.",
    tags: ["collection", "media"],
    risk: "free-text search across records",
  },
  {
    id: "job-applications",
    source: "authored",
    description:
      "Track job applications: company, role, when I applied and what stage I'm at. Nudge me if I haven't heard anything back in two weeks.",
    tags: ["work", "reminder"],
  },
  {
    id: "gift-ideas",
    source: "authored",
    description:
      "A place to jot down gift ideas for people as I think of them, with everyone's birthday, and a reminder two weeks before so I actually have time to order something.",
    tags: ["social", "reminder"],
    risk: "annually recurring reminder derived from a birthday",
  },
  {
    id: "home-inventory",
    source: "authored",
    description:
      "Photograph everything I own for insurance purposes — what I paid, when I bought it, which room it's in — and total it up per room.",
    tags: ["inventory", "media"],
    risk: "aggregate grouped by a field value",
  },
  {
    id: "meal-plan",
    source: "authored",
    description:
      "Plan what we're eating each night of the week, then give me the shopping list for it automatically from the recipes.",
    tags: ["food", "derivation"],
    risk: "deriving one entity's contents from a set of related records",
  },
  {
    id: "sleep",
    source: "authored",
    description:
      "Log what time I go to bed and what time I get up, and show me my average over the past week.",
    tags: ["health", "aggregate"],
  },
  {
    id: "dog-health",
    source: "authored",
    description:
      "Keep track of my dog's vet visits, vaccinations and his weight over time, and remind me when the next jab is due.",
    tags: ["pets", "reminder"],
    risk: "a measurement series over time on one record",
  },
  {
    id: "vocab-quiz",
    source: "authored",
    description:
      "Help me learn Portuguese vocabulary — I add words with translations and it quizzes me, showing me more often the ones I keep getting wrong.",
    tags: ["learning", "interactive"],
    risk: "interactive drill loop + spaced repetition scheduling",
  },
  {
    id: "flatmate-split",
    source: "authored",
    description:
      "Split shared expenses with my two flatmates — who paid for what — and work out who owes who at the end of the month.",
    tags: ["finance", "derivation"],
    risk: "pairwise balance computed across all records, not per-record",
  },
  {
    id: "water-intake",
    source: "authored",
    description:
      "Let me tap a glass icon every time I drink water and show how close I am to two litres today. That's it.",
    tags: ["health", "one-tap"],
    risk: "today-scoped running total against a goal",
  },
  {
    id: "book-club",
    source: "authored",
    description:
      "Track what my book club is reading, who picked each book, what everyone rated it out of five, and the average score.",
    tags: ["social", "relation"],
  },
  {
    id: "seed-planting",
    source: "authored",
    description:
      "Note down when I planted what and in which bed, and roughly when I should expect to harvest it. I'd like to see it on a calendar.",
    tags: ["garden", "calendar"],
  },
  {
    id: "podcast-queue",
    source: "authored",
    description:
      "A queue of podcast episodes people have recommended to me — who recommended it, how long it is, and whether I've listened. Show me something short when I've only got 20 minutes.",
    tags: ["media", "filter"],
    risk: "filtering by a user-supplied threshold at view time",
  },
  {
    id: "houseplant-rescue",
    source: "authored",
    description:
      "I keep killing my plants. I need to know which one needs water today, and I want it to be obvious the second I open the app.",
    tags: ["garden", "reminder"],
    risk: "the ask is a prioritised 'what needs me now' home screen, not a list",
  },
  {
    id: "car-boot-sale",
    source: "authored",
    description:
      "I sell bits at car boot sales. I need to track what I bought something for, what I sold it for, and whether I'm actually making any money overall.",
    tags: ["money", "aggregate"],
    risk: "cross-record profit aggregate",
  },
  // Ten requests for apps that exist nowhere in the gallery, the examples or the Studio's corpus (2026-10-31):
  // the measurement of what a stranger's own idea costs and how often it passes first try, as opposed to
  // the ideas above, which mirror apps the model has seen passages of.
  {
    id: "beehives",
    source: "authored",
    description:
      "I keep three beehives. After each inspection I want to note per hive whether I saw the queen, how many frames of brood, any mites, and what I harvested. Show me each hive's history and when I last opened it.",
    tags: ["log", "per-item"],
  },
  {
    id: "chore-rota",
    source: "authored",
    description:
      "A chore rota for our flat: three of us, five chores, rotating every week so nobody does the same thing twice in a row. Show who does what this week and let us tick chores off.",
    tags: ["rota", "rotation"],
  },
  {
    id: "reading-minutes",
    source: "authored",
    description:
      "My daughter's school wants 20 minutes of reading a day. Let her log what she read and for how long, show the week's total against the target, and keep a list of books she finished.",
    tags: ["kids", "target"],
  },
  {
    id: "lent-out",
    source: "authored",
    description:
      "Who has my stuff: I lend books, tools and board games and forget. Record what I lent, to whom, when, and mark it returned. Show what's still out, oldest first.",
    tags: ["lending"],
  },
  {
    id: "sourdough",
    source: "authored",
    description:
      "A log for my sourdough starter: each feeding with the flour and ratio, how it rose, and remind me when the next feeding is due based on the interval I set.",
    tags: ["reminder", "interval"],
  },
  {
    id: "insurance-inventory",
    source: "authored",
    description:
      "A home inventory for insurance: each item with a photo, the room, what I paid and the receipt. I want the total value per room and overall.",
    tags: ["photo", "totals"],
  },
  {
    id: "bird-list",
    source: "authored",
    description:
      "A birdwatching life list: species, where and when I first saw it, a photo if I got one. Show how many new species I added each month and let me search by name.",
    tags: ["list", "monthly"],
  },
  {
    id: "vocab-trainer",
    source: "authored",
    description:
      "Help me learn Italian words: I add a word and its meaning, then quiz me on the ones that are due, and space them out further each time I get one right.",
    tags: ["spaced-repetition", "quiz"],
  },
  {
    id: "fuel-log",
    source: "authored",
    description:
      "Every time I fill up the car I want to enter litres, price and the odometer, and see my consumption per 100 km and what I spent this month.",
    tags: ["computed", "vehicle"],
  },
  {
    id: "allotment",
    source: "authored",
    description:
      "Plan my allotment: six beds, what I planted in each and when, and when I expect to harvest. Show what's due to harvest in the next two weeks.",
    tags: ["planner", "dates"],
  },

];
