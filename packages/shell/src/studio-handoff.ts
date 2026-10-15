// "Open the Studio on this app, with this already written" — across the page load between a demo
// link and the app it was remixed into (docs/24 §6). For this tab only, taken once.
const KEY = "potyro:studio-handoff";

export function handToStudio(appId: string, prompt: string): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify({ appId, prompt }));
  } catch {
    // no session storage: the app opens, and the Studio is one tap away
  }
}

/** What to write in the Studio for this app, if a remix left it; cleared once read. */
export function takeStudioHandoff(appId: string | undefined): string | null {
  if (!appId) return null;
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { appId?: unknown; prompt?: unknown };
    if (parsed.appId !== appId || typeof parsed.prompt !== "string") return null;
    globalThis.sessionStorage?.removeItem(KEY);
    return parsed.prompt;
  } catch {
    return null;
  }
}
