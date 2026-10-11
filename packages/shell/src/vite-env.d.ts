/// <reference types="vite/client" />

// Deployment knobs (KA-28). Both optional: absent, a build falls back to a same-origin `/sync`
// relay and hides every surface that would need a model.
interface ImportMetaEnv {
  /** Websocket URL of the sync relay. Overrides the same-origin `/sync` default. */
  readonly VITE_POTYRO_RELAY?: string;
  /** Set when this deployment can actually reach a model — see `canGenerate`. */
  readonly VITE_POTYRO_GENERATOR?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
