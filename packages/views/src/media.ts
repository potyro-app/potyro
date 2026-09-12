// One breakpoint for "is this a phone" (#111), shared by the shell's chrome and the views: below
// it a menu is a bottom sheet and the app's pages are a tab bar; above it a menu is a popover and
// the pages are a sidebar. The same number the form sheet and the switcher use.

import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 759px)";

const subscribe = (onChange: () => void): (() => void) => {
  if (typeof matchMedia !== "function") return () => {};
  const mql = matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};
const read = (): boolean => (typeof matchMedia === "function" ? matchMedia(PHONE_QUERY).matches : false);

/** True on a phone-sized viewport; re-renders when the viewport crosses the breakpoint. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
