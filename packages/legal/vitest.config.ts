import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "legal",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
