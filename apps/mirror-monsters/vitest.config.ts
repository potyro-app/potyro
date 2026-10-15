import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-mirror-monsters",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
