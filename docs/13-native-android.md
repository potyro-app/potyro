---
title: Native Android
description: Running Potyro on an Android device through Capacitor: build, install, the device checklist.
status: current
order: 13
---

# 13 · Native Android (Capacitor) — run Potyro on a device

The Capacitor target wraps the **shell's web build** into a native Android app. Nothing about the app
code, the sealed box (the browser realm; QuickJS-WASM behind a flag), or the capability seam changes — the composition root just swaps
`WebCapabilities` for **`CapacitorCapabilities`** when it detects the native runtime
(`packages/native/src/index.ts` → `maybeCreateNativeCapabilities()`). The payoff is the one thing web
can't do: an **exact, offline reminder that fires with the app closed**.

**iOS** is the same target with a different shell: see [docs/27](27-ios.md) (handoff for the iOS
developer — build, signing, the WKWebView audit and its device checklist).

The generated `android/` project is **git-ignored** — it's reproduced deterministically from
`capacitor.config.ts` + the plugins, so you regenerate it rather than commit it.

## Prerequisites (already on this machine)

- **Android Studio:** `/home/aivuk/android-studio/bin/studio`
- **Android SDK:** `~/Android`  → export it so the CLI can find it:
  ```bash
  export ANDROID_HOME="$HOME/Android"
  ```
- **Node ≥ 22** — the Capacitor 8 CLI refuses older Node. If your default is 18:
  ```bash
  nvm use 22   # or: nvm install 22
  ```

## First run (generate + open)

```bash
# 1. Build the web app the native shell will wrap
pnpm --filter @potyro/shell build:web

# 2. Generate the Android project (first time only) — also patches the manifest for exact alarms
cd packages/native
pnpm cap:add:android

# 3. Open it in Android Studio, then press Run ▶ with your device connected (USB debugging on)
pnpm cap:open
```

Android Studio uses its **bundled JDK**, so the Run button avoids any CLI Gradle/JDK setup. On first
launch it will Gradle-sync; then pick your device and Run.

## Iterating (after web changes)

```bash
pnpm --filter @potyro/shell build:web      # rebuild web
pnpm --filter @potyro/native cap:sync      # copy dist → android + re-patch manifest
# then Run ▶ again in Android Studio (or `pnpm --filter @potyro/native cap:open`)
```

Shortcut for the whole loop: `pnpm --filter @potyro/native android` (build web → sync → open).

## What to test on the device

