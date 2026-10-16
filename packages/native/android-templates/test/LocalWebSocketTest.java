package __PACKAGE__;

// Runs LocalWebSocket on a desktop JVM (packages/native/test/local-websocket.test.ts compiles and runs
// it): against a real echo server on 127.0.0.1, then the refusals. Prints one line per check; any
// failure exits non-zero with what went wrong.

import java.net.InetAddress;
import java.net.URI;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

public final class LocalWebSocketTest {
    private static void check(boolean ok, String what) {
        if (!ok) {
            System.out.println("FAIL " + what);
            System.exit(1);
        }
        System.out.println("ok " + what);
    }

    public static void main(String[] args) throws Exception {
        int echoPort = Integer.parseInt(args[0]);
        int deadPort = Integer.parseInt(args[1]);
        int forbiddenPort = Integer.parseInt(args[2]);

        for (String a : new String[] {"127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.20", "169.254.0.9", "::1", "fd00::1", "fc12::1", "fe80::1"}) {
            check(LocalWebSocket.isLocal(InetAddress.getByName(a)), a + " is local");
        }
        for (String a : new String[] {"8.8.8.8", "172.32.0.1", "100.64.0.1", "2001:db8::1", "1.1.1.1"}) {
            check(!LocalWebSocket.isLocal(InetAddress.getByName(a)), a + " is not local");
        }
        check(LocalWebSocket.Base64.encode(new byte[] {(byte) 0xfb, (byte) 0xff}).equals("+/8="), "base64 encodes");
        check(java.util.Arrays.equals(LocalWebSocket.Base64.decode("+/8="), new byte[] {(byte) 0xfb, (byte) 0xff}), "base64 decodes");
        check(LocalWebSocket.expectedAccept("dGhlIHNhbXBsZSBub25jZQ==").equals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="), "the RFC 6455 accept example");

        BlockingQueue<Object> got = new ArrayBlockingQueue<>(16);
        LocalWebSocket ws = LocalWebSocket.connect(URI.create("ws://127.0.0.1:" + echoPort + "/echo?x=1"), List.of("v1"), "https://localhost", 5000, new LocalWebSocket.Listener() {
            public void onText(String text) { got.add("text:" + text); }
            public void onBinary(byte[] bytes) { got.add(bytes); }
            public void onClose(int code, String reason, boolean clean) { got.add("close:" + code + ":" + reason + ":" + clean); }
        });
        check("v1".equals(ws.protocol()), "the server's chosen subprotocol");
        ws.sendText("hello ✓");
        check("text:hello ✓".equals(got.poll(5, TimeUnit.SECONDS)), "text goes and comes back");
        ws.sendBinary(new byte[] {1, 2, (byte) 255});
        Object b = got.poll(5, TimeUnit.SECONDS);
        check(b instanceof byte[] && java.util.Arrays.equals((byte[]) b, new byte[] {1, 2, (byte) 255}), "bytes go and come back");
        byte[] big = new byte[200_000];
        for (int i = 0; i < big.length; i++) big[i] = (byte) i;
        ws.sendBinary(big);
        Object bb = got.poll(5, TimeUnit.SECONDS);
        check(bb instanceof byte[] && java.util.Arrays.equals((byte[]) bb, big), "200 kB (a 64-bit length) comes back whole");
        ws.close(1000, "done");
        check("close:1000:done:true".equals(got.poll(5, TimeUnit.SECONDS)), "a close frame both ways, clean");

        try {
            LocalWebSocket.connect(URI.create("ws://8.8.8.8/"), Collections.emptyList(), null, 2000, null);
            check(false, "a public address is refused");
        } catch (LocalWebSocket.NotLocalException e) {
            check(true, "a public address is refused before anything is sent");
        }
        try {
            LocalWebSocket.connect(URI.create("ws://127.0.0.1:" + deadPort + "/"), Collections.emptyList(), null, 2000, null);
            check(false, "nothing listening is refused");
        } catch (java.net.ConnectException e) {
            check(true, "nothing listening is refused");
        }
        try {
            LocalWebSocket.connect(URI.create("ws://127.0.0.1:" + forbiddenPort + "/"), Collections.emptyList(), "https://localhost", 2000, null);
            check(false, "a 403 is refused");
        } catch (LocalWebSocket.RefusedException e) {
            check(e.status == 403, "a server that answers 403 is refused, with the status");
        }
        System.out.println("ALL OK");
    }
}
