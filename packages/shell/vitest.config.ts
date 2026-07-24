import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shell",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
