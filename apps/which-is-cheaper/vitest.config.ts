import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-which-is-cheaper",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
