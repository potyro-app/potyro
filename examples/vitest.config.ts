import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "examples",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
