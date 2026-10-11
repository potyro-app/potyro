import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-piano",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
