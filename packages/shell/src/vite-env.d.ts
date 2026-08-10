/// <reference types="vite/client" />

// Virtual modules provided by the sandbox-bundle Vite plugin: a bundled `.app.js` string for
// running an example untrusted in the isolate.
declare module "virtual:sandbox:*" {
  const bundleCode: string;
  export default bundleCode;
}

// Deployment knobs (KA-28). Both optional: absent, a build falls back to a same-origin `/sync`
// relay and hides every surface that would need a model.
interface ImportMetaEnv {
  /** Websocket URL of the sync relay. Overrides the same-origin `/sync` default. */
  readonly VITE_KARTA_RELAY?: string;
  /** Set when this deployment can actually reach a model — see `canGenerate`. */
  readonly VITE_KARTA_GENERATOR?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
