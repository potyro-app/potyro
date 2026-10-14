// @potyro/host/realm — the untrusted runner for shared apps (#272, docs/22): an opaque-origin
// sandboxed iframe holding a Worker, reached only through the mediated ctx over a MessagePort.
// A separate entrypoint, like ./isolate, so the trusted path never loads it.
export { createRealmLoader, RealmLoadedApp, RealmStartError, type RealmLoaderOptions, type RealmSpawner, type RealmHandle } from "./realm-host.js";
export { frameSpawner, realmDocument, FRAME_SOURCE, type FrameSpawnerOptions } from "./frame.js";
export { OPS, REALM_CSP, type CallKind, type CtxBase, type Op } from "./protocol.js";
