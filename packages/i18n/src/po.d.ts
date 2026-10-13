// A `.po` catalog, compiled to JS by `@lingui/vite-plugin` at build time.
declare module "*.po" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}
