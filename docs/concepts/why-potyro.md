---
title: Why Potyro
description: The problem personal apps have, the one idea Potyro is built on, what it is not, and the principles that decide how it behaves.
section: concepts
order: 6
---

# Why Potyro

A small personal app should be one file you write in an afternoon, run offline, and hand to a
friend. Potyro exists to make that true.

## The problem

The same shape of app recurs. A few kinds of typed records, a few views, a computed value or two,
a quick action, a reminder. A plant diary. A recipe box with calories. Places you want to
go back to.

Today you get one of two things. A no-code tool gives you the records and the views, then stops at
the first formula it did not foresee. Its "expression language" grows variables, conditions and
loops one release at a time and never becomes a real one. Or you start a project: a framework, a
database, a build, hosting, accounts. The app is three screens and the project is three weeks.

Neither treats the thing as what it is, which is a small program.

## The idea

An app is one TypeScript module. Its **shape**, the entities, fields and pages, is declared as data,
and from that data Potyro derives storage, forms, validation and migrations. Its **logic** is
ordinary functions. A filter is a function. A formula is a function. A screen you draw yourself is
a function returning React.

There is no expression language, because every safe little language ends up reinventing a worse
TypeScript. What Potyro controls instead is independent of the language:

- **The capability surface.** Everything an app can reach is on `ctx`, one object handed to every
  function. Power is the richness of `ctx`.
- **The execution boundary.** Where a function runs, and with what authority, is Potyro's choice
  per app. Safety is the boundary.

Power and safety are different axes. The same source runs direct when it is yours and sealed when
it is not, and the code does not know which.

## What Potyro is not

- **Not a no-code builder.** There is no drag-and-drop canvas. The file is the app. The Studio
  writes the file for people who do not code, but what it writes is the same TypeScript you would.
- **Not a DSL.** Nothing is interpreted. Your functions run as JavaScript, with imports, types and a
  debugger.
- **Not a hosted service.** Potyro runs in your browser and on your phone. Records stay on the
  device. The servers that exist store encrypted data they cannot read, or forward messages they do
  not keep.
- **Not a database for a company.** Personal scale, thousands of records and not millions. A
  filter is a function over an array, and that is fast enough.

## The principles

These decide how Potyro behaves when two good options conflict.

**Offline first.** Nothing in the runtime needs the network. Sync is per app and off until you
turn it on. A person who never syncs never touches a server.

**Data stays on the device.** Records live in the app's own database on your device. When you
share, the data is encrypted to the people you chose before it leaves. See
[Data and sync](data-and-sync.md).

**Provenance decides execution.** Your own app has your full authority. An app from anyone else is
sealed, with nothing until it asks and you agree. A link can never make an app trusted; only you
can, deliberately. See [Your apps and other people's apps](trusted-and-sealed.md).

**`ctx` grows instead of a language.** When apps need something new, a camera, a live connection, a
model, it becomes a member of `ctx`. A permission sits beside it. Nothing is added to a grammar.
We would rather give app code more power through a cleaner `ctx` than less power through
restriction.

**Shape is validated, logic is run.** The declarative parts are checked against a schema. The
functions are typed, then run somewhere safe. We do not try to validate code, because it cannot
be done.

**Every shared link is a working demo.** Someone who opens your link sees the app running, with
sample records, before installing anything. See [Sharing](sharing.md).

## Where that leaves you

You write a file. You build it into a zip and install it, or you describe it to the Studio. It runs
on your phone with no server. When it is good, you share a link. The person on the other end sees
it working before they trust you with anything. If they like it, they make it theirs and
change it.

## Next

- [Introduction](../start/introduction.md): an app in one file, and how to run it.
- [How an app is put together](how-an-app-is-put-together.md): the model in detail.
- [Your apps and other people's apps](trusted-and-sealed.md): the boundary that makes sharing safe.
