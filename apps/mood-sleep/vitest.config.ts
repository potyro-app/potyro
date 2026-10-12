import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app imports chart.js by URL, which only the shell resolves (from the bytes it locked at
  // install). These tests check the app's shape and its pure logic, so the URL stands for a stub.
  resolve: { alias: [{ find: /^https:\/\/esm\.sh\/.*$/, replacement: fileURLToPath(new URL("./test/library-stub.ts", import.meta.url)) }] },
  test: {
    name: "app-mood-sleep",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
