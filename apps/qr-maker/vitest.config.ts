import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-qr-maker",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
