// Generated form inputs — one per declarative field type (docs/03: declaring fields as data
// buys "generated forms"). Works in RAW value space (relations are ids, not resolved objects)
// so the result can go straight into create()/patch(). Recurses for `list` fields.

import { useEffect, useRef, useState } from "react";
import type { FileRef, Geo, MediaRef } from "potyro";
import { optionLabel, type ShownField as Field } from "./shown.js";
import type { PotyroRuntime } from "@potyro/runtime";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
import { MAP_STYLE } from "./map.js";
import { Switch } from "./switch.js";
import { DurationInput, NumberInput } from "./number-input.js";
import { DateInput } from "./date-input.js";
import { EnumInput } from "./enum-input.js";
import { ListInput } from "./list-input.js";
import { MediaInput } from "./media-input.js";
import { FileInput } from "./file-input.js";
import { MoneyInput } from "./money-input.js";
import { RelationInput } from "./relation-input.js";

export interface FieldInputProps {
  runtime: PotyroRuntime;
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  /** The field's label, for controls that name themselves (a number with its stepper buttons). */
  label?: string;
}

export function FieldInput({ runtime, field, value, onChange, label }: FieldInputProps) {
  switch (field.type) {
    case "text":
      // `placeholder` is the field's own (#100): example text in the empty control.
      return field.multiline ? (
        <textarea className="k-input" rows={3} placeholder={field.placeholder} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="k-input" type="text" placeholder={field.placeholder} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "richtext":
      return <textarea className="k-input" rows={5} placeholder={field.placeholder} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <input className="k-input" type="url" placeholder={field.placeholder} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;

    case "money":
      // Whole minor units, with the currency beside the box (KA-26).
      return <MoneyInput field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />;

    case "number":
      // Unit inside the field, a stepper where the value is nudged, the right phone keyboard (#99).
      return <NumberInput field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />;
    case "duration":
      return field.unit === "min" || field.unit === "h" ? (
        <DurationInput field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />
      ) : (
        <NumberInput field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />
      );

    case "boolean":
      // The toggle alone: a form renders the whole switch row itself (record-form.tsx); here the
      // label is whatever surrounds this input — a list row's column, say.
      return <Switch checked={Boolean(value)} onChange={onChange} label={(field as { label?: string }).label} />;

    case "enum":
      // A row of buttons for a short list, a searchable picker for a long one — never a raw
      // `<select>`, which hid the options and was the last unstyled control in the form (#98).
      return <EnumInput field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />;

    case "tags":
      return <TagsInput field={field} value={value} onChange={onChange} />;

    case "datetime":
      // A day by default, with chips and a month grid; the hour only when the field asks (#103).
      return <DateInput field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />;

    case "geo":
      return <GeoInput runtime={runtime} value={value as Geo | null} onChange={onChange} />;

    case "media":
      // A tile that shows what you chose, with Camera / Library on a phone and drag-and-drop on a
      // desktop — not the browser's bare file button (#102).
      return <MediaInput runtime={runtime} field={field} value={value as MediaRef | MediaRef[] | null} onChange={onChange} label={label ?? (field as { label?: string }).label} />;

    case "file":
      // A chip naming the file, and a menu: bring one in, or pick one already in the app's folder (#252).
      return <FileInput runtime={runtime} field={field} value={(value as FileRef | null) ?? null} onChange={onChange} label={label ?? (field as { label?: string }).label} />;

    case "relation":
      // A searchable picker, not a browser <select> — and several are chips you can take off.
      return <RelationInput runtime={runtime} field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />;

    case "member":
      return <MemberInput runtime={runtime} field={field} value={value} onChange={onChange} />;

    case "list":
      // Rows as cards, with a grip when the list is ordered (#104).
      return <ListInput runtime={runtime} field={field} value={value} onChange={onChange} label={label ?? (field as { label?: string }).label} />;

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
            {optionLabel(field, o)}
          </button>
        ))}
      </div>
    );
  }
  // No declared options: the person makes them up. Type a word, press Enter, it becomes a chip —
  // rather than a comma-separated line where a stray space silently made a different tag (#98).
  return <FreeTags selected={[...selected]} onChange={onChange} />;
}

function FreeTags({ selected, onChange }: { selected: string[]; onChange: (v: unknown) => void }) {
  const { t } = useLingui();
  const [draft, setDraft] = useState("");
  const add = (raw: string): void => {
    const tag = raw.trim();
    setDraft("");
    if (!tag || selected.includes(tag)) return;
    onChange([...selected, tag]);
  };
  return (
    <div className="k-tags">
      {selected.length ? (
        <div className="k-chips">
          {selected.map((tag) => (
            <span key={tag} className="k-chip k-tag" data-on="true">
              {tag}
              <button type="button" className="k-tag-x" aria-label={t`Remove ${tag}`} onClick={() => onChange(selected.filter((x) => x !== tag))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        className="k-input"
        type="text"
        placeholder={t`Type a tag, press Enter`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => add(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && selected.length) {
            onChange(selected.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

/** A tiny MapLibre map you click to drop the point. Same tiles as the map view. */
function GeoPicker({ value, onChange, onTileError }: { value: Geo; onChange: (v: Geo) => void; onTileError: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ remove?: () => void; setCenter?: (c: [number, number]) => void } | null>(null);
  const markerRef = useRef<{ setLngLat: (c: [number, number]) => void; remove: () => void } | null>(null);
  const { t } = useLingui();
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
        console.warn("[potyro] map tiles failed to load", e?.error);
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
        console.warn("[potyro] map picker unavailable", e);
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

  return <div ref={ref} className="k-geo-map" aria-label={t`Pick a point on the map`} />;
}

/** A coordinate as the language writes a number, always to five places (about a metre). */
const coord = (n: number): string => fmt.number(n, { minimumFractionDigits: 5, maximumFractionDigits: 5 });

function GeoInput({ runtime, value, onChange }: { runtime: PotyroRuntime; value: Geo | null; onChange: (v: unknown) => void }) {
  const { t } = useLingui();
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
          <Trans>
            Map unavailable here — the browser could not open a second map (or the tile host is
            blocked). Place the point on the main map instead, or use the coordinates below.
          </Trans>
        </p>
      ) : null}
      <div className="k-geo-actions">
        <button type="button" className="k-add" disabled={busy || !geo} onClick={useMyLocation}>
          {busy ? t`Locating…` : t`📍 Use my location`}
        </button>
        <span className="k-muted">
          {placed ? `${coord(g.lat)}, ${coord(g.lng)}` : t`Tap the map to place a point`}
        </span>
        <button type="button" className="k-add" onClick={() => setShowCoords((v) => !v)}>
          {showCoords ? t`Hide coordinates` : t`Enter coordinates`}
        </button>
      </div>
      <label className="k-geo-label">
        <span className="k-form-label">
          <Trans comment="A place's name, typed beside its point on the map">Label</Trans>
        </span>
        <input className="k-input" type="text" value={g.label ?? ""} onChange={(e) => set({ label: e.target.value })} />
      </label>
      {showCoords ? (
        <div className="k-geo-coords">
          <label>
            <Trans comment="Latitude, as short as your language writes it">lat</Trans>
            <input className="k-input" type="number" step="any" value={g.lat} onChange={(e) => set({ lat: Number(e.target.value) })} />
          </label>
          <label>
            <Trans comment="Longitude, as short as your language writes it">lng</Trans>
            <input className="k-input" type="number" step="any" value={g.lng} onChange={(e) => set({ lng: Number(e.target.value) })} />
          </label>
        </div>
      ) : null}
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
  runtime: PotyroRuntime;
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
