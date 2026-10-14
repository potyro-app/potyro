// The pieces both review layouts are made of (#213): a record's name, each of its values in full, the
// sources it was checked against, and the approve / reject control. The card and the table only
// arrange these differently.

import { formatMoney, humanizeKey, type AppDefinition as SourceDefinition, type Field as SourceField, type Localized } from "potyro";
/** The definition as the person reads it — `runtime.definition`, localized (#302). */
type AppDefinition = Localized<SourceDefinition>;
type Field = Localized<SourceField>;
import type { ReviewRow } from "./ask-apply.js";
import { trustLabel } from "./ask-verdicts.js";

/** Names to show a link with: a proposed row by ref ("@lx" → its title), a record of the person's by id. */
export interface LinkNames {
  refs: Map<string, string>;
  records: Map<string, string>;
}

/** What a proposed row is called: its display field, else its first text value. */
export function titleOf(def: AppDefinition, row: ReviewRow): string {
  const entity = def.entities[row.entity];
  const by = entity?.displayField;
  const v = by ? row.values[by] : Object.values(row.values).find((x) => typeof x === "string");
  return typeof v === "string" && v.trim() ? v : entity?.label ?? row.entity;
}

function linkName(v: unknown, names: LinkNames): string {
  if (typeof v !== "string") return "";
  return (v.startsWith("@") ? names.refs.get(v.slice(1)) : names.records.get(v)) ?? "";
}

/** A value in full, as the person reads it; null when there is nothing to show. */
export function showValue(field: Field, value: unknown, names: LinkNames): string | null {
  if (value == null || value === "") return null;
  switch (field.type) {
    case "geo": {
      const g = value as { lat: number; lng: number; label?: string };
      return g.label ? `📍 ${g.label}` : `📍 ${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`;
    }
    case "relation": {
      const list = Array.isArray(value) ? value : [value];
      return list.map((v) => linkName(v, names)).filter(Boolean).join(", ") || null;
    }
    case "list": {
      if (!Array.isArray(value) || !value.length) return null;
      return value
        .map((row) =>
          Object.entries(field.of)
            .map(([k, sub]) => showValue(sub, (row as Record<string, unknown>)[k], names))
            .filter(Boolean)
            .join(" · "),
        )
        .map((line, i) => `${i + 1}. ${line}`)
        .join("\n");
    }
    case "tags":
      return Array.isArray(value) ? value.join(", ") : null;
    case "boolean":
      return value ? "Yes" : "No";
    case "number":
      return `${String(value)}${field.unit ? ` ${field.unit}` : ""}`;
    case "money":
      return typeof value === "number" ? formatMoney(value, field.currency) : String(value);
    case "datetime": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return field.precision === "minute" ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
    }
    case "duration":
      return `${String(value)} ${field.unit ?? "ms"}`;
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
  }
}

/** The fields worth showing for a row: those with a value, or with something to say about them. */
export function shownFields(def: AppDefinition, row: ReviewRow): Array<[string, Field]> {
  const entity = def.entities[row.entity];
  return Object.entries(entity?.fields ?? {}).filter(([k, f]) => !f.hidden && (row.values[k] != null || row.trust?.fieldIssues?.[k]));
}

export const fieldLabel = (key: string, field: Field): string => field.label ?? humanizeKey(key);

/** One value with what its sources say about it: disputed (left out unless kept) or not stated. */
export function ValueCell({
  field,
  value,
  issue,
  kept,
  onKeep,
  names,
}: {
  field: Field;
  value: unknown;
  issue?: { kind: "contradicted" | "unsupported"; why: string };
  kept: boolean;
  onKeep: () => void;
  names: LinkNames;
}) {
  const shown = showValue(field, value, names);
  const dropped = issue?.kind === "contradicted" && !kept;
  return (
    <span className="k-ask-value" data-issue={issue?.kind} data-dropped={dropped || undefined}>
      <span className="k-ask-value-text">{shown ?? "—"}</span>
      {issue ? (
        <span className="k-ask-value-why">
          {issue.kind === "contradicted" ? "Disputed: " : "Not in its sources: "}
          {issue.why}
          {issue.kind === "contradicted" ? (
            <button type="button" className="k-ask-keep" aria-pressed={kept} onClick={onKeep}>
              {kept ? "Leave it out" : "Keep anyway"}
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export function Sources({ row }: { row: ReviewRow }) {
  const sources = row.trust?.sources ?? [];
  if (!sources.length) return null;
  return (
    <ul className="k-ask-sources-list" aria-label="Where this was found">
      {sources.map((s) => (
        <li key={s.url}>
          {/* What the person gave (their request, a paste) has no page to open: it is named instead. */}
          {s.url.startsWith("potyro:") ? (
            <span className="k-ask-source-own">{s.via ?? "you"}</span>
          ) : (
            <a href={s.url} target="_blank" rel="noreferrer noopener">
              {s.host}
            </a>
          )}
          <q>{s.quote}</q>
        </li>
      ))}
    </ul>
  );
}

export function TrustBadge({ row }: { row: ReviewRow }) {
  const { text, tone } = trustLabel(row);
  return (
    <span className="k-ask-badge" data-tone={tone}>
      {text}
    </span>
  );
}

/** Approve / reject: two buttons, one pressed. */
export function Decision({ approved, onChange, name }: { approved: boolean; onChange: (approved: boolean) => void; name: string }) {
  return (
    <span className="k-ask-decision" role="group" aria-label={`Keep ${name}?`}>
      <button type="button" className="k-ask-approve" aria-pressed={approved} aria-label={`Approve ${name}`} title="Approve" onClick={() => onChange(true)}>
        ✓
      </button>
      <button type="button" className="k-ask-reject" aria-pressed={!approved} aria-label={`Reject ${name}`} title="Reject" onClick={() => onChange(false)}>
        ✕
      </button>
    </span>
  );
}
