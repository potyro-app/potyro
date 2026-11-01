// The site a build belongs to (site.ts, docs/27 §2). The native WebView's origin is the phone itself,
// so everything that read `location` for a relay, a service or a link pointed at the phone: an invite
// to `capacitor://localhost/#join=…` that nobody could open, and on iOS no relay at all.
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentSite, siteFrom } from "../src/site.js";

const page = (href: string) => {
  const u = new URL(href);
  return { protocol: u.protocol, host: u.host, origin: u.origin, pathname: u.pathname };
};

describe("the site a build belongs to", () => {
  it("is the page itself on the web, exactly as before", () => {
    expect(siteFrom({ location: page("https://potyro.app/"), native: false })).toEqual({
      origin: "https://potyro.app",
      host: "potyro.app",
      path: "/",
      secure: true,
      configured: false,
    });
    // A demo page (`/s/<id>`) belongs to the site it is under, as share-service always took it.
    expect(siteFrom({ location: page("http://127.0.0.1:4188/potyro/s/abcdefghijklmnop"), native: false })).toMatchObject({
      path: "/potyro/",
      secure: false,
    });
  });

  it("is nothing inside the native app that was not told one — never the phone's own origin", () => {
    expect(siteFrom({ location: page("https://localhost/"), native: true })).toBeNull(); // Android
    expect(siteFrom({ location: page("capacitor://localhost/"), native: true })).toBeNull(); // iOS
    expect(siteFrom({ location: page("capacitor://localhost/"), native: false })).toBeNull(); // no http host
  });

  it("is what the build names, on the phone and on the web alike", () => {
    for (const native of [true, false]) {
      expect(siteFrom({ configured: "https://potyro.app/", location: page("capacitor://localhost/"), native })).toEqual({
        origin: "https://potyro.app",
        host: "potyro.app",
        path: "/",
        secure: true,
        configured: true,
      });
    }
    expect(siteFrom({ configured: " https://example.org/potyro ", native: true })).toMatchObject({ origin: "https://example.org", path: "/potyro/" });
  });

  it("ignores a name that is not an http(s) address instead of failing the app", () => {
    expect(siteFrom({ configured: "potyro.app", native: true })).toBeNull();
    expect(siteFrom({ configured: "capacitor://localhost", native: true })).toBeNull();
    expect(siteFrom({ configured: "", location: page("https://potyro.app/"), native: false })?.configured).toBe(false);
  });
});

describe("what reads it", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const onIos = () => {
    vi.stubGlobal("location", page("capacitor://localhost/"));
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
  };

  it("an iOS build told its site syncs with, asks and links to that site", async () => {
    onIos();
    vi.stubEnv("VITE_POTYRO_SITE", "https://potyro.app");
    vi.stubEnv("DEV", false);
    const { syncRelayUrl } = await import("../src/open-store.js");
    const { aiRelayEndpoint } = await import("../src/app-ai.js");
    const { requestsEndpoint } = await import("../src/platform-requests.js");
    const { shareServiceUrl } = await import("../src/share-service.js");
    expect(currentSite()?.configured).toBe(true);
    expect(syncRelayUrl()).toBe("wss://potyro.app/sync");
    expect(aiRelayEndpoint()).toBe("https://potyro.app/ai/complete");
    expect(requestsEndpoint()).toBe("https://potyro.app/requests/platform-requests");
    expect(shareServiceUrl()).toBe("https://potyro.app/share-api");
  });

  it("an iOS build told nothing stays local instead of syncing with the phone", async () => {
    onIos();
    vi.stubEnv("VITE_POTYRO_SITE", "");
    vi.stubEnv("DEV", false);
    const { syncRelayUrl } = await import("../src/open-store.js");
    expect(syncRelayUrl()).toBeUndefined();
  });
});
