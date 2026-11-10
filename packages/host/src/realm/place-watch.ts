// Told when an element is somewhere else on screen (#41).
//
// Nothing in the platform reports that an element MOVED: a ResizeObserver sees its size, and a
// resize of the window is one cause among many — a bar above it that comes, wraps, grows or goes
// moves everything under it and resizes nothing that could be named in advance. What does see a
// position is an IntersectionObserver whose root is cut down to exactly the element's own box: the
// element then fills it, and any move takes part of it out, which the observer reports. So: observe
// with the root at the box, and on a report tell the caller and observe again at the new box. No
// timer, no polling; between moves it costs nothing.

/**
 * Call `moved` whenever `mark` — a small box, 1 px by 1 px is enough — is drawn somewhere else in the
 * viewport than it was (a scroll of the page moves it too). Returns the way to stop. Where the
 * engine has no IntersectionObserver, it never calls.
 */
export function watchPlace(mark: Element, moved: () => void): () => void {
  const doc = mark.ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof win.IntersectionObserver === "undefined") return () => {};
  let io: IntersectionObserver | null = null;
  let over = false;

  const arm = (): void => {
    io?.disconnect();
    io = null;
    if (over) return;
    const at = mark.getBoundingClientRect();
    const root = doc.documentElement;
    // Whole pixels, outwards: the root is the mark's box or a hair more, never less.
    const inset = [Math.floor(at.top), Math.floor(root.clientWidth - at.right), Math.floor(root.clientHeight - at.bottom), Math.floor(at.left)];
    let first = true;
    io = new win.IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (over || !entry) return;
        if (first) {
          first = false;
          // The answer to observing: the mark fills its root, so the watch is set.
          if (entry.intersectionRatio >= 1) return;
          const now = mark.getBoundingClientRect();
          // Not drawn, or cut off by something that scrolls or clips it: where it is cannot be
          // watched from here, and observing again would only say the same. This observer stays,
          // and reports when the mark is whole in its place again.
          if (now.top === at.top && now.left === at.left && now.width === at.width && now.height === at.height) return;
        }
        moved();
        arm();
      },
      { rootMargin: inset.map((n) => `${-n}px`).join(" "), threshold: 1 },
    );
    io.observe(mark);
  };
  arm();

  return () => {
    over = true;
    io?.disconnect();
    io = null;
  };
}
