import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "native",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
