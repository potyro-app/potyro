// @potyro/host/realm — the untrusted runner for shared apps (#272, docs/22): an opaque-origin
// sandboxed iframe holding a Worker, reached only through the mediated ctx over a MessagePort; and,
// since #267, their custom views, each in a sandboxed frame of its own, reached the same way.
// A separate entrypoint, like ./isolate, so the trusted path never loads it.
export {
  createRealmLoader,
  releaseSharedProcess,
  RealmLoadedApp,
  RealmStartError,
  type RealmLoaderOptions,
  type RealmSpawner,
  type RealmHandle,
  type RealmViewOptions,
} from "./realm-host.js";
export { frameSpawner, realmDocument, viewDocument, spawnViewFrame, FRAME_SOURCE, NO_WEBRTC, VIEW_CSS, type FrameSpawnerOptions, type ViewFrameHandle } from "./frame.js";
export { OPS, VIEW_OPS, REALM_CSP, type CallKind, type CtxBase, type Op, type ViewOp, type ViewInit, type HostToView, type ViewToHost } from "./protocol.js";
export { ViewGuard, MARK_PREFIX, OFF_KEY, MARK_STALE_MS, MARK_REFRESH_MS, type GuardStorage, type MountMark, type OffEntry } from "./view-guard.js";
export { ViewWatchdog, VIEW_BLOCKED_MS, VIEW_SILENCE_MS, VIEW_MOUNT_MS, VIEW_PING_MS, VIEW_CHECK_MS, type ViewVerdict } from "./view-watchdog.js";
export { SealedViewController, readTokens, VIEW_MIN_HEIGHT } from "./sealed-view.js";
