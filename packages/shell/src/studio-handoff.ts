// "Open the Studio on this app" — across the page load between Make it mine and the copy it made
// (docs/24 §6). For this tab only, taken once.
//
// What the Studio then says is its own: a remix greets the person with "What would you like to
// change?" and suggestions drawn from the app (remix-suggestions.ts). A `prompt` is for a caller that
// has words for the box already.
const KEY = "potyro:studio-handoff";

export interface StudioHandoff {
  /** What to write in the Studio's box, if anything. */
  prompt?: string;
}

export function handToStudio(appId: string, handoff: StudioHandoff = {}): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify({ appId, ...(handoff.prompt ? { prompt: handoff.prompt } : {}) }));
  } catch {
    // no session storage: the app opens, and the Studio is one tap away
  }
}

/** Whether to open the Studio on this app on arrival, and with what; cleared once read. */
export function takeStudioHandoff(appId: string | undefined): StudioHandoff | null {
  if (!appId) return null;
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { appId?: unknown; prompt?: unknown };
    if (parsed.appId !== appId) return null;
    globalThis.sessionStorage?.removeItem(KEY);
    return typeof parsed.prompt === "string" ? { prompt: parsed.prompt } : {};
  } catch {
    return null;
  }
}
