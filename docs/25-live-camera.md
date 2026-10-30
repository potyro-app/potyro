---
title: Live camera
description: ctx.caps.camera.live(): a live video stream and the faces in it, for trusted apps.
status: current
order: 25
---

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

## Faces — `live({ faces: true })`

Owner decision 2026-10-15: finding faces is a Potyro capability, not something each app does. An app
asks for it when it starts the camera; every frame's `info` then carries the faces found in it.

```ts
const cam = await ctx.caps.camera!.live!({ facing: "user", faces: true });   // or { faces: { max: 2, points: true } }
cam.onFrame((video, { faces, facesFailed }) => {
  const f = faces?.[0];
  if (!f) return;                       // none in this frame (or not loaded yet, or facesFailed says why)
  f.eyes.left.center; f.eyes.left.pupil; f.eyes.left.outline; f.eyes.left.width; f.eyes.left.open;
  f.mouth.left; f.mouth.right; f.mouth.top; f.mouth.bottom; f.mouth.outer; f.mouth.inner;
  f.nose; f.brows.left; f.box;          // { x, y } points / { x, y, w, h }, in the video's pixels
  f.expressions.mouthOpen;              // and jawOpen, smile, blinkLeft, blinkRight, browUp, browDown, pucker, puff: 0..1
  f.turn.roll;                          // and yaw, pitch: radians
});
```

- **Coordinates** are the video's own pixels, **not mirrored** — the frame's convention. A selfie view
  that mirrors the picture mirrors the points the same way. **Left and right are the person's**: their
  left eye is on the right of an unmirrored picture.
- **`turn.roll`** is the eye line's tilt in the picture (clockwise positive); `yaw` is positive when the
  person turns to their left, `pitch` when they nod down — both read from the mesh's depth, so they are
  approximate.
- **`expressions`** are MediaPipe's blendshapes, the handful a toy needs, each 0..1. `mouthOpen` also
  reads the lips' own gap, so a mouth open without the jaw dropping counts.
- **`faces: { max, points }`**: up to `max` faces (1–4, default 1); `points: true` adds `Face.points`,
  all 478 mesh points in MediaPipe's numbering.
- **Timing.** Finding runs at most once per frame and never holds a frame back (unless the app asks,
  `sameFrame` below): while one find is
  running, frames go by with the latest faces found (a frame or two old). A slow device finds faces
  less often; it never draws less often. The first frames carry `faces: []` while the finder loads.
- **Failure** never stops the camera. `info.facesFailed` is `"unsupported"` (this device or Potyro
  cannot find faces: no Worker or WebAssembly SIMD, or no finder at all) or `"failed"` (the model
  would not load, or the finder broke); `faces` is then `[]`. Say it once in your own words and carry on.
- **The types** (`Face`, `FaceEye`, `FaceExpressions`, `FacePoint`, `FaceMeshPoint`, `FaceOptions`, `FacesFailure`) are
  exported by `potyro`, from `packages/schema/src/types/faces.ts`. Like every capability since #341
  they are outside the core of the model's prompt: it carries one index line, and the declarations
  come through `lookup("Face")` and beside a request that asks for faces.

### For warps: depth, the head in 3D, timing, detail, graphics (faces v2)

Added 2026-10-16, after a prototype that reshaped a nose live had to guess at what the finder knew.
All of it is additive: no app changes, no `schemaVersion` moves.

```ts
const cam = await ctx.caps.camera!.live!({ faces: { points: true, sameFrame: true, detail: "high" } });
cam.graphics;                                   // "gpu" | "software" | "unknown"
cam.onFrame((video, { time, faces, facesTime, frame, width, height }) => {
  g.drawImage(frame ?? video, 0, 0);            // with sameFrame: the very picture the faces are of
  const f = faces?.[0];
  f?.points?.[1].z;                             // depth of the nose tip: negative, in front
  f?.matrix;                                    // 16 numbers, column-major: the head in 3D
  time - (facesTime ?? time);                   // how old the faces are, in ms (0 with sameFrame)
});
```

- **`Face.points[i].z`** (`FaceMeshPoint`). MediaPipe's landmark depth, scaled like `x`: video
  pixels, approximate. 0 is about the middle of the head and **negative is nearer the camera** (the
  nose tip is the most negative). It says what is in front of what and how the surface curves — for
  shading or pushing a warp along the face. It is not a distance from the camera (the matrix is).
