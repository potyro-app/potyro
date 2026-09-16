// Deep links on a device — and the black screen they caused.
//
// A Capacitor plugin is a Proxy that answers to ANY method name by calling native. Returned bare
// from an `async` function, the runtime sees `.then` on it and calls `App.then(...)`; Android
// answers `"App.then()" is not implemented on android` and the promise never settles. Boot awaits
// the launch URL before rendering, so the app showed a black screen on the device, forever, while
// every browser test passed. These drive the same shape: a plugin that answers any method.

import { describe, expect, it, vi } from "vitest";
import { launchUrlFrom, listenForUrls, type CapacitorAppPlugin } from "../src/deep-links.js";

/** A stand-in for a Capacitor plugin: every property is a native call, `then` included. */
function pluginProxy(impl: Partial<CapacitorAppPlugin>): CapacitorAppPlugin {
  return new Proxy({} as CapacitorAppPlugin, {
    get(_t, name: string) {
      const own = (impl as Record<string, unknown>)[name];
      if (own) return own;
      return () => Promise.reject(new Error(`"App.${name}()" is not implemented on android`));
    },
  });
}

describe("the launch URL", () => {
  it("settles even though the plugin answers to `then`", async () => {
    const app = pluginProxy({ getLaunchUrl: async () => ({ url: "https://karta.app/#join=abc" }) });
    // Proof the hazard is real in this fixture: awaiting the plugin ITSELF never settles — the
    // runtime calls its `then`, which goes to native and answers nobody. That is the black screen.
    const hung = Promise.race([
      Promise.resolve(app as unknown as Promise<unknown>).then(() => "settled"),
      new Promise((r) => setTimeout(() => r("never settled"), 250)),
    ]);
    await expect(hung).resolves.toBe("never settled");

    await expect(launchUrlFrom(app)).resolves.toBe("https://karta.app/#join=abc");
  });

  it("is null when the app was not launched by a link, and when the plugin fails", async () => {
    await expect(launchUrlFrom(pluginProxy({ getLaunchUrl: async () => null }))).resolves.toBeNull();
    await expect(launchUrlFrom(pluginProxy({}))).resolves.toBeNull();
  });
});

describe("links while the app is running", () => {
  it("passes the url through and hands back a working unsubscribe", async () => {
    const remove = vi.fn();
    let fire: ((d: { url: string }) => void) | undefined;
    const app = pluginProxy({
      addListener: (async (_e: string, cb: (d: { url: string }) => void) => {
        fire = cb;
        return { remove };
      }) as CapacitorAppPlugin["addListener"],
    });
    const seen: string[] = [];
    const stop = await listenForUrls(app, (u) => seen.push(u));
    fire?.({ url: "https://karta.app/#join=xyz" });
    expect(seen).toEqual(["https://karta.app/#join=xyz"]);
    stop();
    expect(remove).toHaveBeenCalled();
  });
});
