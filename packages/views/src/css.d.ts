// Allow side-effect CSS imports (e.g. the lazily-loaded MapLibre stylesheet) under `tsc --noEmit`.
declare module "*.css";

// A worker built by Vite, as a URL (`maplibre.ts`).
declare module "*?worker&url" {
  const url: string;
  export default url;
}
