---
title: Data and sync
description: Where an app's records live, what happens when you turn on sync, and what changes when two people edit at once.
section: concepts
order: 3
---

# Data and sync

An app's records stay on your device. Nothing leaves it until you turn on sync for that app, and
then only the people you invite can read it.

## On the device

Each app has its own database on the device, in the browser's private storage. Records, photos,
files and the app's own settings (`ctx.storage`) all live there. The app reads and writes them
through `ctx`; it never sees the database itself.

Adding a field to an entity is not a database change. Existing records simply have no value for it
until something writes one. Changing or removing fields is covered in
[Changing an app that has data](../guides/changing-an-app-with-data.md).

## Turning on sync

Sync is per app. An app with sync off has no identity, no network and no sync engine loaded.

When you turn it on, the app's data moves into a **space**: a group of people with roles, each of
whom holds a key to the data. Potyro copies the existing records into the space, keeps the local
copy until the copy succeeds, and only then switches over. Turning sync on never loses what you had.

Everything in a space is encrypted to its members before it leaves the device. It travels through a
relay server that stores and forwards the updates and cannot read any of them. A space with one
member, you on two devices, still works the same way.

You are identified by an account created silently the first time Potyro runs. There is no signup
and no email. To use a second device, you enter your recovery words there, and the account's apps
arrive through the relay.

## People in a space

A member has one of three roles: `admin`, `writer` or `reader`. Your app sees them:

```ts
ctx.me                              // you: id and display name
ctx.space?.members ?? [ctx.me]      // every member with their role; just you when the app is solo
```

Every record remembers who created it in `createdBy`. Potyro stamps it, and an app cannot forge it.
A `member` field type lets a record point at one of the space's members, for things like "who paid"
or "assigned to".

## Two people editing at once

Two people can change the same record while offline. When their devices meet, each field keeps the
latest change made to it. Editing different fields of one record never conflicts. Editing the same
field keeps the later edit.

Two patterns do not survive this, and both are easy to write by accident:

- **Read, add, write back.** A `+1` button that reads the count and writes `count + 1` loses presses
  when two people tap together. Use `ctx.increment(entity, id, field, delta)` instead; the deltas
  from everyone are summed.
- **Swapping values across records.** Reordering two rows by exchanging their `order` values is two
  writes that another device may interleave. Give each row its own position value, and move a row by
  setting only its own.

A text field declared `collaborative: true` is merged character by character, so two people can
type in the same note at the same moment without losing each other's words.

Before an app is shared for the first time, Potyro runs it as two devices editing at once and
reports what would not survive. You can share anyway, but you know what to fix.

## Code trust and people trust are separate

Being in someone's space says nothing about their code. An app a friend sends you runs sealed, in a
sandbox, even when you share data with that friend every day. See
[Your apps and other people's apps](trusted-and-sealed.md).

## Next

- [Working together](../guides/working-together.md): inviting people, guests, and collaborative
  text in practice.
- [Sharing an app](sharing.md): demo links, Make it mine, and links into a page or a record.
