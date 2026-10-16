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
| **Hosted** (default) | `https://apps.vaz.io/s/<id>#k=<key>` | the share service (§4) | yes |
| **Inline** (fallback) | `https://apps.vaz.io/#try=<package>` | nothing — a static site | no (the site's own) |

Both carry the same thing: a **demo package**, an ordinary `potyro-app/1` zip (#253) holding

- the source, the app's own modules (`src/`) and its lock (libraries by URL and digest — their
  bytes are not carried; the viewer fetches them from where the lock says, with consent, and the
  digest is checked as on any install);
- the files it ships with (`files/`, `origin: shipped` only — never files the person added);
- `seed.json`: **demo records** (§3);
- `manifest.json` with `credit` (§6).

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
2. Otherwise **nothing**: the app opens empty, as it would for anyone who adds it. That is honest,
   and an app worth sharing is usable from empty.

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
| `DELETE /share-api/shares/<id>` | with `x-delete-token`: removes it (the sharer's "stop sharing", and the operator's takedown) |
| `GET /s/<id>` | the shell's `index.html` with Open Graph and Twitter meta for the link written in |
| `GET /s/<id>/preview.jpg` (or `.png`) | the preview image |
| `GET /share-api/health` | `{ ok: true }` |

Caps: payload ≤ 2 MiB, image ≤ 300 KB (JPEG or PNG, checked by magic bytes), title ≤ 80 and
description ≤ 200 characters, checked before anything is written. 30 shares a day per address.
Ids are 128 random bits. Meta text is HTML-escaped where it is written into the page. Every page it
serves carries `noindex`: a link is for whoever it was sent to, not for search.

The shell at `/s/<id>` is the ordinary SPA: it reads `<id>` from the path and `k` from the fragment,
fetches the payload, decrypts it and opens the demo. Built-in asset paths are absolute, so the same
`index.html` works at any path.

In dev and `vite preview` the same handler is mounted by a Vite plugin (shares kept in memory), so
the hosted form is what the dev server and the browser tests exercise. Deploying it is docs/16.

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

## 10. The gallery

A curated page of apps to try and make your own, served statically on potyro.com (docs/16): Potyro's
first public face, and the place a share-link loop starts from without anyone's feed.

**The data** is one file, `gallery/gallery.json` (`potyro-gallery/1`, checked by `gallery/src/data.mjs`):
each app's id, its name and one line in all six languages, a category, an icon, and where it comes
from — `{ "example": "groceries" }` or `{ "package": ["apps/receipt-split/receipt-split.app.ts"] }`.
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
with `&remix=1`). The footer has "Report a link", a mailto to `contact@potyro.com` (named once, in
`build.mjs`), and links to potyro.app. Tests: `gallery/test` (data, words, page, build) and
`e2e/gallery-trusted.spec.ts` (publish against the local dev server, axe in light and dark, no request
leaves the page's origin, languages).

In the app, the gallery is one tap from Add an app ("From the gallery"), the Classic launcher's ＋ menu
and the Tiles launcher's app bar (`gallery-link.ts`; a build may point elsewhere with
`VITE_POTYRO_GALLERY`).
