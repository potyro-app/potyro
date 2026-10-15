// The device's capabilities for one app: with that app's AI service (docs/23) and its live
// connections (docs/28) added.
//
// AI is not a device feature — no target implements it — so the composition root adds it per app:
// it is keyed by the app (its on/off switch, its consent, its spend), it reads the person's own key
// at the moment of each request (Model settings, engine-store.ts), and it names the device to the
// free relay with the same random id the platform-request relay counts by.
//
// Live connections ARE the device's (one set per page, closed when the person leaves the app); what
// is per app is where Potyro's rooms are and which hosts the person let it reach (app-sockets.ts).

import type { Capabilities } from "@potyro/capabilities";
import { createAppAi } from "./app-ai.js";
import { appSockets } from "./app-sockets.js";
import { getEngineConfig } from "./engine-store.js";
import { currentLocale } from "./locale.js";
import { deviceId } from "./device-id.js";

export function capsForApp(caps: Capabilities, appId: string): Capabilities {
  const ai = createAppAi({ appId, ownKey: () => getEngineConfig().openrouterKey, device: deviceId, language: currentLocale });
  const sockets = appSockets(caps.sockets, appId);
  // A copy with the same prototype: the device's capabilities may be a class with methods on it.
  return Object.assign(Object.create(Object.getPrototypeOf(caps) as object) as Capabilities, caps, { ai, sockets });
}
