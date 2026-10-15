// Counting what share links do, on this device only (docs/24 §7).
//
// Potyro measures nothing yet (#118), and when it does it will be counts with no ids, switchable off.
// Until then a share link counts here: a number per kind of event in this browser's storage, and a DOM
// event the measurement of #118 can listen for. No id, no app name, nothing sent anywhere.

export type ShareEvent =
  | "demo-opened"
  | "demo-kept"
  | "demo-remixed"
  | "demo-link-made"
  | "demo-link-inline"
  | `share-network:${"copy" | "whatsapp" | "telegram" | "native"}`
  | "clip-recorded";

export const SHARE_EVENT = "potyro:share-event";
const KEY = "potyro:share-counts";

/** How many times each event happened on this device. */
export function shareCounts(): Partial<Record<ShareEvent, number>> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<Record<ShareEvent, number>>) : {};
  } catch {
    return {};
  }
}

/** Count one. Never throws: a counter is never a reason for sharing to fail. */
export function shareEvent(event: ShareEvent): void {
  try {
    const counts = shareCounts();
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...counts, [event]: (counts[event] ?? 0) + 1 }));
  } catch {
    // private mode, or storage full: the count is lost, nothing else
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(SHARE_EVENT, { detail: { event } }));
  } catch {
    // no DOM (tests in Node): nobody is listening
  }
}
