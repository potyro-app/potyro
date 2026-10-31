// The browser's bar follows the theme Potyro is shown in (#123).
//
// index.html carries one `theme-color` per system theme — the page's own background in each — and
// that is right while the Look follows the system. But a person can choose dark on a light phone, and
// an app can open in its own theme (app-theme.ts); both put `data-theme` on the root, which the
// media queries on those tags cannot see. Added to the home screen, that left a white status bar over
// a dark app. So while a theme is chosen, every tag says that theme's colour; once it is not, each
// tag gets its own back. The colours stay in index.html, next to the tokens they mirror.

type Theme = "light" | "dark";

function themeOf(root: Element): Theme | null {
  const theme = root.getAttribute("data-theme");
  return theme === "light" || theme === "dark" ? theme : null;
}

/** Start following `data-theme` on the root. Returns a stop function (tests). */
export function followThemeColor(doc: Document = document): () => void {
  const metas = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  if (!metas.length) return () => {};
  const defaults = metas.map((m) => m.getAttribute("content") ?? "");
  const colourOf = (theme: Theme): string | undefined => {
    const i = metas.findIndex((m) => (m.getAttribute("media") ?? "").replace(/\s+/g, "").includes(`prefers-color-scheme:${theme}`));
    return i < 0 ? undefined : defaults[i];
  };
  const root = doc.documentElement;
  const apply = (): void => {
    const theme = themeOf(root);
    const chosen = theme ? colourOf(theme) : undefined;
    metas.forEach((m, i) => m.setAttribute("content", chosen ?? defaults[i]!));
  };
  apply();
  const View = doc.defaultView;
  if (!View?.MutationObserver) return () => {};
  const observer = new View.MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
