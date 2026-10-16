// Root Vitest workspace: aggregates every package's tests so `vitest` at the
// repo root runs the whole suite. `pnpm -r test` runs them per-package instead.
export default [
  "packages/*/vitest.config.ts",
  "examples/vitest.config.ts",
  "apps/*/vitest.config.ts",
  "gallery/vitest.config.ts",
];
