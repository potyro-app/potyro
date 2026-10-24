import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "tutorials-code", environment: "node", include: ["**/test/*.test.ts"] },
});
