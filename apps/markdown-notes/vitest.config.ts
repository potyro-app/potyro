import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-markdown-notes",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
