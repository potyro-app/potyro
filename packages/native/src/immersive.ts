// Immersive mode on Android (#fullscreen): hide the status and navigation bars while a page that
// asked for the whole screen is open, show them again when it closes. Capacitor 8's own SystemBars
// plugin; nothing on the web, where the shell's frame covers its own bars and the browser keeps its.
//
// Imported lazily, like every native piece the web bundle must not pay for.

/** Hide (true) or show (false) the phone's system bars. Resolves quietly where there are none. */
export async function setImmersive(on: boolean): Promise<void> {
  try {
    const { Capacitor, SystemBars } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    if (on) await SystemBars.hide();
    else await SystemBars.show();
  } catch {
    // An older shell without the plugin: the page is still full-screen inside the app.
  }
}
