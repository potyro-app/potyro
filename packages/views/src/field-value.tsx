// Render a resolved field value according to its declared field TYPE. This is what makes the
// detail view readable: list fields render as rows, relations resolve to the related record's
// display field, tags become chips, media becomes an image, etc. Falls back to formatValue for
// computed keys (which have no field definition — their value is already final).

import { useEffect, useState } from "react";
import type { Field, Geo, MediaRef, DateTimeField } from "karta";
import type { KartaRuntime } from "@karta/runtime";
import { displayFieldFor, formatValue, humanizeKey } from "./format.js";
import { formatDuration, formatWithUnit } from "./units.js";
import { formatDateAbsolute, precisionOf, toDate } from "./dates.js";
import { EnumPill } from "./enum-input.js";
import { MediaTile, mediaList } from "./media-input.js";

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

      // An ordered list is a sequence, so it reads as one: numbered, in order, not a table whose
      // row numbers you have to infer from where they sit (#104).
      if (field.ordered) {
        return (
          <ol className="k-row-list">
            {rows.map((row, i) => (
              <li key={i}>
                {subEntries.map(([k, f], n) => (
                  <span key={k}>
                    {n > 0 ? " · " : ""}
                    <FieldByType runtime={runtime} field={f} value={row[k]} />
                  </span>
                ))}
              </li>
            ))}
          </ol>
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
    case "member": {
      // Resolution already turned ids into people, so this renders names — but it tolerates a bare
      // id (an unresolved raw row) rather than printing "[object Object]" or nothing.
      const people = Array.isArray(value) ? value : [value];
      return (
        <span className="k-badges">
          {people.filter((p) => p != null).map((p) => (
            <span key={String((p as { id?: string })?.id ?? p)} className="k-person-chip">
              {typeof p === "string" ? p : String((p as { name?: string })?.name ?? "Unknown")}
            </span>
          ))}
        </span>
      );
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
    case "enum":
      // The value as a tinted pill, the same colour it wore in the form (#98).
      return <EnumPill field={field} value={String(value)} />;

    case "datetime": {
      // A day reads as a day; only a minute field shows its time (#103). The absolute date sits in
      // the title, so a relative word ("yesterday") never hides the real one.
      const d = toDate(value);
      if (!d) return <>{String(value ?? "")}</>;
      const precision = precisionOf(field as DateTimeField);
      return <span title={formatDateAbsolute(d, precision)}>{formatDateAbsolute(d, precision)}</span>;
    }
    case "boolean":
      return <>{value ? "Yes" : "No"}</>;
    case "url":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer noopener">
          {String(value)}
        </a>
      );
    case "number":
      // The same formatting the form's suffix uses (#99): "7 days" reads the same everywhere.
      return <>{formatWithUnit(value, field)}</>;
    case "duration":
      return <>{formatDuration(value, field)}</>;
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

/**
 * On the record page, media shows as the same tiles the form used (#102) — one photo looks like one
 * photo everywhere — and a `multiple` field shows all of them, not only the first.
 */
function MediaValue({ runtime, value }: { runtime: KartaRuntime; value: MediaRef | MediaRef[] }) {
  const refs = mediaList(value);
  if (!refs.length) return <span className="k-muted">–</span>;
  return (
    <span className="k-media k-media-read">
      {refs.map((ref, i) => (
        <MediaTile key={`${ref.key}-${i}`} runtime={runtime} mediaRef={ref} />
      ))}
    </span>
  );
}
