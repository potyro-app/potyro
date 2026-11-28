import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "fediverse",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
