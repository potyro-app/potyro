import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "share-links",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
