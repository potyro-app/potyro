# docs/legal

The privacy page and the terms of use for the free service at potyro.app, run by one person in
Italy. Issue #117. **Drafts**: nothing here is in force until the owner fills in the placeholders
and counsel has read them.

| File | What |
|---|---|
| [privacy.md](privacy.md) | What stays on the device, what leaves it, where, for how long, and the person's rights |
| [terms.md](terms.md) | Using a free service: no warranty, data can be lost, acceptable use, reports, changes |
| [facts.md](facts.md) | Every claim in the two texts, with the file, doc or observation that proves it |

The rule for changing them: change the claim in `facts.md` first, with its proof, then the public
text. A claim marked **to verify** stays out of the public text until it is proven. Notes for the
review are HTML comments (`<!-- -->`), so they do not show when the page is served.

## Placeholders

Still open: `<DATE>` (the day each text takes effect, on its `Effective:` line, written
`YYYY-MM-DD`), `<RETENTION, to decide>` (how long emails are kept) and `<HOSTING LOCATION>` (where
Hetzner hosts potyro.app; facts.md F-58: the address looks like Hetzner's Helsinki cloud, to confirm
in the Hetzner console).

Filled in on 2026-11-01: the person responsible (`Edgar Zanella Alvarenga`), the contact address
(contact@potyro.com) and the report address (abuse@potyro.com; facts.md F-61). The report address
lives in three places that must agree: the texts, `abuse` in `packages/shell/src/contacts.json` (the
app's and the gallery's "Report") and the share service's `SHARE_ABUSE_CONTACT` (the page of a link
taken down; while it is unset, that page names `contact@potyro.com`).

## Where they will be served

- `https://potyro.app/privacy` and `https://potyro.app/terms`
- `https://potyro.com/privacy` and `https://potyro.com/terms`

Today both paths on potyro.app answer with the app itself (the SPA fallback, facts.md F-65). The
pages are plain static HTML built from these files, so they load with no JavaScript and stay
readable when the app does not start. Each page keeps a date at the top. Earlier versions are not
reachable yet (for example `/privacy/2026-11-01`): nothing builds them.

### How they are built (`packages/legal`, #117)

- **The gate.** While either text still has a placeholder (`<LIKE THIS>`, outside comments and code),
  an open point in words ("to confirm", "to decide", "to verify", in any case, outside comments and
  code), no `Effective: YYYY-MM-DD` line with a real day, or still starts with the **Draft.** note,
  no page is built and the build prints one line saying
  what is left (`legal: /privacy and /terms not built: …`). The app and the gallery link the pages
  only when they were built, so main deploys as it is and the pages and links appear with the first
  build after the texts are finished. `packages/legal/test/legal.test.ts` holds the gate, on copies
  of the texts: no test depends on whether these files are finished yet.
- **The shell.** `packages/legal/src/vite.mjs` serves the pages in `pnpm dev`, emits them into
  `packages/shell/dist` and sets `import.meta.env.VITE_POTYRO_LEGAL` for the links
  (`packages/shell/src/legal-links.tsx`).
- **The gallery.** `pnpm gallery:build` writes them into `dist/gallery` beside the landing page and
  links them from its footer.
