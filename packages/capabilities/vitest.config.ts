import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "capabilities",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
