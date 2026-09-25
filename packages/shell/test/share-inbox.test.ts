// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { bestFits, handShareTo, peekShare, rememberShare, takeAskMaterial } from "../src/share-inbox.js";

// Text shared into Karta from another app (#213): kept for this session, offered to an app — the best
// fits first, judged on this device from each app's own words — and handed to that app's Ask.

beforeEach(() => sessionStorage.clear());

describe("the share inbox", () => {
  it("keeps a share until it is handed to an app, and hands it only to that app's Ask", () => {
    rememberShare({ text: "1. Bench press 4×6" });
    expect(peekShare()?.text).toBe("1. Bench press 4×6");
    handShareTo("workout");
    expect(peekShare()).toBeNull();
    expect(takeAskMaterial("recipes")).toBeNull();
    expect(takeAskMaterial("workout")).toEqual({ label: "what you shared", text: "1. Bench press 4×6" });
    expect(takeAskMaterial("workout")).toBeNull();
  });
});

describe("bestFits", () => {
  const apps = [
    { id: "workout", name: "PPL Log", source: 'entities: { exercise: { label: "Exercise", fields: { name: {}, day: { options: ["push","pull","legs"] }, targetSets: {}, repRange: {}, restSec: { label: "Rest" } } }, session: {} }' },
    { id: "recipes", name: "Recipes", source: 'entities: { recipe: { fields: { name: {}, ingredients: {}, steps: {}, servings: {} } }, ingredient: { label: "Ingredient" } }' },
    { id: "books", name: "Reading list", source: 'entities: { book: { label: "Book", fields: { title: { type: "text" }, author: { type: "text" }, year: { type: "number" }, genre: { type: "enum" } } } }' },
  ];

  it("ranks the app whose own words the text uses", () => {
    const ppl = "Push day: Bench Press 4 sets of 6-8 reps, rest 2 min. Pull day: Deadlift 3 sets of 5.";
    expect(bestFits(apps, ppl)[0]).toBe("workout");
    const books = "A few books to start with: The Leopard, by Tomasi di Lampedusa (1958); Invisible Cities, author Italo Calvino.";
    expect(bestFits(apps, books)[0]).toBe("books");
  });

  it("suggests nothing when no app fits", () => {
    expect(bestFits(apps, "hello there, how are you today?")).toEqual([]);
  });
});
