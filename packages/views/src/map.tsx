// Map built-in view (M3, issue #20). Renders records as markers on a MapLibre GL map, positioned by
// a `geo` binding, with optional `title`/`color`. MapLibre is imported lazily (kept out of the main
// bundle). Marker resolution goes through `runtime.resolveBinding`, so it works trusted + in the
// isolate. The view's JS `filter` is applied by the runtime query, so markers reflect current
// params. Online tiles first; offline tiles are a later milestone (M5).

import { useEffect, useRef, useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { MapCamera, Resolved } from "karta";
import type { BuiltinViewProps, DisplayCell } from "./types.js";
import { getView } from "./format.js";
import { useDisplayCells } from "./cells.js";
import { DetailView } from "./builtins.js";

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
 * A pin's popup: what this place is, and what you can do about it.
 *
 * A name alone is rarely the answer to "is this the one I meant?" — the photo is. So the popup
 * carries the view's `display`: the photo, a second line, its tags, then the actions.
 *
 * Plain DOM because MapLibre owns the node — rendering a React tree into a popup it can destroy at
 * any time is a lifetime problem for no gain.
 */
function popupContent(
  title: string,
  cell: DisplayCell | undefined,
  actions: { label: string; primary?: boolean; run: () => void }[],
): HTMLElement {
  const el = document.createElement("div");
  el.className = "k-map-popup";

  if (cell?.mediaUrl) {
    const img = document.createElement("img");
    img.className = "k-map-popup-media";
    img.src = cell.mediaUrl;
    img.alt = "";
    el.append(img);
  }

  const name = document.createElement("p");
  name.className = "k-map-popup-title";
  name.textContent = cell?.primary || title || "Untitled";
  el.append(name);

  if (cell?.secondary) {
    const line = document.createElement("p");
    line.className = "k-map-popup-detail";
    line.textContent = cell.secondary;
    el.append(line);
  }

  if (cell?.badges?.length) {
    const tags = document.createElement("p");
    tags.className = "k-map-popup-tags";
    for (const badge of cell.badges) {
      const tag = document.createElement("span");
      tag.className = "k-badge";
      const colour = badge.field?.colors?.[badge.text];
      if (colour) tag.style.setProperty("--badge", colour);
      tag.textContent = badge.text;
      tags.append(tag);
    }
    el.append(tags);
  }

  if (actions.length) {
    const bar = document.createElement("p");
    bar.className = "k-map-popup-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `k-add k-map-popup-open${action.primary ? " k-primary-action" : ""}`;
      button.textContent = action.label;
      button.addEventListener("click", action.run);
      bar.append(button);
    }
    el.append(bar);
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
  const { runtime, pageId, params, onCreate, onEdit } = props;
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  const markers = useMapMarkers(runtime, pageId, rows);
  // The view's `display`, resolved the same way a list resolves its rows — so a popup can show the
  // photo and the tags without the map growing bindings of its own.
  const cells = useDisplayCells(runtime, pageId, rows);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  /** The record whose full page is open over the map. */
  const [openId, setOpenId] = useState<string | null>(null);

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
  const mapRef = useRef<{
    remove?: () => void;
    fitBounds?: (...a: unknown[]) => void;
    resize?: () => void;
    getZoom?: () => number;
    flyTo?: (opts: { center: [number, number]; zoom: number }) => void;
  } | null>(null);
  const markerObjs = useRef<{ remove: () => void }[]>([]);
  // The last framing of everything pinned, kept so `ctx.views.map(page).fit()` can ask for it long
  // after the marker sync that computed it.
  const boundsRef = useRef<unknown>(null);
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
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const view = getView(runtime, pageId) as unknown as
    | { entity?: string; geo?: string; camera?: unknown; locate?: boolean }
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
  // The record's own page, if the app has one for this entity — rendered OVER the map rather than
  // navigated to, so tapping a pin never costs you the position you spent a minute finding.
  const detailPage = runtime.definition.pages.find((p) => {
    const v = p.view as { type?: string; entity?: string } | undefined;
    return v?.type === "detail" && v.entity === (view?.entity ?? "");
  });
  const detailPageRef = useRef(detailPage);
  detailPageRef.current = detailPage;
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

      // What the map shows, for Ask (#213): "restaurants" with no place named means the area on
      // screen. Every move counts here, the auto-fit included — it is what the person sees.
      // Never allowed to break the map: telling Ask where it is looking is a courtesy.
      const publish = (): void => {
        try {
          const c = created.getCenter();
          const b = (created as { getBounds?: () => { getNorth(): number; getEast(): number } }).getBounds?.();
          // Without bounds, a zoom-level estimate: a 1000-pixel view spans ~40000 km / 2^zoom.
          const radiusKm = b ? distanceKm(c.lat, c.lng, b.getNorth(), b.getEast()) : 20000 / 2 ** created.getZoom();
          setShown({ lat: c.lat, lng: c.lng, radiusKm: Math.max(0.2, radiusKm) });
        } catch {
          // an area nobody hears about
        }
      };
      created.on("moveend", publish);
      (created as { once?: (e: string, f: () => void) => void }).once?.("load", publish);

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

      // Measure again now that the map exists. MapLibre takes the container's size once, at
      // construction, and a container that fills its page is laid out by what surrounds it — so the
      // size it read can already be stale by the time the first frame is drawn, and the map is then
      // painted into part of its canvas with paper in the rest.
      // Optional, like `fitBounds` below: a test double — or a MapLibre older than this — is not a
      // reason to take the whole map down.
      created.resize?.();
      requestAnimationFrame(() => {
        if (!disposed) created.resize?.();
      });

      // There is a map now — re-run the marker sync, which bailed if it got here first.
      setMapReady((n) => n + 1);
    })();
    return () => {
      disposed = true;
      setShown(null);
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
        const index = rowsRef.current.findIndex((r) => String(r.id) === mk.id);
        const actions: { label: string; primary?: boolean; run: () => void }[] = [];
        // The whole record, over the map. Leaving the page to read a record's own page means losing
        // the framing you navigated to — and on a map that framing is half of what you were doing.
        if (detailPageRef.current) actions.push({ label: "Details", primary: true, run: () => setOpenId(mk.id) });
        else if (onOpen) {
          actions.push({
            label: "Open",
            primary: true,
            run: () => {
              const row = rowsRef.current.find((r) => String(r.id) === mk.id);
              const param: Record<string, string> = {};
              for (const [target, sourceKey] of Object.entries(onOpen.param ?? {})) {
                param[target] = String((row?.[sourceKey] as unknown) ?? "");
              }
              navigateRef.current(onOpen.page, param);
            },
          });
        }
        if (onEditRef.current) actions.push({ label: "Edit", run: () => onEditRef.current?.(entityRef.current, mk.id) });
        marker.getElement().style.cursor = "pointer";
        marker.setPopup(new maplibre.Popup({ offset: 24, closeButton: false }).setDOMContent(
          popupContent(mk.title, cellsRef.current[index], actions),
        ) as never);
        marker.addTo(map as never);
        markerObjs.current.push(marker);
        bounds.extend([mk.lng, mk.lat]);
      }
      // Under the default `"remember"`, frame the markers only on a first open with no remembered
      // camera: fitting on every marker change would fight the user, re-framing the map under them
      // whenever a filter chip is touched and overriding the position they deliberately left it at.
      // An app that asks for `camera: "fit"` is asking for exactly that re-framing, every time.
      boundsRef.current = bounds.isEmpty() ? null : bounds;
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
  }, [markers, mapReady, cells]);

  // MapLibre sizes its canvas in pixels when it is created and only watches the WINDOW after that.
  // A map that fills its page is sized by everything around it — the chrome above, the bar below,
  // a sidebar appearing — and every one of those leaves the canvas at its old size, drawing the map
  // into part of the box and paper into the rest.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => mapRef.current?.resize?.());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapReady]);

  const entityLabel = runtime.definition.entities[view?.entity ?? ""]?.label ?? view?.entity ?? "record";
  const canPlace = Boolean(onCreate && geoFieldKey.current);
  const detailParam = (detailPage?.view as { param?: string } | undefined)?.param ?? "id";

  /**
   * Move the map, and remember it — the one path every deliberate move takes, whether it came from
   * the button below or from an app calling `ctx.views.map(page).flyTo(...)`.
   *
   * Remembered only where the app left the framing to the person (`camera: "remember"`): a map told
   * to open somewhere fixed opens there. `flyTo` carries no `originalEvent`, so the move handler
   * that records a drag never sees this one.
   */
  const moveTo = (center: [number, number], zoom: number): boolean => {
    const map = mapRef.current;
    if (!map) return false;
    map.flyTo?.({ center, zoom });
    if (cameraModeRef.current === "remember") {
      restoredRef.current = true;
      void runtimeRef.current.ctx.storage
        .set(cameraKey(pageIdRef.current), { center, zoom })
        .catch((err: unknown) => console.warn("[karta] could not save the map position:", err));
    }
    return true;
  };

  // The app's own way in (#216): a view on screen, addressed by its page, told what to do.
  //
  // Registered rather than exported, and dropped on unmount, because "the map on page X" is only
  // answerable while that page is open — an app holding a handle would be holding something that has
  // since been taken off the screen. A verb this view does not know is declined, not thrown: a page
  // can show several views at once and the call is offered to each of them.
  useEffect(() => {
    return runtime.registerViewControl(pageId, (verb, arg) => {
      const map = mapRef.current;
      if (!map) return false;
      if (verb === "map.flyTo") {
        const to = arg as { center?: [number, number]; zoom?: number } | undefined;
        const center = to?.center;
        if (!Array.isArray(center) || center.length !== 2 || center.some((n) => typeof n !== "number")) return false;
        // Left alone when unasked-for, so "go here" can pan without throwing away the scale.
        return moveTo(center, typeof to?.zoom === "number" ? to.zoom : (map.getZoom?.() ?? 12));
      }
      if (verb === "map.fit") {
        const bounds = boundsRef.current;
        if (!bounds) return false;
        map.fitBounds?.(bounds, { padding: 48, maxZoom: 14 });
        // A deliberate re-frame outranks a remembered position, the same as a drag would.
        restoredRef.current = true;
        return true;
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, pageId, mapReady]);

  // "Where am I in this?" — the button every phone map has.
  //
  // It has to live here, in the host, because an app cannot reach the camera: `camera` is read when
  // the view opens and there is no runtime affordance to move it afterwards. Asked for exactly that
  // ("a small button on the map that centers the map in my current location"), the generator
  // correctly answered that the platform could not do it. This is the platform doing it.
  const canLocate = view?.locate !== false && Boolean(runtime.ctx.caps.geo);
  const [locating, setLocating] = useState(false);
  const centreOnMe = async (): Promise<void> => {
    const geo = runtime.ctx.caps.geo;
    const map = mapRef.current;
    if (!geo || !map) return;
    setLocating(true);
    try {
      const pos = await geo.current();
      // Zoom in only if we are further out than street level; someone already close in asked to be
      // moved, not to be zoomed somewhere else.
      moveTo([pos.lng, pos.lat], Math.max(map.getZoom?.() ?? 0, 15));
    } catch {
      // Denied, or the device cannot say. The map is still a map.
      runtime.ctx.ui.toast("Could not get your location.");
    } finally {
      setLocating(false);
    }
  };

  return (
    // The map comes first and its chrome sits ON it. A map is the page — the way it is in every map
    // app on a phone — and a bar above it is a bar taking a bite out of the thing you came to see.
    <div className="k-map" data-placing={placing || undefined}>
      <div ref={containerRef} className="k-map-canvas" role="application" aria-label="Map" />
      {!loading && markers.length === 0 ? <p className="k-empty k-map-empty">No places to show.</p> : null}
      {canLocate ? (
        <button
          type="button"
          className="k-map-locate"
          data-stacked={canPlace || undefined}
          aria-label="Centre the map on my location"
          aria-busy={locating || undefined}
          disabled={locating}
          onClick={() => void centreOnMe()}
        >
          <span aria-hidden>◎</span>
        </button>
      ) : null}
      {canPlace ? (
        placing ? (
          <div className="k-map-bar">
            <span className="k-map-hint" role="status">
              Tap the map to place the {entityLabel.toLowerCase()}.
            </span>
            <button type="button" className="k-add" onClick={() => setPlacing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="k-map-add" onClick={() => setPlacing(true)}>
            <span className="k-fab-plus" aria-hidden>
              ＋
            </span>
            Add {entityLabel.toLowerCase()} here
          </button>
        )
      ) : null}
      {openId && detailPage ? (
        <div className="k-map-sheet-scrim" onClick={() => setOpenId(null)}>
          <section className="k-map-sheet" role="dialog" aria-label={entityLabel} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="k-map-sheet-close" aria-label="Close" onClick={() => setOpenId(null)}>
              ✕
            </button>
            {/* The app's OWN record page, with whatever it declares on it — sections, photos,
                actions — rather than a second rendering of a record that would drift from it. */}
            <DetailView {...props} pageId={detailPage.id} params={{ ...params, [detailParam]: openId }} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

// ── the area on screen (#213) ───────────────────────────────────────────────

let shown: { lat: number; lng: number; radiusKm: number } | null = null;
const shownListeners = new Set<() => void>();

function setShown(next: typeof shown): void {
  shown = next;
  for (const l of shownListeners) l();
}

/** Be told when the area on screen changes (for `useSyncExternalStore`). */
export function subscribeMapArea(cb: () => void): () => void {
  shownListeners.add(cb);
  return () => void shownListeners.delete(cb);
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** The area the map on screen shows — its centre and the distance to its corner — or null when no
 *  map is open. Read by Ask to know what "near here" means. */
export function mapArea(): { lat: number; lng: number; radiusKm: number } | null {
  return shown;
}
