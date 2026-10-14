// Vite `?raw` imports return the file's text — used to inline the isolate stub sources into the
// runtime app bundler.
declare module "*?raw" {
  const contents: string;
  export default contents;
}

// The realm's worker runtime, bundled by `realmWorkerPlugin()` (packages/host/realm-build.mjs), as
// source text: the sandboxed frame starts it from a blob: URL (#272).
declare module "virtual:potyro-realm-worker" {
  const workerSource: string;
  export default workerSource;
}

// Prism's grammar files have no types of their own: they are side-effecting modules that register a
// language against the core, and export nothing. Declared here so importing them for their effect
// isn't an implicit `any`.
declare module "prismjs/components/*" {}
