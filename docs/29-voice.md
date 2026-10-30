---
title: Voice input
description: The Studio's microphone and ctx.caps.speech.
status: current
order: 29
---

# 29 — Voice input: the Studio's microphone and `ctx.caps.speech`

Status: built (2026-10-16), draft for the owner's review (§9). Potyro's audience does not code, and
the competitor's first screen is "tap and say the app you want". So the Studio has a microphone in
its box, and apps have `ctx.caps.speech`: live words as the person speaks, in their language. The
types are in `packages/schema/src/types/speech.ts`; the Studio's model reads them with
`lookup("ctx.caps.speech")`.

## 1. The API

```ts
const s = await ctx.caps.speech.listen();          // resolves once the microphone is on
s.language;                                        // "pl-PL": the tag it listens in
s.engine;                                          // "device" | "browser" | "cloud" (§2)
s.onText((text, final) => show(text));             // everything heard so far; returns the unsubscribe
s.stop();                                          // keep what was heard
const words = await s.result;                      // the whole text ("" if nothing was said)
```

`listen({ language?, interim? })`: `language` is a tag ("pt-BR") or a Potyro language ("pl"); the
default is the person's, `ctx.locale`, with the region their browser prefers (else the usual one:
`pl` → `pl-PL`). `interim: false` hands over finished sentences only.

`text` is cumulative on purpose: an app shows it as it is, and never has to stitch pieces together.
An `onText` registered late hears the newest text at once, so nothing said between the `listen` and
the subscribe is lost.

`listen()` and `result` reject with an `Error` whose `code` the app words:

| `code` | What happened |
|---|---|
| `"denied"` | the person said Not now (asked again next time), or the microphone is blocked |
| `"unavailable"` | no microphone, or no way to turn speech into words here |
| `"offline"` | the words are made online and the device is offline |
| `"failed"` | the engine stopped with an error (its words in `message`) |

