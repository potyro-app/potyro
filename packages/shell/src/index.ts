// @potyro/shell — composition root + shell UI (public surface for embedding/tests).
export { App } from "./App.js";
export { compose, type ComposeOptions, type Composed } from "./compose.js";
export { createUiBridge, createNavBridge } from "./ui-bridge.js";
export { Toaster, type Toast } from "./toaster.js";
export { seedIfEmpty } from "./seed.js";
export { createSandboxLoader, createSharedAppLoader, type LoadIsolated, type SandboxOptions } from "./isolate-bridge.js";
export { sandboxRunner, realmAvailable, markRealmUnavailable, SANDBOX_FLAG, type SandboxRunner } from "./sandbox-runner.js";
