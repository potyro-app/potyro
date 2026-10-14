// The phone's own language (#298), where a native shell can say.
//
// Android's WebView reports the system languages in `navigator.languages` too, but not always the
// per-app language Android 13 lets a person set for one app, and not always in the same order.
// `Device.getLanguageTag()` is `Locale.getDefault()` — what Android itself would show this app in.
//
// Lazily imported like every native piece, and the answer is BOXED: a Capacitor plugin is a Proxy
// that answers any method name, `then` included, so returning the plugin (or anything holding it)
// from an async function hangs forever on Android (see deep-links.ts). Only plain strings leave here.

/** The system language tags, best first, or null on the web or when the plugin cannot say. */
export async function systemLanguages(): Promise<string[] | null> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    const { Device } = await import("@capacitor/device");
    const { value } = await Device.getLanguageTag();
    return typeof value === "string" && value ? [value] : null;
  } catch {
    // An older shell without the plugin: the WebView's own languages answer instead.
    return null;
  }
}
