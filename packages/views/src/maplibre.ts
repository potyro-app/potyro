// MapLibre, with a worker that exists.
//
// MapLibre 6 finds its worker next to its own module: `new URL("./maplibre-gl-worker.mjs",
// import.meta.url)`. In dev that is node_modules, where the file is. In a production build the
// library is bundled into a hashed chunk under /assets and the worker file is never emitted, so the
// request fell through to the SPA's index.html: Chromium quietly ran without its worker, and Firefox
// reported "Failed to load maplibre-gl-worker.mjs. A ServiceWorker intercepted the request and
// encountered an unexpected error" on every map (found by the console smoke, fix/opfs-access-handles).
// Vite builds the worker as a worker of its own here and hands back its URL.

import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

type MapLibre = typeof import("maplibre-gl");

/** The library and its stylesheet, its worker pointed at the built one. The imports are cached by
 *  the module system, and pointing the worker again is harmless. */
export async function loadMapLibre(): Promise<MapLibre> {
  const [maplibre] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
  maplibre.setWorkerUrl(workerUrl);
  return maplibre;
}

let drawable: boolean | undefined;

/**
 * Can this browser draw a MapLibre map at all? MapLibre 6 needs WebGL2, and a browser without it —
 * WebGL switched off, a graphics driver Firefox has blocklisted, a hardened profile, a headless
 * browser — gets no error from `new Map(…)`: the map is built without a painter, and its first
 * `resize()` or `remove()` throws. Thrown from a React cleanup, that took the whole app down to a
 * blank page in Firefox. Asked once per page, with a context that is let go straight away.
 */
export function canDrawMaps(): boolean {
  if (drawable !== undefined) return drawable;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    drawable = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    drawable = false;
  }
  return drawable;
}

/**
 * Whether a map that was built can draw. The probe above can pass and the map's own context still
 * be refused (the browser's budget of contexts is spent): then MapLibre leaves out its painter.
 */
export function mapDraws(map: unknown): boolean {
  return Boolean((map as { painter?: unknown } | null)?.painter);
}

/** Take a map down; one that never could draw throws from `remove()`, and is simply let go. */
export function removeMap(map: { remove?: () => void } | null | undefined): void {
  try {
    map?.remove?.();
  } catch {
    // a map without a painter has nothing to take down
  }
}