- **What is emitted:** `privacy/index.html` and `privacy.html` (the same page, for servers that map a
  folder and for those that try `.html`), the same for terms, and `legal/` (the stylesheet, the
  design system's tokens and fonts, the logo), each named by a hash of its bytes so a cache-first
  service worker never keeps an old one. Every path in a page starts with `../`, so it works at
  `/privacy` and at `/privacy/`. "Open Potyro" goes to the app: `../` on potyro.app,
  `https://potyro.app/` beside the gallery on potyro.com.
- **Headings are anchors.** The app links sections by their heading (`#voice`,
  `#links-anyone-can-try` …, `PRIVACY_SECTIONS` in legal-links.tsx). Renaming a heading in
  privacy.md fails `packages/shell/test/legal-links.test.tsx` until the link is moved too.
- **A preview with the texts filled in:** `POTYRO_LEGAL_DIR=<folder with privacy.md and terms.md>
  pnpm dev`, then open `/privacy`. The browser test does this with copies
  (`e2e/legal-pages-trusted.spec.ts`).

## Where the app must link them

| Place | Link | Why there | In the code (shown once the pages are built) |
|---|---|---|---|
| The footer of potyro.com and of the gallery | Privacy, Terms | The first page people see | `gallery/src/build.mjs` footer |
| The You panel | Privacy, Terms | Where identity, sync and the relay are | `identity-panel.tsx` (`LegalLinks`) |
| The share sheet | Privacy, beside "A link anyone can try" | The link's title, line and picture become public | `share-sheet.tsx`, `#links-anyone-can-try` |
| The space invite ("Use it together") | Privacy | The relay starts holding the app | `share-sheet.tsx`, `#sync-sharing-with-people-and-backup` |
| "Back up my apps" | Privacy | The same | `backup-switch.tsx`, under the switch and in its question |
| AI settings (Model settings) and the AI prompt | Privacy, the AI section | Data goes to OpenRouter and Google | `engine-settings.tsx` (`#building-apps-in-the-studio-and-ask`); the AI question (`app-ai.ts`, `#ai-inside-apps-and-the-free-allowance`) |
| The voice question | Privacy, the voice section | Speech may leave the device | `app-speech.ts`, `studio-voice.ts`, `#voice` |
| The request card in the Studio, and wording suggestions | Privacy, the requests section | It becomes a public GitHub issue | `platform-request-card.tsx`, `suggest-wording.tsx` |
| The Android and iOS store listings | Privacy | The stores require a policy URL (#123) | not in the code: the listings |

The AI switch in Edit tile (`tile-editor.tsx`) has no link of its own: the question asked before an
app's first AI request has it. A link opens the page beside Potyro (a new tab).

## Found while checking, to fix in the code

- ~~`packages/shell/src/backup-switch.tsx` says turning sync off for an app takes it "back off the
  relay"~~, and ~~"The relay only ever sees encrypted data"~~. Fixed (#117): the switch now says
  turning sync off deletes nothing (F-20), and that the apps' contents are encrypted while the name
  and who shares with whom can be seen on the relay (F-16, F-17). The You panel's relay line says
  "It cannot read your records" instead of "only ever sees encrypted data".
- The request card said "a public list of requests"; it now says the request is posted publicly on
  GitHub, and the wording form says the same (F-51a).
- `docs/16-deployment.md` said the link and request services were not deployed. All four services
  answer on potyro.app (F-32, F-41, F-51b, F-54a); docs/16 says so since the #458 pass (2026-10-30).
- There is no button to take a demo link down, though the device keeps its delete token (F-29).
- There is no tool to remove a space from the relay (F-52), and no way to tell people in the app
  that the terms changed.

## Open points for counsel

1. **Web server logs** (F-07). What the server in front of potyro.app logs, and for how long, is
   not known. The privacy page must say it, or the logs must be turned off.
2. **Transfers outside the EU** (F-40). OpenRouter, Google, GitHub and Gandi: where each processes
   data, and the safeguard (adequacy, the EU-US Data Privacy Framework, standard clauses).
3. **Processor agreements** with Hetzner, OpenRouter, GitHub and Gandi (GDPR art. 28), and whether
   Google is OpenRouter's sub-processor or a separate one.
4. **Records of processing** (GDPR art. 30) for an individual running a service that is not
   occasional.
5. **Legal bases.** Contract for the features, legitimate interest for limits and abuse. Is the
   permission prompt for AI and voice a consent in law, or only a product choice?
6. **Device storage** (ePrivacy art. 5(3)). The random device id is kept in the browser and sent to
   the relays, to count the free allowance. Is that strictly necessary for a service the person
   asked for?
7. **Age 14.** What to do about younger users, given there are no accounts and no age check.
8. **Erasure of shared spaces.** A space belongs to several people. Removing it from the relay at
   one person's request removes the others' copy too.
9. **DSA.** Which duties apply to the link service and the relay: points of contact (arts. 11–12),
   notice and action (art. 16), and a statement of reasons (art. 17) when there is no way to reach
   the person who made the link.
10. **AI Act art. 50.** Is the "AI can be wrong" text, plus the AI prompts in the app, enough
    transparency for apps and answers made by AI? Should AI-made apps be marked?
11. **Free digital services.** Whether the consumer rules for digital content and services
    (Directive 2019/770) apply to a free service, and what that means for "No warranty".
12. **Liability wording** under Italian law (Codice civile art. 1229, Codice del consumo).
13. **Languages.** Whether an Italian version is required, and which text prevails.
14. **Requests on GitHub.** People's own words become public. Is the card's warning enough, and
    can a published request be removed on demand?

## Before the soft launch

- The owner fills the placeholders and confirms the mailboxes exist.
- Counsel reads both texts and the open points above. Record the date here.
- The F-07 logging question is settled and the page says it.
- The pages are served at the four URLs (the build makes them once the placeholders are filled;
  potyro.app's Caddy must serve `privacy.html` or `privacy/index.html` at `/privacy`, docs/16), and
  the links above show in the app.
- The pages are English only. Which other languages, and which text prevails, is open point 13.
