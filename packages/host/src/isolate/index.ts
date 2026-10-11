// @potyro/host/isolate — the untrusted (QuickJS-WASM) runner. Kept as a separate entrypoint so
// the WASM engine is only loaded when an untrusted app is actually run.
export {
  createIsolateLoader,
  type IsolateLoaderOptions,
  type QuickJSAsyncContextLike,
  type QuickJSHandle,
} from "./isolate-host.js";
export { serialize, deserialize } from "./marshal.js";
export { HARNESS_SOURCE } from "./harness.js";
