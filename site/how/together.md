---
title: Together, in real time.
lead: Invite a friend with a link. You both change the same app and see each other's changes as they happen. Nobody creates an account.
description: How two phones share one app in real time without accounts, how their changes merge, what is encrypted, and what the relay can see.
---

## How it starts

In an app, **Share**, then **Use it together**. Potyro copies the app's records into a shared space
first, then gives you a link. Your friend opens it, chooses a name to be called, and is in. The link
carries the key, so anyone who has it is in: send it to the people you mean.

## How two phones agree

Each change is a small update. Your phone keeps the log of them and so does your friend's, and the
two logs merge without a central copy that decides. Two people editing different fields of the same
record both keep their change. Two people adding to the same list both see both. Offline, your
changes wait and merge when you are back. The engine behind this is cojson, the CRDT library of
Jazz; a CRDT is a kind of data that merges without conflicts by construction.

## Encrypted on your phone

Updates are encrypted on your phone to the people in the space. They pass through a relay that
stores and forwards them and cannot read them. What the relay can see is which accounts share which
spaces, and when they are active.

## Worth knowing

A friend's app still runs in the safe box on your phone: being in someone's data says nothing about
running their code. The link is the whole key, so one link cannot be taken back without re-keying
the space. Games and drawing together use a different, live channel, a rooms relay, which sees
those frames as they pass and keeps none of them.

## Go deeper

- [Data and sync](docs/concepts/data-and-sync.md): spaces, roles, and what two people editing at once does
- [Working together](docs/guides/working-together.md): turning sync on, inviting people, collaborative text
- [Your apps and other people's apps](docs/concepts/trusted-and-sealed.md): what the servers can and cannot see
