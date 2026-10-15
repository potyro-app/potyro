import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor wraps the SHELL's web build (packages/shell/dist) into a native Android/iOS app. Build
// the shell first (`pnpm --filter @potyro/shell build:web`), then `cap sync` copies dist → native.
// The sealed box (the browser realm, with QuickJS behind a flag) and the capability seam are
// unchanged — the WebView gets the shell's frame-src policy from the <meta> in index.html, since it
// serves no headers (#272) — and only the composition root swaps in
// CapacitorCapabilities (see src/index.ts → maybeCreateNativeCapabilities).
//
// iOS: docs/27-ios.md. `ios/` is generated and gitignored like `android/`; scripts/patch-plist.mjs
// re-applies what the generated project does not get on its own after every `cap add ios` / `cap sync ios`.

/** The App Group the iOS Share Extension and the app share (docs/27 §4.3). Must match the extension. */
export const IOS_APP_GROUP = "group.app.potyro";

const config: CapacitorConfig = {
  appId: "app.potyro",
  appName: "Potyro",
  webDir: "../shell/dist",
  server: {
    // THE ORIGIN IS WHERE THE DATA LIVES. Every database (OPFS), every key and every setting
    // (localStorage) belongs to the WebView's origin — `https://localhost` on Android and
    // `capacitor://localhost` on iOS. Both are Capacitor's defaults, written out so nobody "tidies"
    // them: changing a scheme or setting a `hostname` after people have installed the app moves it to
    // a new, empty origin, and every app and record on the phone looks gone. Never set `server.url`
    // or a hostname with a port either: on iOS that also costs the secure context getUserMedia needs.
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  ios: {
    // The shell draws under the notch and the home indicator itself (viewport-fit=cover +
    // env(safe-area-inset-*) in styles.css), so the WebView must not inset its content as well.
    contentInset: "never",
    // No service worker exists on a custom scheme, and app-bound domains would only restrict
    // navigation; the app loads nothing remote into the WebView.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    LocalNotifications: {
      // Exact, offline, app-closed reminders — the deciding native feature (business plan §8.3).
      // Android only; iOS takes its icon from the app.
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#1f6feb",
    },
    CapacitorShareTarget: {
      // iOS only: where the Share Extension leaves what was shared (docs/27 §4.4). Android reads the
      // intent directly and ignores it.
      appGroupId: IOS_APP_GROUP,
    },
  },
};

export default config;
