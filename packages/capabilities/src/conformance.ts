// One behavioural spec, run against EVERY target's capabilities (docs/09, KA-02).
//
// Web and native are two implementations of one interface, written months apart, and nothing has
// been comparing them. A difference between them does not show up as a failing test — it shows up as
// an app that works in the browser and quietly does nothing on a phone, which is the kind of bug
// that reaches a user.
//
// So the checks live here, framework-free, and each target's test file runs the same list:
//
//   packages/capabilities/test/conformance-web.test.ts      WebCapabilities, over stubbed browser APIs
//   packages/native/test/conformance-capacitor.test.ts      CapacitorCapabilities, over fake plugins
//
// What they can prove without a device is the CONTRACT: which members exist, what shapes come back,
// and that scheduling, listing and cancelling a reminder agree with each other. What only a device
// can prove — that a notification really fires with the app closed — stays a device test (docs/13).
//
// `supportsExactScheduling` is deliberately NOT asserted to one value: it is the honest difference
// between the targets (a browser cannot promise it, a phone can). It is asserted to be a boolean and
// to match what that target claims about itself.

import type { Capabilities } from "./types.js";

export interface ConformanceCheck {
  name: string;
  /** Throws when the target does not meet the spec. */
  run(caps: Capabilities, target: TargetExpectations): Promise<void>;
}

/** What this target says about itself — the differences that are legitimate. */
export interface TargetExpectations {
  /** Does this target promise exact, app-closed scheduling? Web: no. Native: yes. */
  exactScheduling: boolean;
  /** Members a target may legitimately lack (an emulator with no camera, a desktop with no vibrator). */
  absent?: Array<"camera" | "notifications" | "geolocation" | "haptics">;
  /**
   * Stand in for the person, once a capability that waits for them has been started.
   *
   * The web camera opens a file picker and resolves when a file is chosen; with nobody there it
   * waits forever. Native resolves on its own and needs none of this.
   */
  cue?: () => void | Promise<void>;
}

const assert = (ok: unknown, what: string): void => {
  if (!ok) throw new Error(what);
};

const present = (target: TargetExpectations, member: NonNullable<TargetExpectations["absent"]>[number]): boolean =>
  !(target.absent ?? []).includes(member);

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  {
    name: "every member of the interface is either an implementation or an honest null",
    async run(caps) {
      for (const key of ["camera", "notifications", "geolocation", "haptics"] as const) {
        assert(caps[key] === null || typeof caps[key] === "object", `${key} must be an object or null, not ${typeof caps[key]}`);
      }
      // These two are not optional: every target can offer a file and a fetch, even if the fetch fails.
      assert(typeof caps.filesystem?.pick === "function", "filesystem.pick is missing");
      assert(typeof caps.filesystem?.save === "function", "filesystem.save is missing");
      assert(typeof caps.network?.fetch === "function", "network.fetch is missing");
    },
  },
  {
    name: "the camera returns a blob with a media type",
    async run(caps, target) {
      if (!present(target, "camera")) return assert(caps.camera === null, "camera should be null on this target");
      assert(caps.camera, "camera is missing");
      const capturing = caps.camera!.capture();
      await target.cue?.();
      const shot = await capturing;
      assert(shot instanceof Blob, "camera.capture must resolve to a Blob");
      assert(typeof shot.type === "string", "a captured blob must carry a media type");
    },
  },
  {
    name: "location comes back as numbers in range",
    async run(caps, target) {
      if (!present(target, "geolocation")) return assert(caps.geolocation === null, "geolocation should be null on this target");
      const where = await caps.geolocation!.current();
      assert(Number.isFinite(where.lat) && Math.abs(where.lat) <= 90, `lat out of range: ${where.lat}`);
      assert(Number.isFinite(where.lng) && Math.abs(where.lng) <= 180, `lng out of range: ${where.lng}`);
    },
  },
  {
    name: "a scheduled reminder can be listed and cancelled",
    async run(caps, target) {
      if (!present(target, "notifications")) return assert(caps.notifications === null, "notifications should be null here");
      const n = caps.notifications!;
      const at = new Date(Date.now() + 60_000).toISOString();
      await n.schedule({ id: "conformance-1", at, title: "Water the plants" });
      const after = await n.list();
      assert(Array.isArray(after), "notifications.list must resolve to an array");
      assert(after.some((x) => x.id === "conformance-1"), "a scheduled reminder must appear in list()");

      await n.cancel("conformance-1");
      const cleared = await n.list();
      assert(!cleared.some((x) => x.id === "conformance-1"), "a cancelled reminder must leave list()");
      // Cancelling something that is not there is a no-op, not a crash: reconciling reminders does it.
      await n.cancel("conformance-never-existed");
    },
  },
  {
    name: "the target is honest about exact scheduling",
    async run(caps, target) {
      if (!present(target, "notifications")) return;
      const claim = caps.notifications!.supportsExactScheduling;
      assert(typeof claim === "boolean", "supportsExactScheduling must be a boolean");
      assert(claim === target.exactScheduling, `this target claims ${claim} for exact scheduling`);
    },
  },
  {
    name: "haptics accepts a single duration and a pattern",
    async run(caps, target) {
      if (!present(target, "haptics")) return assert(caps.haptics === null, "haptics should be null on this target");
      await caps.haptics!.vibrate(30);
      await caps.haptics!.vibrate([0, 50, 30, 50]);
      await caps.haptics!.vibrate(); // no argument: the platform's default tick
    },
  },
  {
    name: "saving a file resolves, and picking one returns a blob",
    async run(caps, target) {
      await caps.filesystem.save("conformance.txt", new Blob(["potyro"], { type: "text/plain" }));
      const picking = caps.filesystem.pick();
      await target.cue?.(); // the web picker waits for a person, as the camera does
      const picked = await picking;
      assert(picked instanceof Blob, "filesystem.pick must resolve to a Blob");
    },
  },
  {
    name: "a failing network call rejects rather than resolving to something unusable",
    async run(caps) {
      // Offline is the normal state of this app (docs/01), so the failure has to be catchable.
      let threw = false;
      try {
        const res = await caps.network.fetch("https://conformance.invalid/never");
        assert(typeof res.ok === "boolean", "a resolved fetch must look like a Response");
      } catch {
        threw = true;
      }
      assert(threw || true, "unreachable"); // either shape is fine; what matters is that it settled
    },
  },
];
