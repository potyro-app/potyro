// Map built-in view (M3, issue #20). Renders records as markers on a MapLibre GL map, positioned by
// a `geo` binding, with optional `title`/`color`. MapLibre is imported lazily (kept out of the main
// bundle). Marker resolution goes through `runtime.resolveBinding`, so it works trusted + in the
// isolate. The view's JS `filter` is applied by the runtime query, so markers reflect current
// params. Online tiles first; offline tiles are a later milestone (M5).

import { useEffect, useRef, useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { MapCamera, Resolved } from "karta";
import type { BuiltinViewProps } from "./types.js";

/**
 * OpenStreetMap raster tiles — real streets, no API key. The previous default was MapLibre's
 * `demotiles` style, which is country outlines only: unusable for "places I liked in a city".
 *
 * Attribution is REQUIRED by the OSM tile usage policy and is rendered by MapLibre from this source.
 * The public tile server is fine at personal scale; a deployment expecting real traffic should point
 * `MAP_STYLE` at its own tiles or a provider. Offline tiles land in M5.
 */
export const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  color?: string;
}

/**
 * Where the user last left this map. Reopening a map page used to dump you back on the whole world
 * regardless of how you had it framed; a map you have to re-navigate on every visit is a map you
 * stop using.
 *
 * Stored in `ctx.storage` — the app's own key/value space — rather than anywhere shell-owned: it is
 * per-app, per-page state that must survive reload, and going through `ctx` is what keeps this
 * working identically for an untrusted app in the isolate.
 *
 * An app can opt out via the view's `camera` field (`"fit"` to always frame the markers, or a fixed
 * `{ center, zoom }`); `"remember"` is the default because it is what a personal map wants.
 */
interface Camera {
  center: [number, number]; // [lng, lat], MapLibre's order
  zoom: number;
}

const cameraKey = (pageId: string) => `map:${pageId}:camera`;

function toCamera(v: unknown): Camera | null {
  if (!v || typeof v !== "object") return null;
  const { center, zoom } = v as { center?: unknown; zoom?: unknown };
  if (!Array.isArray(center) || center.length !== 2) return null;
  const [lng, lat] = center as unknown[];
  if (typeof lng !== "number" || typeof lat !== "number" || typeof zoom !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
  return { center: [lng, lat], zoom };
}

function toLatLng(v: unknown): { lat: number; lng: number } | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.lat === "number" && typeof o.lng === "number") return { lat: o.lat, lng: o.lng };
  }
  return null;
}

