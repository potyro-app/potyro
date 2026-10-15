package __PACKAGE__;

// `PotyroLocalSocket`: plain ws:// to the local network for the Android app — docs/28 §6.
//
// The shell opens every other connection with the WebView's own WebSocket (wss://, or ws:// to the
// phone itself). Only a ws:// address on the local network comes here, and LocalWebSocket checks
// that again on what the name resolves to: the JS side's check is by spelling, this one is the one
// that holds. Copied into the generated project by scripts/patch-android.mjs, which registers it in
// MainActivity — android/ is generated, so this template is the source.

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PotyroLocalSocket")
public class LocalSocketPlugin extends Plugin {
    /** As the web's: at most this many open at once on the device, whatever the apps. */
    private static final int MAX_OPEN = 16;
    private static final int TIMEOUT_MS = 15_000;
    /** What the relay and servers see as the page: the WebView's own origin. */
    private static final String ORIGIN = "https://localhost";

    private final Map<String, LocalWebSocket> open = new ConcurrentHashMap<>();
    private final ExecutorService io = Executors.newCachedThreadPool();

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("no address", "refused");
            return;
        }
        if (open.size() >= MAX_OPEN) {
            call.reject("too many live connections on this device", "refused");
            return;
        }
        List<String> protocols = new ArrayList<>();
        JSArray p = call.getArray("protocols");
        if (p != null) {
            for (int i = 0; i < p.length(); i++) protocols.add(p.optString(i));
        }
        String id = UUID.randomUUID().toString();
        io.execute(() -> {
            try {
                LocalWebSocket ws = LocalWebSocket.connect(URI.create(url), protocols, ORIGIN, TIMEOUT_MS, new LocalWebSocket.Listener() {
                    @Override
                    public void onText(String text) {
                        JSObject e = new JSObject();
                        e.put("id", id);
                        e.put("text", text);
                        notifyListeners("message", e);
                    }

                    @Override
                    public void onBinary(byte[] bytes) {
                        JSObject e = new JSObject();
                        e.put("id", id);
                        e.put("base64", LocalWebSocket.Base64.encode(bytes));
                        notifyListeners("message", e);
                    }

                    @Override
                    public void onClose(int code, String reason, boolean clean) {
                        open.remove(id);
                        JSObject e = new JSObject();
                        e.put("id", id);
                        e.put("code", code);
                        e.put("reason", reason);
                        e.put("clean", clean);
                        notifyListeners("close", e);
                    }
                });
                open.put(id, ws);
                JSObject r = new JSObject();
                r.put("id", id);
                r.put("protocol", ws.protocol());
                call.resolve(r);
            } catch (LocalWebSocket.NotLocalException e) {
                call.reject(e.getMessage(), "insecure");
            } catch (SocketTimeoutException | NoRouteToHostException | UnknownHostException e) {
                call.reject("no answer from " + url, "unreachable");
            } catch (ConnectException | LocalWebSocket.RefusedException e) {
                call.reject(e.getMessage() == null ? "refused" : e.getMessage(), "refused");
            } catch (IOException | IllegalArgumentException e) {
                call.reject(e.getMessage() == null ? "refused" : e.getMessage(), "refused");
            }
        });
    }

    @PluginMethod
    public void send(PluginCall call) {
        LocalWebSocket ws = open.get(call.getString("id", ""));
        if (ws == null) {
            call.reject("the connection is not open", "closed");
            return;
        }
        String text = call.getString("text");
        String base64 = call.getString("base64");
        io.execute(() -> {
            try {
                if (text != null) ws.sendText(text);
                else ws.sendBinary(LocalWebSocket.Base64.decode(base64 == null ? "" : base64));
                call.resolve();
            } catch (IOException | IllegalArgumentException e) {
                call.reject("the connection is not open", "closed");
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        LocalWebSocket ws = open.get(call.getString("id", ""));
        int code = call.getInt("code", 1000);
        String reason = call.getString("reason", "");
        if (ws != null) io.execute(() -> ws.close(code, reason));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (LocalWebSocket ws : open.values()) ws.close(1001, "the app closed");
        open.clear();
        io.shutdown();
    }
}
