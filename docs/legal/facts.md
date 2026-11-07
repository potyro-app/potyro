# Facts behind the privacy page and the terms

Every claim in [privacy.md](privacy.md) and [terms.md](terms.md), with what proves it. Checked on
2026-10-30 against `main` at `e1724650` and, where it says so, against the live potyro.app.

**Status:** *code* means read in the source named. *observed* means seen on the live site on
2026-10-30. *doc* means stated in a doc and not checked further. **to verify** means not proven:
the public text says nothing about it until it is.

When the code changes, change the claim here first, then the public text.

## Who runs it

| # | Claim | Proof | Status |
|---|---|---|---|
| F-01 | The controller is an individual in Italy, no company. | Owner decision for the release plan. | owner |
| F-02 | Nothing is sold; no paid plan is live. | Owner decision. No billing code in the repository (#120 open). | owner, code |
| F-03 | No accounts. Identity is a key made on the device, with BIP39 recovery words. | `packages/identity/src/identity.ts` (header, `recoveryPassphrase`, `signInWithPassphrase`) | code |
| F-04 | The code is open source under Apache 2.0. | Owner decision: the repository goes public under Apache-2.0. | owner. There is no LICENSE file in the repository yet: **to verify** it lands before these go live |

## On the device

| # | Claim | Proof | Status |
|---|---|---|---|
| F-05 | The secret key is kept encrypted in IndexedDB with a non-extractable AES-GCM key (web), or in the platform keystore (Android). Code on the origin can still ask it to decrypt. | `packages/identity/src/vault.ts` header | code |
| F-06 | A random device id (`crypto.randomUUID`) is kept in localStorage `potyro:device-id`. It is sent only to the request relay and the AI relay. | `packages/shell/src/device-id.ts`; used in `platform-requests.ts`, `wording-suggestions.ts`, `app-ai-caps.ts`, `studio-voice.ts` | code |
| F-08 | Keys pasted for AI services live in sessionStorage only, so they die with the tab. | `packages/shell/src/engine-store.ts` header (`potyro:engine-config` in sessionStorage) | code |
| F-09 | Keys for Ask's data sources are in the vault, never in localStorage. | `packages/shell/src/ask-sources.ts` header | code |
| F-10 | No cookies are set. | `grep -rn "document.cookie\|Set-Cookie" packages/*/src`: no match. The site's response headers set none (observed). | code, observed |
| F-11 | No analytics or error tracker. | No sendBeacon, analytics or Sentry in shell, views, runtime, host. Share counters are local only (docs/24 §7, `share-events.ts`). #118 (privacy-preserving counts) is open, not built. | code |
| F-12 | Fonts are self-hosted, not loaded from Google. | `packages/design/scripts/tokens.mjs` strips the Google Fonts `@import` and writes local `@font-face` rules | code |

## Sync relay

| # | Claim | Proof | Status |
|---|---|---|---|
| F-13 | Sync is off until turned on, per app or for all with "Back up my apps". | `packages/shell/src/backup-all.ts` header ("OFF until asked for"); `toggle-sync.ts` | code |
| F-14 | Sharing with people needs sync on. | `share-sync.ts` `createShareLink` throws when `!app.sync` | code |
| F-15 | Content is encrypted on the device; the invite's secret travels in the URL fragment. | docs/16 "What this does NOT protect"; `share-sync.ts` (`#join=`) | doc, code |
| F-16 | The relay can see account ids, group membership (who shares with whom) and activity times. | docs/10 KA-33 (group and account metadata are `trusting`, plaintext) | doc |
| F-17 | The display name is plaintext on the relay. | `packages/store/src/jazz-backend.ts` `publishProfileName`: `profile.set("name", name, "trusting")` | code |
| F-18 | The relay sees the device's IP address while connected. | Inherent to a websocket. Whether `jazz-run sync` or the proxy logs it: **to verify** (see F-07). | to verify (logging) |
| F-19 | Nothing is compacted; deleted and replaced data stay on the relay. | docs/10 KA-30; docs/16 "Nothing is freed" | doc |
| F-20 | Turning sync off does not remove data from the relay. | `toggle-sync.ts` header: copies, deletes nothing. | code |
| F-21 | The app's creator can remove a person; their devices keep what they already had; open invites are revoked. | `jazz-backend.ts` `removeSpaceMember` | code |
| F-22 | The relay is unauthenticated: anyone who reaches it can store data. | docs/16 "What this does NOT protect", KA-29 (#119 open) | doc |
| F-23 | Anyone with an invite link can join. | docs/16 "What this does NOT protect", KA-17 | doc |

**Mismatch fixed in the shell (#117).** `backup-switch.tsx` said "Turn sync off for an app
individually to take it back off the relay", which F-20 contradicts, and "The relay only ever sees
encrypted data", which F-16 and F-17 contradict. It now says turning sync off deletes nothing, and
that names and who shares with whom can be seen on the relay.

## Demo links

| # | Claim | Proof | Status |
|---|---|---|---|
| F-24 | The package is AES-GCM encrypted on the device; the key is in the fragment. | docs/24 §2; `share-links/src/wire.ts` header | doc, code |
| F-25 | Demo links carry sample records only. | docs/24 §3; `demo-share.ts` | doc |
| F-26 | Public per link: title (app name), one line, language, preview picture; the line names the sharer when "Say it is by" is ticked. | `share-links/src/store.ts` (`StoredShare`: meta, createdAt, deleteHash, imageType); `wire.ts` `ShareMeta`; `shell/src/demo-share.ts` `previewMeta`; `share-sheet.tsx` | code |
| F-27 | Pages carry `noindex`. | docs/16, docs/24 §4 | doc |
| F-28 | Links never expire. | docs/16 "Disk: links are never expired"; no expiry in `disk.ts` | doc, code |
| F-29 | Delete: `DELETE /share-api/shares/<id>` with the delete token (the link then answers 404). The operator takes a link down by id without the token (`DELETE /share-api/admin/shares/<id>` with the operator token, or `scripts/takedown.mjs`); the link's package, picture and meta are removed, the time and the operator's reason are kept, and the link answers 410 with a page naming the report address. The sharer's device keeps the last 200 tokens (`potyro:shares`) but **no UI calls DELETE yet**. | `share-links/src/handler.ts`, `disk.ts`, `scripts/takedown.mjs`, `test/handler.test.ts`, `test/takedown.test.ts`; `shell/src/share-service.ts` (`remember`, no DELETE anywhere in shell); docs/16 "Taking a link down" | code |
| F-30 | Per-address limits a day (UTC), in memory: 30 links made, 300 packages fetched, 2000 link pages and pictures; an IPv6 address counts as its /64, and its /48 gets eight times each limit. For the whole service: 2 GB of new links a day, none while the disk would have under 1 GB free. Addresses are held only as counts for the day, never written down. | docs/16 "Limits per address"; `share-links/src/handler.ts` (`dayCounts`, `DEFAULT_LIMITS`, `WIDE`), `address.ts` | code |
| F-31 | Without the service, the inline link carries the whole app in the fragment. | docs/24 §2 | doc |
| F-32 | The link service is live on potyro.app. | `https://potyro.app/share-api/health` → `{"ok":true}` | observed (docs/16 says so since the #458 pass, 2026-10-30) |

## AI inside apps and the free allowance

| # | Claim | Proof | Status |
|---|---|---|---|
| F-33 | A sealed app asks before its first AI call; only what the call names goes. | docs/23 "Permission" | doc |
| F-34 | Pictures are resized on the device to 1600 px before they go. | docs/23; docs/16 | doc |
| F-35 | The relay sends to OpenRouter with `provider.data_collection: "deny"`; the model is fixed (`google/gemini-2.5-flash-lite` by default). | `ai-relay/src/request.ts` `openRouterBody`, `AI_MODEL` | code. The model on the live relay (`AI_MODEL` env): **to verify** |
| F-36 | OpenRouter gets no device id or IP address from the relay. | `openRouterBody` has no device or user field; `server.ts` `openRouter()` sends only the body | code |
| F-37 | The relay keeps no content and logs only upstream error messages. | `ai-relay/src/relay.ts` (`onError` gets `OpenRouter <status>: <message>`); `server.ts` | code |
| F-38 | The ledger file holds the current month's spend and a count per device id; it is replaced on the first request of a new month. Daily counts per device and per address are in memory. | `relay.ts` `memoryLedger` (`at()` replaces the state when the month differs), `dayCounter`; `server.ts` (`AI_LEDGER` file) | code |
| F-39 | With the person's own key the browser calls OpenRouter directly, with the same provider rules. | `shell/src/app-ai.ts` (`OPENROUTER_URL`, `openRouterBody`) | code |
| F-40 | Where OpenRouter, Google, GitHub and Gandi process data, and the transfer safeguard. | Not in the code. | **to verify** (the public text only says "may be outside the EU") |
| F-41 | The AI relay is live on potyro.app. | `https://potyro.app/ai/health` → `{"ok":true}` | observed |
| F-42 | Potyro's OpenRouter account has logging and training off. | docs/16 says to set it. | **to verify** on the account (not stated publicly) |

## Voice

| # | Claim | Proof | Status |
|---|---|---|---|
| F-43 | Engines: on-device; the browser's service (Google for Chrome, Microsoft for Edge, Apple for Safari); in Firefox a WAV through the AI path. | docs/29 §2; `capabilities/src/speech.ts` (`pickEngine`, `browserService`) | doc |
| F-44 | Asked before speech leaves the device (own apps); sealed apps always asked; where the words are made is on the listening strip. | docs/29 §3 | doc |
| F-45 | Cloud recordings are at most a minute and thrown away if the person leaves. | docs/29 §2, §8 | doc |

## Studio and Ask

| # | Claim | Proof | Status |
|---|---|---|---|
| F-46 | Engines a deployed build offers: on-device (WebLLM), Chrome's built-in model, Anthropic and OpenRouter with the person's key. `claude -p` only on a dev server. | `shell/src/engines.ts` `ENGINES`; `engine-store.ts` `startingConfig` | code. An OpenAI or local-server engine is **not in the shell today**: the public text does not name them |
| F-47 | The Studio does not use the free allowance (only apps' AI and Firefox voice do). | `app-ai-caps.ts`, `studio-voice.ts` are the only `createAppAi` callers | code |
| F-48 | Ask sends the definition, the request, context and pasted material, never records. Ask needs OpenRouter and the person's key. | `shell/src/start-ask.ts` header, `askRefusal` | code |
| F-49 | Ask's geocoding goes to nominatim.openstreetmap.org from the device, only with web search on. | `shell/src/ask-geocode.ts` header | code |
| F-50 | The on-device model is downloaded from huggingface.co (weights) and raw.githubusercontent.com. | `@mlc-ai/web-llm` 0.2.84 prebuilt config; `generator/src/webllm-backend.ts` | code |

## Requests to the team

| # | Claim | Proof | Status |
|---|---|---|---|
| F-51 | A request holds the person's words, the app's name and structure (no records), the language, a request id and the device id. The issue shows the words, language, app and request id, never the device id or address. Rate limits per device and per address are in memory. | docs/16 "Requests to the Potyro team"; `platform-requests/src/request.ts` `issueBody`; `relay.ts` header | code |
| F-51a | The card says the request is posted publicly on GitHub; the wording form says the same. | `shell/src/platform-request-card.tsx` ("It is posted publicly on GitHub…"), `suggest-wording.tsx` | code |
| F-51b | The request relay is live on potyro.app. | `https://potyro.app/requests/health` → `{"ok":true}` | observed |

## Rooms

| # | Claim | Proof | Status |
|---|---|---|---|
| F-53 | Nothing on disk; a room ends with its last member; frames passed on unread; not end-to-end encrypted; logs only start and stop. | docs/26 §4; `rooms/src/relay.ts`, `server.ts` (only start, stop and fatal errors are logged) | code |
| F-54 | Held while live: a random member id, the display name the app passes (`opts.name`, ≤ 40 characters), per-address counts. | docs/26 §1, §3; `host/src/sockets.ts` (`cleanName(opts?.name)`) | code |
| F-54a | The rooms relay is live on potyro.app. | `https://potyro.app/rooms/health` → `{"ok":true,…}` | observed |

## Other services the browser contacts

| # | Claim | Proof | Status |
|---|---|---|---|
| F-55 | Map tiles come from tile.openstreetmap.org. | `views/src/map.tsx` `MAP_STYLE` | code |
| F-56 | Libraries are fetched once at install, with consent for packages, often from esm.sh. | `shell/src/library-fetch.ts`, `package-libraries.ts` | code |
| F-57 | A sealed app reaches the internet only with permission. | docs/07, docs/28; `ctx.caps.network` is gated (CLAUDE.md rule 6) | doc |

## Hosting, retention, safety

| # | Claim | Proof | Status |
|---|---|---|---|
| F-07 | What the web server in front of potyro.app (Caddy, by its `alt-svc: h3` header) logs, and for how long; whether `jazz-run` logs addresses. | `deploy/potyro.app.Caddyfile` is the live config (read on the server 2026-11-01): the potyro.app block has no `log` directive, so Caddy writes no access log for it, and potyro.com's discards its own. What `jazz-run` and the other containers print goes to `docker logs` (how long Docker keeps that was not read from the server); whether `jazz-run` prints addresses is not checked. The old site (apps.vaz.io, Apache) kept `combined` access logs. | **to verify** (`jazz-run`, and Docker's log retention). The public text says only that the server receives the IP address |
| F-58 | Hosting is Hetzner. The box is `65.109.228.5`. | the owner's deployment notes (potyro-app/notes). RIPE RDAP for that address: netname `CLOUD-HEL1`, country `FI`, which points to Hetzner Cloud, Helsinki. | observed, and the owner confirmed the location on 2026-11-07 (Finland, EU). The public text says `Finland (EU)` |
| F-59 | One relay, no backup yet. | #214 open: no nightly backup, no offsite copy, no restore drill. docs/16 mentions backups only as planned. | doc |
| F-60 | The sync relay on potyro.app is live. | `/sync` did not answer a plain GET within 10 s (it expects a websocket). | **to verify** |
| F-61 | Mail for potyro.com and potyro.app goes to Gandi. | `dig MX potyro.com` → `spool.mail.gandi.net`, `fb.mail.gandi.net` (same for potyro.app) | observed. On 2026-11-01 Gandi's server accepted `RCPT TO` for contact@, abuse@ and security@potyro.com and rejected privacy@ ("User unknown"): the three exist, privacy@ does not |
| F-62 | The gallery on potyro.com keeps no access log. | docs/16 "The gallery" (Caddy `log { output discard }`) | doc; whether it is applied on the server: **to verify** |
| F-63 | The gallery's "Report a link" and a hosted demo link's Report mail the report address (`abuse` in `shell/src/contacts.json`); abuse@potyro.com since 2026-11-01; were it a placeholder again, contact@potyro.com. | docs/24 §4, §10; `gallery/src/build.mjs`; `shell/src/contact.ts`, `demo.tsx` | code |
| F-64 | potyro.app answers without a gate (public). | `curl -sI https://potyro.app/` → 200, no auth | observed |
| F-65 | `/privacy` and `/terms` on potyro.app currently serve the app shell (the SPA fallback), not these texts. | `curl https://potyro.app/privacy` → the shell's `index.html` | observed |

## Rights and erasure

| # | Claim | Proof | Status |
|---|---|---|---|
| F-29 | A demo link can be deleted by id. | see above | code |
| F-52 | A space's data can be removed from the relay, by hand, with the relay stopped; a device that still holds the space puts it back when it next syncs, and backups keep it until they age out. | `store/scripts/erase-space.mjs`, tested on a database made by cojson in `store/test/erase-space.test.ts` (including the copy coming back); docs/16 "Erasing a space or an account from the relay" | code; never run on potyro.app yet. The public text says "we will try, by hand" |
| F-66 | GitHub issues can be deleted by a repository admin. | GitHub feature, not Potyro code | to verify on `potyro-app/potyro` once public |
| F-67 | The identity id is shown under You, Advanced. | `shell/src/identity-panel.tsx` ("Identity `{me.id}`") | code |
| F-68 | Export saves an app with its records as a file. | `shell/src/App.tsx` app menu `Export`; docs/16 (the person's export of a shared app, `missingFiles`) | code |

## Commitments the owner makes (not code)

- Reply to rights requests within one month (GDPR art. 12(3)).
- Act on content reports and say what was done (DSA art. 16).
- Tell people in the app before a change that matters applies. **No mechanism exists yet** to show
  a notice of changed terms in the shell.
- Retention of emails sent to the contact addresses: `<RETENTION, to decide>`.

## Legal references, for counsel only

Not cited in the public text. Pointers for the review, not legal advice.

| Topic | Where | Where it shows |
|---|---|---|
| Information to give | GDPR arts. 12–14 | privacy.md, all of it |
| Legal bases | GDPR art. 6(1)(b) contract (the features), 6(1)(f) legitimate interest (limits, abuse), 6(1)(c) legal obligation | "Why we handle this data" |
| Processors | GDPR art. 28: agreements with Hetzner, OpenRouter, GitHub, Gandi | "Who else handles data for us" |
| Transfers outside the EU | GDPR arts. 44–49 (adequacy, the EU-US Data Privacy Framework, or standard clauses) | "may be outside the EU" |
| Records of processing | GDPR art. 30 (the exemption under 250 people may not apply: processing is not occasional) | README open points |
| Rights and complaint | GDPR arts. 15–22, 77; Garante per la protezione dei dati personali | "Your rights" |
| Age 14 | GDPR art. 8; Codice privacy (D.Lgs. 196/2003) art. 2-quinquies | "Age" |
| Device storage | ePrivacy Directive art. 5(3), Codice privacy art. 122: storage strictly necessary for a service the person asked for | "What stays on your device" |
| Hosting and notices | DSA (Reg. 2022/2065) arts. 11–12 (points of contact), 16 (notice and action), 17 (statement of reasons) | terms.md "Reporting illegal content" |
| AI transparency | AI Act (Reg. 2024/1689) art. 50, applying from 2 August 2026: people told they deal with AI; AI-made content | "AI can be wrong" in both texts |
| Liability limits | Codice civile art. 1229 (no exclusion for intent or gross negligence); Codice del consumo (D.Lgs. 206/2005) arts. 33–36 (unfair terms) | terms.md "Liability" |
| Free digital services | Directive (EU) 2019/770, art. 3(1), in Codice del consumo arts. 135-octies ff.: may apply where a person provides personal data | terms.md, README open points |
| Governing law for consumers | Rome I (Reg. 593/2008) art. 6; Brussels I bis (Reg. 1215/2012) art. 18 | terms.md "Law and disputes" |
