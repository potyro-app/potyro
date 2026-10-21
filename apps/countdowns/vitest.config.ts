import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-countdowns",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
