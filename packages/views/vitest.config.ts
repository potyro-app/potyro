import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "views",
    environment: "node", // React render tests opt into a DOM per-file via `// @vitest-environment happy-dom`
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
