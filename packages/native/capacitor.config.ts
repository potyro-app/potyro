import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor wraps the SHELL's web build (packages/shell/dist) into a native Android/iOS app. Build
// the shell first (`pnpm --filter @potyro/shell build:web`), then `cap sync` copies dist → native.
// The sealed box (the browser realm, with QuickJS behind a flag) and the capability seam are
// unchanged — the WebView gets the shell's frame-src policy from the <meta> in index.html, since it
// serves no headers (#272) — and only the composition root swaps in
// CapacitorCapabilities (see src/index.ts → maybeCreateNativeCapabilities).
const config: CapacitorConfig = {
  appId: "app.potyro",
  appName: "Potyro",
  webDir: "../shell/dist",
  plugins: {
    LocalNotifications: {
      // Exact, offline, app-closed reminders — the deciding native feature (business plan §8.3).
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#1f6feb",
    },
  },
};

export default config;
