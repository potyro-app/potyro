import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-palette-catcher",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
