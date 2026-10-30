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

`Edgar Zanella Alvarenga`, `<CONTACT EMAIL>`, `<ABUSE EMAIL>`, `<DATE>` (the date each text takes effect) and
`<RETENTION, to decide>` (how long emails are kept). The hosting location reads "Germany or
Finland, to confirm" (facts.md F-58: the address looks like Hetzner's Helsinki cloud).

## Where they will be served

- `https://potyro.app/privacy` and `https://potyro.app/terms`
- `https://potyro.com/privacy` and `https://potyro.com/terms`

Today both paths on potyro.app answer with the app itself (the SPA fallback, facts.md F-65). The
pages should be plain static HTML built from these files, outside the shell, so they load with no
JavaScript and stay readable when the app does not start. Each page keeps a date at the top and the
earlier versions stay reachable (for example `/privacy/2026-11-01`).

## Where the app must link them

| Place | Link | Why there |
|---|---|---|
| The footer of potyro.com and of the gallery | Privacy, Terms | The first page people see |
| The You panel | Privacy, Terms | Where identity, sync and the relay are |
| The share sheet | Privacy, beside "A link anyone can try" | The link's title, line and picture become public |
| The space invite ("Use it together") | Privacy | The relay starts holding the app |
| "Back up my apps" | Privacy | The same |
| AI settings (Model settings) and the AI prompt in Edit tile | Privacy, the AI section | Data goes to OpenRouter and Google |
| The voice question | Privacy, the voice section | Speech may leave the device |
| The request card in the Studio, and wording suggestions | Privacy, the requests section | It becomes a public GitHub issue |
| The Android and iOS store listings | Privacy | The stores require a policy URL (#123) |

None of these links exists yet. Adding them is shell work, with words through Lingui.

## Found while checking, to fix in the code

- `packages/shell/src/backup-switch.tsx` says turning sync off for an app takes it "back off the
  relay". It does not: `toggle-sync.ts` deletes nothing, and the relay keeps everything (F-20). The
  same switch says "The relay only ever sees encrypted data", but names and who-shares-with-whom
  are readable there (F-16, F-17).
- `docs/16-deployment.md` on `main` says the AI, link, request and rooms services are not deployed.
  All four answer on potyro.app (F-32, F-41, F-51b, F-54a). The copy on the `docs/how-potyro-works`
  branch already says the AI relay is.
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
- The pages are served at the four URLs, and the links above are in the app.