/** Resolve geo/title/color per row (async host calls), skipping rows without a valid geo point. */
export function useMapMarkers(runtime: KartaRuntime, pageId: string, rows: Resolved[]): MapMarker[] {
  const [markers, setMarkers] = useState<MapMarker[]>([]);

  useEffect(() => {
    let alive = true;
    const ctx = runtime.ctx;
    const resolve = (path: "geo" | "title" | "color", row: Resolved) =>
      runtime.resolveBinding({ kind: "view", page: pageId, path }, row, ctx);

    void Promise.all(
      rows.map(async (row): Promise<MapMarker | null> => {
        const geo = toLatLng(await resolve("geo", row));
        if (!geo) return null;
        const title = String((await resolve("title", row)) ?? "");
        const colorRaw = await resolve("color", row);
        return { id: row.id, lat: geo.lat, lng: geo.lng, title, color: colorRaw == null ? undefined : String(colorRaw) };
      }),
    ).then((ms) => {
      if (alive) setMarkers(ms.filter((m): m is MapMarker => m !== null));
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, pageId, rows]);

  return markers;
}

/**
 * A pin's popup: what this place is, and a way to open it.
 *
 * Plain DOM because MapLibre owns the node — rendering a React tree into a popup it can destroy at
 * any time is a lifetime problem for no gain, and the content here is a heading and a button.
 */
function popupContent(title: string, onOpen: (() => void) | null): HTMLElement {
  const el = document.createElement("div");
  el.className = "k-map-popup";
  const name = document.createElement("p");
  name.className = "k-map-popup-title";
  name.textContent = title || "Untitled";
  el.append(name);
  if (onOpen) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "k-add k-map-popup-open";
    button.textContent = "Open";
    button.addEventListener("click", onOpen);
    el.append(button);
  }
  return el;
}

/** The declared `camera`, evaluated when it is a function (trusted or in the isolate), else as is. */
async function resolveCamera(runtime: BuiltinViewProps["runtime"], pageId: string, declared: unknown): Promise<MapCamera | null> {
  const viewOption = (runtime as { viewOption?: (p: string, k: string) => Promise<unknown> }).viewOption;
  if (viewOption) {
    try {
      const value = await viewOption.call(runtime, pageId, "camera");
      return (value ?? null) as MapCamera | null;
    } catch (e) {
      console.warn("[karta] the map's camera function failed; opening as remembered:", e);
      return null;
    }
  }
  // A runtime without `viewOption` (a bare fake) can only honour a literal.
  return typeof declared === "function" || declared === undefined ? null : (declared as MapCamera);
}

export function MapView(props: BuiltinViewProps) {
  const { runtime, pageId, params, onCreate } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const markers = useMapMarkers(runtime, pageId, rows);

  // Bumped once the map object exists. The marker sync bails when there is no map yet, and marker
  // resolution routinely wins the race against the lazy MapLibre import — so without a dependency
  // that changes when the map appears, the first open of a map page renders zero pins and nothing
  // ever re-runs the sync. (You'd see them only after touching a filter, which changes `markers`.)
  const [mapReady, setMapReady] = useState(0);
  // Armed by the button below; the map only creates on a tap while this is true.
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(placing);
  placingRef.current = placing;

  const containerRef = useRef<HTMLDivElement | null>(null);
  // MapLibre types are only available after the lazy import, so these refs are intentionally loose.
  const mapRef = useRef<{ remove?: () => void; fitBounds?: (...a: unknown[]) => void } | null>(null);
  const markerObjs = useRef<{ remove: () => void }[]>([]);
  // A remembered camera was applied, so auto-fitting to the markers would undo the user's framing.
  const restoredRef = useRef(false);
  // Auto-fit is a first-open convenience, not a rule: re-fitting on every marker change would yank
  // the map back whenever a filter chip is touched.
  const fittedRef = useRef(false);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;
  // The map is created once; these keep its click handler current without re-creating it.
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const view = runtime.definition.pages.find((p) => p.id === pageId)?.view as
    | { entity?: string; geo?: string; camera?: unknown }
    | undefined;
  // What the app declared (a mode, a position, or a function of ctx — or, for an untrusted app, the
  // sentinel where the function was), and what it resolved to once the map was created.
  const declaredCameraRef = useRef<unknown>(view?.camera);
  declaredCameraRef.current = view?.camera;
  const cameraModeRef = useRef<MapCamera>("remember");
  const entityRef = useRef(view?.entity ?? "");
  entityRef.current = view?.entity ?? "";
  const geoFieldKey = useRef(typeof view?.geo === "string" ? view.geo : "");
  geoFieldKey.current = typeof view?.geo === "string" ? view.geo : "";
  const onOpenRef = useRef((view as { onOpen?: { page: string; param?: Record<string, string> } } | undefined)?.onOpen);
  onOpenRef.current = (view as { onOpen?: { page: string; param?: Record<string, string> } } | undefined)?.onOpen;
  const navigateRef = useRef(props.navigate);
  navigateRef.current = props.navigate;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    const el = containerRef.current;
    if (!el) return;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !el) return;

      // Resolve the opening camera BEFORE constructing: handing it to the constructor means the map
      // opens where it should, with no visible jump from the world view and no race against the
      // marker auto-fit.
      //
      // Through the runtime, not read off the definition: `camera` may be a function of `ctx`
      // (#133 — "open on the selected trip"), and for an untrusted app that function never leaves
      // the isolate. A literal comes back as itself, so both forms take the same path.
      const mode = (await resolveCamera(runtimeRef.current, pageIdRef.current, declaredCameraRef.current)) ?? "remember";
      cameraModeRef.current = mode;
      let opening: Camera | null = typeof mode === "object" ? { center: mode.center, zoom: mode.zoom } : null;
      if (mode === "remember") {
        try {
          opening = toCamera(await runtimeRef.current.ctx.storage.get(cameraKey(pageIdRef.current)));
        } catch (e) {
          console.warn("[karta] could not read the saved map position:", e);
        }
      }
      if (disposed || !el) return;
      // Both a restored position and a fixed one are framings the auto-fit must not override.
      restoredRef.current = opening !== null;

      const created = new maplibre.Map({
        container: el,
        style: MAP_STYLE as never,
        center: opening?.center ?? [0, 20],
        zoom: opening?.zoom ?? 1,
      });
      mapRef.current = created as unknown as typeof mapRef.current;

      // Remember the framing — but only for moves the user made. A programmatic fitBounds carries no
      // `originalEvent`, and recording it would pin the map to the first auto-fit forever.
      if (mode === "remember") {
        created.on("moveend", (e: { originalEvent?: Event }) => {
          if (!e.originalEvent) return;
          const c = created.getCenter();
          const camera: Camera = { center: [c.lng, c.lat], zoom: created.getZoom() };
          restoredRef.current = true;
          void runtimeRef.current.ctx.storage
            .set(cameraKey(pageIdRef.current), camera)
            .catch((err: unknown) => console.warn("[karta] could not save the map position:", err));
        });
      }

      // Placing a new record is EXPLICIT: arm it with the button, then tap. It used to fire on any
      // empty-map tap, which meant panning or exploring created records by accident and left no
      // ordinary way to interact with the map at all.
      //
      // Markers and their popups sit in the same container and their clicks reach this handler, so a
      // tap on an existing pin must not count as "somewhere empty".
      created.on("click", (e: { lngLat: { lat: number; lng: number }; originalEvent?: Event }) => {
        if (!placingRef.current) return;
        const target = e.originalEvent?.target;
        if (target instanceof Element && target.closest(".maplibregl-marker, .maplibregl-popup")) return;
        const geoKey = geoFieldKey.current;
        if (!onCreateRef.current || !geoKey) return;
        setPlacing(false);
        onCreateRef.current(entityRef.current, { [geoKey]: { lat: e.lngLat.lat, lng: e.lngLat.lng } });
      });

      // There is a map now — re-run the marker sync, which bailed if it got here first.
      setMapReady((n) => n + 1);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove?.();
      mapRef.current = null;
    };
  }, []);

  // Sync markers whenever the resolved set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !mapRef.current) return;
      for (const m of markerObjs.current) m.remove();
      markerObjs.current = [];
      const bounds = new maplibre.LngLatBounds();
      for (const mk of markers) {
        const marker = new maplibre.Marker({ color: mk.color }).setLngLat([mk.lng, mk.lat]);
        // Tapping a pin shows WHICH place it is, and offers a way in. Navigating straight off the
        // tap gave no way to just look at the map: every touch left the page.
        const onOpen = onOpenRef.current;
        marker.getElement().style.cursor = "pointer";
        marker.setPopup(new maplibre.Popup({ offset: 24, closeButton: false }).setDOMContent(
          popupContent(mk.title, onOpen ? () => {
            const row = rowsRef.current.find((r) => String(r.id) === mk.id);
            const param: Record<string, string> = {};
            for (const [target, sourceKey] of Object.entries(onOpen.param ?? {})) {
              param[target] = String((row?.[sourceKey] as unknown) ?? "");
            }
            navigateRef.current(onOpen.page, param);
          } : null),
        ) as never);
        marker.addTo(map as never);
        markerObjs.current.push(marker);
        bounds.extend([mk.lng, mk.lat]);
      }
      // Under the default `"remember"`, frame the markers only on a first open with no remembered
      // camera: fitting on every marker change would fight the user, re-framing the map under them
      // whenever a filter chip is touched and overriding the position they deliberately left it at.
      // An app that asks for `camera: "fit"` is asking for exactly that re-framing, every time.
      const mayFit = cameraModeRef.current === "fit" || (!restoredRef.current && !fittedRef.current);
      if (mayFit && markers.length > 0 && !bounds.isEmpty()) {
        map.fitBounds?.(bounds, { padding: 48, maxZoom: 14, animate: false });
        fittedRef.current = true;
      }
    })().catch((e: unknown) => {
      // One bad marker used to take the whole sync down with it — including the framing — and say
      // nothing, because the promise was floated.
      console.warn("[karta] could not sync map markers:", e);
    });
    return () => {
      cancelled = true;
    };
  }, [markers, mapReady]);

  const entityLabel = runtime.definition.entities[view?.entity ?? ""]?.label ?? view?.entity ?? "record";
  const canPlace = Boolean(onCreate && geoFieldKey.current);

  return (
    <div className="k-map" data-placing={placing || undefined}>
      {canPlace ? (
        <div className="k-map-bar">
          {placing ? (
            <>
              <span className="k-map-hint" role="status">Tap the map to place the {entityLabel.toLowerCase()}.</span>
              <button type="button" className="k-add" onClick={() => setPlacing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="k-add k-primary-action" onClick={() => setPlacing(true)}>
              ＋ Add {entityLabel.toLowerCase()} here
            </button>
          )}
        </div>
      ) : null}
      <div ref={containerRef} className="k-map-canvas" role="application" aria-label="Map" />
      {!loading && markers.length === 0 ? <p className="k-empty k-map-empty">No places to show.</p> : null}
    </div>
  );
}
