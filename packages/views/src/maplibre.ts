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
