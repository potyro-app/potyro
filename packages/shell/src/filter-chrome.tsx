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
  return <OptionChips chip={chip} entity={entity} runtime={runtime} params={params} setParam={setParam} />;
}

function BooleanChip({ chip, params, setParam }: Omit<ChipProps, "entity" | "runtime">) {
  const on = Boolean(params[chip.param]);
  return (
    <div className="k-chip-group">
      <button type="button" className="k-chip" data-on={on} onClick={() => setParam(chip.param, on ? undefined : true)}>
        {chip.label}
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
    } catch {
      // denied/unavailable → leave the param unset (the filter simply matches nothing)
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
