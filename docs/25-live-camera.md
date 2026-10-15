# 25 · Live camera — `ctx.caps.camera.live()`

Status: built (this branch). Owner decision 2026-10-15: apps can make camera toys — face stickers,
mirror effects, pose games — so `ctx.caps.camera` gains a live stream beside the still `capture()`.

## Why

`capture()` hands back one photo. Everything that makes a camera toy fun happens between photos:
the sticker that follows you, the mirror that splits your face, the trail your hand leaves. That
needs frames, many a second, drawn as they come — which a still cannot be stretched into.

## The API

```ts
const cam = await ctx.caps.camera!.live!({ facing: "user", width: 640, height: 480 });

cam.video;                  // an HTMLVideoElement, playing, muted, not in the page: drawImage() it, or append it
cam.stream;                 // the MediaStream behind it (a <video> of your own, a recorder)
cam.width; cam.height;      // what the camera really gives (it may differ from what was asked)
cam.facing;                 // "user" | "environment"
cam.active;                 // false once it has stopped, for any reason

const off = cam.onFrame((video, { time, width, height }) => g.drawImage(video, 0, 0));  // once per new frame
const blob = await cam.snap({ type: "image/jpeg", quality: 0.9 });                    // this frame, as a picture
cam.onStop((why) => showResumeButton(why));   // "app" | "person" | "hidden" | "closed" | "ended" | "replaced"
cam.stop();
```

- **Options.** `facing` defaults to `"user"` (the selfie camera); a device with one camera gives that
  one. `width`/`height` are *ideal* sizes, clamped to 160–1920 (640×480 when absent). Frames are
  **not mirrored**: a selfie toy flips them itself, the way a mirror would.
- **One at a time.** A device has one live session. `live()` while one is running stops the old one
  (`"replaced"`) — that is how an app flips between cameras: `live({ facing: "environment" })`.
- **Frames.** `onFrame` is driven by `requestVideoFrameCallback` where the engine has it (Chromium,
  Safari, Android WebView), else by animation frames, and only while someone listens. It hands the
  `<video>` itself — drawing it costs nothing, copying it into an `ImageBitmap` sixty times a second
  would. `snap()` is the current frame at the camera's own size; it rejects once stopped.
