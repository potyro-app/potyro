// Capability mediation (docs/04 "How ctx differs by trust", docs/07). Trusted apps get every
// platform capability unmediated. Untrusted apps get ONLY the capabilities their `permissions`
// manifest requested, each behind a one-time consent prompt and (where relevant) a scoping
// wrapper. App code sees the same `ctx.caps` interface either way — authority is what differs.

import type { Caps, NetworkPermission, PermissionManifest } from "potyro";
import type { Capabilities } from "@potyro/capabilities";
import type { Provenance, UiBridge } from "./types.js";

/** A once-per-capability consent gate backed by the shell's confirm dialog. */
function makeConsentGate(ui: UiBridge, appName: string) {
  const decisions = new Map<string, Promise<boolean>>();
  return async function ensure(capLabel: string): Promise<void> {
    let decision = decisions.get(capLabel);
    if (!decision) {
      decision = ui.confirm(`Allow “${appName}” to use ${capLabel}?`);
      decisions.set(capLabel, decision);
    }
    if (!(await decision)) {
      throw new Error(`Permission denied: ${appName} → ${capLabel}`);
    }
  };
}

/** Direct 1:1 adaptation of platform Capabilities → the app-facing `ctx.caps` shape. */
function adaptFull(caps: Capabilities): Caps {
  const out: Caps = {
    filesystem: { pick: () => caps.filesystem.pick(), save: (name, data) => caps.filesystem.save(name, data) },
    network: { fetch: (input, init) => caps.network.fetch(input, init) },
  };
  if (caps.camera) {
    const cam = caps.camera;
    const live = caps.liveCamera;
    out.camera = live
      ? { capture: (o) => cam.capture(o), live: (o) => live.start(o) }
      : { capture: (o) => cam.capture(o) };
  }
  if (caps.geolocation) out.geo = { current: () => caps.geolocation!.current() };
  if (caps.haptics) out.haptics = { vibrate: (p) => caps.haptics!.vibrate(p) };
  if (caps.notifications) {
    const n = caps.notifications;
    out.notifications = {
      supportsExactScheduling: n.supportsExactScheduling,
      schedule: (x) => n.schedule({ id: x.id, at: x.at.toISOString(), title: x.title, body: x.body }),
      cancel: (id) => n.cancel(id),
    };
  }
  return out;
}

function hostOf(input: string): string | null {
  try {
    return new URL(input).host;
  } catch {
    return null;
  }
}

function networkAllowed(perm: NetworkPermission | undefined, input: string): boolean {
  if (!perm) return false;
  if (perm === true) return true;
  if (!perm.hosts || perm.hosts.length === 0) return true;
  const host = hostOf(input);
  return host != null && perm.hosts.includes(host);
}

/** Build the mediated `ctx.caps` for an untrusted app from its permission manifest. */
function adaptMediated(caps: Capabilities, perms: PermissionManifest, ui: UiBridge, appName: string): Caps {
  const gate = makeConsentGate(ui, appName);
  const out: Caps = {
    // Untrusted filesystem is denied unless requested; when granted, scoped + consented.
    filesystem: {
      pick: async () => {
        if (!perms.filesystem) throw new Error(`Permission denied: ${appName} → filesystem`);
        await gate("files");
        return caps.filesystem.pick();
      },
      save: async (name, data) => {
        if (!perms.filesystem) throw new Error(`Permission denied: ${appName} → filesystem`);
        await gate("files");
        // Scope writes to an app-private name prefix.
        return caps.filesystem.save(`${appName}/${name}`, data);
      },
    },
    // Network denied unless requested; scoped to the allow-list of hosts when present.
    network: {
      fetch: async (input, init) => {
        if (!networkAllowed(perms.network, input)) {
          throw new Error(`Permission denied: ${appName} → network (${input})`);
        }
        await gate("the network");
        return caps.network.fetch(input, init);
      },
    },
  };

  if (perms.camera && caps.camera) {
    const cam = caps.camera;
    // A still only. The live camera is for trusted apps until sealed custom views exist (docs/25):
    // a sealed app's logic runs in the realm, which has nothing to draw frames on and no op that
    // streams. `live` is absent rather than a refusing stub, so `camera.live` tells the app.
    out.camera = {
      capture: async (o) => {
        await gate("the camera");
        return cam.capture(o);
      },
    };
  }
  if (perms.geo && caps.geolocation) {
    const geo = caps.geolocation;
    out.geo = {
      current: async () => {
        await gate("your location");
        return geo.current();
      },
    };
  }
  // Haptics is non-sensitive (can't leak data or harm) — manifest-gated but no consent prompt.
  if (perms.haptics && caps.haptics) {
    const h = caps.haptics;
    out.haptics = { vibrate: (p) => h.vibrate(p) };
  }
  if (perms.notifications && caps.notifications) {
    const n = caps.notifications;
    out.notifications = {
      supportsExactScheduling: n.supportsExactScheduling,
      schedule: async (x) => {
        await gate("notifications");
        return n.schedule({ id: x.id, at: x.at.toISOString(), title: x.title, body: x.body });
      },
      cancel: (id) => n.cancel(id),
    };
  }
  return out;
}

export function mediateCaps(args: {
  caps: Capabilities;
  provenance: Provenance;
  permissions: PermissionManifest;
  ui: UiBridge;
  appName: string;
}): Caps {
  return args.provenance === "trusted"
    ? adaptFull(args.caps)
    : adaptMediated(args.caps, args.permissions, args.ui, args.appName);
}
