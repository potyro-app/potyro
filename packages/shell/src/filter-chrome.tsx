// Generic filter-chip chrome (issue #21). Renders a view's declarative `filters` as chips that
// write into `ctx.params`, re-running the view query. Supports three chip kinds:
//   • boolean — a toggle (param = true | undefined)
//   • geo     — a "use my location" button (param = { lat, lng } from ctx.caps.geo) → "near me"
//   • field   — `from` names an enum/tags field; its options become single- or multi-select chips
// The recipes pantry picker (a record-source picker) stays its own chrome for now.

import { useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { FilterChip } from "karta";

interface ChromeProps {
  runtime: KartaRuntime;
  pageId: string;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
}

interface ChipProps {
  chip: FilterChip;
  entity: string;
  runtime: KartaRuntime;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
}

export function FilterChrome({ runtime, pageId, params, setParam }: ChromeProps) {
  const view = runtime.definition.pages.find((p) => p.id === pageId)?.view as
    | { entity?: string; filters?: FilterChip[] }
    | undefined;
  const filters = view?.filters;
  if (!filters?.length) return null;

  return (
    <section className="k-chrome" aria-label="Filters">
      {filters.map((chip) => (
        <ChipControl key={chip.param} chip={chip} entity={view!.entity ?? ""} runtime={runtime} params={params} setParam={setParam} />
      ))}
    </section>
  );
}

function ChipControl({ chip, entity, runtime, params, setParam }: ChipProps) {
  if (chip.type === "boolean") return <BooleanChip chip={chip} params={params} setParam={setParam} />;
  if (chip.type === "geo") return <GeoChip chip={chip} runtime={runtime} params={params} setParam={setParam} />;
  // `from` naming an entity → record-source chips (the values are record ids, e.g. the recipes
  // pantry picking ingredients); otherwise it names an enum/tags field → option chips.
  if (chip.from && runtime.definition.entities[chip.from]) {
    return <RecordChips chip={chip} runtime={runtime} params={params} setParam={setParam} />;
  }
  return <OptionChips chip={chip} entity={entity} runtime={runtime} params={params} setParam={setParam} />;
}

function RecordChips({ chip, runtime, params, setParam }: Omit<ChipProps, "entity">) {
  const fromEntity = chip.from!;
  const { rows } = runtime.useQuery(fromEntity);
  const displayField = (runtime.definition.entities[fromEntity]?.displayField as string | undefined) ?? "id";
  const selected = new Set((params[chip.param] as string[] | undefined) ?? []);

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParam(chip.param, next.size ? [...next] : undefined);
  };

  return (
    <div className="k-chip-group" role="group" aria-label={chip.label}>
      <span className="k-chrome-label">{chip.label}:</span>
      <div className="k-chips">
        {rows.map((r) => (
          <button key={r.id} type="button" className="k-chip" data-on={selected.has(r.id)} onClick={() => toggle(r.id)}>
            {String(r[displayField] ?? r.id)}
          </button>
        ))}
        {rows.length === 0 ? <span className="k-muted">Nothing to pick yet.</span> : null}
      </div>
    </div>
  );
}

// The same switch a form's boolean is (#97), at chip scale: "Open now" on a list and a boolean in
// a form look like the same thing, because they are.
function BooleanChip({ chip, params, setParam }: Omit<ChipProps, "entity" | "runtime">) {
  const on = Boolean(params[chip.param]);
  return (
    <div className="k-chip-group">
      <button type="button" role="switch" aria-checked={on} className="k-chip k-chip-switch" data-on={on} onClick={() => setParam(chip.param, on ? undefined : true)}>
        {chip.label}
        <span className="k-switch" aria-hidden>
          <span className="k-switch-knob" />
        </span>
      </button>
    </div>
  );
}

function OptionChips({ chip, entity, runtime, params, setParam }: ChipProps) {
  const field = chip.from
    ? (runtime.definition.entities[entity]?.fields[chip.from] as { options?: string[] } | undefined)
    : undefined;
  const options = field?.options ?? [];
  if (options.length === 0) return null;

  const isSelected = (opt: string): boolean =>
    chip.multi ? ((params[chip.param] as string[] | undefined) ?? []).includes(opt) : params[chip.param] === opt;

  const toggle = (opt: string): void => {
    if (chip.multi) {
      const current = (params[chip.param] as string[] | undefined) ?? [];
      const next = current.includes(opt) ? current.filter((x) => x !== opt) : [...current, opt];
      setParam(chip.param, next.length ? next : undefined);
    } else {
      setParam(chip.param, params[chip.param] === opt ? undefined : opt);
    }
  };

  return (
    <div className="k-chip-group" role="group" aria-label={chip.label}>
      <span className="k-chrome-label">{chip.label}:</span>
      <div className="k-chips">
        {options.map((opt) => (
          <button key={opt} type="button" className="k-chip" data-on={isSelected(opt)} onClick={() => toggle(opt)}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function GeoChip({ chip, runtime, params, setParam }: Omit<ChipProps, "entity">) {
  const [busy, setBusy] = useState(false);
  const active = Boolean(params[chip.param]);
  const geo = runtime.ctx.caps.geo;

  const useLocation = async (): Promise<void> => {
    if (!geo) return;
    setBusy(true);
    try {
      const pos = await geo.current();
      setParam(chip.param, { lat: pos.lat, lng: pos.lng });
    } catch (e) {
      // Say so. Swallowing this left the button looking like it simply does nothing when location is
      // denied — you press it, the label flicks to "Locating…" and back, and nothing ever explains why.
      runtime.ctx.ui.toast(e instanceof Error ? e.message : "Could not get your location");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-chip-group">
      <button
        type="button"
        className="k-chip"
        data-on={active}
        disabled={busy || !geo}
        onClick={active ? () => setParam(chip.param, undefined) : useLocation}
      >
        {active ? `${chip.label} ✓` : busy ? "Locating…" : chip.label}
      </button>
    </div>
  );
}
