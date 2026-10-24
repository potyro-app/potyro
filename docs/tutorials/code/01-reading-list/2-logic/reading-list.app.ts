// Reading list — the app built in docs/tutorials/01-your-first-app.md, at the end (step 5).
import { defineApp } from "potyro";

/** "Ursula K. Le Guin · ★★★★☆": the line under a book, from its author and rating. */
export function lineOf(author: unknown, rating: unknown): string {
  const stars = Number(rating) > 0 ? "★".repeat(Number(rating)) + "☆".repeat(5 - Number(rating)) : "";
  return [String(author ?? "").trim(), stars].filter(Boolean).join(" · ");
}

/** A date field's value as a number to sort by; a book with no date sorts last. */
const time = (value: unknown): number => (value ? new Date(value as string).getTime() : 0);

export default defineApp({
  id: "reading-list",
  name: "Reading list",
  icon: "book-open",
  version: "0.2.0",
  schemaVersion: 1,
  language: "en",
  theme: { accent: "#B4532A" },

  entities: {
    book: {
      label: "Book",
      icon: "book",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Title", placeholder: "The Dispossessed" },
        author: { type: "text", label: "Author" },
        status: {
          type: "enum",
          options: ["want", "reading", "read"],
          labels: { want: "Want to read", reading: "Reading", read: "Read" },
          colors: { want: "grey", reading: "blue", read: "green" },
          default: "want",
          label: "Status",
        },
        rating: { type: "number", integer: true, min: 1, max: 5, label: "Rating" },
        finished: { type: "datetime", label: "Finished on" },
        notes: { type: "text", multiline: true, label: "Notes" },
      },
      computed: {
        line: { label: "Author", value: (book) => lineOf(book.author, book.rating) },
      },
      actions: {
        finish: {
          label: "Finished it",
          icon: "check",
          run: async (book, ctx) => {
            // Ask for a rating; the person may close the sheet without one (null).
            const stars = await ctx.ui.sheet({
              title: "How was it?",
              items: [5, 4, 3, 2, 1].map((n) => ({ id: n, label: "★".repeat(n) })),
            });
            await ctx.patch("book", book.id, {
              status: "read",
              finished: ctx.today(),
              ...(stars ? { rating: stars } : {}),
            });
            ctx.ui.toast(`${book.title} is on your Read shelf`);
          },
        },
      },
    },
  },

  pages: [
    {
      id: "shelf",
      title: "To read",
      icon: "book-open",
      view: {
        type: "list",
        entity: "book",
        filter: (book) => book.status !== "read",
        // What you are reading now comes first, then the rest by title.
        sort: (a, b) => Number(b.status === "reading") - Number(a.status === "reading") || String(a.title).localeCompare(String(b.title)),
        display: { primary: "title", secondary: "line", badges: ["status"] },
        rowActions: ["finish"],
        emptyText: "No books waiting. Add one you want to read.",
        onOpen: { page: "book", param: { bookId: "id" } },
      },
    },
    {
      id: "read",
      title: "Read",
      icon: "book-check",
      view: {
        type: "list",
        entity: "book",
        filter: (book) => book.status === "read",
        sort: (a, b) => time(b.finished) - time(a.finished),
        display: { primary: "title", secondary: "line" },
        emptyText: "Nothing finished yet.",
        onOpen: { page: "book", param: { bookId: "id" } },
      },
    },
    {
      id: "book",
      title: "Book",
      hidden: true,
      view: {
        type: "detail",
        entity: "book",
        param: "bookId",
        actions: ["finish"],
        sections: [{ fields: ["author", "status", "rating", "finished"] }, { title: "Notes", fields: ["notes"] }],
      },
    },
  ],
});
