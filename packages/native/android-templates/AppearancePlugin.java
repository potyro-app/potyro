package __PACKAGE__;

// `PotyroAppearance`: the phone's bars and the next splash follow the theme Potyro is showing.
//
// Potyro has its own light/dark choice (the Look), and an app can open in its own theme. Android
// knows neither: it draws the status and navigation bar icons, and the splash, for the PHONE's
// theme. With a light Potyro on a dark phone the clock and the signal were white on a white page,
// and a dark splash gave way to a white Home (seen on a Pixel, 2026-11-16).
//
// The page says what it shows (android-templates/appearance.js, run after every page load; it
// watches, it does not poll), and this:
//   · draws the bar icons for it, and colours the bars and what is behind the WebView where Android
//     still lets an app colour them (before Android 15; from 15 the page itself is under the bars);
//   · on Android 12+, tells the system the person's own choice for Potyro
//     (UiModeManager.setApplicationNightMode). The system keeps it and applies it to the whole app,
//     the splash of the next start included — the splash is drawn before any of this code runs, so
//     nothing in the app could choose it then. "The phone decides" hands the choice back. On Android
//     7–11 there is no such thing: the splash follows the phone there.
//
// The page calls it through the bridge by name; nothing in the web code holds the plugin object.
// Copied into the generated project by scripts/patch-android.mjs, which registers it in MainActivity.

import android.app.UiModeManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.Window;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PotyroAppearance")
public class AppearancePlugin extends Plugin {
    /** android-templates/appearance.js, written in by scripts/patch-android.mjs. */
    static final String WATCH = __APPEARANCE_JS__;
    static final String PREFS = "potyro_appearance";
    static final String LOOK = "look";

    @Override
    public void load() {
        super.load();
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                webView.evaluateJavascript(WATCH, null);
            }
        });
    }

    @PluginMethod
    public void show(final PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        final String look = call.getString("look", "system");
        getBridge().executeOnMainThread(() -> {
            draw(dark);
            remember(look);
            call.resolve();
        });
    }

    @SuppressWarnings("deprecation") // the bar colours: ignored from Android 15, needed before it
    private void draw(boolean dark) {
        final Window window = getActivity().getWindow();
        final int page = ContextCompat.getColor(getContext(), dark ? R.color.potyro_bg_dark : R.color.potyro_bg_light);
        final WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
        window.setStatusBarColor(page);
        window.setNavigationBarColor(page);
        window.getDecorView().setBackgroundColor(page);
        getBridge().getWebView().setBackgroundColor(page);
    }

    private void remember(String look) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        final SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (look.equals(prefs.getString(LOOK, "system"))) return;
        final UiModeManager ui = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        if (ui == null) return;
        // AUTO is "no choice of the app's": the phone's theme decides again.
        ui.setApplicationNightMode("dark".equals(look) ? UiModeManager.MODE_NIGHT_YES : "light".equals(look) ? UiModeManager.MODE_NIGHT_NO : UiModeManager.MODE_NIGHT_AUTO);
        prefs.edit().putString(LOOK, look).apply();
    }
}
