import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "rooms",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
