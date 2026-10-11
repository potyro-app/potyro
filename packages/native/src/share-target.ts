// Text shared to Potyro from another app (#213) — a list, a plan, a table another AI made — reaches
// the shell through @capgo/capacitor-share-target. The plugin keeps a share until JavaScript listens,
// so sharing into Potyro while it is closed still arrives.
//
// Boxed: an awaited Capacitor plugin hangs forever on Android (see deep-links.ts), so this never
// returns the plugin itself. Text only for now; files and images come later.

export interface SharedText {
  title?: string;
  text: string;
}

interface ShareEvent {
  title?: string;
  texts?: string[];
}

interface SharePlugin {
  addListener(event: "shareReceived", cb: (e: ShareEvent) => void): Promise<{ remove: () => Promise<void> }>;
}

/** The text of a share, or null when it carries none (a file-only share, for now). */
export function textOfShare(e: ShareEvent): SharedText | null {
  const text = (e.texts ?? []).map((t) => t.trim()).filter(Boolean).join("\n\n");
  if (!text) return null;
  return { ...(e.title?.trim() ? { title: e.title.trim() } : {}), text };
}

/** Listen on a plugin; split out so it can be tested without a device. */
export async function listenOn(plugin: SharePlugin, onShare: (s: SharedText) => void): Promise<{ stop: () => void }> {
  const handle = await plugin.addListener("shareReceived", (e) => {
    const s = textOfShare(e);
    if (s) onShare(s);
  });
  return { stop: () => void handle.remove() };
}

/** Shares, when running inside the native shell; nothing in a browser. */
export async function listenForShares(onShare: (s: SharedText) => void): Promise<{ stop: () => void } | null> {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const { CapacitorShareTarget } = await import("@capgo/capacitor-share-target");
  return listenOn(CapacitorShareTarget as unknown as SharePlugin, onShare);
}
