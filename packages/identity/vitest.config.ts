import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "identity",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
