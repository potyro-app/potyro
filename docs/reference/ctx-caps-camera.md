---
title: ctx.caps.camera
description: Taking a photo with capture(), and the live video stream with the faces in it from live().
section: reference
order: 5
---

# ctx.caps.camera

`ctx.caps.camera` takes a photo, and in your own apps it streams live video with the faces in it.

```ts
// a photo, as a Blob
const photo = await ctx.caps.camera!.capture({ source: "camera" });
const ref = await ctx.media.put(photo);
await ctx.patch("plant", plant.id, { photo: ref });

// live video, in a custom view
const cam = await ctx.caps.camera!.live!({ facing: "user", faces: true });
cam.onFrame((video, info) => {
  g.drawImage(video, 0, 0);
  const face = info.faces?.[0];
  if (face) g.fillRect(face.nose.x - 4, face.nose.y - 4, 8, 8);
});
cam.onStop((why) => showResumeButton(why));
```

## Who gets what

| | Your own app | A shared (sealed) app |
|---|---|---|
| `capture()` | always, where the device has a camera | with `permissions: { camera: true }`; asks the person once |
| `live()` | always, where the device has a camera | `undefined` |

`ctx.caps.camera` is `undefined` in a sealed app that does not declare the permission. `live` is
an optional member: check it before calling.

## Permission

```ts
permissions: { camera: true }
```

One declaration covers both `capture()` and `live()`. The browser or the phone asks for the camera
on top of Potyro's question. A refusal rejects the call with `"denied"`.

## `capture(opts?)`

```ts
capture(opts?: { source?: "camera" | "library" }): Promise<Blob>
```

| Option | Values | Default |
|---|---|---|
| `source` | `"camera"` takes a new picture, `"library"` picks an existing one | the device's own chooser |

The Blob is the picture. Keep it with `ctx.media.put` for a `media` field, or with `ctx.files.write`
in the app's folder.

## `live(opts?)`

```ts
live(opts?: LiveCameraOptions): Promise<LiveCamera>
```

Resolves once the camera is on. Rejects with an `Error` whose `code` is a `LiveCameraFailure`.

### Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `facing` | `"user" \| "environment"` | `"user"` | a device with one camera gives that one |
| `width` | number | 640 | the ideal size in pixels, held between 160 and 1920 |
| `height` | number | 480 | the same |
| `faces` | `boolean \| FaceOptions` | off | find faces in every frame; see below |

`width` and `height` are requests. Read `cam.width` and `cam.height` for what the camera gives.

### The session

| Member | Type | Notes |
|---|---|---|
| `video` | `HTMLVideoElement` | playing, muted, not in the page: draw it with `drawImage`, or append it |
| `stream` | `MediaStream` | for a `<video>` of your own or a recorder |
| `facing` | `"user" \| "environment"` | the camera in use |
| `width`, `height` | number | the real frame size |
| `active` | boolean | `false` once stopped, for any reason |
| `graphics` | `"gpu" \| "software" \| "unknown"` | what draws on this device; on `"software"`, draw less and smaller |
| `onFrame(cb)` | `(video, info: LiveFrameInfo) => void` | once per new frame, only while someone listens; returns the unsubscribe |
| `snap(opts?)` | `{ type?: "image/jpeg" \| "image/png" \| "image/webp"; quality?: number }` → `Promise<Blob>` | the current frame at the camera's size; rejects once stopped |
| `onStop(cb)` | `(why: LiveCameraStop) => void` | once, when it ends; returns the unsubscribe |
| `stop()` | | ends the session; `onStop` hears `"app"` |

Frames are not mirrored. A selfie view flips them itself.

### Frame info

| Field | Type | Notes |
|---|---|---|
| `time` | number | the video's clock, in milliseconds |
| `width`, `height` | number | the frame's size |
| `faces` | `Face[]` | with `faces` on: the faces found; `[]` while the finder loads |
| `facesTime` | number | the `time` of the frame the faces were found in; `time - facesTime` is how stale they are |
| `facesFailed` | `"unsupported" \| "failed"` | why there are no faces although asked for; the camera keeps going |
| `frame` | `ImageBitmap` | with `faces: { sameFrame: true }`: a still of this very frame, valid inside the callback only |

### One session per device

A device has one live session. Calling `live()` while one runs stops the old one with
`"replaced"`. That is how an app switches cameras: `live({ facing: "environment" })`.

### When it stops