- **`Face.matrix`**: MediaPipe's facial transformation matrix (`outputFacialTransformationMatrixes`),
  16 numbers, **column-major** (`m[12..14]` is the move). It maps a point of MediaPipe's *canonical
  face* — centimetres, the head's middle at 0, +x to the person's left, +y up, +z out of the face —
  into the camera's space (centimetres, camera at 0 looking down −z, +y up), under a perspective
  camera with a **63° vertical field of view** (MediaPipe's default environment). To the picture:

  ```ts
  function toPicture(m: number[], p: { x: number; y: number; z: number }, width: number, height: number) {
    const t = Math.tan((63 / 2) * Math.PI / 180);
    const X = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
    const Y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    const Z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
    return { x: (1 + X / (-Z * t * (width / height))) / 2 * width, y: (1 - Y / (-Z * t)) / 2 * height };
  }
  toPicture(f.matrix, { x: 0, y: -1.13, z: 7.48 }, info.width, info.height);   // ≈ f.nose
  ```

  Canonical points worth knowing: the nose tip (0, −1.13, 7.48), the outer eye corners (±4.45, 2.66,
  3.17), the chin (0, −9.40, 4.26). Measured on the Mona Lisa fixture: the canonical nose tip lands
  **4.4–6 px** from the finder's own nose tip (a 640×480 and a 1920×1080 frame) — the matrix is a fit
  of the whole mesh to a rigid head, so it is steadier than any single point and a few pixels off
  any one of them. Its move is in centimetres for a 63° camera; a real camera's view differs, so
  treat distances as relative (nearer, further) rather than as a tape measure. Absent when the finder gives none (the fakes give one; an older Potyro does not).
- **`info.facesTime`**: the `time` of the frame the faces were found in. Faces are found one at a
  time, off the page, so ordinarily they are behind the picture: measured **67–100 ms** (two or
  three frames at 30 fps) on the desktop CPU path. Absent until the first find has answered.
- **`faces: { sameFrame: true }`** — for a warp that must not slide off the face. `onFrame` is then
  called only once a frame's own faces are found, with **`info.frame`**, an `ImageBitmap` still of
  that very frame (valid inside the callback; it is closed after — copy it to keep it). Draw `frame`,
  not `video`: the video has moved on. `facesTime === time` on every such frame. Frames that come
  while a find runs are not handed on, and until the finder has loaded (or if it fails) frames come
  as usual, without `frame`. **The trade-off, measured** (headless desktop Chromium, CPU path):
  delivery **26–48 ms** after the frame was on the video (median), and **15–26 fps** instead of the
  camera's 30 — the finder's rate, not the camera's. On a phone with the GPU path, both are better;
  not yet measured there.
- **`faces: { detail: "high" }`**: the finder gets the camera's whole picture (up to 1920 px)
  instead of one shrunk to 640 px on its long side. It does **not** find smaller faces — the face
  detector reads the whole picture at 128 px either way, and a Mona Lisa 400 px wide in a 1920×1080
  frame was found by neither — it gives the mesh a sharper crop of a face already found. **Cost,
  measured** on a 1920×1080 camera: faces found 9.4–13.5 times a second against 13.0–14.6 (≈10–35 %
  fewer), drawing unchanged at 30 fps; on a 640×480 camera it is the same as normal (nothing to
  shrink). Ask for it when a face is small in a large picture and its outline must be precise.
- **`cam.graphics`**: what draws on this page — `"gpu"`, `"software"` (WebGL on SwiftShader,
  llvmpipe or Microsoft's Basic Render Driver: a VM, a headless browser, a driver the browser
  blocklists), or `"unknown"` (the browser will not say). Read once per page from a throwaway WebGL
  context, the same test the face finder uses to choose its own GPU or CPU path. On `"software"`,
  draw less: a smaller canvas, fewer passes, no per-pixel effects. The headless test browser says
  `"software"`.

### How Potyro finds them

- **MediaPipe Tasks Vision Face Landmarker** (Apache-2.0): a face detector, the 478-point mesh with
  irises, and 52 blendshapes, in one model, run in VIDEO mode (it tracks across frames).
- **Pinned and shipped by Potyro, never fetched from a CDN** (rule 6): `@mediapipe/tasks-vision` 1.1.0,
  and Google's `face_landmarker.task` float16 v1 in `packages/shell/faces/` (3,758,596 bytes, sha256
  `64184e22…0bc9ff`). The shell serves them at `/potyro-faces/mp1.1.0-fl1/` — the dev server from the
  package and that folder, a build by emitting them into `dist/`, which is also what the Capacitor
  APK carries. The worker is a module worker, so it loads the runtime's module build
  (`vision_wasm_module_internal.js` 335 KB + `.wasm` 13.0 MB); nothing else of the package is shipped.
- **Sizes on the wire** (first use only): the runtime ≈ 3.9 MB gzipped (13.3 MB raw), the model ≈ 3.3 MB
  gzipped (3.8 MB raw), the worker's own script ≈ 160 KB.
- **Loaded lazily, cached on use.** Nothing is fetched until an app asks for faces. The shell's
  service worker caches what the page fetches (cache-first for every non-navigation, `public/sw.js`),
  so after the first use faces work offline; nothing is precached for people who never use them.
- **Off the page's thread.** The landmarker runs in a worker (`packages/shell/src/faces/`); each frame
  crosses as an `ImageBitmap` shrunk to 640 px on its long side (the whole picture with
  `detail: "high"`; transferred, not copied), and the mesh, its scores and its matrix come back as
  three small typed arrays. The page turns them into `Face`s (`faceFrom` in
  `@potyro/capabilities`).
