import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "views",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
