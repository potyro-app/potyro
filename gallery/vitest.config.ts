import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "gallery",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
