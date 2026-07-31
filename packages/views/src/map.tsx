// Map built-in view (M3, issue #20). Renders records as markers on a MapLibre GL map, positioned by
// a `geo` binding, with optional `title`/`color`. MapLibre is imported lazily (kept out of the main
// bundle). Marker resolution goes through `runtime.resolveBinding`, so it works trusted + in the
// isolate. The view's JS `filter` is applied by the runtime query, so markers reflect current
// params. Online tiles first; offline tiles are a later milestone (M5).

import { useEffect, useRef, useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { Resolved } from "karta";
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

export function MapView(props: BuiltinViewProps) {
  const { runtime, pageId, params, onCreate } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const markers = useMapMarkers(runtime, pageId, rows);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // MapLibre types are only available after the lazy import, so these refs are intentionally loose.
  const mapRef = useRef<{ remove?: () => void; fitBounds?: (...a: unknown[]) => void } | null>(null);
  const markerObjs = useRef<{ remove: () => void }[]>([]);
  // The map is created once; these keep its click handler current without re-creating it.
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const view = runtime.definition.pages.find((p) => p.id === pageId)?.view as { entity?: string; geo?: string } | undefined;
  const entityRef = useRef(view?.entity ?? "");
  entityRef.current = view?.entity ?? "";
  const geoFieldKey = useRef(typeof view?.geo === "string" ? view.geo : "");
  geoFieldKey.current = typeof view?.geo === "string" ? view.geo : "";

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    const el = containerRef.current;
    if (!el) return;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !el) return;
      const created = new maplibre.Map({
        container: el,
        style: MAP_STYLE as never,
        center: [0, 20],
        zoom: 1,
      });
      mapRef.current = created as unknown as typeof mapRef.current;

      // Tap EMPTY map to add a place there. Placing first and filling the form after beats opening a
      // second map inside the form — the map is already right here.
      //
      // Markers and their popups sit in the same container and their clicks reach this handler, so a
      // tap on an existing place would open the create form instead of showing that place. Ignore
      // any click that started on marker/popup chrome.
      created.on("click", (e: { lngLat: { lat: number; lng: number }; originalEvent?: Event }) => {
        const target = e.originalEvent?.target;
        if (target instanceof Element && target.closest(".maplibregl-marker, .maplibregl-popup")) return;
        const geoKey = geoFieldKey.current;
        if (!onCreateRef.current || !geoKey) return;
        onCreateRef.current(entityRef.current, { [geoKey]: { lat: e.lngLat.lat, lng: e.lngLat.lng } });
      });
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
        const marker = new maplibre.Marker({ color: mk.color })
          .setLngLat([mk.lng, mk.lat])
          .setPopup(new maplibre.Popup({ offset: 24 }).setText(mk.title))
          .addTo(map as never);
        markerObjs.current.push(marker);
        bounds.extend([mk.lng, mk.lat]);
      }
      if (markers.length > 0 && !bounds.isEmpty()) {
        map.fitBounds?.(bounds, { padding: 48, maxZoom: 14, animate: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markers]);

  return (
    <div className="k-map">
      <div ref={containerRef} className="k-map-canvas" role="application" aria-label="Map" />
      {!loading && markers.length === 0 ? <p className="k-empty k-map-empty">No places to show.</p> : null}
    </div>
  );
}
