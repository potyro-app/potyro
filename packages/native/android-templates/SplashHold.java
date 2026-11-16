package __PACKAGE__;

// Keep the system splash on the screen until the shell says its first screen is there, so the splash
// gives way to the app and not to an empty window.
//
// Android takes the splash away at the activity's first frame, and a WebView's first frame is blank:
// the page is still being read, and then the shell still has to open its storage and draw. Holding
// back the first frame is the documented way to keep the splash (a pre-draw listener that answers
// false), and it needs no splash plugin.
//
// WHAT IT WAITS FOR: the shell's own signal, `document.documentElement.dataset.potyroReady === "1"`,
// which the shell sets once its first real screen (Home, an app, or a start-up state that will not
// go away by itself) has rendered. Asked of the page every PROBE_MS once it has loaded. Not "the
// root element has children": React mounts a wrapper long before anything can be seen, and a hold
// that ended there showed a blank page in the page's colour (seen on an emulator, 2026-11-16).
//
// WHAT ENDS IT ANYWAY: the page failing to load, or LIMIT_MS. One limit, because a page that never
// sets the signal — a shell built before the signal existed, or one that cannot start — cannot be
// told from one that is merely slow. Five seconds: a cold start on a slow phone still gets to its
// first screen inside it, and a page that cannot start shows itself soon enough to be dealt with;
// never an everlasting splash. A shell without the signal therefore holds the full five seconds on
// every start, which is why this must not ship ahead of the shell change that sets it (#48).
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
    /** True once the shell has rendered its first real screen (it sets `data-potyro-ready="1"` on the root element). */
    static final String READY = "document.documentElement.dataset.potyroReady==='1'";

    private SplashHold() {}

    /** Call after `super.onCreate`: the bridge and its WebView exist from then on. */
    public static void attach(final BridgeActivity activity) {
        if (activity.getBridge() == null) return;
        final WebView web = activity.getBridge().getWebView();
        final boolean[] loaded = { false };
        final boolean[] drawn = { false };
        final boolean[] failed = { false };
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
                failed[0] = true;
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
                        web.evaluateJavascript(READY, value -> { if ("true".equals(value)) drawn[0] = true; });
                    }
                    // Nothing else asks for a frame while the page loads; ask again, or the hold never ends.
                    content.postInvalidateDelayed(16);
                    return false;
                }
                content.getViewTreeObserver().removeOnPreDrawListener(this);
                Log.d("PotyroSplash", "held " + (now - started) + " ms; " + (failed[0] ? "the page failed to load" : drawn[0] ? "the shell said its first screen is there" : "gave up waiting for the shell's signal"));
                return true;
            }
        });
    }
}
