// Build wiring for every Vite/Vitest config that compiles Potyro's UI: the Lingui macro (a Babel
// plugin, run through @vitejs/plugin-react) and the `.po` loader. Plain .mjs so a Vite config can
// import it without a TypeScript loader. All of it reads ONE config file, lingui.config.ts, which
// the CLI extractor reads too — so what is extracted and what is compiled cannot drift apart.

import { fileURLToPath } from "node:url";
import { getConfig } from "@lingui/conf";
import { lingui } from "@lingui/vite-plugin";
import linguiMacro from "@lingui/babel-plugin-lingui-macro";

export const LINGUI_CONFIG = fileURLToPath(new URL("./lingui.config.ts", import.meta.url));

/** The `.po` → compiled-catalog loader, plus Lingui's guard against an uncompiled macro import. */
export function linguiVitePlugins() {
  return lingui({ configPath: LINGUI_CONFIG });
}

let config;
/** `[plugin, options]` for `react({ babel: { plugins: [...] } })`. */
export function linguiBabelPlugin() {
  config ??= getConfig({ configPath: LINGUI_CONFIG });
  return [linguiMacro, { linguiConfig: config }];
}
