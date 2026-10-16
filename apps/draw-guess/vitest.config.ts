import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-draw-guess",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
