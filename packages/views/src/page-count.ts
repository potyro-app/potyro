// How many records a page is showing, told to whoever draws the page's header.
//
// The header lives in the shell, above the filter chips; the rows live in the view. Running the page
// query a second time just to count would read every record twice on every write — so the view that
// already has the rows says how many, and the header shows it. A page with no listener (a layout
// item, the Studio's preview) pays nothing.

import { createContext, useContext, useEffect } from "react";

/** Receives the count a page's view is showing; `undefined` while it loads or when it has none to give. */
export type PageCountListener = (count: number | undefined) => void;

export const PageCountContext = createContext<PageCountListener | null>(null);

/** Report this view's count to the page header, if one is listening. */
export function useReportCount(count: number | undefined): void {
  const listen = useContext(PageCountContext);
  useEffect(() => {
    if (!listen) return;
    listen(count);
  }, [listen, count]);
  useEffect(() => {
    if (!listen) return;
    return () => listen(undefined);
  }, [listen]);
}
