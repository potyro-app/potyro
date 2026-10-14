import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { linguiBabelPlugin, linguiVitePlugins } from "./build.mjs";

export default defineConfig({
  plugins: [react({ babel: { plugins: [linguiBabelPlugin()] } }), linguiVitePlugins()],
  test: {
    name: "i18n",
    environment: "node", // React render tests opt into a DOM per-file via `// @vitest-environment happy-dom`
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
