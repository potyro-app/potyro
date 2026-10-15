import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-daily-puzzle",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
