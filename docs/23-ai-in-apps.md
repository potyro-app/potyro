---
title: AI in apps
description: ctx.caps.ai: the API, the permission, who pays, the model, where each part lives.
status: current
order: 23
---

# 23 · AI in apps — `ctx.caps.ai` (#213, part 3)

Status: built, and the free allowance's relay is deployed on potyro.app (`/ai/health` answers ok,
checked 2026-10-30). Where it is not running, apps use the person's own OpenRouter key, and say
plainly when there is none (docs/16 "AI for apps"). The relay's chat route for the Studio and Ask
(#468) is merged but not running there yet: on 2026-10-30 `POST https://potyro.app/ai/v1/chat/completions`
answered 404. The shell's "Potyro" engine sends it (#121, below), and offers itself only once the
relay's `/health` says `chat: true`, so until then nothing changes for anyone.

## Why

The apps people tell a friend about do something a person cannot do by hand: photograph a receipt
and get its lines and prices, photograph a poster and get a calendar event, photograph a shelf and
get what is about to expire, photograph a sick plant and get what is wrong with it. Each of them is
one call: *read this, give it back in this shape*. Ask (#213 part 1) lets the PERSON bring a model
to an app; `ctx.caps.ai` lets the app's BUILDER put one behind a button.

## The API

```ts
// read a photo (or a text) into the app's own shape — validated before the app sees it
const receipt = await ctx.caps.ai!.extract({
  image: photo,                       // Blob | Uint8Array | FileRef | MediaRef | a file path — or an array of them
  text: pasted,                       // optional, instead of or beside the image
  instructions: "A shop receipt. One entry per line bought; skip totals, tax and payment lines.",
  schema: {                           // a plain shape, not Zod, not JSON Schema
    shop: "text?",
    date: "date?",                    // "YYYY-MM-DD"
    items: [{ name: "text", price: "number", kind: { oneOf: ["food", "drink", "other"] } }],
  },
});
// receipt: { shop: string | null; date: string | null; items: { name: string; price: number; kind: "food" | "drink" | "other" }[] }

// or just words back
const advice = await ctx.caps.ai!.ask("What is wrong with this plant, and what should I do?", { image: photo });
```

**The shape.** `"text" | "number" | "boolean" | "date"`, each with a trailing `?` when it may be
missing (`null`); `{ oneOf: [...] }` for one of a list (`optional: true` allows `null`); `[shape]`
for a list of them; `{ key: shape }` for an object. That is all, on purpose: it is what a form
field already is, a generated app writes it without mistakes, and its TypeScript type is inferred
(`AiValue<typeof schema>`), so `receipt.items[0].price` is a `number` in the editor.

**Validated by the host, not trusted.** The host turns the shape into a strict JSON Schema for the
provider's structured output, then checks what comes back against the shape itself: a number in a
string (`"12,50"`) becomes `12.5`, an option in another case becomes the declared one, an empty
optional becomes `null`, a missing list becomes `[]`, unknown keys are dropped. When something
still does not fit, the model is asked once more with the problems listed; when the second answer
does not fit either, `extract` throws ("The AI's answer did not fit what this app asked for"). The
app never receives a value outside its shape.

**Images are resized on the device** (by the shell, outside the sealed box) — at most 1600 px on the
long side, re-encoded as JPEG — before they leave it: a 12-megapixel phone photo is ~4 MB, and a
model reads a receipt as well at a tenth of that. At most four images and 20 000 characters of text a call.

**Language.** Words the model writes itself (a category, an explanation, `ask`'s answer) are in
the person's language — the shell's own language, else the app's `ctx.locale`. Names copied off the
image stay as written.

## Permission

```ts
permissions: { ai: true }
```

- **Declared, like every other capability.** A sealed (shared) app without it has no
  `ctx.caps.ai` at all. A trusted app (your own) has it whenever the device does.
- **A sealed app asks first** — once per app, on this device, at the first call, naming the service
  and what goes:

  > **“Receipt Split” wants to send a photo to an AI service (OpenRouter) to read it.**
  > Only what the app sends goes: this photo and its question — nothing else in the app.
  > Free while this month's allowance lasts; then your own OpenRouter key, usually under 1¢.
  > [Not now] [Allow]

  The last sentence says who would pay **as things are now**, and never promises what the device
  cannot keep. "Free while…" only when the free relay answered recently (a request, or a look at its
  `/health`, which sends nothing); otherwise "It uses your own OpenRouter key from Model settings,
  usually under 1¢ a request.", or, with no key either, "AI isn't available until you add your own
  OpenRouter key in Model settings." A text-only call says "some text" instead of "a photo". *Allow* is remembered for that app;
  *Not now* refuses this call and asks again next time.
- **Per app on/off.** Edit tile has "AI" for any app that has used it: off, every call refuses
  ("AI is turned off for this app") — for trusted apps too, because it is the person's money and
  their photos, not the app's. On again, it is allowed again. Deleting the app forgets the answer,
  so another app arriving under the same id asks afresh.
- **Records are never sent unless the app passes them.** `ctx.caps.ai` takes what the call names
  and nothing else; there is no ambient context. This is the cloud rule of #213 ("structure only,
  never records") applied the only way it can apply to app code: an app that passes a record's text
  is the person's app doing what its builder wrote, and a sealed one only after the prompt above.
- **Keys never reach app code.** The app names a kind of work; the shell holds the key, picks the
  service and makes the call (CLAUDE.md rule 2).

## Who pays

Owner decision 2026-10-15: **both**, free first.

1. **The free allowance.** A small relay (`packages/ai-relay`, beside the platform-request relay)
   holds Potyro's OpenRouter key, fixes the model, the token cap and the provider settings, and
   meters: per device a day and a month, per address a day (an IPv6 address by its /64), and **a
   monthly and a daily spending cap for the whole service, checked before every dispatch** with the
   most the request could cost on top of every request still out. A device id is random and says nothing about the
   person.
   Deployment and every limit: docs/16 "AI for apps".

   **The chat route** (#468, `packages/ai-relay/src/chat.ts`) is the same relay's passthrough for
   the Studio and Ask, not for apps: `POST /ai/v1/chat/completions` takes an OpenAI-shaped chat
   request (messages, tools, reasoning), sends it on only for an allowlisted model with the token cap
   clamped and `data_collection: "deny"` forced, pipes the answer back as it streams, and holds each
   device to a monthly allowance in US dollars, debited from OpenRouter's `usage.cost`. Web search is
   refused until a paid plan exists (none does). It shares the service's monthly and daily caps with
   `/complete`. The Studio and Ask reach it as the **Potyro engine** (below); docs/16 "AI for apps"
   has its limits, its kill switch and how to check it once it runs.
2. **Then the person's own key** — the OpenRouter key in Model settings (session-only, as for Ask)
   — when the allowance is used up, the relay is not reachable, or it is not deployed.
3. **Neither:** the call throws, in words the shell shows as the action's failure:
   - relay not deployed or not reachable: *"Free AI isn't available yet — add your own key in Model
     settings."*
   - allowance used up: *"This month's free AI is used up — add your own OpenRouter key in Model
     settings."*

### The chat route's refusals

Every refusal from `POST /ai/v1/chat/completions` is in OpenAI's error shape, so an OpenAI-style
client reads it as an error, with a code the shell maps to its own words and an English `message`
that already says what to do next (shown as it is where the shell has nothing better):

```json
{"error": {"code": "allowance", "message": "This month's free AI on this device is used up. To keep going, add your own key in Model settings.", "type": "potyro"}}
```

A refusal about one field of the request also carries `param`, the field's name. The codes
(`ChatErrorCode` and `CHAT_MESSAGES` in `packages/ai-relay/src/chat.ts`):

| Code | Status | When | What the shell does |
|---|---|---|---|
| `allowance` | 429 | The device's month is used up — or what is left is not enough for this request (a shorter one may still fit; the message says so) | Move to the person's own key |
| `address-day` | 429 | This network's day is used up (an IPv6 network by its /64) | Own key; else "back tomorrow" |
| `service-day` | 429 | The whole service's day is used up | Own key; else "back tomorrow" |
| `service-month` | 429 | The whole service's month is used up | Own key |
| `busy` | 429 | The device has too many requests out | Wait and retry |
| `off` | 503 | The kill switch is on | Own key; else "try later" |
| `device` | 401 | No `Bearer potyro-device:<id>` | A bug: update |
| `model` | 400 | A model the free allowance does not offer | Use the default model, or own key |
| `plan` | 403 | Web search or another server tool, which needs a plan (none exists) | Without web search, or own key |
| `request` | 400 | Not JSON, or a field that is unknown or wrong (`param`) | A bug: update |
| `too-big` | 413 | Over 4 MiB | Start a new chat, or own key |
| `method` | 405 | Not a POST | A bug: update |
| `upstream` | 502 | OpenRouter failed, or refused Potyro's key | Retry, or own key |

Every `429` but `busy` carries `x-potyro-left-usd`. A refusal from OpenRouter itself that the sender
can act on (a 400 such as "reasoning is mandatory") is passed back as OpenRouter sent it.
`/complete` keeps its own shape (`429 {"ok":false,"error":"allowance","reason":…}`, with
`service-day` among the reasons), which the shell already reads.

### The Potyro engine: the Studio's free path (#121, #455)

- **Offered only when it serves.** `GET /ai/health` answers `{ok, chat, model}`: `chat` is true while
  the chat route is wired and its kill switch is not thrown, and `model` is the one it sends. A
  deployed build asks at shell start (so Ask and Fix this start on it too), again when the browser
  comes back online, and when the Studio or Model settings opens, through the same look as an app's
  consent question (`relayHealth` in `app-ai.ts`): an answer is remembered ten minutes; no answer
  (offline, unreachable, slower than 3 s) is *unknown*, remembered a minute, and decides nothing.
  With `chat: true`, Model settings lists **Potyro** first under Cloud; otherwise it is not there.
  Until the first look answers, the Studio shows neither the panel below nor "needs an API key".
- **What it is.** The ordinary chat engine (OpenRouter's request shape, which the relay passes on) at
  `{site}/ai/v1`, with `Authorization: Bearer potyro-device:<id>` (the random device id) and the model
  `/health` named; thinking off. No key, no model choice. Ask's web search is not offered on it.
- **The starting engine** on a deployed build (no `claude -p`), for a person who has not chosen in
  this tab and has no key remembered on this device (`engine-store.ts` `checkFreeEngine`). Otherwise
  today's start: OpenRouter, which asks for a key. A config on Potyro goes back to that start only
  when `/health` definitely says `{ok: true, chat: false}`; with no answer it stays, and says free app
  making can't be reached right now.
- **What is left**, from `x-potyro-left-usd`, in words on the engine button and in Model settings:
  *plenty left* from $0.10, *a little left* under it, *used up* under $0.02 (the relay's least hold,
  `AI_CHAT_RESERVE_USD`, so no request fits). Never dollars or cents (`free-ai.ts` `leftOf`).
- **Refusals in words** (`refusalText`), each with what to do next, always the shell's own sentence
  in the person's language (the relay's `message` is English, for whoever reads the wire).
  `allowance` (used up), `service-day`, `service-month`, `address-day` and `off` stop free app
  making: the Studio shows the **no-dead-end panel** in place of the composer, the stop's sentence
  first. A month's stop (`allowance`, `service-month`) is kept on the device until the month is
  over, a day's (`service-day`, `address-day`) until the day is (`potyro:free-ai-stop`: the code and
  the month or day, nothing else); `off` lasts the page, and makes `/health` be asked again.
  `allowance` is a stop only when its `x-potyro-left-usd` is under the relay's least hold ($0.02):
  with more left, this one request does not fit and a shorter one may, so it is said as *"This
  conversation is too long for the free allowance. Start a new app, or add your own key."* and
  nothing is kept. `busy`, `plan`, `too-big`, `upstream` are said and nothing stops; `device`,
  `model`, `request`, `method` say to reload. Fix this returns any of them as its refusal, never a
  throw (`start-fix.ts`).
- **The panel** shows whenever no engine can make an app (no free route and no key, or it stopped):
  one line on what a key is and costs, links to get one (OpenRouter, Anthropic) and "or any
  OpenAI-compatible server, in Model settings", Add a key (or "Use your OpenRouter key" when one is
  already in Model settings), **Start from an app in the gallery** (the gallery's Make it mine needs
  no key), and "I'd pay for a plan", a count and nothing more.
- **Remember on this device** (#455): an opt-in switch under each key field, off by default. On, the
  key goes into the device's secret vault (the identity's: the platform keystore, or a non-extractable
  AES key in the browser), never localStorage; an endpoint is kept whole. Forget takes it out of the
  vault and the field. Loaded at start; a remembered key's engine is where that person starts. No
  vault, no switch (`remembered-keys.ts`). The vault writes for each kind run one after another,
  and only the latest asked for runs, so a fast typist or a Forget never leaves an older key there.
- **The device id** is random, kept in localStorage; where it cannot be kept, it is a random id for
  the page, never a fixed string that every such device would share (`device-id.ts`).
- **Ask on Potyro** says where the request goes: Potyro passes it to OpenRouter and the model it picks.

### Counts (#118)

The shell posts `{"event": "own-key"}` the first time a key is typed into Model settings in a month,
and `{"event": "want-plan"}` when "I'd pay for a plan" is pressed — each at most once a
calendar month per device (`potyro:counted:<event>:<month>`), only to a relay whose `/health`
answered, with no device id, no cookies (`credentials: "omit"`), no referrer and no header but the
content type (`demand-counts.ts`, tested). **You → Counts → Count me anonymously** (on by default;
its help: "That I used my own key, or that I'd pay for a plan") turns those two off, and only those.
`exhausted`, "used up", is counted by the relay itself as part of keeping the allowance (it already
holds each device's month to meter it), so the switch does not reach it. Pressing "I'd pay for a
plan" promises nothing back: no notice when a plan exists is built (#118 item 3).

**On the person's key** two guards run on the device before dispatch: 20 calls a minute per app (a
loop in an app's code must not empty a wallet) and $1 a month per app. Past either, the call
refuses and says why.

**Spend is shown.** What each call cost (OpenRouter's own `usage.cost`) is added to a per-app,
per-device total — the same mechanism as Ask's (`ask-spend.ts`), kept apart from Ask's — and Edit
tile shows it beside the switch: "AI in this app has used 0.4¢ of your OpenRouter credit on this
device." Free calls cost the person nothing and add nothing.

## Model

`google/gemini-2.5-flash-lite` on OpenRouter, for both paths: vision, structured outputs, a 1M
context, $0.10 / $0.40 per million tokens. A resized receipt is ~1 300 input tokens and ~300 output,
about **$0.0003 a photo** — 3 000 receipts per dollar. It is a Google model with strong OCR, its
reasoning is off by default (fast, predictable cost), and it is a GA model rather than a preview.
Requests ask OpenRouter for providers that do not collect data (`provider.data_collection:
"deny"`), and for one that honours the JSON Schema (`require_parameters`). The person's Model
settings choice is for *building* apps (a coder model, often without vision) and is not used here.
Changing the model is one constant in `@potyro/ai-relay` (`AI_MODEL`) and the relay's `AI_MODEL`
environment variable.

## Time and the network

- **Offline:** refused at once, never queued and never hung: *"You're offline. AI needs the
  internet — try again when you're connected."* Nothing in the runtime waits on it (CLAUDE.md
  rule 6): it is a capability the app called, and its failure is the call's.
- **Timeout:** 60 s for the whole request, body included; then *"The AI service took too long to
  answer."* Each way of paying has its own 60 s; a relay that is not there (the site's own page or a
  404 comes back) is not asked again for ten minutes.
- **Sealed runners:** a call in flight is the world's time, not the app's: the browser realm and the
  QuickJS isolate pause the call's CPU budget while it waits, as they do for a consent prompt.

## Where each part lives

| Part | Package | Why there |
|---|---|---|
| `AiCapability`, `AiShape`, `AiValue`, `permissions.ai` | `potyro` (schema types) | the contract (docs/04) |
| `AiCap` (send one request) | `@potyro/capabilities` | the platform seam (docs/05); optional, composed by the shell |
| shape check, JSON Schema, prompt, validation, retry, image resolving | `@potyro/host` `ai.ts` | the same for every runner; mediation in `mediate.ts` |
| realm op `caps.ai.extract` / `caps.ai.ask` | `@potyro/host` realm | allow-listed in `OPS`; a `Blob` crosses by structured clone |
| QuickJS ops `cap.ai.*` | `@potyro/host` isolate | bytes cross as base64; a `FileRef` / `MediaRef` as itself |
| free first, own key, resize, offline, timeouts, guards, spend, on/off | `@potyro/shell` `app-ai.ts` | holds the key and the person's choices |
| wire format, OpenRouter body, relay, server | `@potyro/ai-relay` | browser-safe format + Node relay, no Potyro dependencies |
| the Studio's and Ask's chat route, its dollar allowance, the demand counts | `@potyro/ai-relay` `chat.ts`, `counts.ts`, `ledger.ts` | the same key, the same cap, the same ledger |
| the Potyro engine, its refusals in words, the panel, remembered keys, counts | `@potyro/shell` `free-ai.ts`, `engines.ts`, `engine-store.ts`, `free-panel.tsx`, `remembered-keys.ts`, `demand-counts.ts` | the Studio's engine is the shell's choice |

## What this does not do

Image generation and editing (the original scope of #213) are not here: its blockers (provider
terms, the AI Act's labelling, minors) are unchanged. Streaming, tools and web search are not
offered to apps (the relay's chat route has streaming and tools, for the Studio and Ask only). An on-device model is not wired yet; `AiCap` is the seam it would plug into.

These are new optional members: no existing app changes, so `schemaVersion` is not bumped.
