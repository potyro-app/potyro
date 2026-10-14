import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { linguiBabelPlugin, linguiVitePlugins } from "@potyro/i18n/build.mjs";

export default defineConfig({
  // The Lingui macros must compile here too, or a component using one throws when rendered.
  plugins: [react({ babel: { plugins: [linguiBabelPlugin()] } }), linguiVitePlugins()],
  test: {
    name: "shell",
    environment: "node", // React render tests opt into a DOM per-file via `// @vitest-environment happy-dom`
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