| Do | Expect |
|---|---|
| Open the app | Boots to **Recipes** (same UI as web) |
| Switch to **Plants** via the header dropdown → a plant's **Schedule** | Real Android **local notification** is scheduled (exact — `supportsExactScheduling=true`) |
| **Background or close the app**, wait for the due time | The reminder **fires with the app closed** — the deciding feature |
| Places → **+ New Place → Use my location** | Native **GPS** fills lat/lng (grant the permission prompt) |
| Add a photo field / capture | Native **camera** returns the image |
| Export an app | Writes the `.potyro.zip` into **Documents** via the native filesystem |
| From Files, **share** a `.md` (or several files) to Potyro | "Add this file to…" lists your apps; picking one opens its **Files** tab with the file in it (#254) |
| On a `.md` in Files, **Open with → Potyro** | The same question (ACTION_VIEW, read through the WebView from its `content://` address) |
| Share a `.potyro-app.zip` to Potyro | **Add an app** opens on the app's card |

The first schedule/GPS/camera call triggers the Android **permission prompt** — grant it. Exact alarms
use `USE_EXACT_ALARM` (Android 14+, no prompt) with `SCHEDULE_EXACT_ALARM` as the Android 12/13
fallback. They, the two **location** permissions and **CAMERA** are injected by
`scripts/patch-manifest.mjs` on every `cap:add`/`cap:sync`: a Capacitor plugin merges some of its
permissions and leaves the rest to the app, and without the location ones the geolocation plugin does
not ask the person — it refuses with "Missing the following permissions in AndroidManifest.xml", which
the geo field swallows, so "Use my location" silently does nothing. Found on a Pixel, 2026-09-16.

The same script puts Potyro in the share sheet and the "Open with" list: `SEND`/`SEND_MULTIPLE` for any
type (`@capgo/capacitor-share-target` copies each file into the app's cache) and `VIEW` on `content://`
and `file://` (`@capacitor/app` reports it as an opened URL). A manifest patched by an older build, with
the text-only filter, is upgraded in place. Not yet checked on a device (#254).

## Build tools: pinned to what Android Studio here can open

`cap add android` writes whatever the installed Capacitor ships with — currently **AGP 8.13 / Gradle
8.14** — and a Studio older than that refuses to open the project at all:

> The project is using an incompatible version (AGP 8.13.0) of the Android Gradle plugin. Latest
> supported version is AGP 8.9.2

So `scripts/pin-gradle.mjs` runs beside the manifest patch on every `cap:add`/`cap:sync` and pins
**AGP 8.9.2 / Gradle 8.11.1**, plus `android.suppressUnsupportedCompileSdk` (AGP 8.9 predates
compileSdk 36 and stops the build over it; the warning is the honest state of things, the failure is
not). `android/` is generated and gitignored, which is why the pin is a script rather than a
committed file. Both scripts are idempotent.

On a newer Studio, take the template's own versions instead:

```
POTYRO_AGP=keep pnpm cap:sync                       # leave whatever Capacitor generated
POTYRO_AGP=8.13.0 POTYRO_GRADLE=8.14.3 pnpm cap:sync  # or pin somewhere else
```

## What has actually been checked on a device

2026-09-16, Pixel 10 / Android 17, debug build:

- **An exact reminder fires with the app closed** — the deciding native feature. A task due at 15:27,
  the app closed to the home screen, and the notification arrived at 15:27:02 with its title and body.
  Android held it as `RTC_WAKEUP … window=0 exactAllowReason=policy_permission`, which is the
  `USE_EXACT_ALARM` permission this script injects.
  **Force-stopping is not the test**: Android cancels a force-stopped app's alarms
  (`Reason=alarm_cancelled` in `dumpsys alarm`), so the first attempt "failed" for a reason that has
  nothing to do with the app. Close it the way a person does.
- **Location** reads a real position through `ctx.caps.geo` (after the manifest fix above).
- **The camera takes a real photo** — a 3000×4000 JPEG from the phone arrived in the form. This one
  needed a second fix: the adapter called the plugin's `requestPermissions()` with no argument, which
  checks EVERY alias it has, and the photos alias demands `READ_EXTERNAL_STORAGE` in the manifest. The
  call failed, the rejection travelled back through `ctx.caps.camera`, and the menu simply closed —
  tapping "Take a photo" did nothing at all. It now asks for the one alias the capture needs
  (`camera`, or `photos` when picking from the library), so no storage permission is declared:
  declaring one to take a photo would be asking for every photo on the phone.
- Still unchecked on a device: store builds.

Useful while checking: `adb shell dumpsys alarm | grep -A3 app.potyro` for what is scheduled, and
`adb shell dumpsys notification --noredact | grep -B4 -A10 "<title>"` for what actually fired. The
WebView can be driven from a laptop over CDP — `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`,
then connect Playwright to `http://localhost:9222` — which is how the checks above were run. The
WebView pauses when the app is backgrounded, so keep the app in front while driving it.

## Local model on Android (the bonus test)

Once the app is on your device, open **New app → describe → On-device**. That runs **WebLLM** inside
Android's System WebView, which needs **WebGPU**. Recent Android WebView/Chrome builds have it — so a
local model may work with **no extra native code**.

- **If it generates:** you have on-device generation on Android already. 🎉
- **If it errors (no WebGPU):** that's the trigger for the next milestone — a **native model runtime**
  (Cactus or MediaPipe LLM Inference) exposed as another `ModelBackend`, bridged through a Capacitor
  plugin. We only build that if your WebView actually lacks WebGPU.

## Notes

- Everything above runs on **your** machine (the SDK/Studio live here). CI only builds/tests the web
  packages; it never compiles the Android project.
- **Potyro's own Java** lives in `packages/native/android-templates/` (android/ is generated):
  `scripts/patch-android.mjs` — run by `cap:add:android` and `cap:sync` — copies the
  `PotyroLocalSocket` plugin into MainActivity's package and registers it. It is plain `ws://` to the
  local network only (Home Assistant-style), for `ctx.caps.network.socket` (docs/28 §6): the WebView
  refuses ws:// from `https://localhost`. Nothing about cleartext is changed in the manifest or the
  network security config; the plugin checks every address a name resolves to is local and speaks the
  protocol itself. To try it on a phone: a trusted app with
  `await ctx.caps.network!.socket("ws://<your Home Assistant>:8123/api/websocket")` should get
  `{"type":"auth_required"…}` as its first message.
- **Voice input** (docs/29) is Potyro's own `PotyroSpeech` plugin
  (`android-templates/SpeechPlugin.java`, registered by `patch-android.mjs`): the on-device recognizer
  where Android 12+ has the language (`createOnDeviceSpeechRecognizer`), else the system recognizer
  with `EXTRA_PREFER_OFFLINE`. `patch-manifest.mjs` declares `RECORD_AUDIO` — for voice only, asked at
  runtime the first time something listens; the live camera still asks for video alone — and a
  `<queries>` entry for `android.speech.RecognitionService` (without it Android 11+ reports no
  recognizer). It compiled in `assembleDebug` on 2026-10-16; to try it on a phone, open the Studio,
  tap the microphone and speak: the strip should say "On this device" where the language model is
  installed (Settings → System → Languages → On-device speech recognition).
- `CapacitorCapabilities` is unit-tested against fake plugins (`packages/native/test`), so the adapter
  logic is verified without a device — the device run validates the *native* half.
