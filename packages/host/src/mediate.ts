// Capability mediation (docs/04 "How ctx differs by trust", docs/07). Trusted apps get every
// platform capability unmediated. Untrusted apps get ONLY the capabilities their `permissions`
// manifest requested, each behind a one-time consent prompt and (where relevant) a scoping
// wrapper. App code sees the same `ctx.caps` interface either way — authority is what differs.

import type { AiCapability, Caps, NetworkPermission, PermissionManifest } from "potyro";
import type { AiCall, AiCap, AiConsentWords, Capabilities } from "@potyro/capabilities";
import { AiError, makeAi, type AiDeps } from "./ai.js";
import type { Provenance, UiBridge } from "./types.js";
import { makeLiveNetwork, permittedHosts } from "./sockets.js";
import { makeSpeech } from "./speech.js";

/** What `ctx.caps.ai` needs from the ctx it lives on: the language and the app's own pictures. */
export type AiContext = Omit<AiDeps, "before">;

/** No ctx to read pictures from (a caps-only test): a Blob is the only picture there is. */
const BLOBS_ONLY: AiContext = {
  language: "en",
  image: async (img) => {
    if (img instanceof Blob) return img;
    throw new Error("ctx.caps.ai: this picture cannot be read here");
  },
};

function englishConsent(appName: string, sends: "photo" | "text", service: string): AiConsentWords {
  return {
    message: sends === "photo" ? `“${appName}” wants to send a photo to an AI service (${service}) to read it.` : `“${appName}” wants to send some text to an AI service (${service}).`,
    // Who pays is the platform's to say (AiCap.consentWords): this fallback promises nothing about it.
    detail: `Only what the app sends goes: this ${sends} and its question — nothing else in the app.`,
    ok: "Allow",
    cancel: "Not now",
  };
}

/**
 * A sealed app's AI: asked once per app on this device, with words that name the service and what
 * goes. "Allow" is remembered by the shell (`AiCap.allow`); "Not now" refuses this call and is asked
 * again on the next — never remembered as a no, because the person may simply not have been ready.
 */
function sealedAi(cap: AiCap, ui: UiBridge, appName: string, ai: AiContext): AiCapability {
  let asking: Promise<boolean> | null = null;
  const before = async (call: AiCall): Promise<void> => {
    if (cap.standing?.() === "on") return;
    const sends = call.parts.some((p) => "image" in p) ? "photo" : "text";
    // Two calls at once ask one question.
    asking ??= (async () => {
      try {
        const w = (await cap.consentWords?.(appName, sends)) ?? englishConsent(appName, sends, cap.service);
        return await ui.confirm(w.message, { detail: w.detail, ok: w.ok, cancel: w.cancel, privacy: w.privacy });
      } finally {
        asking = null;
      }
    })();
    if (!(await asking)) throw new AiError(`Permission denied: ${appName} → AI`, "denied");
    cap.allow?.();
  };
  return makeAi(cap, { ...ai, before });
}

/** A trusted app's AI: no question, but the off switch still holds, and first use shows the switch. */
function trustedAi(cap: AiCap, ai: AiContext): AiCapability {
  return makeAi(cap, {
    ...ai,
    before: async () => {
      if (cap.standing?.() === undefined) cap.allow?.();
    },
  });
}

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
function adaptFull(caps: Capabilities, ui: UiBridge, appName: string, owner: object): Caps {
  // Live connections are mediated for every app (limits, closing on leave); a trusted one is not asked.
  const live = makeLiveNetwork({ cap: caps.sockets, trusted: true, permission: true, ui, appName, owner });
  const out: Caps = {
    filesystem: { pick: () => caps.filesystem.pick(), save: (name, data) => caps.filesystem.save(name, data) },
    network: { fetch: (input, init) => caps.network.fetch(input, init), socket: live.socket, room: live.room },
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
  const hosts = permittedHosts(perm);
  if (hosts === "any") return true;
  const host = hostOf(input);
  return host != null && hosts.includes(host);
}

/** Build the mediated `ctx.caps` for an untrusted app from its permission manifest. */
function adaptMediated(caps: Capabilities, perms: PermissionManifest, ui: UiBridge, appName: string, owner: object): Caps {
  const gate = makeConsentGate(ui, appName);
  // Hosts from the manifest, asked once per app and host and remembered on this device (docs/28).
  const live = makeLiveNetwork({ cap: caps.sockets, trusted: false, permission: perms.network, ui, appName, owner });
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
      socket: live.socket,
      room: live.room,
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
  /** For `ctx.caps.ai`: the ctx's language and how it reads the app's own pictures. */
  ai?: AiContext;
  /**
   * Whose live connections these are — the loaded app — so its count of open connections and its
   * consent questions outlive one pass's ctx. The platform caps when absent.
   */
  owner?: object;
}): Caps {
  const trusted = args.provenance === "trusted";
  const owner = args.owner ?? args.caps;
  const out = trusted ? adaptFull(args.caps, args.ui, args.appName, owner) : adaptMediated(args.caps, args.permissions, args.ui, args.appName, owner);
  // AI: on the device or not at all; for a sealed app only when its manifest asked (docs/23).
  const cap = args.caps.ai;
  if (cap && (trusted || args.permissions.ai === true)) {
    out.ai = trusted ? trustedAi(cap, args.ai ?? BLOBS_ONLY) : sealedAi(cap, args.ui, args.appName, args.ai ?? BLOBS_ONLY);
  }
  // Voice (docs/29): every app where the device can listen; a sealed one only when its manifest asked,
  // and then it asks the person once. Absent otherwise, so `ctx.caps.speech` tells the app.
  const speech = args.caps.speech;
  if (speech && (trusted || args.permissions.speech === true)) {
    out.speech = makeSpeech({ cap: speech, trusted, ui: args.ui, appName: args.appName, owner, locale: args.ai?.language ?? "en" });
  }
  return out;
}
