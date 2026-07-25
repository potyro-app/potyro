import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "generator",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000, // scoring bundles + imports generated modules
  },
});
