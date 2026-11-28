---
title: The gallery on the fediverse
description: The gallery's ActivityPub account: what it posts, what it keeps, what it ignores, how its requests are signed and checked, and why ActivityPub is used here and nowhere else in Potyro.
status: current
order: 33
---

# The gallery on the fediverse

Status: built (`packages/fediverse`, the feed in `gallery/src/feed.mjs`), **not yet deployed**. The
deployment is docs/16 "The gallery's fediverse account".

The gallery (docs/24 §10) is a page someone has to come back to. This gives it an account,
**`@apps@potyro.com`**, that people follow from Mastodon or any other fediverse server: each app the
gallery publishes arrives in their timeline as a post, with its picture, **Try it** and **Make it
mine**. Replies and boosts happen on their servers, among their people. Potyro builds no accounts,
no feed and no comments for it.

## Where ActivityPub is used, and where it is not

Only here: a public, one-way announcement of something that is already public. It is not a way to
sync, share or collaborate. Those stay on cojson, through the Store (CLAUDE.md, hard rule 7):
ActivityPub has no conflict resolution, no end-to-end encryption and needs a server that is always
there, which is the opposite of an app's data. Nothing in the shell, the runtime, the host or an app
knows this service exists, and it depends on no Potyro package.

## What it is made of

```
gallery/gallery.json ── pnpm site:build ──▶ /srv/potyro.com/apps/feed.json
                                                    │ read every minute
                                                    ▼
other servers ◀── signed Create / Update / Delete ── packages/fediverse (port 4207)
              ─── signed Follow / Undo ───────────▶   key.pem, followers.json,
                                                       notes.json, outgoing.json
```

**The feed** (`potyro-gallery-feed/1`) is one file the gallery build and the site build write beside
the gallery's page: each published app's id, name and line in the six languages, its demo link and
Make-it-mine link, when the link was made, and one picture (the English, light, 824 px WebP). It is
the only thing the service reads from Potyro, and it checks it again as it reads it
(`packages/fediverse/src/feed.ts`): a feed with any problem is refused whole. A feed with no apps is
a problem, so a broken build can never take every post down.

**The service** compares the feed with what it has posted:

| The gallery | The account |
|---|---|
| publishes an app | `Create` of a `Note`: name, line, the two links, the picture; every language in `contentMap`, English first |
| changes its words, its link or its picture | `Update` of the same note |
| drops it | `Delete`; the note's address answers 410 from then on |

The first time it runs, the notes take the gallery's own dates and go to nobody, even to someone who
followed before there was a feed: nobody is sent the whole gallery at once. After that a note is
dated when it is posted, so it arrives as new.

A feed that drops more than half of what is posted (and more than one app) is refused too, and says
so in the log: a broken build looks like that. To really take many apps out, take them out a few at
a time.

## Addresses

All on the gallery's own name, under `/fedi/`, plus webfinger. They are built on `FEDI_ORIGIN` and
`FEDI_USERNAME`, and **neither can change once anyone follows**: other servers know the account by
these addresses and by its key.

| | |
|---|---|
| `GET /.well-known/webfinger?resource=acct:apps@potyro.com` | who the account is |
| `GET /fedi/actor` | the account: a `Service` (shown as automated), its inbox, its public key |
| `GET /fedi/outbox` | every post, newest first |
| `GET /fedi/followers` | how many follow. Never who |
| `GET /fedi/notes/<app>`, `…/activity` | one post, and the `Create` that carried it |
| `POST /fedi/inbox` | what other servers send |
| `GET /fedi/health` | `{"ok":true,"posts":N}` |

A person's browser asking for the account or a post is redirected to the gallery's page. The
account has no pages of its own.

## What it keeps, and what it never keeps

In `FEDI_DATA_DIR`, readable by the service only:

- `key.pem`: the account's private key, made on first start. **It is the account.** Lose it and
  every follower has to follow again. It is in the nightly backup.
- `followers.json`: for each follower, their account's address, their inbox, their server's shared
  inbox, their public key and the day they followed. That is what delivering to them takes. They
  are public accounts that chose to follow; the service asks nothing else about them.
- `notes.json`: which apps are posted, and when.
- `feed.json`: the gallery's feed as last taken, so the posts are served after a restart even when
  the site's file is not there.
- `outgoing.json`: deliveries still to make.

