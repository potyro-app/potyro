import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-where-i-parked",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
