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

/** The element an app's full-screen layer belongs in. */
export function usePortalRoot(): HTMLElement {
  return useContext(PortalRootContext) ?? document.body;
}
