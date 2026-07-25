// Generated form inputs — one per declarative field type (docs/03: declaring fields as data
// buys "generated forms"). Works in RAW value space (relations are ids, not resolved objects)
// so the result can go straight into create()/patch(). Recurses for `list` fields.

import { useState } from "react";
import type { Field, Geo, MediaRef } from "karta";
import type { KartaRuntime } from "@karta/runtime";
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

function GeoInput({ runtime, value, onChange }: { runtime: KartaRuntime; value: Geo | null; onChange: (v: unknown) => void }) {
  const g: Geo = value ?? { lat: 0, lng: 0 };
  const set = (patch: Partial<Geo>) => onChange({ ...g, ...patch });
  const geo = runtime.ctx.caps.geo;
  const [busy, setBusy] = useState(false);

  const useMyLocation = async (): Promise<void> => {
    if (!geo) return;
    setBusy(true);
    try {
      const pos = await geo.current();
      onChange({ ...g, lat: pos.lat, lng: pos.lng });
    } catch {
      // denied/unavailable → keep manual entry as the fallback
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-geo-input">
      <button type="button" className="k-add-row" disabled={busy || !geo} onClick={useMyLocation}>
        {busy ? "Locating…" : "📍 Use my location"}
      </button>
      <div className="k-geo-coords">
        <label>
          lat
          <input className="k-input" type="number" step="any" value={g.lat} onChange={(e) => set({ lat: Number(e.target.value) })} />
        </label>
        <label>
          lng
          <input className="k-input" type="number" step="any" value={g.lng} onChange={(e) => set({ lng: Number(e.target.value) })} />
        </label>
        <label>
          label
          <input className="k-input" type="text" value={g.label ?? ""} onChange={(e) => set({ label: e.target.value })} />
        </label>
      </div>
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
  if (loading) return <span className="k-muted">Loading…</span>;

  if (field.many) {
    const sel = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
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
        {rows.length === 0 ? <span className="k-muted">No {field.to} yet</span> : null}
      </div>
    );
  }

  return (
    <select className="k-input" value={relId(value)} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— choose —</option>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {String(r[disp] ?? r.id)}
        </option>
      ))}
    </select>
  );
}

/** A relation value can be a raw id or a resolved object; normalize to an id string. */
function relId(value: unknown): string {
  if (value && typeof value === "object") return String((value as { id?: string }).id ?? "");
  return value ? String(value) : "";
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
