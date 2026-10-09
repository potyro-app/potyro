// Opening and switching apps without reloading the page (#89).
//
// Opening an app used to be `location.search = "?user=…"`: a full navigation, so every switch re-
// fetched the bundle, re-opened storage and re-created the identity behind a white flash, and the
// Back button left the site. Now a switch is a history entry and a re-render, handled by whoever
// registered (main.tsx). The URL stays the same shape, so a deep link or a reload still lands where
// it did.
//
// Nothing registered (a surface that is not the shell, a test), or the handler declines a route it
// cannot switch to in place: it falls back to the full navigation, which always works.

/** `data` is the Data page, open on one app's records when `id` says which. */
/** `share`: text shared into Potyro from another app, waiting for the person to pick an app (#213). */
export type ShellRoute = { kind: "user"; id: string } | { kind: "home" } | { kind: "data"; id?: string } | { kind: "share" };

/** Returns false to decline, and the router navigates the page instead. */
type Handler = (route: ShellRoute) => boolean;

let handler: Handler | null = null;

export function setRouteHandler(next: Handler | null): void {
  handler = next;
}

export function urlFor(route: ShellRoute): string {
  if (route.kind === "home") return location.pathname;
  if (route.kind === "share") return `${location.pathname}?share`;
  if (route.kind === "data") return route.id ? `${location.pathname}?data=${encodeURIComponent(route.id)}` : `${location.pathname}?data`;
  return `${location.pathname}?user=${encodeURIComponent(route.id)}`;
}

/** Marks a history entry this router pushed, so "back" can tell a way back into the shell from one
 *  that would leave the site. */
const PUSHED = { potyro: true } as const;

/** Is there a shell page behind this one to go back to? */
export function canGoBack(): boolean {
  return (history.state as { potyro?: boolean } | null)?.potyro === true;
}

export function navigateTo(route: ShellRoute): void {
  if (handler) {
    const here = `${location.pathname}${location.search}`;
    const there = urlFor(route);
    if (handler(route)) {
      if (here !== there) history.pushState(PUSHED, "", there);
      return;
    }
  }
  location.assign(urlFor(route));
}
