import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ai-relay",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
