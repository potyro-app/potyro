---
title: Potyro for developers
lead: One TypeScript module per app, one door to the host, and where code runs decided by where it came from. Open source under Apache-2.0.
description: What Potyro is for a developer: the shape of an app, the packages, what works today, how to write an app, and the repository.
---

## What works today

- Apps on the phone that work offline: records in SQLite in the browser's private storage, one database per app.
- Apps from other people run sealed: a Worker in a sandboxed frame, host power only through a mediated `ctx`, capabilities asked for, a watchdog.
- Sync between devices and people, opt-in per app, end-to-end encrypted, through a relay that stores what it cannot read.
- Demo links that open a working copy with sample records, and Make it mine for a copy of your own.
- The Studio: a model writes and changes apps under gates, with seven engines, a free allowance first.
- Six languages, a web app you can install, and Android through Capacitor.
- The repository, public, under Apache-2.0.

## The shape of an app

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "recipes",
  name: "Recipes",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    ingredient: {
      label: "Ingredient",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        caloriesPer100: { type: "number", min: 0, label: "Calories per 100 g" },
      },
    },
  },
  // pages, computed values, actions, reminders and custom views follow: plain data for the shape,
  // ordinary functions that receive `ctx` for everything that happens.
});
```

The data shape is plain data, validated. The logic is ordinary functions that receive `ctx`: data,
time, storage, files, the person, the UI, navigation and the device's capabilities. There is no
expression language and no visual builder. Growing Potyro means growing `ctx`.

## The packages

{{package-map}}

A package is a seam: it exports an interface, and the packages above it depend on that interface,
never on another package's internals. [How Potyro works](docs/00-how-potyro-works.md) walks through
them, lowest first.

## Write an app

```sh
npm create potyro@latest my-app     # a project with an app in it
npm run build                       # → dist/my-app.potyro-app.zip, for Add an app → From this device
```

- [Your first Potyro app](docs/tutorials/01-your-first-app.md): a reading list, in fifteen minutes.
- [App module API](docs/04-app-module-api.md): `defineApp` and `ctx`, member by member.
- [Runtime interfaces](docs/05-runtime-interfaces.md): the contracts at the seams.

## The repository

[github.com/potyro-app/potyro](https://github.com/potyro-app/potyro), Apache-2.0. `CONTRIBUTING.md`
says how a change is checked and shipped; `SECURITY.md` says how to report a hole privately;
`CLAUDE.md` is the working agreement for the agents that build it.

## Contact

[contact@potyro.com](mailto:contact@potyro.com), or an issue on the repository.