The inbox acts on three things: a **Follow** (kept, answered with `Accept`), the **Undo** of one
(forgotten), and the **Delete** of an account that follows (forgotten). Everything else, replies,
mentions, likes and boosts included, is answered 202 and dropped unread. Nothing anyone says to the
account is stored or shown, so there is nothing to moderate, and no content of anyone else's on
Potyro's server. A follower is also forgotten when their server answers 410, or when a delivery to
it fails and deliveries to it have been failing for a week or more.

It logs its own start, each feed it takes (counts only), and errors by their message. Never an
address, an account or a request.

## Signed, and checked

Every request the service makes is signed with the account's key (HTTP signatures, draft-cavage-12,
`rsa-sha256`, which is what the fediverse speaks). Every activity it acts on must be signed by the
key of the account it names:

- The signature must cover the request line, the host, the date and the body's digest; the host
  must be ours, the date within an hour, the digest the body's, the key RSA of 2048 bits or more.
- A Follow is checked against the key its account publishes: one lookup on its server. The key must
  live on the same host as the account, and so must its inbox.
- An Undo or a Delete is checked against the key kept when the account followed, so a stranger's
  Delete (the fediverse sends many) costs no lookup and no work.

The follower chooses where the service connects, so nothing it reaches may be inside
(`src/net.ts`): https only, the default port, a host name and never a bare address, and every
address the name resolves to must be public. The check is in the connection's own lookup, so the
address that was checked is the one connected to. Redirects are not followed; answers are cut at a
size and a time.

Limits, so that one sender cannot cost everyone: 300 requests a minute per address (an IPv6 /64
together); 6 account lookups a minute per sending address and 60 for all together, and none at all
for a key that is on another server than its account; 256 kB an activity; 20 000 followers, 5 000
from one server; one `Accept` on its way to an inbox at a time, however often its account follows
again; a public key of 2 000 characters at most, with nothing before it. Each count is an
environment variable (`src/server.ts`).

## Delivery

One POST per server (its shared inbox), not one per follower. A delivery that fails is tried again
after 1, 5 and 30 minutes, 2, 6 and 12 hours, then a day and a day more, and is given up on after
about three days; the follower stays unless deliveries to their server have been failing for a week.
Only 410 means "gone": any other refusal is tried again.

What goes to one inbox goes in the order it was posted: a later activity waits for the one before
it, so no server sees an `Update` before its `Create`. A round sends at most two deliveries to one
server, so a slow server holds up nobody but itself.

The queue is on disk, so a restart loses nothing. The deliveries are written before the notes are
marked as posted: stopped in between, the same activities are queued again with the same ids, which
changes nothing. A delivery made twice is the same activity with the same id, which servers ignore.

## What this does not do

- No replies, mentions, likes or boosts are read, stored or shown.
- No account for anyone but the gallery: a person on Potyro is not on the fediverse through it.
- Nothing from a device: the service knows the gallery's public file and nothing else.
- A new follower gets what is posted from then on. Older posts are in the outbox, which most
  servers do not read.
- An app that left the gallery and comes back is posted under the same address, which a server that
  saw the `Delete` refuses (Mastodon remembers what was deleted). Give it a new id in gallery.json
  if that matters, and do not take an app out of the gallery for a moment: it is a `Delete`.
- An `Undo` that names the Follow only by its address, not the Follow itself, is not understood
  (Mastodon and the servers like it send the Follow itself).
- A follower whose inbox or key is on another host than their account is not accepted.

## Where in the code

- `gallery/src/feed.mjs` `galleryFeed`, `feedImage`; written by `gallery/src/build.mjs` (`feed.json`)
  and `site/build.mjs` (`apps/feed.json`).
- `packages/fediverse/src/feed.ts` (the feed, checked), `objects.ts` (the actor, notes, activities),
  `signature.ts` (sign, verify), `net.ts` (what may be reached), `inbox.ts` (Follow, Undo, Delete),
  `delivery.ts` (compare, queue, retry), `handler.ts` (the routes), `store.ts` and `disk.ts` (what is
  kept), `fediverse.ts` (put together), `server.ts` (the process, the environment).
- Tests: `packages/fediverse/test/`; the feed's contract with the gallery in `gallery/test/gallery.test.ts`
  and `site/test/site.test.ts`.
