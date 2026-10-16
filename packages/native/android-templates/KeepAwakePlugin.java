package __PACKAGE__;

// `PotyroKeepAwake`: keep the screen on while an app asks (`ctx.ui.keepAwake`, docs/04).
//
// The web has the Screen Wake Lock API for this, and Android's WebView does not reliably offer it.
// The Android way is a window flag: FLAG_KEEP_SCREEN_ON keeps the screen on only while this activity
// is in front, needs no permission, and is dropped by the system the moment Potyro is not visible —
// exactly the promise ctx makes. The shell decides when (the app's holds, leaving the app); this only
// sets and clears the flag, on the UI thread where window flags must change.
//
// Copied into the generated project by scripts/patch-android.mjs, which registers it in MainActivity.

import android.app.Activity;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PotyroKeepAwake")
public class KeepAwakePlugin extends Plugin {
    @PluginMethod
    public void keep(PluginCall call) {
        set(call, true);
    }

    @PluginMethod
    public void allow(PluginCall call) {
        set(call, false);
    }

    private void set(PluginCall call, boolean on) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no screen to keep on", "unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
