// The device's capabilities, for shell surfaces that aren't an app.
//
// Boot picks them once — native on a device, web otherwise (main.tsx is the sole place that chooses).
// The Data panel builds runtimes of its own, and a photo field's editor needs the camera: handing it
// the web capabilities from here would pick a target outside the one place allowed to.

import type { Capabilities } from "@karta/capabilities";

let current: Capabilities | null = null;

export function setShellCaps(caps: Capabilities): void {
  current = caps;
}

export function shellCaps(): Capabilities {
  if (!current) throw new Error("the device's capabilities are not ready yet");
  return current;
}