A listening ends when the app calls `stop()`, when the engine hears a pause, when the person leaves
the app, when Potyro is hidden (at once — a microphone never runs behind the person's back), when a
new listening starts (one at a time per page), or after five minutes (one minute for the cloud
engine). A transcript is cut at 20,000 characters.

**Why `onText` + `result` and not events for everything.** The two things apps do are "show it as
it is said" and "use what was said"; a session object with a callback and a promise is exactly that,
and it crosses the sealed box as one number (§5). There is no `onEnd(why)`: why it ended is the
platform's business except when it failed, and then `result` says so with a code.

## 2. Engines, privacy first

Where the words are made is decided per device, in this order, and the person is told which:

| Where | Engine | Where the audio goes | `engine` |
|---|---|---|---|
| Chrome/Edge with an on-device model for the language (`SpeechRecognition.available({ processLocally: true })` → `"available"`, Chrome 139+) | the browser's SpeechRecognition with `processLocally = true` | nowhere | `device` |
| Chrome, Edge, Samsung Internet… otherwise | the browser's SpeechRecognition | **Google's** servers (Chrome), **Microsoft's** (Edge) | `browser` |
| Safari (macOS, iOS) | `webkitSpeechRecognition` | **Apple** — on the device for some languages on recent versions, but a page cannot tell, so it is named as Apple's service | `browser` |
| Android app | Potyro's `PotyroSpeech` plugin: `createOnDeviceSpeechRecognizer` (Android 12+) where the language is on the phone | nowhere | `device` |
| Android app, no on-device model | the system recognizer with `EXTRA_PREFER_OFFLINE` | the phone's offline model if it has one, else **Google's** servers — named as Google's | `browser` |
| iOS app | the WebView's speech recognition today; the `PotyroSpeech` Swift template (`requiresOnDeviceRecognition` where supported) once the iOS developer adds it (docs/27 §4.7) | Apple / nowhere | `browser` / `device` |
| Firefox desktop (no SpeechRecognition) | **the cloud engine**: MediaRecorder → 16 kHz mono WAV → the AI relay, or the person's own OpenRouter key | **OpenRouter** (Gemini 2.5 Flash Lite, providers that do not keep data) | `cloud` |

The detection is in `packages/capabilities/src/speech.ts` (`pickEngine`, `browserService`), the
Android one in `packages/native/src/native-speech.ts`.

**The cloud engine** records until the person stops, or until two seconds of quiet after speech
(eight with no speech at all), or one minute. Then the recording is decoded and resampled in the
browser (`wav.ts`: `OfflineAudioContext`, 32 KB a second, under 2 MB a minute) and sent as one
`audio` part through the app's own `ctx.caps.ai` machinery (shell `app-ai.ts`): the AI switch in
Edit tile, the free allowance first, then the person's own key, the same per-app rate and monthly
cap, the same spend in Edit tile. The model is told to write down exactly what was said
(`TRANSCRIBE_SYSTEM`, shell `app-speech.ts`). A recording made while the person walked away (left
the app, hid Potyro, started another listening) is thrown away, never sent. There are no interim
words in this engine — the strip says "Writing down what you said…" while it waits.

## 3. Trust and the question

| | Your own app | A shared (sealed) app | The Studio |
|---|---|---|---|
| Has it | always (where the device can listen) | only with `permissions: { speech: true }`; absent otherwise | always |
| Asked | only when the recording would leave the device (`browser`, `cloud`) | always, the first time | only when it would leave the device |
| The words | “**“Pantry” wants to listen to you through the microphone.**” + what happens to the recording — on this device; on Google's/Apple's/Microsoft's servers; or sent to an AI service (OpenRouter) "— it leaves your device". **Allow** / **Not now** | the same | “**Use your voice to describe the app?**” + the same honesty, "You can read and change the words before sending them." **Use my voice** / **Not now** |
| Kept | per app and per way of listening, on this device: `potyro:speech:<appId>` (`["device"]`, `["device","cloud"]`…), never `ctx.storage`; forgotten when the app is deleted; Not now is never kept | the same | `potyro:speech:potyro-studio` |

An answer is for a way of listening: yes on the device is not yes to a service. Two listens at once
ask one question. The words are in the six languages (Lingui, glossary docs/21), and the "where"
words — *On this device*, *Through Google's speech service*, *Sent to OpenRouter to write down* —
are also on the listening strip, so "leaves your device" is never small print.

The browser asks for the microphone on top of Potyro's question (its own prompt, once per site);
Android asks for RECORD_AUDIO at the first listening; iOS needs the usage strings (§6).

## 4. The Studio's microphone

A round button beside Send (`voice-input.tsx`, `studio-voice.ts`). **Hold** it to talk and let go
when done, or **tap** it to start and tap again (■) to stop; Enter or Space toggles it from the
keyboard. While it listens the button turns into a red stop with a breathing ring, the box takes the
same colour, and a strip above the box says *Listening — tap ■ to stop* (or *let go when you're
done* while held) with where the words are made. The words appear in the box as they are said, after
whatever was already typed, and stay there to be changed; typing or sending stops the microphone.
The button is not there at all on a device that cannot listen. Model settings is not involved: voice
uses no model on the device, and in Firefox it uses the AI path apps use (§2), which the question
names.

## 5. Sealed apps

The host holds the microphone; a sealed app holds a number for its listening (`lid`), exactly as for
live connections (docs/28 §4). Two ops — `caps.speech.listen`, `caps.speech.stop` — go to the host
(`host/src/speech-bridge.ts`); events go in as `{ t: "speech", ev }` on the realm's port, or through
`__potyro.speech(json)` into QuickJS: `{ kind: "text", text, final }`, then one `{ kind: "end", text,
code? }`. Each text carries everything so far, so a box that is slow to take them gets the newest
one, not a backlog. The ctx a listening was started through stays nameable while it runs. A box the
watchdog stops, or closing the app, ends its listening and keeps nothing.

## 6. Native permissions

- **Android** (`scripts/patch-manifest.mjs`): `RECORD_AUDIO` — for voice only, asked at runtime by
  the plugin the first time something listens; the live camera still asks `getUserMedia` for video
  alone (docs/25). A `<queries>` entry for `android.speech.RecognitionService`, without which
  Android 11+ reports no recognizer. The plugin is `android-templates/SpeechPlugin.java`, copied and
  registered by `scripts/patch-android.mjs`. Compiled in an `assembleDebug` on 2026-10-16; not yet
  run on a phone.
- **iOS** (`scripts/patch-plist.mjs`): `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription` (without them iOS terminates the app when the WebView asks).
  `ios-templates/SpeechPlugin.swift` is for the iOS developer (docs/27 §4.7); uncompiled.

**Why our own plugin and not `@capacitor-community/speech-recognition`.** It is MIT and maintained
(7.0.1, peer `@capacitor/core >=7`, so it would install on 8), but: it has no on-device or
prefer-offline option on either platform, its iOS side ships a podspec and no `Package.swift`
(Potyro's iOS project is SPM-only, docs/27), and its `start()` resolves with matches at the end
rather than when the microphone is on. Ours is ~200 lines on each side, follows the precedent of
`PotyroLocalSocket` (docs/28 §6), and does what §2 needs.

## 7. Tests

- `packages/capabilities/test/speech.test.ts` — engine by environment, the browser recognizer and
  the cloud engine through fakes, one listening a page, hidden, too long, languages, the WAV.
- `packages/host/test/speech.test.ts` — who gets it, the question once per way of listening, Not now,
  a listening's life, the bridge; `speech-runners.test.ts` — trusted, realm and QuickJS.
- `packages/native/test/native-speech.test.ts`, `patch-*.test.ts`; `packages/ai-relay/test` — the
  `audio` part and its limits.
- e2e `studio-voice-trusted.spec.ts` (Chromium: fake SpeechRecognition; Firefox: the cloud engine
  with the relay mocked), `voice-sandbox.spec.ts` (realm, QuickJS, Firefox). `createFakeSpeech()`
  (capabilities) is a microphone in memory for unit tests; `e2e/voice.ts` the browser fakes.

## 8. Limits

| | |
|---|---|
| A listening | 5 min; 1 min for the cloud engine |
| A transcript | 20,000 characters |
| A recording to the relay | one `audio` part, `data:audio/wav;base64`, ≤ 2.7 MB, never with a picture (docs/16) |
| At once | one listening per page |

## 9. Open questions for the owner

1. **Trusted apps on Chrome are asked once** because Chrome sends audio to Google. Is that the right
   call for the person's own apps, or should their own apps be asked only for the cloud engine?
2. **Firefox voice spends the free AI allowance** (about $0.0006 a minute). Count Studio dictation
   against the same allowance as apps, or give voice its own?
3. **Android's recognizer is one utterance**: it ends after a pause, as Android keyboards do. A
   long description needs a tap again. Restart it automatically while the person holds the button?
4. **iOS**: rely on the WebView's recognizer (Apple's servers or on-device; the page cannot tell)
   until the iOS developer compiles the Swift plugin, or keep voice off on iOS until then?
