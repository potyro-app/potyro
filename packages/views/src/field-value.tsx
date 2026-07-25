// Render a resolved field value according to its declared field TYPE. This is what makes the
// detail view readable: list fields render as rows, relations resolve to the related record's
// display field, tags become chips, media becomes an image, etc. Falls back to formatValue for
// computed keys (which have no field definition — their value is already final).

import { useEffect, useState } from "react";
import type { Field, Geo, MediaRef } from "karta";
import type { KartaRuntime } from "@karta/runtime";
import { displayFieldFor, formatValue, humanizeKey } from "./format.js";

function formatNumber(v: unknown): string {
  if (typeof v !== "number") return String(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function FieldValue({
  runtime,
  entity,
  fieldKey,
  value,
}: {
  runtime: KartaRuntime;
  entity: string;
  fieldKey: string;
  value: unknown;
}) {
  const field = runtime.definition.entities[entity]?.fields[fieldKey];
  if (!field) return <>{formatValue(value)}</>; // computed / unknown key
  return <FieldByType runtime={runtime} field={field} value={value} />;
}

function FieldByType({ runtime, field, value }: { runtime: KartaRuntime; field: Field; value: unknown }) {
  if (value == null || value === "") return <span className="k-muted">–</span>;

  switch (field.type) {
    case "list": {
      const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
      if (rows.length === 0) return <span className="k-muted">None</span>;
      const subEntries = Object.entries(field.of);
      const nested = subEntries.filter(([, f]) => f.type === "list");
      const scalar = subEntries.filter(([, f]) => f.type !== "list");

      // Rows that contain a nested list (e.g. workout entries → sets) render as grouped blocks:
      // the scalar sub-fields form a header, and each nested list renders as its own table.
      if (nested.length > 0) {
        return (
          <div className="k-entries">
            {rows.map((row, i) => (
              <div className="k-entry" key={i}>
                <div className="k-entry-head">
                  {scalar.map(([k, f]) => (
                    <span className="k-entry-h" key={k}>
                      <FieldByType runtime={runtime} field={f} value={row[k]} />
                    </span>
                  ))}
                </div>
                {nested.map(([k, f]) => (
                  <FieldByType key={k} runtime={runtime} field={f} value={row[k]} />
                ))}
              </div>
            ))}
          </div>
        );
      }

      // All-scalar rows render as a labelled table (e.g. sets → Kg | Reps).
      return (
        <table className="k-list-table">
          <thead>
            <tr>
              {subEntries.map(([k, f]) => (
                <th key={k}>{f.label ?? humanizeKey(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {subEntries.map(([k, f]) => (
                  <td key={k}>
                    <FieldByType runtime={runtime} field={f} value={row[k]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "relation": {
      const disp = displayFieldFor(runtime, field.to);
      if (Array.isArray(value)) {
        return <>{value.map((v) => relText(v, disp)).join(", ")}</>;
      }
      return <>{relText(value, disp)}</>;
    }
    case "media":
      return <MediaValue runtime={runtime} value={value as MediaRef | MediaRef[]} />;
    case "tags": {
      const tags = Array.isArray(value) ? value : [value];
      return (
        <span className="k-badges">
          {tags.map((t) => (
            <span key={String(t)} className="k-badge">
              {String(t)}
            </span>
          ))}
        </span>
      );
    }
    case "geo": {
      const g = value as Geo;
      const label = g.label ?? `${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`;
      const href = `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=15/${g.lat}/${g.lng}`;
      return (
        <a className="k-geo-value" href={href} target="_blank" rel="noreferrer noopener">
          📍 {label}
        </a>
      );
    }
    case "datetime":
      return <>{value instanceof Date ? value.toLocaleString() : String(value)}</>;
    case "boolean":
      return <>{value ? "Yes" : "No"}</>;
    case "url":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer noopener">
          {String(value)}
        </a>
      );
    case "number":
    case "duration":
      return (
        <>
          {formatNumber(value)}
          {field.type === "number" && field.unit ? ` ${field.unit}` : ""}
        </>
      );
    default:
      return <>{formatValue(value)}</>;
  }
}

function relText(v: unknown, displayField: string): string {
  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    return String(rec[displayField] ?? rec.id ?? "?");
  }
  return String(v);
}

function MediaValue({ runtime, value }: { runtime: KartaRuntime; value: MediaRef | MediaRef[] }) {
  const ref = Array.isArray(value) ? value[0] : value;
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    void runtime.ctx.media.url(ref).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [runtime, ref]);
  if (!ref) return <span className="k-muted">–</span>;
  return url ? <img className="k-detail-media" src={url} alt="" /> : <span className="k-muted">(image)</span>;
}