- **GPU, then CPU.** The worker uses the GPU delegate where its WebGL is a real GPU, and the CPU
  (XNNPACK) where it is a software one (SwiftShader, llvmpipe: VMs, headless browsers, blocklisted
  drivers) — which is many times slower than the CPU and holds up the page's own drawing while it
  grinds. A real GPU whose first finds take over 45 ms is moved to the CPU as well.
- **Its console is quiet.** MediaPipe's runtime logs its start-up on every level, `console.error`
  included; the worker drops that chatter and keeps only its errors, as warnings.
- **Measured** (desktop Chromium, headless — so the CPU path — Mirror Monsters on a 412 px phone
  screen, the Mona Lisa fixture at 30 fps): drawing 30 fps (the camera's own rate) and faces 29–30 fps
  in Monster, Kaleido and Twin; with the page's CPU throttled 4× (DevTools; it does not slow the
  worker) drawing still 30 fps and faces 26–28 fps. A find takes ~21 ms on that CPU. **Not yet
  measured on a phone**, where the GPU path is the one that runs.

### Tests without the model

`createFakeLiveCamera({ faces: [sketchFace({ x, y, size, roll, expressions })] })` makes every frame
find those faces (`setFaces` changes them; `facesFail` makes loading fail). In the browser the dev
server takes `localStorage["potyro:faces"] = "script"` and reads the faces from
`localStorage["potyro:faces-script"]` (sketches in fractions of the frame), or `"fail"` to fail — so
e2e specs say exactly where a face is. One spec (`mirror-faces-model-trusted`) runs the real model on
a fixture video of Leonardo's Mona Lisa (public domain) and checks the monster's eyes land on hers.

## Who gets it

- **Your own (trusted) apps: all of it.** `live()` is on `ctx.caps.camera` wherever the device has
  `getUserMedia`; there is no Potyro prompt, as for every cap of a trusted app (docs/04), but there is
  always the browser's or the phone's own.
- **Shared (sealed) apps: not yet.** `ctx.caps.camera.live` is `undefined` there; `capture()` is
  unchanged. Three reasons, each of which would have to change first:
  1. **There was nothing to draw on.** A sealed app's logic runs in a Worker in a sandboxed frame
     (#272, docs/22). Since 2026-10-16 its custom views draw in sandboxed frames too (#267, docs/22
     §11), so the surface now exists — `live` is the follow-up (Mirror Monsters sealed), along the
     path below, and is still `undefined` in a sealed view.
  2. **The realm is request/response.** Every op is one call answered once, inside one evaluation pass
     with a CPU budget. A stream is a long-lived subscription the protocol does not have; bolting it
     on before its consumer exists would be designing it blind.
  3. **It is the most sensitive thing a device has.** A live picture of the person's face and home is
     worth more than any record. It should reach code someone else wrote together with the view
     phase, under one review — not ahead of it.

  **The path, now that sealed views have landed:** the session stays on the HOST (the shell's page owns
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
  top of the screen — a red dot, "Camera on", and **Turn off** — above everything the app can draw.
  On a phone it sits just under the app's top bar, at its right, so it never covers the app's name
  or the bar's buttons; with no top bar it is centred at the top. While it shows, the shell sets
  `--k-chrome-top` to the room it takes under the bar (docs/04), so a custom view keeps its own
  badges and its picture clear of it — Mirror Monsters' stage starts below it. The app does not render it and cannot dismiss it: removing or hiding
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
| `Face`, `FaceOptions`, `FacesFailure` | `potyro` (schema types, `types/faces.ts`) | outside the prompt's core; `lookup("Face")` (#341) |
| faces in a session: one find at a time, `facesFailed`, `faceFrom`, `sketchFace`, the fake's scripted faces | `@potyro/capabilities` `faces.ts`, `live-camera.ts` | pure, tested without a browser |
| the face finder: worker, loading, the files | `@potyro/shell` `src/faces/`, `vite.config.ts` `facesAssets`, `faces/face_landmarker.task` | handed over with `liveCamera.useFaces` at boot |
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

The front camera as a mirror with a monster in it: googly eyes on the person's own eyes (they shut
when the person blinks, the pupils still wobble), a fanged mouth on theirs that opens with it, horns
that tilt with the head — from `live({ faces: true })`, falling back to the warm-skinned blob in the
frame (a skin-tone mask on a 64-px thumbnail, smoothed) when there is no face or faces cannot be
found. A mirror-twin face split down the nose, a kaleidoscope centred on the face, neon motion trails
and an 8-bit pixel monster. **Snap** keeps the composite as a PNG in the app's folder and
a record in the Gallery. Six languages, phone-first, trusted only (it draws on a page).

These are new optional members: no existing app changes, so `schemaVersion` is not bumped.
