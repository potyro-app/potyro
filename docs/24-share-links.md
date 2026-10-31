---
title: Share links
description: Every shared link is a working demo: the link, demo records, the share service, credit and remix, page links, the gallery.
status: current
order: 24
---

# Share links: every shared link is a working demo

Status: design, approved for Phase 0 by the owner on 2026-10-15 (distribution research, Phase 0).
Builds on the Add-an-app card (#253), the sealed browser realm (#272, docs/22), carried code and
locks (#281, #294) and the trust rules in docs/07.

## 1. What changes for a person

Today a shared link either **joins** an app and its data (`#join=`, a space invite: sync on, a name
prompt, a trust question) or **installs** a package someone hosts (`#add=`). Both are commitments.
Neither shows the app to someone who has not decided yet.

A **demo link** does. Whoever opens it sees the app running, straight away:

- in the browser, with **no install, no account, no consent wall** before the app is on screen;
- **sealed**, in the browser realm, exactly as an app from someone else always runs (rule 3);
- with **demo records** only — the app's sample data, never the sharer's records;
- in **the viewer's language** (Potyro's words and, where the app has them, the app's);
- with one calm bar: **Made with Potyro · Make it mine · Keep this app**.

A permission is asked for only when the app itself reaches for a capability, and a library is
fetched only after the person says yes — both through the prompts every sealed app already gets.

"Keep" goes through the ordinary Add-an-app card, as a link (so never "I wrote this"; it can be
promoted later). "Make it mine" goes through the same card and then opens the Studio on the copy, which greets it
(§6). Nothing about trust changes.

Sharing from the sharer's side is one sheet: **A link anyone can try** (the demo link) above
**Use it together** (the existing invite). The sheet offers copy, WhatsApp, Telegram and the
device's own share sheet.

## 2. The link

Two forms, one viewer:

| Form | Looks like | Needs | Preview card |
|---|---|---|---|
| **Hosted** (default) | `https://potyro.app/s/<id>#k=<key>` | the share service (§4) | yes |
| **Inline** (fallback) | `https://potyro.app/#try=<package>` | nothing — a static site | no (the site's own) |

Both carry the same thing: a **demo package**, an ordinary `potyro-app/1` zip (#253) holding

- the source, the app's own modules (`src/`) and its lock (libraries by URL and digest — their
  bytes are not carried; the viewer fetches them from where the lock says, with consent, and the
  digest is checked as on any install);
- the files it ships with (`files/`, `origin: shipped` only — never files the person added);
- `seed.json`: **demo records** (§3);
- `manifest.json` with `credit` (§6) and the app's `line` (§11).

The inline form puts the zip, base64url, in the fragment. A fragment never reaches a server. It
works on any static deployment with nothing new to run, which is why it stays as the fallback — but
a 10–20 KB link does not survive every messenger (Telegram stops at 4096 characters), and a crawler
cannot build a preview from a fragment.

The hosted form puts the zip on the share service **encrypted** (AES-GCM, a fresh 128-bit key per
link) and the key in the fragment. The service holds ciphertext it cannot read, next to the two
things a link preview needs and that the sharer's device made public on purpose: a title/description
and a preview image (§5). That keeps the asymmetry the research asks us not to give up: the service
can show what a link is called, never what the app is or holds.

The sharer's device tries hosted first; if the service is not there (`GET /share-api/health` does
not answer `{ ok: true }`), it makes an inline link and says that this one will not show a preview.
An inline link that would be longer than 24,000 characters is refused in plain words, with the
package as the way to send it instead.

## 3. Demo records

A demo shows the app as it looks with something in it, and must never show the sharer's records.
The device that shares builds them, in this order:

1. **The app's own sample data**: the first-run records a bundled example writes (`seed.ts`), run
   into a throwaway in-memory store and read back. A sample photo is written as the path of the
   file the example ships with (`{ "file": "photos/x.webp" }`), the file travels in `files/`, and
   the viewer's device makes the record's copy (`seed-files.ts`) — so an example with photos makes
   a hosted link of a few hundred KB, too long for the inline form. Run without the sharer's account id (`me` is
   undefined), so no record names anyone.
2. For an app added from a package, **the seed its package came with** (`seed.json`, #253): the
   app's own sample data, kept beside the app when it was added (`UserApp.seed`, at most 64 KB of
   JSON — a bigger one is applied on install but not kept), and only for the entities it keeps.
   Never what the person added since. An inline link too long with them is made without them.
   For an app made in the Studio, **the records its run check passed on** (#486), kept the same way.
   The create loop runs every candidate on records made up from its fields, in a throwaway store
   (`run-candidate.ts`); the candidate the loop ends with, when its run threw nothing, keeps them as
   they were before any of its logic ran (`app-seed.ts`), and they become its seed. A later change
   keeps only the rows that still fit: whenever the app's definition is at hand — a version saved in
   the Studio, a version put back from History, the app opening — each row is checked against its
   entity's fields by the rule every write is held to (`fieldValueProblem`), and a row that no
   longer fits is dropped, never repaired, with any reference to it taken out of the rows that
   pointed at it. Nothing is ever added to a seed afterwards, and the person's own records are never
   read for one.
3. Otherwise **nothing**: the app opens empty, as it would for anyone who adds it. That is honest,
   and an app worth sharing is usable from empty.
4. On the viewer's device, once the records are in, **the app's own demo** when it declares one
   (`defineApp({ demo })`, docs/04 §Demo): an app that lives on a feed plays a replay, since records
   written in advance would be stale by the time the link is opened. Only a demo link runs it.

An app with an app-wide selection (docs/03 `scope`, Split's group) opens with the first of its demo
records of that entity already chosen, not on "choose a group": a question before the app is on
screen is a poor first look. Nothing is remembered, and an app with no such demo records asks, as on
a first run.

What is never read: the app's own store. Building the demo package opens the app's store only to
copy files it **shipped with**, by path.

A space can be shared on purpose only through the invite (`#join=`), which says what it does.

## 4. The share service (`packages/share-links`)

A small Node process beside the relay, same shape as `platform-requests` (#263): no dependencies,
`node --experimental-strip-types`, loopback only, behind Apache on the same origin.

| Route | What |
|---|---|
| `POST /share-api/shares` | `{ meta: { title, description, lang }, image?, payload }` (base64). Returns `{ id, deleteToken }`. |
| `GET /share-api/shares/<id>/payload` | the ciphertext |
| `DELETE /share-api/shares/<id>` | with `x-delete-token`: removes it (the sharer's "stop sharing"); the link then answers 404 |
| `DELETE /share-api/admin/shares/<id>` | with `authorization: Bearer <SHARE_ADMIN_TOKEN>` and `{ reason }`: the operator's takedown; the link then answers 410 |
| `GET /s/<id>` | the shell's `index.html` with Open Graph and Twitter meta for the link written in |
| `GET /s/<id>/preview.jpg` (or `.png`) | the preview image |
| `GET /share-api/health` | `{ ok: true }` |

Caps: payload ≤ 2 MiB, image ≤ 300 KB (JPEG or PNG, checked by magic bytes), title ≤ 80 and
description ≤ 200 characters, checked before anything is written. Per address (an IPv6 address
counts as its /64) and per day (UTC): 30 links made, 300 packages fetched, 2000 link pages and
pictures, and an IPv6 /48 eight times that; for the whole service, 2 GB of new links a day and
none while the disk would have under 1 GB free. A refusal is JSON with a `code` and a sentence,
except on a link's own page, which is a few lines in the visitor's language; the shell says "Too
many apps were opened from this network today" with Try again, never that the link is damaged
(docs/16). Ids are 128 random bits. Meta text is HTML-escaped where it is written into the page. Every page it
serves carries `noindex`: a link is for whoever it was sent to, not for search.

The shell at `/s/<id>` is the ordinary SPA: it reads `<id>` from the path and `k` from the fragment,
fetches the payload, decrypts it and opens the demo. Built-in asset paths are absolute, so the same
`index.html` works at any path.

In dev and `vite preview` the same handler is mounted by a Vite plugin (shares kept in memory), so
the hosted form is what the dev server and the browser tests exercise. Deploying it is docs/16.

**Taken down (#11).** A link the operator takes down (docs/16, "Taking a link down") answers 410 on
its page, its package and its picture. The page is not the shell: a few lines in the visitor's
language — the link was taken down, the app behind it was removed, where to write if it was a
mistake — and nothing of the link. The service keeps the time and the operator's reason in the
link's place, and serves neither. Where the shell itself opens the link instead of that page, it
gets the 410 from the package and says the same on its splash. The service worker never answers
`/s/…` or `/share-api/…` from its cache (the PWA work's rule, which this needs), so no device keeps
opening a package it fetched before.

**Report.** The demo bar of a hosted link has a quiet **Report**: a mail to the report address the
terms name, with the link without its key and the start of a notice. An inline link has none — it is
on no server to remove. The address is `abuse` in `packages/shell/src/contacts.json` (read by the
shell and by the gallery's "Report a link"); while it is still the `<ABUSE EMAIL>` placeholder,
reports go to `general` (`contact@potyro.com`).

## 5. The preview image

Rendered on the **sharer's device**, from demo data, never from the screen: a 1200×630 card drawn on
a canvas — the app's icon and accent, its name, up to three lines taken from the demo records (the
first text field of the first records of the app's first list), and "Made with Potyro". JPEG,
quality lowered until it is under 300 KB (in practice 40–90 KB). A card rather than a screenshot
because a screenshot of a sealed app would have to be taken from the person's screen, which shows
their records.

## 6. Credit and remix: Make it mine

`manifest.json` gains `credit`: `{ name, by?, remixOf?: credit }`, at most five deep.

- `name` is the app's name; `by` is the sharer's name, only when they have set one (You → name)
  and leave "Say it is by <name>" ticked on the share sheet.
- Keeping an app keeps its credit on the saved app (`UserApp.credit`).
- Remixing saves the copy with `remixOf: <the shared app's credit>` — or `{ name }` when the app came
  with none, so a remix always says what it remixed. When that copy is shared, its credit is
  `{ name, by, remixOf }` — a chain.
- The Add-an-app card says "By Ana"; a remix's tile and the Studio's greeting say "Remix of Groceries
  by Ana" ("Remix of Groceries" when nobody said who made it). History keeps it too: the remix's first
  version is noted `remix of “Groceries” by Ana` (stored in English, shown in the reader's language).

**One path from any shared app** to "your own copy you can change", called **Make it mine**
(glossary: docs/21). It is offered in three places, and all three are the Add-an-app card with
`remix` (`AddAppDialog`), so libraries, files and trust are the ordinary install's:

| Where | What it copies |
|---|---|
| A demo link: the bar's **Make it mine** | the package the link carried |
| A link with the remix intent (`&remix=1`, the gallery's second button, §10) | the same; the card is already open over the running app |
| A sealed app on this device: its tile's ⋯ menu, or the app's own menu | the package a demo link of it would carry (`remix.tsx`): its code, shipped files and sample records — never its store, which may be a space other people write in |

Make it mine is offered for someone else's app (sealed) that is not already a remix of the person's
own; their own apps have Duplicate.

What the copy is:

- **A new app**, always, beside anything the person has: its id is `<id>-remix` (or `-remix-2`…), never
  the original's — the example seeders and conversations are keyed on app ids, so a copy under the
  original's id would be given the original's first-run records and chat. Its name is the original's,
  or "Groceries (remix)" when an app of that name is already on the device, so the two tiles differ.
- **Sealed.** A remix of someone's code stays in the sealed box until the person lets it run as theirs
  (docs/07); the Studio changes it either way, and previews it sealed (`studio-preview.tsx`).
- **With the sample records, unless the person unticks it.** The card asks "Start with its N sample
  records" (on by default) when the package has any. They are the app's own examples, never anyone's
  records (§3), and a copy you are about to change in the Studio is judged by looking at it: a change
  like "add a price to each item" shows on rows, not on an empty list. Off, it starts empty.

Then the copy opens with the Studio on it (`studio-handoff.ts`, across the page load). The Studio greets
a remix that nobody has asked anything of yet (`RemixHello`): the credit, **"This is your own copy.
What would you like to change?"**, and up to four suggestions drawn from the app with no model call
(`remix-suggestions.ts`): about its main record — the one its first page shows — what it does not have
yet (a photo, a date or a calendar, a note, who each is for), and always one about its look. A
suggestion fills the box, in the person's language, quoting the app's own word for its record.

### The link intent

`<a demo link>&remix=1` — `https://potyro.app/s/<id>#k=<key>&remix=1`, or `#try=<package>&remix=1`. It is
in the fragment, like the key, so no server sees it; only `1` counts. `readDemoLink` returns
`{ …, remix: true }` and the demo opens with the Make it mine card already up. A link without it is a
plain demo.

## 7. Measuring, without measuring people

There is no analytics in Potyro yet (#118). Share links count on the device only: `share-events.ts`
increments a local counter (`demo-opened`, `demo-kept`, `demo-remixed`, `demo-link-made`,
`share-network:<name>`) and dispatches a `potyro:share-event` DOM event — no id, no app name, no
network. #118's beacon, when it exists and the person has not switched it off, reads the counts. No
third-party request is made by any of this; the browser tests assert it.

## 8. Recording a clip

The share sheet offers "Record a 15-second clip" of the app on screen, where the browser can:
an app that draws on a `<canvas>` is recorded straight from it (`captureStream`, no prompt); anything
else asks to record this tab (`getDisplayMedia`), which Chrome and Edge on a computer support.
Where neither exists — Safari, phones, the Android WebView — the sheet says plainly that this
browser cannot record and suggests the phone's own screen recorder. The clip is saved as a file;
nothing is uploaded.

Details: the clip is offered only inside an app (the launcher has none on screen). While it records,
the sheet steps aside for a small "Recording · 12 s · Stop" bar. A tab recording is cropped to the
app where the browser has Region Capture. MP4 is written where the browser can (every network takes
it), WebM otherwise. Saving waits for a tap on "Save the clip", because a browser's save dialog needs one.

## 9. What this does not do

- No public feed, search or listing of share links: the gallery (§10) is curated, by hand.
- No records leave the device in a demo; no space is created.
- No change to trust: a demo runs sealed, Keep and Make it mine install sealed, promotion stays explicit.
- No server-side rendering of apps: the service never runs app code.
- No word to the sharer when the operator takes a link down: there are no accounts to tell
  (docs/legal/terms.md says so).

## 10. The gallery

A curated page of apps to try and make your own, served statically on potyro.com (docs/16): Potyro's
first public face, and the place a share-link loop starts from without anyone's feed.

**The data** is one file, `gallery/gallery.json` (`potyro-gallery/1`, checked by `gallery/src/data.mjs`):
each app's id, its name and one line in all six languages, a category, an icon, and where it comes
from — `{ "example": "groceries" }` or `{ "package": ["apps/receipt-split/receipt-split.app.ts"] }`, with
`files` (a folder it ships with, packed whole) and `seed` (its sample records) when it has them.
`status` is `ready` (works sealed today, with built-in views) or `coming-soon` with `waitsFor` (the
issue or PR it needs: #267 for apps whose custom screens need the sealed frame, or the open PR that adds
it). People edit everything but `link`, `screenshot` and `publishedAt`, which the publish script writes.
The page's own words are in `gallery/strings.json`, six languages, same placeholders in each.

**`pnpm gallery:publish --site https://potyro.app`** (`gallery/src/publish.mjs`, Playwright) makes
each ready app's link the way a person does, in a new, empty browser: an example is already on the
launcher; an app under `apps/` is packed (`scripts/pack-app.mjs`) and added through Add an app. The link
is made from the tile's Share sheet. A second empty browser then opens it as a stranger — sealed, a
heading, no console error — opens the remix link to see the Make it mine card, and takes the
screenshot (412 px wide, demo bar hidden). Each link and screenshot is written as soon as it is made.
Running it again keeps every link already on that site (`--refresh` makes new ones); coming-soon apps
are skipped and listed. Nothing personal goes out: the browser is empty, and no name is on the links
unless `--by` says one.

**`pnpm gallery:build`** (`gallery/src/build.mjs`) writes `dist/gallery/`: one HTML page that is whole
without JavaScript (English), its stylesheet and a small script on the same origin, system fonts, the
screenshots it shows and nothing else. The script picks the language — `?lang=`, the one chosen on the
page, then the browser's — and handles the light/dark switch and the category filter; what it remembers
stays in that browser. Every card has **Try it** (the demo link) and **Make it mine** (the same link
with `&remix=1`). The footer has "Report a link", a mailto to the report address (`packages/shell/src/contacts.json`,
the same one the demo bar's Report uses; `contact@potyro.com` while the abuse address is a
placeholder), and links to potyro.app. Tests: `gallery/test` (data, words, page, build) and
`e2e/gallery-trusted.spec.ts` (publish against the local dev server, axe in light and dark, no request
leaves the page's origin, languages).

In the app, the gallery is one tap from Add an app ("From the gallery"), the Classic launcher's ＋ menu
and the Tiles launcher's app bar (`gallery-link.ts`; a build may point elsewhere with
`VITE_POTYRO_GALLERY`).

## 11. Links to a page of an app

A demo link opens an app. Some sharing needs more: a game's invite has to open **the game** at **its
join page** with **the code filled in**, on the friend's own copy if they have one. That link is made by
the app (`ctx.ui.share({ app: { page, params } })`, docs/04 "Params from links") and carries where to
land beside the demo:

| Form | Looks like |
|---|---|
| Hosted demo + target | `https://potyro.app/s/<id>#k=<key>&app=<line>&to=<page>&p.<name>=<value>…` |
| Inline demo + target | `https://potyro.app/#try=<package>&app=<line>&to=<page>&p.<name>=<value>…` |
| Target only | `https://potyro.app/#app=<line>&to=<page>&p.<name>=<value>…` — when no demo could be made |

All of it is in the fragment, so no server sees a game's code. `remix=1` still means Make it mine and
may stand beside a target.

### Which app: its line

A device-local id cannot say which app a link is for: a friend's copy is `draw-guess-2`, a remix
`draw-guess-remix`. Every app has a **line** (`UserApp.line`, `manifest.json` `line`):

- an app **made here** (the Studio), a **Duplicate** and a **remix** get a line of their own, 128 random
  bits: they are other apps from then on;
- a **kept** copy takes the line its package carries — every demo package and every package the Studio
  saves writes the app's line — so the copy opens from the same links as the original;
- an app with no line of its own — an example, anything from a package that did not say (every
  package built from `apps/`), anything older — is known by its declared id: `id:<id>`;
- a remix remembers what it remixed (`UserApp.lineOf`), and is opened by a link to that app when it is
  the only copy on the device.

Matching (`app-link-find.ts`) prefers a copy of that app, the most recently changed, then a remix. A
line is a hint, not a credential: any package can claim any line. That is acceptable because of what a
link can do (below): a wrong match shows the wrong app with some text in it, and nothing runs.

### What happens when one is opened

1. **The person has the app:** the address becomes the app's own (`?user=<id>`, the fragment gone) and
   it opens on that page with those params. Not the demo, even when the link carries one.
2. **They do not:** the demo the link carries, opened on that page. **Keep this app** (or Make it mine)
   goes through the ordinary card, and the copy opens on that page with those params (`holdArrival`,
   for that app only, taken once). Letting it run as theirs reloads it, and the page and its params
   come back with it.
3. **They do not, and the link carries no demo:** "This link opens an app you don't have here", with
   the way to their apps. Nothing is installed, ever, by a link.
4. **`&remix=1`:** the demo with the Make it mine card, as in §6, whether or not they have the app.

### What a page gets

Only what it declares (`link: { params: ["code"] }`), as text of at most 200 characters, at most 8
names. The shell cuts what it reads from a fragment (a name that is not a plain identifier, a value
over the cap, a second value for a name, everything past 32), and the page's declaration cuts the rest
(`acceptLinkParams`). Nothing is said about what was cut: anyone can write a link. A page the app does
not have is no page; the app opens where it always does.

The page only **receives** them, as `ctx.params` (and a custom view's `ViewProps.param`). No action
runs because of a link: Draw & Guess fills in the code and waits for Join.

### Making one

`ctx.ui.share({ text, title, app: { page, params } })` opens the share dialog at once — "Making the
link…" — while the shell makes the address: the app's demo link (made once per version of the app and
kept on the device, `app-link-make.ts`; a new one when the app changes or its link was taken down from
the share sheet), with the target on it. When no demo link can be made (no share service and too big to
be inline), the target-only form: it still opens the app for whoever has it. From inside a demo the
link is that demo's own, so a person trying a game can invite a friend into it. A sealed app makes links
the same way; the address reveals nothing but the params it chose.
