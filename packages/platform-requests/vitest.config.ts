import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "platform-requests",
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
