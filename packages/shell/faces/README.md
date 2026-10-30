# faces/

`face_landmarker.task` is Google's MediaPipe Face Landmarker model bundle, float16, version 1: a face
detector, the face mesh and the blendshapes in one file. Potyro ships it unchanged and serves it
itself, so live faces work offline (docs/25).

- Size 3,758,596 bytes, sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
- Licence: Apache License 2.0. Each of the three models in the bundle says so on its model card
  (BlazeFace short range, Face Mesh V2, Blendshape V2), linked from
  <https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker>.
- The runtime that reads it is the `@mediapipe/tasks-vision` package (Apache-2.0), pinned in
  `packages/shell/package.json`.

Both are listed in the root `NOTICE`.
