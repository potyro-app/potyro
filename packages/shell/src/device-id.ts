// A random id for this device, kept: the relays' limits (platform requests, the free AI allowance)
// count per device. Says nothing about the person. Its own module so the app's boot path can name the
// device without loading the Studio's request code.
//
// Where it cannot be kept (no localStorage, or one that throws), it is a random id for this page,
// held in memory: never one fixed string, which every such device would share — and with it one
// allowance, that anyone sending that string could use up for all of them.

const DEVICE = "potyro:device-id";

export const randomId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** This page's id, made once: the one kept, or, where none can be, this page's own. */
let pageId: string | null = null;

export function deviceId(): string {
  try {
    const store = globalThis.localStorage;
    const known = store?.getItem(DEVICE);
    if (known) return known;
    pageId ??= randomId();
    store?.setItem(DEVICE, pageId);
  } catch {
    // not kept: this page's own id
  }
  return (pageId ??= randomId());
}

/** Test seam: forget this page's id. */
export function resetDeviceIdForTests(): void {
  pageId = null;
}
