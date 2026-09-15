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

export type ShellRoute = { kind: "user"; id: string } | { kind: "home" };

/** Returns false to decline, and the router navigates the page instead. */
type Handler = (route: ShellRoute) => boolean;

let handler: Handler | null = null;

export function setRouteHandler(next: Handler | null): void {
  handler = next;
}

export function urlFor(route: ShellRoute): string {
  return route.kind === "home" ? location.pathname : `${location.pathname}?user=${encodeURIComponent(route.id)}`;
}

export function navigateTo(route: ShellRoute): void {
  if (handler) {
    const here = `${location.pathname}${location.search}`;
    const there = urlFor(route);
    if (handler(route)) {
      if (here !== there) history.pushState(null, "", there);
      return;
    }
  }
  location.assign(urlFor(route));
}
