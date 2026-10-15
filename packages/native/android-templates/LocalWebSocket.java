package __PACKAGE__;

// A WebSocket client (RFC 6455) for plain ws:// on the LOCAL NETWORK only — docs/28 §6.
//
// Why it exists: the app's WebView is https://localhost, and a WebView refuses ws:// from an https
// page (mixed content), so a Home Assistant on 192.168.1.20:8123 could not be reached at all. Why it
// is this small hand-written client and not OkHttp or a network-security-config change: Android's
// network security config cannot name address RANGES, only domains, so "cleartext to the private
// ranges only" cannot be said there — and turning cleartext on for the whole app would loosen every
// HTTP stack in it. Instead nothing is loosened: the app's cleartext policy stays "no", and this one
// client, which reaches only addresses it has checked are local, speaks ws:// itself.
//
// The check is on what the name RESOLVES to, every address of it, and the connection goes to the
// address that was checked (no second lookup a DNS answer could change in between). Plain Java, no
// Android classes, so `LocalWebSocketTest` runs it on a desktop JVM against a real server.

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.List;
import java.util.Locale;

public final class LocalWebSocket {
    /** What the connection tells its owner. Called on the reader thread. */
    public interface Listener {
        void onText(String text);
        void onBinary(byte[] bytes);
        /** Once. `clean`: a close frame was exchanged. */
        void onClose(int code, String reason, boolean clean);
    }

    /** The address is not on the local network: refused before anything is sent. */
    public static final class NotLocalException extends IOException {
        public NotLocalException(String message) { super(message); }
    }

    /** The server answered the upgrade with something other than 101. */
    public static final class RefusedException extends IOException {
        public final int status;
        public RefusedException(int status, String message) { super(message); this.status = status; }
    }

    /** One message, at most (a bigger one closes the connection with 1009). */
    public static final int MAX_MESSAGE = 4 * 1024 * 1024;
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final Listener listener;
    private final String protocol;
    private volatile boolean closeSent = false;
    private volatile boolean finished = false;
    private final java.util.concurrent.atomic.AtomicLong queued = new java.util.concurrent.atomic.AtomicLong();

    private LocalWebSocket(Socket socket, InputStream in, OutputStream out, Listener listener, String protocol) {
        this.socket = socket;
        this.in = in;
        this.out = out;
        this.listener = listener;
        this.protocol = protocol;
    }

    /** loopback, 10/8, 172.16/12, 192.168/16, link-local (169.254/16, fe80::/10), IPv6 unique-local fc00::/7. */
    public static boolean isLocal(InetAddress a) {
        if (a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress()) return true;
        if (a instanceof Inet6Address) return (a.getAddress()[0] & 0xfe) == 0xfc;
        return false;
    }

