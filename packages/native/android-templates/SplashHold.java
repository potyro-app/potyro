package __PACKAGE__;

// Keep the system splash on the screen until the app has something to show, so the splash gives way
// to the app and not to an empty window.
//
// Android takes the splash away at the activity's first frame, and a WebView's first frame is blank:
// the page is still being read, and then the shell still has to draw. Holding back the first frame
// is the documented way to keep the splash (a pre-draw listener that answers false), and it needs
// no splash plugin. The hold ends when the page has loaded AND the shell has put something into its
// root element (asked of the page every PROBE_MS), or when the page failed to load, or after
// LIMIT_MS whatever happened — a page that cannot start must show itself, never an everlasting splash.
//
// Behind the WebView the window is the page's own background (`potyro_bg`, scripts/brand.mjs: the
// shell's `--bg`, light and night), and the WebView itself is given that colour, so whatever shows
// between the splash and the page's first paint is the colour the page then paints.
//
// Copied into the generated project by scripts/patch-android.mjs, which calls `attach` from MainActivity.

import android.util.Log;
import android.view.View;
import android.view.ViewTreeObserver;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public final class SplashHold {
    static final long LIMIT_MS = 5000;
    static final long PROBE_MS = 100;
    /** True once the shell has drawn into its root; true as well for a page that has no such element. */
    static final String DRAWN = "(function(){var r=document.getElementById('root');return !r||r.childElementCount>0})()";

    private SplashHold() {}

    /** Call after `super.onCreate`: the bridge and its WebView exist from then on. */
    public static void attach(final BridgeActivity activity) {
        if (activity.getBridge() == null) return;
        final WebView web = activity.getBridge().getWebView();
        final boolean[] loaded = { false };
        final boolean[] drawn = { false };
        final long[] probed = { 0 };
        final long started = System.currentTimeMillis();

        web.setBackgroundColor(ContextCompat.getColor(activity, R.color.potyro_bg));
        activity.getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                loaded[0] = true;
            }

            @Override
            public void onReceivedError(WebView webView) {
                loaded[0] = true;
                drawn[0] = true;
            }
        });

        final View content = activity.findViewById(android.R.id.content);
        content.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                final long now = System.currentTimeMillis();
                if (!drawn[0] && now - started < LIMIT_MS) {
                    if (loaded[0] && now - probed[0] >= PROBE_MS) {
                        probed[0] = now;
                        web.evaluateJavascript(DRAWN, value -> { if ("true".equals(value)) drawn[0] = true; });
                    }
                    // Nothing else asks for a frame while the page loads; ask again, or the hold never ends.
                    content.postInvalidateDelayed(16);
                    return false;
                }
                content.getViewTreeObserver().removeOnPreDrawListener(this);
                Log.d("PotyroSplash", "held " + (now - started) + " ms; " + (drawn[0] ? "the page had drawn" : "gave up waiting for the page"));
                return true;
            }
        });
    }
}
