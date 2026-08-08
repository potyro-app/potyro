// Generated form inputs — one per declarative field type (docs/03: declaring fields as data
// buys "generated forms"). Works in RAW value space (relations are ids, not resolved objects)
// so the result can go straight into create()/patch(). Recurses for `list` fields.

import { useEffect, useRef, useState } from "react";
import type { Field, Geo, MediaRef } from "karta";
import type { KartaRuntime } from "@karta/runtime";
import { RecordForm } from "./record-form.js";
import { MAP_STYLE } from "./map.js";
import { displayFieldFor, humanizeKey } from "./format.js";

export interface FieldInputProps {
  runtime: KartaRuntime;
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FieldInput({ runtime, field, value, onChange }: FieldInputProps) {
  switch (field.type) {
    case "text":
      return field.multiline ? (
        <textarea className="k-input" rows={3} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="k-input" type="text" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "richtext":
      return <textarea className="k-input" rows={5} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <input className="k-input" type="url" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;

    case "number":
    case "duration":
      return (
        <input
          className="k-input"
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          min={field.type === "number" ? field.min : undefined}
          max={field.type === "number" ? field.max : undefined}
          step={field.type === "number" ? field.step ?? (field.integer ? 1 : undefined) : undefined}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );

    case "boolean":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;

    case "enum":
      return (
        <select className="k-input" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— choose —</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );

    case "tags":
      return <TagsInput field={field} value={value} onChange={onChange} />;

    case "datetime": {
      const d = value instanceof Date ? value : value ? new Date(String(value)) : null;
      return (
        <input
          className="k-input"
          type="datetime-local"
          value={d ? toLocalInput(d) : ""}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)}
        />
      );
    }

    case "geo":
      return <GeoInput runtime={runtime} value={value as Geo | null} onChange={onChange} />;

    case "media":
      return <MediaInput runtime={runtime} value={value as MediaRef | MediaRef[] | null} onChange={onChange} />;

    case "relation":
      return <RelationInput runtime={runtime} field={field} value={value} onChange={onChange} />;

    case "member":
      return <MemberInput runtime={runtime} field={field} value={value} onChange={onChange} />;

    case "list":
      return <ListInput runtime={runtime} field={field} value={value} onChange={onChange} />;

    default:
      return <input className="k-input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

function TagsInput({ field, value, onChange }: { field: Extract<Field, { type: "tags" }>; value: unknown; onChange: (v: unknown) => void }) {
  const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
  if (field.options?.length) {
    return (
      <div className="k-chips">
        {field.options.map((o) => (
          <button
            key={o}
            type="button"
            className="k-chip"
            data-on={selected.has(o)}
            onClick={() => {
              const next = new Set(selected);
              if (next.has(o)) next.delete(o);
              else next.add(o);
              onChange([...next]);
            }}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  return (
    <input
      className="k-input"
      type="text"
      placeholder="comma,separated,tags"
      value={[...selected].join(",")}
      onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
    />
  );
}

/** A tiny MapLibre map you click to drop the point. Same tiles as the map view. */
function GeoPicker({ value, onChange, onTileError }: { value: Geo; onChange: (v: Geo) => void; onTileError: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ remove?: () => void; setCenter?: (c: [number, number]) => void } | null>(null);
  const markerRef = useRef<{ setLngLat: (c: [number, number]) => void; remove: () => void } | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let disposed = false;
    const el = ref.current;
    if (!el) return;
    void (async () => {
      try {
      const maplibre = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !el) return;
      const hasPoint = value.lat !== 0 || value.lng !== 0;
      const map = new maplibre.Map({
        container: el,
        style: MAP_STYLE as never,
        center: [value.lng, value.lat],
        zoom: hasPoint ? 14 : 2,
      });
      mapRef.current = map as unknown as typeof mapRef.current;
      // Tiles are a third-party host: a VPN, an ad blocker or being offline can block them, and
      // MapLibre just renders an empty canvas. Surface it instead of showing a blank rectangle.
      map.on("error", (e: { error?: { status?: number } }) => {
        if (disposed) return;
        onTileError();
        // eslint-disable-next-line no-console
        console.warn("[karta] map tiles failed to load", e?.error);
      });
      if (hasPoint) {
        markerRef.current = new maplibre.Marker().setLngLat([value.lng, value.lat]).addTo(map) as never;
      }
      // Tap/click anywhere to set the point — the whole reason this exists.
      map.on("click", (e: { lngLat: { lat: number; lng: number } }) => {
        const { lat, lng } = e.lngLat;
        if (markerRef.current) markerRef.current.setLngLat([lng, lat]);
        else markerRef.current = new maplibre.Marker().setLngLat([lng, lat]).addTo(map) as never;
        latest.current({ lat, lng });
      });
      } catch (e) {
        // Constructing a Map can THROW — most often no WebGL context available, which happens when a
        // map view is already on screen behind this form and the browser's context budget is spent.
        // Inside `void (async …)()` that rejection was invisible: a blank div and no message at all.
        if (disposed) return;
        onTileError();
        // eslint-disable-next-line no-console
        console.warn("[karta] map picker unavailable", e);
      }
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove?.();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Created once; later value changes move the marker via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker in step when the point is set elsewhere (e.g. "use my location").
  useEffect(() => {
    if (!markerRef.current || (value.lat === 0 && value.lng === 0)) return;
    markerRef.current.setLngLat([value.lng, value.lat]);
    mapRef.current?.setCenter?.([value.lng, value.lat]);
  }, [value.lat, value.lng]);

  return <div ref={ref} className="k-geo-map" aria-label="Pick a point on the map" />;
}

function GeoInput({ runtime, value, onChange }: { runtime: KartaRuntime; value: Geo | null; onChange: (v: unknown) => void }) {
  const g: Geo = value ?? { lat: 0, lng: 0 };
  const set = (patch: Partial<Geo>) => onChange({ ...g, ...patch });
  const geo = runtime.ctx.caps.geo;
  const [busy, setBusy] = useState(false);
  // Typing coordinates is not how anyone picks a place; the map is the default and the numbers are
  // the escape hatch.
  const [showCoords, setShowCoords] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  const useMyLocation = async (): Promise<void> => {
    if (!geo) return;
    setBusy(true);
    try {
      const pos = await geo.current();
      onChange({ ...g, lat: pos.lat, lng: pos.lng });
    } catch {
      // denied/unavailable → the map and the manual fields still work
    } finally {
      setBusy(false);
    }
  };

  const placed = g.lat !== 0 || g.lng !== 0;
  return (
    <div className="k-geo-input">
      <GeoPicker
        value={g}
        onChange={(next) => onChange({ ...g, ...next })}
        onTileError={() => {
          setTilesFailed(true);
          setShowCoords(true); // keep the field usable — don't strand them on a blank map
        }}
      />
      {tilesFailed ? (
        <p className="k-form-error">
          Map unavailable here — the browser could not open a second map (or the tile host is
          blocked). Place the point on the main map instead, or use the coordinates below.
        </p>
      ) : null}
      <div className="k-geo-actions">
        <button type="button" className="k-add-row" disabled={busy || !geo} onClick={useMyLocation}>
          {busy ? "Locating…" : "📍 Use my location"}
        </button>
        <span className="k-muted">
          {placed ? `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}` : "Tap the map to place a point"}
        </span>
        <button type="button" className="k-add-row" onClick={() => setShowCoords((v) => !v)}>
          {showCoords ? "Hide coordinates" : "Enter coordinates"}
        </button>
      </div>
      <label className="k-geo-label">
        <span className="k-form-label">Label</span>
        <input className="k-input" type="text" value={g.label ?? ""} onChange={(e) => set({ label: e.target.value })} />
      </label>
      {showCoords ? (
        <div className="k-geo-coords">
          <label>
            lat
            <input className="k-input" type="number" step="any" value={g.lat} onChange={(e) => set({ lat: Number(e.target.value) })} />
          </label>
          <label>
            lng
            <input className="k-input" type="number" step="any" value={g.lng} onChange={(e) => set({ lng: Number(e.target.value) })} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function MediaInput({
  runtime,
  value,
  onChange,
}: {
  runtime: KartaRuntime;
  value: MediaRef | MediaRef[] | null;
  onChange: (v: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const current = Array.isArray(value) ? value[0] : value;
  return (
    <div className="k-media-input">
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const ref = await runtime.ctx.media.put(file);
            onChange(ref);
          } finally {
            setBusy(false);
          }
        }}
      />
      {current ? <span className="k-muted">attached</span> : null}
    </div>
  );
}

function RelationInput({ runtime, field, value, onChange }: { runtime: KartaRuntime; field: Extract<Field, { type: "relation" }>; value: unknown; onChange: (v: unknown) => void }) {
  const { rows, loading } = runtime.useQuery(field.to);
  const disp = displayFieldFor(runtime, field.to);
  // Creating the FIRST related record used to require abandoning this form, making the other record,
  // and starting over — a relation to an empty entity was a dead end ("No placeType yet").
  const [creating, setCreating] = useState(false);
  const label = runtime.definition.entities[field.to]?.label ?? field.to;

  if (loading) return <span className="k-muted">Loading…</span>;

  const addNew = (
    <button type="button" className="k-add-row" onClick={() => setCreating(true)}>
      ＋ New {label}
    </button>
  );

  const inlineForm = creating ? (
    <div className="k-inline-create">
      <RecordForm
        nested
        runtime={runtime}
        entity={field.to}
        onCancel={() => setCreating(false)}
        onDone={(id) => {
          setCreating(false);
          // Select what was just created — that is why the user made it.
          if (field.many) {
            const sel = new Set(Array.isArray(value) ? (value as string[]) : []);
            sel.add(id);
            onChange([...sel]);
          } else {
            onChange(id);
          }
        }}
      />
    </div>
  ) : null;

  if (field.many) {
    const sel = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <div className="k-relation-input">
        <div className="k-chips">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="k-chip"
              data-on={sel.has(r.id)}
              onClick={() => {
                const next = new Set(sel);
                if (next.has(r.id)) next.delete(r.id);
                else next.add(r.id);
                onChange([...next]);
              }}
            >
              {String(r[disp] ?? r.id)}
            </button>
          ))}
          {rows.length === 0 ? <span className="k-muted">No {label} yet</span> : null}
        </div>
        {creating ? inlineForm : addNew}
      </div>
    );
  }

  const selected = typeof value === "string" ? value : ((value as { id?: string } | null)?.id ?? "");
  return (
    <div className="k-relation-input">
      <select className="k-input" value={selected} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{rows.length ? "— choose —" : `No ${label} yet`}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {String(r[disp] ?? r.id)}
          </option>
        ))}
      </select>
      {creating ? inlineForm : addNew}
    </div>
  );
}

function ListInput({ runtime, field, value, onChange }: { runtime: KartaRuntime; field: Extract<Field, { type: "list" }>; value: unknown; onChange: (v: unknown) => void }) {
  const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
  const subEntries = Object.entries(field.of);

  const update = (i: number, key: string, v: unknown): void => {
    const next = rows.map((r, ri) => (ri === i ? { ...r, [key]: v } : r));
    onChange(next);
  };
  const addRow = (): void => onChange([...rows, {}]);
  const removeRow = (i: number): void => onChange(rows.filter((_, ri) => ri !== i));

  return (
    <div className="k-list-input">
      {rows.map((row, i) => (
        <div className="k-list-input-row" key={i}>
          <div className="k-list-input-fields">
            {subEntries.map(([key, sub]) => (
              <label className="k-subfield" key={key}>
                <span>{sub.label ?? humanizeKey(key)}</span>
                <FieldInput runtime={runtime} field={sub} value={row[key]} onChange={(v) => update(i, key, v)} />
              </label>
            ))}
          </div>
          <button type="button" className="k-remove" aria-label="Remove row" onClick={() => removeRow(i)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="k-add-row" onClick={addRow}>
        + Add {field.label ?? "row"}
      </button>
    </div>
  );
}

/**
 * Person picker over the app's space (KA-19).
 *
 * The candidate list is space membership, never a table the app maintains — which is why this is
 * not a relation input. Solo shows just you rather than an empty control: a `member` field has to be
 * usable *before* an app is shared, or every shared app is broken until the moment it is shared.
 */
function MemberInput({
  runtime,
  field,
  value,
  onChange,
}: {
  runtime: KartaRuntime;
  field: Extract<Field, { type: "member" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const ctx = runtime.ctx;
  const people = ctx.space?.members ?? (ctx.me ? [ctx.me] : []);

  if (field.many) {
    const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
    const toggle = (id: string): void => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    };
    return (
      <div className="k-member-input" role="group">
        {people.map((p) => (
          <button
            key={p.id}
            type="button"
            className="k-person-chip"
            aria-pressed={selected.has(p.id)}
            data-on={selected.has(p.id) || undefined}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <select className="k-input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
