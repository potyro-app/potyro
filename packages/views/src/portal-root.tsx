// Where an app's full-screen layers go (#261).
//
// A form sheet is portalled out of the view that opened it so it can cover the whole screen. "The
// whole screen" was always `document.body` — which is wrong for an app that is not the whole screen:
// the Studio shows an app beside its conversation, and the app's form covered the conversation too,
// on top of everything the Studio had. The host that frames an app says where its screen is; with
// no frame, the screen is the page.
//
// Only layers that cover the screen read this. A popover anchored to a control keeps the page: it is
// placed by the control's position on the page, and inside a framed screen those numbers would be
// counted from the frame's corner instead.

import { createContext, useContext } from "react";

export const PortalRootContext = createContext<HTMLElement | null>(null);

/**
 * The app's colour, as the custom properties its root carries (`.k-traco` pairs, set by the shell):
 * a layer portalled out of the app would otherwise take the page's own colour — a form's Create in
 * Potyro's rosa inside a green app. A portalled root wears these and the `k-traco` class.
 */
export const AppColourContext = createContext<Record<string, string> | null>(null);

/**
 * How a picture icon that names a file the app ships (`icon: "icon.svg"`, #425) becomes a URL: the
 * open app's `ctx.files.url`, provided by the shell around an app's pages. Null where no app is open
 * (the launcher), where such an icon falls back.
 */
export const IconFilesContext = createContext<((path: string) => Promise<string | null>) | null>(null);
export function useAppColour(): { className: string; style: Record<string, string> | undefined } {
  const vars = useContext(AppColourContext);
  return { className: vars ? " k-traco" : "", style: vars ?? undefined };
}

/** The element an app's full-screen layer belongs in. */
export function usePortalRoot(): HTMLElement {
  return useContext(PortalRootContext) ?? document.body;
}
