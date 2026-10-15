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
- with one calm bar: **Made with Potyro · Keep this app · Remix this**.

A permission is asked for only when the app itself reaches for a capability, and a library is
fetched only after the person says yes — both through the prompts every sealed app already gets.

"Keep" goes through the ordinary Add-an-app card, as a link (so never "I wrote this"; it can be
promoted later). "Remix" goes through the same card and then opens the Studio on the kept copy,
prefilled with "Make me a version of <app> that…". Nothing about trust changes.

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
   into a throwaway in-memory store and read back. Run without the sharer's account id (`me` is
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

## 6. Credit and remix

`manifest.json` gains `credit`: `{ name, by?, remixOf?: credit }`, at most five deep.

- `name` is the app's name; `by` is the sharer's name, only when they have set one (You → name)
  and leave "Say it is by <name>" ticked on the share sheet.
- Keeping an app keeps its credit on the saved app (`UserApp.credit`).
- Remixing saves the copy with `credit: { remixOf: <the shared app's credit> }`; when that copy is
  shared, its credit is `{ name, by, remixOf }` — a chain.
- The Add-an-app card says "By Ana" or "Remix of Groceries by Ana"; the demo bar says the same.

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

## 9. What this does not do

- No public gallery, feed, search or listing of share links (Phase 1 is a curated showcase, later).
- No records leave the device in a demo; no space is created.
- No change to trust: a demo runs sealed, Keep and Remix install sealed, promotion stays explicit.
- No server-side rendering of apps: the service never runs app code.
