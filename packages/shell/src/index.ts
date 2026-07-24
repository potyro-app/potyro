// @karta/shell — composition root + shell UI (public surface for embedding/tests).
export { App } from "./App.js";
export { compose, type ComposeOptions, type Composed } from "./compose.js";
export { createUiBridge, createNavBridge } from "./ui-bridge.js";
export { Toaster, type Toast } from "./toaster.js";
export { seedIfEmpty } from "./seed.js";
export { createSandboxLoader, type LoadIsolated } from "./isolate-bridge.js";
