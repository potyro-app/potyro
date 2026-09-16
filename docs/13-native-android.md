# 13 · Native Android (Capacitor) — run Karta on a device

The Capacitor target wraps the **shell's web build** into a native Android app. Nothing about the app
code, the QuickJS isolate, or the capability seam changes — the composition root just swaps
`WebCapabilities` for **`CapacitorCapabilities`** when it detects the native runtime
(`packages/native/src/index.ts` → `maybeCreateNativeCapabilities()`). The payoff is the one thing web
can't do: an **exact, offline reminder that fires with the app closed**.

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
pnpm --filter @karta/shell build:web

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
pnpm --filter @karta/shell build:web      # rebuild web
pnpm --filter @karta/native cap:sync      # copy dist → android + re-patch manifest
# then Run ▶ again in Android Studio (or `pnpm --filter @karta/native cap:open`)
```

Shortcut for the whole loop: `pnpm --filter @karta/native android` (build web → sync → open).

## What to test on the device

| Do | Expect |
|---|---|
| Open the app | Boots to **Recipes** (same UI as web) |
| Switch to **Plants** via the header dropdown → a plant's **Schedule** | Real Android **local notification** is scheduled (exact — `supportsExactScheduling=true`) |
| **Background or close the app**, wait for the due time | The reminder **fires with the app closed** — the deciding feature |
| Places → **+ New Place → Use my location** | Native **GPS** fills lat/lng (grant the permission prompt) |
| Add a photo field / capture | Native **camera** returns the image |
| Export an app | Writes the `.karta.zip` into **Documents** via the native filesystem |

The first schedule/GPS/camera call triggers the Android **permission prompt** — grant it. Exact alarms
use `USE_EXACT_ALARM` (Android 14+, no prompt) with `SCHEDULE_EXACT_ALARM` as the Android 12/13
fallback; both are injected by `scripts/patch-manifest.mjs` on every `cap:add`/`cap:sync`.

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
KARTA_AGP=keep pnpm cap:sync                       # leave whatever Capacitor generated
KARTA_AGP=8.13.0 KARTA_GRADLE=8.14.3 pnpm cap:sync  # or pin somewhere else
```

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
- `CapacitorCapabilities` is unit-tested against fake plugins (`packages/native/test`), so the adapter
  logic is verified without a device — the device run validates the *native* half.
