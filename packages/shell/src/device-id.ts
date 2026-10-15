// A random id for this device, kept: the relays' limits (platform requests, the free AI allowance)
// count per device. Says nothing about the person. Its own module so the app's boot path can name the
// device without loading the Studio's request code.

const DEVICE = "potyro:device-id";

export const randomId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function deviceId(): string {
  try {
    const known = globalThis.localStorage?.getItem(DEVICE);
    if (known) return known;
    const made = randomId();
    globalThis.localStorage?.setItem(DEVICE, made);
    return made;
  } catch {
    return "unknown-device";
  }
}
