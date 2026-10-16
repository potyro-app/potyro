// The screen kept on in the Android app (`ctx.ui.keepAwake`, docs/04): Potyro's own `PotyroKeepAwake`
// plugin (android-templates/KeepAwakePlugin.java, installed by scripts/patch-android.mjs), which sets
// the window's keep-screen-on flag. Android's WebView does not reliably have the Screen Wake Lock
// API the web uses, and the flag is the platform's own way: no permission, and only while in front.
//
// iOS keeps the web's wake lock (WKWebView has it from iOS 18.4), so this answers `false` there and
// the shell uses `navigator.wakeLock` — as it does on the web.

/** The slice of the plugin this uses. */
export interface KeepAwakePlugin {
  keep(): Promise<void>;
  allow(): Promise<void>;
}

let plugin: KeepAwakePlugin | null | undefined;

/** The plugin, BOXED: a Capacitor plugin is a Proxy, and awaiting one directly hangs (`then`). */
async function keepAwakePlugin(): Promise<{ plugin: KeepAwakePlugin | null }> {
  if (plugin !== undefined) return { plugin };
  try {
    const { Capacitor, registerPlugin } = await import("@capacitor/core");
    plugin = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" ? registerPlugin<KeepAwakePlugin>("PotyroKeepAwake") : null;
  } catch {
    plugin = null;
  }
  return { plugin };
}

/** Over a given plugin (tests): keep the screen on, or let it sleep. */
export async function keepScreenOnOver(p: KeepAwakePlugin, on: boolean): Promise<boolean> {
  try {
    if (on) await p.keep();
    else await p.allow();
    return true;
  } catch {
    // An older app without the plugin: the screen dims as it always did.
    return false;
  }
}

/**
 * Keep the screen on (`true`) or let it sleep (`false`) the native way. `false` when there is no
 * native way here — the web, iOS, an older Android app — so the caller uses the web's wake lock.
 */
export async function keepScreenOn(on: boolean): Promise<boolean> {
  const { plugin: p } = await keepAwakePlugin();
  return p ? keepScreenOnOver(p, on) : false;
}
