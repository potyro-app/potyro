import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-photo-puzzle",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
