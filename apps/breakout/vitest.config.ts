import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-breakout",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
