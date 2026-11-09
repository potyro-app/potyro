---
title: Build for Android
description: Build Potyro's Android app from a checkout, install it on a phone, iterate, and check what only a device can prove.
section: guides
order: 10
---

# Build for Android

Potyro's Android app wraps the web build in a native shell, and this guide builds it and puts it
on a phone. App code does not change between the web and Android. What the phone adds is a
reminder that fires exactly, with the app closed, and the native camera, position and files.

```sh
pnpm --filter @potyro/shell build:web      # the web build the native shell wraps
pnpm --filter @potyro/native cap:add:android
pnpm --filter @potyro/native cap:open      # Android Studio, then Run
```

## Prerequisites

- A checkout of the repository with its dependencies installed (`pnpm i`).
- Node 22 or newer. The native tooling refuses older versions.
- Android Studio with an Android SDK. Export its location so the command line finds it:

  ```sh
  export ANDROID_HOME="$HOME/Android"
  ```

- A phone with USB debugging on, connected by cable, or an emulator from Android Studio.

## 1. Build the web app

```sh
pnpm --filter @potyro/shell build:web
```

The native shell loads its own copy of these files. If the app should talk to a site of your own
rather than potyro.app, set the site at build time:

```sh
VITE_POTYRO_SITE=https://potyro.example pnpm --filter @potyro/shell build:web
```

The sync relay, rooms, AI and share services are derived from it. See
[Self-host Potyro](self-host.md).

## 2. Generate the Android project

```sh
pnpm --filter @potyro/native cap:add:android
```

The project is generated, not committed. The command also patches the manifest with the
permissions the plugins do not declare themselves: exact alarms, location, camera, the
microphone, and the share-sheet entries that let a phone share a file or an app package into
Potyro. It pins the Gradle plugin to a version your Android Studio can open. On a newer Studio,
keep what the tooling generated or pin another version:

```sh
POTYRO_AGP=keep pnpm --filter @potyro/native cap:sync
POTYRO_AGP=8.13.0 POTYRO_GRADLE=8.14.3 pnpm --filter @potyro/native cap:sync
```

## 3. Open it and run

```sh
pnpm --filter @potyro/native cap:open
```

Android Studio opens the project and syncs Gradle with its bundled JDK, so no JDK setup is
needed. Pick your device and press Run. The first schedule, location, camera or microphone call
on the phone brings Android's own permission prompt. Grant it.

## 4. Iterate

After a change to the web code:

```sh
pnpm --filter @potyro/shell build:web
pnpm --filter @potyro/native cap:sync      # copies the build in and re-applies the patches
```

Then Run again in Android Studio. One command does all three steps, build, sync and open:

```sh
pnpm --filter @potyro/native android
```

## 5. Check it on the device

| Do | Expect |
|---|---|
| Open the app | The same launcher and apps as on the web. |
| Set a reminder in an app, then go to the home screen and wait for its time | The notification arrives with the app closed. |
| Add a place with **Use my location** | The position is filled in after the permission prompt. |
| Take a photo into a `media` field | The camera opens and the photo lands in the form. |
| Export an app | The zip is written to Documents. |
| Share a text file from another app to Potyro | Potyro asks which app to add it to, and the file appears in that app's Files. |
| Share a `.potyro-app.zip` to Potyro | **Add an app** opens on the app's card. |
| Tap the microphone in the Studio and speak | The words appear, and the strip says **On this device** where the phone has the language. |

Close the app the way a person does. Force-stopping it from Settings cancels its alarms, so a
reminder that never arrives after a force-stop says nothing about the app.

Useful while checking:

```sh
adb shell dumpsys alarm | grep -A3 app.potyro          # what is scheduled
adb shell dumpsys notification --noredact | grep -B4 -A10 "<title>"   # what fired
```

The app's web view can be driven from a laptop: `adb forward tcp:9222
localabstract:webview_devtools_remote_<pid>`, then connect a browser automation tool to
`http://localhost:9222`. The web view pauses while the app is in the background, so keep it in
front.

## What differs from the web

- `ctx.caps.notifications` is present and `supportsExactScheduling` is `true`.
- `ctx.caps.network.socket` can open `ws://` to a device on the local network, which the web
  refuses.
- Voice input uses the phone's recogniser, on the device where the language is installed.
- A sealed app runs in the same sandbox as on the web. Nothing native is downloaded or run.

## Next

- [Device capabilities](device-capabilities.md): what each `ctx.caps` member does on each target.
- [Self-host Potyro](self-host.md): the site a native build points at.
- [Running the repository](../contributing/running-the-repository.md): the checkout the build
  starts from.