| `why` | When |
|---|---|
| `"app"` | the app called `stop()` |
| `"person"` | the person pressed **Turn off** on the camera indicator |
| `"hidden"` | the page is hidden: another tab, the home screen, a locked screen |
| `"closed"` | the person left the app, or the page went away |
| `"ended"` | the device ended the track: unplugged, revoked in settings |
| `"replaced"` | the app started another session |

The camera never restarts on its own. When the page is visible again, offer a button and let the
person tap it.

### Failures

| `code` | What happened |
|---|---|
| `"denied"` | the person or the device said no |
| `"missing"` | no camera |
| `"busy"` | another app holds it |
| `"hidden"` | the app is not on screen; a camera never starts behind the person's back |
| `"failed"` | anything else |

## Faces: `live({ faces })`

Pass `true`, or options:

| Option | Type | Default | Notes |
|---|---|---|---|
| `max` | 1–4 | 1 | how many faces to find |
| `points` | boolean | off | hand over every mesh point in `Face.points` |
| `sameFrame` | boolean | off | call `onFrame` only once a frame's own faces are found, with `info.frame`; for a warp that must not slide; fewer frames |
| `detail` | `"normal" \| "high"` | `"normal"` | `"high"` reads the whole picture instead of a shrunk one: finer points, slower on a big picture |

Every point is in the video's pixels, not mirrored. Left and right are the person's own: their left
eye is on the right of an unmirrored picture.

### `Face`

| Member | Type | Notes |
|---|---|---|
| `box` | `{ x, y, w, h }` | around every point of the face |
| `eyes` | `{ left: FaceEye; right: FaceEye }` | |
| `mouth` | `{ left, right, top, bottom: FacePoint; outer, inner: FacePoint[] }` | corners, the lips' middles, and the two closed outlines |
| `nose` | `FacePoint` | the tip |
| `brows` | `{ left: FacePoint[]; right: FacePoint[] }` | each from the nose outwards |
| `expressions` | `FaceExpressions` | each 0 to 1 |
| `turn` | `{ roll, yaw, pitch }` | radians; `roll` is the eye line's tilt, clockwise positive; `yaw` positive to the person's left; `pitch` positive nodding down |
| `points` | `FaceMeshPoint[]` | all 478 mesh points, with `z`; only with `points: true` |
| `matrix` | `number[]` | 16 numbers, column-major: where the head is in 3D; absent when the finder gives none |

### `FaceEye`

| Member | Type | Notes |
|---|---|---|
| `center` | `FacePoint` | the eye's middle |
| `pupil` | `FacePoint` | the iris's centre |
| `outline` | `FacePoint[]` | the lids, corner to corner along the top, then back along the bottom |
| `width` | number | corner to corner, in pixels |
| `open` | number | 0 shut, about 0.3 open |

### `FaceExpressions`

`mouthOpen`, `jawOpen`, `smile`, `blinkLeft`, `blinkRight`, `browUp`, `browDown`, `pucker`,
`puff`. Each is a number from 0 to 1. Blinks are by the person's own left and right.

### `FaceMeshPoint`

`{ x, y, z }`. `z` is depth on the same scale as `x`: 0 is about the middle of the head, negative
is nearer the camera. It says what is in front, not how far away the face is.

### `matrix`

The head's position in 3D as a column-major 4×4 matrix. `m[12..14]` is the move. It maps a point of
the canonical face, in centimetres with the head's middle at 0, into the camera's space under a 63°
vertical field of view. Treat distances as relative.

### Timing and failure

Faces are found at most once per frame and never hold a frame back, unless `sameFrame` is on.
Without it, a frame may carry faces a frame or two old; `facesTime` says how old.

Finding faces never stops the camera. When it cannot run, `info.facesFailed` says why and `faces`
is `[]`:

| `facesFailed` | What happened |
|---|---|
| `"unsupported"` | this device or this Potyro cannot find faces |
| `"failed"` | the finder broke or its model did not load |

Say it once in your own words and keep drawing the video.

## The indicator and the person's control

While a session runs, Potyro shows a **Camera on** pill above everything the app draws, with a
**Turn off** button. The app does not render it and cannot remove it. **Turn off** stops the session
with `"person"`.

Frames never leave the device unless the app hands them to something that sends. Each such thing is
its own capability with its own permission: `ctx.caps.network`, `ctx.caps.ai`, or sync. A `snap()`
lives only where the app puts it.

## Next

- [Device capabilities](../guides/device-capabilities.md): declaring permissions and handling refusals.
- [Custom views](../guides/custom-views.md): the view a live camera draws in.
- [ctx](ctx.md): everything else a function can reach.