- **Failures** reject with an `Error` whose `code` is a `LiveCameraFailure`: `"denied"` (the person or
  the device said no), `"missing"` (no camera), `"busy"` (another app holds it), `"hidden"` (the app is
  not on screen — a camera never starts behind the person's back), `"failed"` (anything else). The
  message is English, for the log; an app says it in its own words from `code`.

## Who gets it

- **Your own (trusted) apps: all of it.** `live()` is on `ctx.caps.camera` wherever the device has
  `getUserMedia`; there is no Potyro prompt, as for every cap of a trusted app (docs/04), but there is
  always the browser's or the phone's own.
- **Shared (sealed) apps: not yet.** `ctx.caps.camera.live` is `undefined` there; `capture()` is
  unchanged. Three reasons, each of which would have to change first:
  1. **There is nothing to draw on.** A sealed app's logic runs in a Worker in a sandboxed frame
     (#272, docs/22); its custom views are trusted-only until the view phase lands. A frame stream
     without a surface serves only analysis-only toys, and no app asks for that today.
  2. **The realm is request/response.** Every op is one call answered once, inside one evaluation pass
     with a CPU budget. A stream is a long-lived subscription the protocol does not have; bolting it
     on before its consumer exists would be designing it blind.
  3. **It is the most sensitive thing a device has.** A live picture of the person's face and home is
     worth more than any record. It should reach code someone else wrote together with the view
     phase, under one review — not ahead of it.

  **The path, when sealed views land:** the session stays on the HOST (the shell's page owns
  `getUserMedia`, the indicator and every stop rule below, exactly as now). A new op `caps.camera.live`
  opens it for the realm after the consent prompt ("“X” wants to see your camera, live"), bound to the
  realm's lifetime; frames cross as transferred `ImageBitmap`s (zero-copy), at most 15 a second and
  640 px on the long side, dropped rather than queued when the realm is behind. The frame's own
  `<video>` never crosses, and neither does the `MediaStream` (it cannot leave its document).
- **The QuickJS fallback** gets none of it, ever: it has no structured clone to carry a frame.

## Permission, and the person's control

- **Declared.** `permissions: { camera: true }` covers both `capture()` and `live()`: they are one
  device, and the browser asks for them as one. For a sealed app the declaration is what it will be
  asked under; for a trusted one it is what the Add an app card says ("Asks for camera").
- **The device's own prompt** is always there: the browser's camera prompt on the web, Android's
  CAMERA runtime permission in the app (Capacitor's WebView asks for it when the page calls
  `getUserMedia`). Refused, `live()` rejects with `"denied"`.
- **A "camera on" indicator owned by the shell.** While a session runs the shell shows a pill at the
  top of the screen — a red dot, "Camera on", and **Turn off** — outside the app's view, above
  everything the app can draw. The app does not render it and cannot dismiss it: removing or hiding
  the element puts it back. (A trusted app shares the page with the shell, so this is a guard
  against a careless app, not a wall against a hostile one — a hostile app is the sealed kind, which
  has no page to reach. The browser's and the phone's own indicators stand behind it either way.)
  **Turn off** stops the session (`"person"`).
- **The camera always stops** when:
  - the page is hidden — another tab, the phone's home screen, the screen locked (`"hidden"`);
  - the page goes away, or the person leaves the app — Home, another app, a reload (`"closed"`);
  - the device ends the track — unplugged, revoked in settings (`"ended"`).

  It does **not** come back on its own when the page is visible again: the app hears `onStop` and
  offers to resume, and the person taps. A camera that switched itself back on would be one the
  person did not turn on.
- **Frames never leave the device** unless the app hands them to something that sends — and every
  such thing is a capability with its own gate: `ctx.caps.network` (manifest + consent),
  `ctx.caps.ai` (prompted, docs/23), sync (asked first). Nothing in Potyro records, uploads or keeps
  a frame; a `snap()` lives only where the app puts it.

## Where each part lives

| Part | Package | |
|---|---|---|
| `LiveCamera`, `LiveCameraOptions`, `LiveCameraFailure`, `CameraCapability.live?` | `potyro` (schema types) | the contract (docs/04) |
| `LiveCameraCap` — one session per page, frame loop, `snap`, stop rules, `subscribe` | `@potyro/capabilities` `live-camera.ts` | DOM-only, every dependency injectable; one per page (`sharedLiveCamera()`), shared by every `Capabilities` instance, so the Studio's preview is covered by the same indicator |
| `ctx.caps.camera.live` for trusted apps, absent for sealed | `@potyro/host` `mediate.ts` | the realm and the isolate never see it |
| the indicator, and stopping on leaving an app | `@potyro/shell` `camera-indicator.ts`, `main.tsx` `show()` | the shell owns the screen |
| Android | `@potyro/native` | `CapacitorCapabilities.liveCamera` is the same web session: the WebView's `getUserMedia`, asked through Capacitor's `BridgeWebChromeClient` (CAMERA, already in the manifest) |

## Android notes

- `CAMERA` is already declared (`patch-manifest.mjs`), for `capture()`. `getUserMedia` in the WebView
  asks for exactly that, through `BridgeWebChromeClient.onPermissionRequest`; nothing else is needed.
  Audio is never asked for (`audio: false`), so `RECORD_AUDIO` stays out of the manifest.
- The WebView is served from `https://localhost` — a secure context, which `getUserMedia` requires.
- The app going to the background pauses the WebView and fires `visibilitychange`: the session stops.
- **Needs a phone:** the runtime prompt appearing once and being remembered; front/back switching
  (`replaced`); the green privacy dot going out on Home and on leaving the app; frame rate of the demo
  on a mid-range phone.

## The demo: Mirror Monsters (`apps/mirror-monsters`)

The front camera as a mirror with a monster in it: googly eyes and horns that find the warm-skinned
blob in the frame (no ML: a skin-tone mask on a 64-px thumbnail, smoothed), a mirror-twin face,
a kaleidoscope and neon motion trails. **Snap** keeps the composite as a PNG in the app's folder and
a record in the Gallery. Six languages, phone-first, trusted only (it draws on a page).

These are new optional members: no existing app changes, so `schemaVersion` is not bumped.