    /** Resolve, check every address is local, connect to the checked one, and upgrade. */
    public static LocalWebSocket connect(URI uri, List<String> protocols, String origin, int timeoutMs, Listener listener) throws IOException {
        if (!"ws".equalsIgnoreCase(uri.getScheme())) throw new NotLocalException("only ws:// is opened here");
        String host = uri.getHost();
        if (host == null || host.isEmpty()) throw new NotLocalException("no host");
        InetAddress[] all = InetAddress.getAllByName(host.startsWith("[") ? host.substring(1, host.length() - 1) : host);
        for (InetAddress a : all) {
            if (!isLocal(a)) throw new NotLocalException(host + " is not on the local network");
        }
        int port = uri.getPort() == -1 ? 80 : uri.getPort();
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(all[0], port), timeoutMs);
            s.setSoTimeout(timeoutMs);
            s.setTcpNoDelay(true);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            String chosen = handshake(uri, host, port, protocols, origin, in, out);
            s.setSoTimeout(0);
            LocalWebSocket ws = new LocalWebSocket(s, in, out, listener, chosen);
            Thread reader = new Thread(ws::readLoop, "potyro-local-socket");
            reader.setDaemon(true);
            reader.start();
            return ws;
        } catch (IOException e) {
            try { s.close(); } catch (IOException ignored) { }
            throw e;
        }
    }

    public String protocol() { return protocol; }

    /** Bytes handed to send and not yet written. */
    public long bufferedAmount() { return queued.get(); }

    private static String handshake(URI uri, String host, int port, List<String> protocols, String origin, InputStream in, OutputStream out) throws IOException {
        byte[] nonce = new byte[16];
        RANDOM.nextBytes(nonce);
        String key = Base64.encode(nonce);
        String path = (uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath()) + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
        StringBuilder req = new StringBuilder();
        req.append("GET ").append(path).append(" HTTP/1.1\r\n");
        req.append("Host: ").append(host).append(port == 80 ? "" : ":" + port).append("\r\n");
        req.append("Upgrade: websocket\r\nConnection: Upgrade\r\n");
        req.append("Sec-WebSocket-Key: ").append(key).append("\r\n");
        req.append("Sec-WebSocket-Version: 13\r\n");
        if (origin != null) req.append("Origin: ").append(origin).append("\r\n");
        if (protocols != null && !protocols.isEmpty()) req.append("Sec-WebSocket-Protocol: ").append(String.join(", ", protocols)).append("\r\n");
        req.append("\r\n");
        out.write(req.toString().getBytes(StandardCharsets.UTF_8));
        out.flush();

        String head = readHead(in);
        String[] lines = head.split("\r\n");
        String[] status = lines[0].split(" ", 3);
        int code = status.length > 1 ? parseInt(status[1]) : 0;
        if (code != 101) throw new RefusedException(code, "the server answered " + lines[0]);
        String accept = null;
        String chosen = "";
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon < 0) continue;
            String name = lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = lines[i].substring(colon + 1).trim();
            if (name.equals("sec-websocket-accept")) accept = value;
            if (name.equals("sec-websocket-protocol")) chosen = value;
        }
        if (!expectedAccept(key).equals(accept)) throw new RefusedException(code, "the server's upgrade was not a WebSocket's");
        return chosen;
    }

    private static int parseInt(String s) {
        try { return Integer.parseInt(s.trim()); } catch (NumberFormatException e) { return 0; }
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int matched = 0;
        while (matched < 4) {
            int b = in.read();
            if (b < 0) throw new EOFException("the server closed during the upgrade");
            buf.write(b);
            if (buf.size() > 16 * 1024) throw new IOException("the server's answer is too long");
            matched = (b == '\r' && (matched == 0 || matched == 2)) || (b == '\n' && (matched == 1 || matched == 3)) ? matched + 1 : (b == '\r' ? 1 : 0);
        }
        return new String(buf.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    static String expectedAccept(String key) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            return Base64.encode(sha1.digest((key + GUID).getBytes(StandardCharsets.US_ASCII)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------ sending

    public void sendText(String text) throws IOException { send(0x1, text.getBytes(StandardCharsets.UTF_8)); }

    public void sendBinary(byte[] bytes) throws IOException { send(0x2, bytes); }

    private void send(int opcode, byte[] payload) throws IOException {
        if (closeSent || finished) throw new IOException("the connection is closed");
        queued.addAndGet(payload.length);
        try {
            writeFrame(opcode, payload);
        } finally {
            queued.addAndGet(-payload.length);
        }
    }

    /** Client frames are masked (RFC 6455 §5.3); one writer at a time. */
    private synchronized void writeFrame(int opcode, byte[] payload) throws IOException {
        int len = payload.length;
        ByteArrayOutputStream f = new ByteArrayOutputStream(len + 14);
        f.write(0x80 | opcode);
        if (len < 126) {
            f.write(0x80 | len);
        } else if (len < 65536) {
            f.write(0x80 | 126);
            f.write(len >>> 8);
            f.write(len & 0xff);
        } else {
            f.write(0x80 | 127);
            for (int i = 7; i >= 0; i--) f.write((int) (((long) len) >>> (8 * i)) & 0xff);
        }
        byte[] mask = new byte[4];
        RANDOM.nextBytes(mask);
        f.write(mask, 0, 4);
        byte[] masked = new byte[len];
        for (int i = 0; i < len; i++) masked[i] = (byte) (payload[i] ^ mask[i & 3]);
        f.write(masked, 0, len);
        out.write(f.toByteArray());
        out.flush();
    }

    /** Close with a code (1000, or the app's 3000–4999) and a reason. The close event follows. */
    public void close(int code, String reason) {
        if (closeSent || finished) return;
        closeSent = true;
        byte[] r = reason == null ? new byte[0] : reason.getBytes(StandardCharsets.UTF_8);
        if (r.length > 123) r = java.util.Arrays.copyOf(r, 123);
        byte[] payload = new byte[2 + r.length];
        payload[0] = (byte) (code >>> 8);
        payload[1] = (byte) (code & 0xff);
        System.arraycopy(r, 0, payload, 2, r.length);
        try {
            writeFrame(0x8, payload);
            // The server answers with its own close; if it does not within 3 s, the socket is ended.
            socket.setSoTimeout(3000);
        } catch (IOException e) {
            finish(1006, "", false);
        }
    }

    // ------------------------------------------------------------ receiving

    private void readLoop() {
        ByteArrayOutputStream message = null;
        int messageOpcode = 0;
        try {
            while (!finished) {
                int b0 = in.read();
                int b1 = in.read();
                if (b0 < 0 || b1 < 0) throw new EOFException();
                boolean fin = (b0 & 0x80) != 0;
                int opcode = b0 & 0x0f;
                if ((b1 & 0x80) != 0) { protocolError("a server frame must not be masked"); return; }
                long len = b1 & 0x7f;
                if (len == 126) len = (readByte() << 8) | readByte();
                else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | readByte(); }
                if (opcode >= 0x8) {
                    if (len > 125 || !fin) { protocolError("bad control frame"); return; }
                    byte[] p = readFully((int) len);
                    if (opcode == 0x9) { if (!closeSent) writeFrame(0xA, p); }
                    else if (opcode == 0x8) { onCloseFrame(p); return; }
                    continue;
                }
                long total = (message == null ? 0 : message.size()) + len;
                if (total > MAX_MESSAGE) { tooBig(); return; }
                byte[] p = readFully((int) len);
                if (opcode != 0x0) {
                    if (message != null) { protocolError("a new message began inside another"); return; }
                    messageOpcode = opcode;
                    message = new ByteArrayOutputStream();
                } else if (message == null) { protocolError("a continuation with no message"); return; }
                message.write(p, 0, p.length);
                if (fin) {
                    byte[] whole = message.toByteArray();
                    message = null;
                    if (messageOpcode == 0x1) listener.onText(new String(whole, StandardCharsets.UTF_8));
                    else if (messageOpcode == 0x2) listener.onBinary(whole);
                }
            }
        } catch (IOException e) {
            finish(1006, "", false);
        }
    }

    private int readByte() throws IOException {
        int b = in.read();
        if (b < 0) throw new EOFException();
        return b;
    }

    private byte[] readFully(int len) throws IOException {
        byte[] p = new byte[len];
        int off = 0;
        while (off < len) {
            int n = in.read(p, off, len - off);
            if (n < 0) throw new EOFException();
            off += n;
        }
        return p;
    }

    private void onCloseFrame(byte[] p) throws IOException {
        int code = p.length >= 2 ? ((p[0] & 0xff) << 8) | (p[1] & 0xff) : 1005;
        String reason = p.length > 2 ? new String(p, 2, p.length - 2, StandardCharsets.UTF_8) : "";
        if (!closeSent) {
            closeSent = true;
            byte[] echo = p.length >= 2 ? java.util.Arrays.copyOf(p, 2) : new byte[0];
            try { writeFrame(0x8, echo); } catch (IOException ignored) { }
        }
        finish(code, reason, true);
    }

    private void tooBig() {
        close(1009, "message too big");
        finish(1009, "message too big", false);
    }

    private void protocolError(String why) {
        close(1002, why);
        finish(1002, why, false);
    }

    private void finish(int code, String reason, boolean clean) {
        if (finished) return;
        finished = true;
        try { socket.close(); } catch (IOException ignored) { }
        listener.onClose(code, reason, clean);
    }

    /** Standard base64, both ways (java.util.Base64 is API 26; the app supports 24). */
    public static final class Base64 {
        private static final char[] A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
        private static final int[] R = new int[128];
        static {
            java.util.Arrays.fill(R, -1);
            for (int i = 0; i < A.length; i++) R[A[i]] = i;
        }

        public static String encode(byte[] b) {
            StringBuilder s = new StringBuilder((b.length + 2) / 3 * 4);
            int i = 0;
            for (; i + 2 < b.length; i += 3) {
                int n = ((b[i] & 0xff) << 16) | ((b[i + 1] & 0xff) << 8) | (b[i + 2] & 0xff);
                s.append(A[n >>> 18]).append(A[(n >>> 12) & 63]).append(A[(n >>> 6) & 63]).append(A[n & 63]);
            }
            if (i < b.length) {
                int n = (b[i] & 0xff) << 16 | (i + 1 < b.length ? (b[i + 1] & 0xff) << 8 : 0);
                s.append(A[n >>> 18]).append(A[(n >>> 12) & 63]).append(i + 1 < b.length ? A[(n >>> 6) & 63] : '=').append('=');
            }
            return s.toString();
        }

        public static byte[] decode(String s) {
            int len = s.length();
            while (len > 0 && s.charAt(len - 1) == '=') len--;
            byte[] out = new byte[len * 3 / 4];
            int buf = 0, bits = 0, j = 0;
            for (int i = 0; i < len; i++) {
                char c = s.charAt(i);
                int v = c < 128 ? R[c] : -1;
                if (v < 0) throw new IllegalArgumentException("not base64");
                buf = (buf << 6) | v;
                bits += 6;
                if (bits >= 8) {
                    bits -= 8;
                    out[j++] = (byte) ((buf >>> bits) & 0xff);
                }
            }
            return j == out.length ? out : java.util.Arrays.copyOf(out, j);
        }
    }
}
