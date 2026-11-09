---
title: ctx.caps.speech
description: listen(): live words as the person speaks, the session, its results, languages and permission.
section: reference
order: 8
---

# ctx.caps.speech

`ctx.caps.speech.listen()` turns what the person says into text while they speak.

```ts
const s = await ctx.caps.speech!.listen({ language: "pt-BR" });
s.onText((text, final) => setDraft(text));     // everything heard so far
// … later, from a Stop button:
s.stop();
const words = await s.result;                   // the whole text, "" when nothing was said
await ctx.create("note", { body: words });
```

## `listen(opts?)`

```ts
listen(opts?: SpeechOptions): Promise<SpeechSession>
```

Resolves once the microphone is on. Rejects with an `Error` whose `code` is a `SpeechFailure`.
One listening runs at a time; starting a new one ends the last.

### Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `language` | string | `ctx.locale`, with the region the person's browser prefers | a language tag such as `"pt-BR"` or `"en-GB"`, or a Potyro language such as `"pl"` |
| `interim` | boolean | `true` | words while the person is still speaking; `false` hands over finished sentences only |

## `SpeechSession`

| Member | Type | Notes |
|---|---|---|
| `language` | string | the tag it listens in, `"pl-PL"` |
| `engine` | `"device" \| "browser" \| "cloud"` | where the words are made; see below |
| `listening` | boolean | `false` once it has ended |
| `onText(cb)` | `(text: string, final: boolean) => void` | everything heard so far, each time it changes; returns the unsubscribe |
| `stop()` | | stop listening; `result` then resolves; safe to call twice |
| `result` | `Promise<string>` | the whole text once it has ended; rejects with a `SpeechFailure` code |

`text` is cumulative: show it as it is, there is nothing to stitch. `final` is `false` while the
last words may still change. An `onText` registered late hears the newest text at once.

### Engines

| `engine` | Where the words are made | The recording |
|---|---|---|
| `"device"` | on this phone or computer | never leaves it |
| `"browser"` | the browser's own speech service | goes to that browser maker's servers |
| `"cloud"` | an AI service, where the browser has none | is sent to it; no interim words, `onText` fires once, at the end |

Potyro picks the engine per device, on-device first. The person is told which before it starts.

### When a listening ends

- the app calls `stop()`
- the engine takes a pause as the end
- the person leaves the app
- Potyro is hidden: at once, a microphone never runs behind the person's back
- a new `listen()` starts
- five minutes pass, or one minute with the `"cloud"` engine

A transcript is cut at 20,000 characters. There is no event for why it ended; when it failed,
`result` rejects and says so.

### Failures

| `code` | What happened |
|---|---|
| `"denied"` | the person said Not now, or the microphone is blocked; asked again next time |
| `"unavailable"` | no microphone, or no way to turn speech into words on this device |
| `"offline"` | the words are made online and the device is offline |
| `"failed"` | the engine stopped with an error; its words are in `message` |

## Permission

```ts
permissions: { speech: true }
```

| | Your own app | A shared (sealed) app |
|---|---|---|
| Has `ctx.caps.speech` | always, where the device can listen | only with `permissions: { speech: true }`; `undefined` otherwise |
| Asked | only when the recording would leave the device: `"browser"`, `"cloud"` | always, the first time |
| The answer | kept per app and per engine on this device; **Not now** is never kept | the same |

The question names the app, and says where the recording goes. Yes to the device engine is not yes
to a service. The browser or the phone asks for the microphone on top of Potyro's question.
Deleting the app forgets the answers.

With the `"cloud"` engine the recording goes through the app's AI path: the same per-app AI switch
in Edit tile, the same allowance and key as [ctx.caps.ai](ctx-caps-ai.md).

## Next

- [Device capabilities](../guides/device-capabilities.md): declaring permissions and wording refusals.
- [Asking the person](../guides/asking-the-person.md): the dialogs a voice note lands in.
- [ctx](ctx.md): everything else a function can reach.
