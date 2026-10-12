import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app imports p5 by URL, which only the shell resolves (from the bytes it locked at install),
  // and p5 reaches for `window` as it loads. These tests check the app's shape and garden.ts, so the
  // URL stands for a stub.
  resolve: { alias: [{ find: /^https:\/\/esm\.sh\/.*$/, replacement: fileURLToPath(new URL("./test/library-stub.ts", import.meta.url)) }] },
  test: {
    name: "app-photo-garden",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
