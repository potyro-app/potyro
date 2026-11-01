// What was in the Studio's box when the person left for the gallery (#487). The gallery opens in
// this tab, so the Studio goes with the page; its words wait here, for this tab only, and the next
// Studio on the same app (or on a new one) starts with them. Taken once.

const KEY = "potyro:kept-idea";

interface Kept {
  /** The app the words were about, or null for a new app. */
  app: string | null;
  text: string;
}

function read(): Kept | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { app?: unknown; text?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    return { app: typeof parsed.app === "string" ? parsed.app : null, text: parsed.text };
  } catch {
    return null;
  }
}

/** Keep what is in the box, about `app` (null: a new app). Nothing typed, nothing kept. */
export function keepIdea(text: string, app: string | null = null): void {
  try {
    if (text.trim()) globalThis.sessionStorage?.setItem(KEY, JSON.stringify({ app, text }));
    else globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // no session storage: the words go with the page, as they would have
  }
}

/** The words kept for `app` (null: a new app), without taking them. */
export function keptIdea(app: string | null = null): string | undefined {
  const kept = read();
  return kept && kept.app === app ? kept.text : undefined;
}

/** The words have a box again: forget them. */
export function forgetKeptIdea(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // nothing kept, nothing to forget
  }
}
