import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "app-receipt-split",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
