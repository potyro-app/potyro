/// <reference types="vite/client" />

// Deployment knobs (KA-28). Both optional: absent, a build falls back to a same-origin `/sync`
// relay and hides every surface that would need a model.
interface ImportMetaEnv {
  /** Websocket URL of the sync relay. Overrides the same-origin `/sync` default. */
  readonly VITE_POTYRO_RELAY?: string;
  /** Websocket URL of the rooms relay for multiplayer apps (docs/26, docs/28). Overrides the site's `/rooms`. */
  readonly VITE_POTYRO_ROOMS?: string;
  /** The site a NATIVE build belongs to (`https://potyro.app`): its relay, services and links (site.ts, docs/27). */
  readonly VITE_POTYRO_SITE?: string;
  /** DEV ONLY: the sync relay a development server defaults to, when not `ws://localhost:4201` (e2e/ports.ts). */
  readonly VITE_POTYRO_DEV_RELAY?: string;
  /** Set when this deployment can actually reach a model — see `canGenerate`. */
  readonly VITE_POTYRO_GENERATOR?: string;
  /** Where this site's people should move to (move-origins.ts): overrides the built-in old → new homes. */
  readonly VITE_POTYRO_NEW_HOME?: string;
  /** More origins, comma-separated, that count as Potyro when apps move between sites (move-origins.ts). */
  readonly VITE_POTYRO_MOVE_ORIGINS?: string;
  /** Where Potyro's gallery is (gallery-link.ts). Default `https://potyro.com/`. */
  readonly VITE_POTYRO_GALLERY?: string;
  /** "1" when this build has /privacy and /terms (set by packages/legal/src/vite.mjs, never by hand): the app links them. */
  readonly VITE_POTYRO_LEGAL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
