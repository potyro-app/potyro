---
title: Introduction
description: What Potyro is, what an app looks like, and how to run your first one.
section: start
order: 0
---

# Introduction

Potyro runs small personal apps on your phone and computer: a reading list, a plant diary, a shared
shopping list. An app is one TypeScript file. It works offline, keeps its data on your device, and
can be shared with other people when you choose.

## An app in one file

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "books",
  name: "Books",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    book: {
      label: "Book",
      displayField: "title",
      fields: {
        title: { type: "text", required: true, label: "Title" },
        author: { type: "text", label: "Author" },
        read: { type: "boolean", label: "Read", default: false },
      },
      actions: {
        markRead: {
          label: "Mark as read",
          run: async (book, ctx) => {
            await ctx.patch("book", book.id, { read: true });
            ctx.ui.toast(`Finished ${book.title}`);
          },
        },
      },
    },
  },
  pages: [
    { id: "to-read", title: "To read", view: { type: "list", entity: "book", filter: (b) => !b.read, rowActions: ["markRead"] } },
    { id: "finished", title: "Finished", view: { type: "list", entity: "book", filter: (b) => b.read } },
  ],
});
```

Three things make up every app:

- **What it keeps.** Entities and their fields, declared as data. Potyro stores the records and
  draws the forms.
- **What it shows.** Pages, each a view of some records: a list, a detail page, a gallery, a
  calendar, or a view you draw yourself.
- **What it does.** Plain functions. Each one receives `ctx`, the one object through which an app
  reaches its data, the person, the screen and the device.

There is no expression language and no visual builder. If you can write a TypeScript function, you
can write the logic of a Potyro app.

## Run it

You need Node 20 or newer and Potyro open in a browser at [potyro.app](https://potyro.app).

```sh
npm create potyro@latest books
cd books
npm install
npm run build        # → dist/books.potyro-app.zip
```

In Potyro, choose **Add an app → From this device** and pick the zip. The app opens with its two
pages, and you can add a book. Edit the file, build again, and replace the app to see your change.

## Your apps and other people's apps

An app you wrote runs with direct access to your device. An app that came from someone else runs
sealed: in a sandbox, with no access to anything until it asks and you agree. You can install any
shared app and try it without trusting its author.

## Next

- [Your first app](your-first-app.md) builds a reading list step by step, in about fifteen minutes.
- [How an app is put together](../concepts/how-an-app-is-put-together.md) explains the model behind
  the file above.
- [The `ctx` reference](../reference/ctx.md) lists everything a function can do.
