---
title: Your data, your rules.
lead: Everything an app keeps is on your phone. Nothing leaves it unless you decide to share it, use it with someone, or ask a model.
description: Where a Potyro app keeps its records, what can leave your phone and when, what our servers can see, and what is not protected.
---

## Where your data is

Each app keeps its records in a database of its own on your phone, in the browser's private
storage. There is no Potyro account, and no Potyro server holds your records. Open an app with no
signal and it works the same, because nothing in it needs a connection.

## What leaves your phone, and when

Three things can send data out. Each is a choice you make, app by app:

- **Sharing a link.** A link anyone can try carries the app and its sample records, never yours.
  [Easy to share](/how/share/) says what each kind of link carries.
- **Using an app together.** When you invite someone into an app, its records are encrypted on your
  phone and pass through a relay that stores what it cannot read. The people in the app hold the
  keys. [Together, in real time](/how/together/).
- **Asking a model.** An app that uses AI sends only what it names, a photo or some text, and an
  app someone else made asks you first. [Apps that use AI](/how/ai/).

Everything else stays where it is.

## What we can see

The relay that carries shared apps can see which accounts share which apps and when they are
active, not what is in them. The service behind share links sees a link's title, its line and its
preview picture, which you chose to make public. The free AI relay sees what an app sends to the
model. With your own key, a request goes from your phone to your provider and never touches us.

## What this does not protect

Your own apps run with your full authority: run an app as yours only if you would run its code. A
link to a record is the record: whoever has the link can read it, and taking a link back is not
built yet.

## Go deeper

- [Data and sync](docs/concepts/data-and-sync.md): where records live, and what turning sync on does
- [Your apps and other people's apps](docs/concepts/trusted-and-sealed.md): what the servers can see, and what is not protected
- [Look inside any app](/how/database/): your data as tables, and how to take it out
