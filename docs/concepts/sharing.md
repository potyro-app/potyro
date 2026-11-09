---
title: Sharing
description: What a shared link gives the other person, how Make it mine and credit work, and how an app links to a page or to a single record.
section: concepts
order: 4
---

# Sharing

Every shared link to a Potyro app is a working demo. The other person sees the app running, with
sample records, before deciding anything.

"Share" means three things in Potyro, and the share sheet separates them:

| What you share | What the other person gets |
|---|---|
| **A link anyone can try** | the app, running, with sample records; nothing of yours |
| **Use it together** | the app and its records, live, with you |
| **A live session** | a room other members' messages flow through, right now |

This page is about the first. The second is [Data and sync](data-and-sync.md) and
[Working together](../guides/working-together.md). The third is the rooms capability in
[`ctx.caps.network`](../reference/ctx-caps-network.md).

## A link anyone can try

Whoever opens the link sees the app at once, in the browser, with no install, no account and no
consent wall. The app runs sealed, as an app from someone else always does, in the viewer's
language. One bar sits at the bottom: **Made with Potyro · Make it mine · Keep this app**.

The link carries a package: the source, the app's own modules and its lock, the files it ships
with, and **sample records**. Your records are never read when the link is made. The sample records
are the ones the app's package came with, or the ones the Studio made when the app was created.
When there are none, the app opens empty and the share sheet says so. An app that lives on a feed
can declare a `demo` function instead, which plays when a demo opens.

The package travels encrypted, with the key in the link's fragment. The service that hosts it sees
the title, the one-line description and the preview image you made public. It sees nothing else.

A permission is asked for only when the app reaches for a capability. A library is fetched only
after the person agrees. Both go through the prompts every sealed app gets.

## Keep this app, or Make it mine

**Keep this app** installs it sealed, through the same card as any install. A link never counts as
"I wrote this"; the person can let it run as theirs later.

**Make it mine** makes a copy that is the person's own app, beside anything they have. It keeps
the sample records unless they untick it, and opens in the Studio ready to change. The copy is
still sealed until its owner lets it run as theirs. Make it mine is also on the menu of any sealed
app already on the device. It copies the app's code, shipped files and sample records, never the
records in its store.

## Credit and remix

A package may say who made the app. Your name goes on a link only when you have set one in Potyro.
You can untick "Say it is by <name>" on the share sheet.

A remix remembers what it remixed. Its tile and the Studio's greeting say "Remix of Groceries by
Ana". When the remix is shared in turn, its credit carries the chain. A remix of an app that
named nobody still says what it is a remix of.

## A link into a page

An app can make a link that opens one of its pages with parameters. A game's invite, for example,
lands on the join page with the code filled in.

```ts
// the page declares what a link may set
{ id: "join", title: "Join", link: { params: ["code"] }, view: { ... } }

// the app makes the link
await ctx.ui.share({ text: "Join my game", app: { page: "join", params: { code } } });
```

The page receives the values as `ctx.params`. Nothing runs because of a link; the page fills in the
code and waits for the person. If the person already has the app, the link opens their own copy on
that page. If not, it opens the demo the link carries, and keeping the app lands them on that page.
A parameter the page does not declare is dropped.

## Sharing a single record

"Use it together" shares a whole app. For a document, the unit is one record. An entity declared
`share: "record"` makes each of its records shareable by its own link:

```ts
entities: {
  doc: { share: "record", fields: { title: { type: "text" }, body: { type: "text", collaborative: true } } },
  comment: { fields: { doc: { type: "relation", to: "doc" }, text: { type: "text" } } },
},
```

```ts
await ctx.ui.share({ text: "Have a look", record: { entity: "doc", id: doc.id, role: "reader" } });
```

Whoever opens the link gets that record live, and the records that point at it, such as a
document's comments. Nothing else of the app's comes with it. `role` is `"writer"` by default, or
`"reader"`. Only the record's maker, or an admin of the app, can make such a link. `ctx.access(entity, id)`
tells the app what this device may do with a record, so it can hide what a reader cannot press.

A person who has the app joins the record in their own copy. Anyone else opens it sealed, in a
viewer that writes back live, and can keep the app from there.

Treat a record's link as you would the document. It cannot be taken back.

## The gallery

The gallery is a curated page of apps to try and remix. Every card has **Try it**, a demo link, and
**Make it mine**. It is one tap from **Add an app → From the gallery**, and from the Studio when no
model is set up. Make it mine from the gallery needs no key and no account.

## Next

- [Working together](../guides/working-together.md): inviting people into an app's data.
- [`ctx` reference](../reference/ctx.md): `ctx.ui.share` and `ctx.access` in full.
- [Your apps and other people's apps](trusted-and-sealed.md): what a kept app may do.
