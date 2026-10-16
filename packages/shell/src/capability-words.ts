// What an app's declared permissions are called where a person reads them: the Add an app card's
// "Asks for", and the trust dialog's list. The keys are the code's (`permissions: { camera: true }`).
//
// A permission is said as precisely as it was declared. `network: true` is the whole internet;
// `network: { hosts: [...] }` is those sites and nothing else; `network: { rooms: true }` is Potyro's
// own rooms relay (docs/28) — saying "the internet" for that would ask a person to allow far more
// than the app can reach.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { i18n } from "@potyro/i18n";

const CAP_WORDS: Record<string, MessageDescriptor> = {
  camera: msg({ message: "camera", comment: "What an app asks this device for, lower case" }),
  notifications: msg({ message: "notifications", comment: "What an app asks this device for, lower case" }),
  geo: msg({ message: "location", comment: "What an app asks this device for, lower case" }),
  geolocation: msg({ message: "location", comment: "What an app asks this device for, lower case" }),
  filesystem: msg({ message: "files outside the app", comment: "What an app asks this device for, lower case" }),
  network: msg({ message: "the internet", comment: "What an app asks this device for, lower case" }),
  haptics: msg({ message: "vibration", comment: "What an app asks this device for, lower case" }),
  sync: msg({ message: "sharing", comment: "What an app asks this device for, lower case" }),
  ai: msg({ message: "AI, for the photos and text it sends", comment: "What an app asks this device for, lower case; AI = an online AI service (ctx.caps.ai)" }),
};

const ROOMS = msg({
  message: "Potyro’s rooms (play live with people who have the link)",
  comment: "What an app asks this device for, lower case: Potyro's own relay for live multiplayer rooms (ctx.caps.network.room, docs/28)",
});

/** A permission key in words; a key Potyro does not know is shown as it is written. */
export function capabilityWords(key: string): string {
  const d = CAP_WORDS[key];
  return d ? i18n._(d) : key;
}

/** `network: { hosts, rooms }` in words, one line per thing it reaches; `true` (or anything unreadable) is the internet. */
function networkWords(value: unknown): string[] {
  if (!value) return [];
  if (typeof value !== "object" || Array.isArray(value)) return [capabilityWords("network")];
  const { hosts, rooms } = value as { hosts?: unknown; rooms?: unknown };
  const lines: string[] = [];
  const named = Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === "string" && h.length > 0) : [];
  if (named.length) {
    const sites = named.join(", ");
    lines.push(i18n._(msg({ message: `the internet, only these sites: ${sites}`, comment: "What an app asks this device for, lower case; sites is a list of web addresses, e.g. api.example.com" })));
  }
  if (rooms === true) lines.push(i18n._(ROOMS));
  return lines;
}

/**
 * Everything a `permissions` object asks for, in words, one line per thing: what the trust dialog
 * and the Add an app card list. A permission set to `false` asks for nothing.
 */
export function permissionWords(permissions: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(permissions ?? {})) {
    if (!value) continue;
    if (key === "network") lines.push(...networkWords(value));
    else lines.push(capabilityWords(key));
  }
  return [...new Set(lines)];
}
