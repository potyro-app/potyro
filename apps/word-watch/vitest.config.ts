import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-word-watch",
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: { TZ: "Europe/Warsaw" },
  },
});
