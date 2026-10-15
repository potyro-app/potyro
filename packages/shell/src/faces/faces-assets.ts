// Where the face finder's files are served from, for the page (faces-loader.ts) and the build
// (vite.config.ts `facesAssets`). Versioned in the path: a new runtime or model is a new URL, so a
// cached old one is never mixed with a new one.
//
// Pinned: @mediapipe/tasks-vision 1.1.0 (Apache-2.0), and Google's face_landmarker.task float16 v1
// (Apache-2.0; packages/shell/faces/, sha256 64184e22…bc9ff, 3,758,596 bytes) — the face detector,
// the 478-point mesh with irises and the 52 blendshapes in one file.

export const FACES_VERSION = "mp1.1.0-fl1";
export const FACES_DIR = `potyro-faces/${FACES_VERSION}/`;
export const FACES_MODEL = "face_landmarker.task";

/** The Wasm runtime's files: the module build, which the face finder's module worker loads (dev and build). */
export const FACES_RUNTIME = {
  module: ["vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm"],
} as const;
