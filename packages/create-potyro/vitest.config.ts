import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "create-potyro",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
