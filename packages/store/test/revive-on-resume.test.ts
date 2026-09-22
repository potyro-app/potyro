// Bringing the relay back when the page comes back.
//
// Reported, and reproduced by the owner on a real phone: "the issue only happens when the browser
// app is opened in the same android but not on focus. If I close it when I open again it shows the
// new chat messages notification and also the balloon. If the browser is opened and in focus and I
// send a message using my desktop the message balloon also appears."
//
// Android freezes a browser that is open but not in front: the socket goes, and every reconnection
// attempt fails while the page cannot run. `WebSocketPeerWithReconnection` backs off linearly per
// attempt, so by the time someone switches back the next try can be a long way off — and nothing in
// the codebase listened for `visibilitychange`, `pageshow` or `online`. A reload reconnected, which
// is why closing and reopening the browser worked and switching back to it did not.

import { describe, expect, it } from "vitest";
import { reviveOnResume, type Revivable } from "../src/jazz-backend.js";

/** A relay that records what was done to it. */
function fakeRelay(connected = false): Revivable & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    connected,
    enable() {
      calls.push("enable");
    },
    disable() {
      calls.push("disable");
    },
  };
}

/** Enough of `window`/`document` to drive the listeners, with a settable visibility. */
function fakeScope() {
  const docListeners = new Map<string, () => void>();
  const winListeners = new Map<string, () => void>();
  const doc = {
    visibilityState: "visible" as string,
    addEventListener: (t: string, fn: () => void) => void docListeners.set(t, fn),
    removeEventListener: (t: string) => void docListeners.delete(t),
  };
  return {
    scope: {
      document: doc,
      addEventListener: (t: string, fn: () => void) => void winListeners.set(t, fn),
      removeEventListener: (t: string) => void winListeners.delete(t),
    },
    hide: () => {
      doc.visibilityState = "hidden";
      docListeners.get("visibilitychange")?.();
    },
    show: () => {
      doc.visibilityState = "visible";
      docListeners.get("visibilitychange")?.();
    },
    online: () => winListeners.get("online")?.(),
    listening: () => docListeners.size + winListeners.size,
  };
}

describe("reviving the relay when the page comes back", () => {
  it("reconnects after the page was away", () => {
    const relay = fakeRelay();
    const s = fakeScope();
    reviveOnResume(relay, s.scope as never);

    s.hide();
    const real = Date.now;
    Date.now = () => real() + 10_000; // ten seconds in the background
    s.show();
    Date.now = real;

    // Cycled, not merely enabled: the backoff is in the old connection, and so is any socket the OS
    // tore down without telling the page.
    expect(relay.calls).toEqual(["disable", "enable"]);
  });

  it("ignores a flick to another tab and back", () => {
    const relay = fakeRelay(true);
    const s = fakeScope();
    reviveOnResume(relay, s.scope as never);

    s.hide();
    s.show(); // straight back, no elapsed time

    expect(relay.calls).toEqual([]);
  });

  it("cycles a connection that still claims to be connected", () => {
    // The zombie case, and the reason this does not check `connected` first: the OS drops the
    // connection without the page seeing a close, so the flag lies and nothing ever arrives.
    const relay = fakeRelay(true);
    const s = fakeScope();
    reviveOnResume(relay, s.scope as never);

    s.hide();
    const real = Date.now;
    Date.now = () => real() + 60_000;
    s.show();
    Date.now = real;

    expect(relay.calls).toEqual(["disable", "enable"]);
  });

  it("reconnects when the network comes back, without waiting for a tab switch", () => {
    const relay = fakeRelay(false);
    const s = fakeScope();
    reviveOnResume(relay, s.scope as never);

    s.online();

    expect(relay.calls).toEqual(["disable", "enable"]);
  });

  it("leaves a healthy connection alone when the network event fires", () => {
    const relay = fakeRelay(true);
    const s = fakeScope();
    reviveOnResume(relay, s.scope as never);

    s.online();

    expect(relay.calls).toEqual([]);
  });

  it("stops listening when the connection is torn down", () => {
    const relay = fakeRelay();
    const s = fakeScope();
    const stop = reviveOnResume(relay, s.scope as never);
    expect(s.listening()).toBe(2);

    stop();

    expect(s.listening()).toBe(0);
  });

  it("does nothing at all where there is no document (a worker, a test, Node)", () => {
    const relay = fakeRelay();
    expect(() => reviveOnResume(relay, {} as never)()).not.toThrow();
    expect(relay.calls).toEqual([]);
  });
});
