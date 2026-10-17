// Generic filter-chip chrome (issue #21). Renders a view's declarative `filters` as chips that
// write into `ctx.params`, re-running the view query. Supports three chip kinds:
//   • boolean — a toggle (param = true | undefined)
//   • geo     — a "use my location" button (param = { lat, lng } from ctx.caps.geo) → "near me"
//   • field   — `from` names an enum/tags field; its options become single- or multi-select chips
// The recipes pantry picker (a record-source picker) stays its own chrome for now.
//
// Every option, always on screen, does not survive contact with a real app: Places' two lists come
// to thirteen chips, which on a phone is most of the screen spent on choices nobody has made yet.
// So the option lists live behind ONE Filter button, and what comes back out is only what was
// chosen — each chosen value a chip that takes itself off when tapped.
//
// A boolean and a "near me" stay where they are: each is already one tap and already says what it
// does, so burying them would only add a tap on the way to a switch.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PotyroRuntime } from "@potyro/runtime";
import type { FilterChip as SourceChip, Localized } from "potyro";
import { optionLabel, usePortalRoot } from "@potyro/views";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";

/** A chip as the person reads it: the localized definition's (#302). */
type FilterChip = Localized<SourceChip>;

interface ChromeProps {
  runtime: PotyroRuntime;
  pageId: string;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
}

interface ChipProps {
  chip: FilterChip;
  entity: string;
  runtime: PotyroRuntime;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
}

/**
 * Chips whose values come from a fixed list, which is what the Filter sheet is for.
 *
 * The others are CONTROLS — a switch, a "use my location" button, a box to type in — and they live
 * in the row itself: hiding a search box inside a sheet called "Filter" is hiding the one thing
 * someone with three hundred rows came to the page to use.
 */
const DIRECT_TYPES = new Set(["boolean", "geo", "text", "number"]);

/** The values chosen for one chip, as a list — a single-select holds one, a multi holds several. */
function chosen(chip: FilterChip, params: Record<string, unknown>): string[] {
  const value = params[chip.param];
  if (value == null) return [];
  // A control shows its own value (a switch, a box with text in it); it is not a pill to remove.
  if (DIRECT_TYPES.has(chip.type ?? "")) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

const isOptionChip = (chip: FilterChip): boolean => !DIRECT_TYPES.has(chip.type ?? "");

/**
 * The app's own buttons for this page (#216).
 *
 * Here, in the page's chrome, rather than inside each view: a button belongs to the page, every view
 * type gets it from one place, and the alternative was fourteen view components each growing their
 * own toolbar. The label is the app's — unlike an action named by key, nothing is guessed from an
 * identifier.
 */
function PageActions({ runtime, pageId, params }: { runtime: PotyroRuntime; pageId: string; params: Record<string, unknown> }) {
  const page = runtime.definition.pages.find((p) => p.id === pageId);
  const actions = page?.actions;
  // The page's primary action is its header's big button, not one more chip.
  const primary = (page as { primaryAction?: string | number } | undefined)?.primaryAction;
  // The page's add (`add`) is the phone's "+" in the top bar; here it stays for a wide screen.
  const add = (page as { add?: number } | undefined)?.add;
  // Which button is mid-run — a `run` that awaits the position or the network takes a moment, and a
  // button that looks inert while it works gets pressed again.
  const [busy, setBusy] = useState<number | null>(null);
  if (!actions?.length) return null;
  return (
    <>
      {actions.map((action, index) => index === primary ? null : (
        <button
          key={`${action.label}:${index}`}
          type="button"
          className="k-chip k-page-action"
          data-page-add={index === add || undefined}
          data-k-wording
          disabled={busy !== null}
          aria-busy={busy === index || undefined}
          onClick={() => {
            setBusy(index);
            void runtime.runPageAction(pageId, index, params).finally(() => setBusy(null));
          }}
        >
          {action.icon ? <span aria-hidden>{action.icon}</span> : null}
          {action.label}
        </button>
      ))}
    </>
  );
}

export function FilterChrome({ runtime, pageId, params, setParam }: ChromeProps) {
  const { t } = useLingui();
  // A page's chips are the page's: they write `ctx.params`, which every item of a layout reads. So a
  // layout shows those of the first item that declares any — a status line above a filtered map
  // keeps the map's chips (it used to look only at the first item, and they vanished).
  const page = runtime.definition.pages.find((p) => p.id === pageId);
  type Chipped = { entity?: string; filters?: FilterChip[] };
  const view = ((page?.layout?.items ?? []).map((i) => i.view as Chipped).find((v) => v.filters?.length) ?? page?.view) as Chipped | undefined;
  const filters = view?.filters;
  const hasActions = Boolean(runtime.definition.pages.find((p) => p.id === pageId)?.actions?.length);
  const [open, setOpen] = useState(false);
  // Navigating away with the sheet open would otherwise bring it back on the next page with filters.
  useEffect(() => setOpen(false), [pageId]);
  // A page with buttons and no chips still has chrome to draw.
  if (!filters?.length) {
    return hasActions ? (
      <section className="k-chrome" aria-label={t`Page actions`} data-k-view>
        <PageActions runtime={runtime} pageId={pageId} params={params} />
      </section>
    ) : null;
  }

  const entity = view!.entity ?? "";
  const options = filters.filter(isOptionChip);
  // A box to type in gets a line of its own, the width of the screen: it is what someone with three
  // hundred rows came for. Everything else is one row of chips under it, scrolling sideways on a
  // phone rather than stacking three rows of choices above the content.
  const boxes = filters.filter((c) => c.type === "text");
  const direct = filters.filter((c) => !isOptionChip(c) && c.type !== "text");
  const picked = options.flatMap((chip) => chosen(chip, params).map((value) => ({ chip, value })));

  const drop = (chip: FilterChip, value: string): void => {
    const rest = chosen(chip, params).filter((v) => v !== value);
    setParam(chip.param, chip.multi && rest.length ? rest : undefined);
  };

  return (
    <section className="k-chrome" aria-label={t`Filters`} data-k-view>
      {boxes.map((chip) => (
        <ChipControl key={chip.param} chip={chip} entity={entity} runtime={runtime} params={params} setParam={setParam} />
      ))}
      <div className="k-chrome-row">
      {options.length ? (
        <button
          type="button"
          className="k-filter-open"
          data-on={picked.length > 0 || undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden>⚟</span> <Trans comment="Button that opens the filter options of a page">Filter</Trans>
          {picked.length ? <span className="k-filter-count">{fmt.number(picked.length)}</span> : null}
        </button>
      ) : null}

      {/* What was chosen, and nothing else. A tap on one takes it off. */}
      {picked.map(({ chip, value }) => {
        const filter = chip.label;
        return (
        <button
          key={`${chip.param}:${value}`}
          type="button"
          className="k-chip k-chip-picked"
          data-on
          aria-label={t({ message: `${filter}: ${value} — remove`, comment: "A chosen filter value; pressing it takes the filter off" })}
          onClick={() => drop(chip, value)}
        >
          <ValueLabel chip={chip} entity={entity} runtime={runtime} value={value} />
          <span className="k-chip-x" aria-hidden>
            ✕
          </span>
        </button>
        );
      })}

      {direct.map((chip) => (
        <ChipControl key={chip.param} chip={chip} entity={entity} runtime={runtime} params={params} setParam={setParam} />
      ))}

      <PageActions runtime={runtime} pageId={pageId} params={params} />
      </div>

      {open ? (
        <FilterSheet
          filters={options}
          entity={entity}
          runtime={runtime}
          params={params}
          setParam={setParam}
          picked={picked.length}
          onClose={() => setOpen(false)}
          onClear={() => options.forEach((chip) => setParam(chip.param, undefined))}
        />
      ) : null}
    </section>
  );
}

/** A chosen value's name: an option reads as its words (`labels`), a record id has to be looked up. */
function ValueLabel({ chip, entity, runtime, value }: { chip: FilterChip; entity: string; runtime: PotyroRuntime; value: string }) {
  const fromEntity = chip.from && runtime.definition.entities[chip.from] ? chip.from : "";
  const { rows } = runtime.useQuery(fromEntity);
  if (!fromEntity) return <>{optionLabel(chip.from ? (runtime.definition.entities[entity]?.fields[chip.from] as { labels?: Record<string, string> } | undefined) : undefined, value)}</>;
  const field = (runtime.definition.entities[fromEntity]?.displayField as string | undefined) ?? "id";
  const row = rows.find((r) => String(r.id) === value);
  return <>{row ? String(row[field] ?? value) : value}</>;
}

/** The options, all of them, on demand — a bottom sheet on a phone, a small panel on a wide screen. */
function FilterSheet({
  filters,
  entity,
  runtime,
  params,
  setParam,
  picked,
  onClose,
  onClear,
}: {
  filters: FilterChip[];
  entity: string;
  runtime: PotyroRuntime;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
  picked: number;
  onClose: () => void;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const screen = usePortalRoot();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Through a portal: the chrome that owns this button floats over the map with a z-index of its
  // own, and a sheet rendered inside it can never rise above the tab bar, whatever z-index it asks
  // for — it is trapped in its parent's stacking context.
  //
  // Into the APP's root, not the document body: the app's accent is a custom property set there, and
  // a sheet outside it comes out wearing the shell's default colour instead of the app's.
  //
  // The app's root within its own screen: framed in the Studio there are two apps on the page (the
  // one the Studio was opened from, under it, comes first), and the first match was the wrong one.
  const host = (screen !== document.body ? screen.querySelector(".k-app") : null) ?? document.querySelector(".k-app") ?? document.body;
  return createPortal(
    <div className="k-modal-scrim k-filter-scrim" onClick={onClose}>
      <div className="k-filter-sheet" role="dialog" aria-label={t({ message: "Filter", comment: "Title of the sheet with a page's filter options" })} data-k-view onClick={(e) => e.stopPropagation()}>
        <header className="k-filter-head">
          <h2 className="k-filter-title">
            <Trans comment="Title of the sheet with a page's filter options">Filter</Trans>
          </h2>
          <button type="button" className="k-filter-clear" disabled={picked === 0} onClick={onClear}>
            <Trans comment="Filter sheet: take every chosen filter off">Clear</Trans>
          </button>
        </header>
        <div className="k-filter-body">
          {filters.map((chip) => (
            <ChipControl key={chip.param} chip={chip} entity={entity} runtime={runtime} params={params} setParam={setParam} />
          ))}
        </div>
        <div className="k-filter-foot">
          <button type="button" className="k-add k-primary-action" onClick={onClose}>
            <Trans comment="Filter sheet: close it">Done</Trans>
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}

function ChipControl({ chip, entity, runtime, params, setParam }: ChipProps) {
  if (chip.type === "boolean") return <BooleanChip chip={chip} params={params} setParam={setParam} />;
  if (chip.type === "geo") return <GeoChip chip={chip} runtime={runtime} params={params} setParam={setParam} />;
  if (chip.type === "text" || chip.type === "number") return <ValueChip chip={chip} params={params} setParam={setParam} />;
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
      <span className="k-chrome-label" data-k-wording>
        {chip.label}:
      </span>
      <div className="k-chips">
        {rows.map((r) => (
          <button key={r.id} type="button" className="k-chip" data-on={selected.has(r.id)} onClick={() => toggle(r.id)}>
            {String(r[displayField] ?? r.id)}
          </button>
        ))}
        {rows.length === 0 ? <span className="k-muted">
            <Trans>Nothing to pick yet.</Trans>
          </span> : null}
      </div>
    </div>
  );
}

/**
 * A value the person types, held in `ctx.params` for the view's `filter` to read (#216).
 *
 * This is how an app gets SEARCH — and it deliberately is not a search engine. The chip collects the
 * text; what matching means is the app's own function, so an app can search a name, a name and its
 * notes, or a normalised spelling, and the rule is visible in the app rather than buried in the
 * host. `number` is the same mechanism for "over £20" / "under 30 minutes".
 *
 * The box keeps its own value and writes the param on a short delay. Every keystroke re-runs the
 * page's query, and a query per letter is how a list of a few hundred rows starts feeling slow on
 * a phone; a controlled input written straight through also fights the keyboard on Android.
 */
function ValueChip({ chip, params, setParam }: Omit<ChipProps, "entity" | "runtime">) {
  const { t } = useLingui();
  const filter = chip.label;
  const live = params[chip.param];
  const [text, setText] = useState(live == null ? "" : String(live));
  // Re-sync when the param changes from somewhere else (a cleared filter, a navigation), but never
  // while typing — that is what would fight the keyboard.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setText(live == null ? "" : String(live));
  }, [live]);

  useEffect(() => {
    if (!typed.current) return;
    const id = setTimeout(() => {
      typed.current = false;
      const trimmed = text.trim();
      if (trimmed === "") return setParam(chip.param, undefined);
      setParam(chip.param, chip.type === "number" ? Number(trimmed) : trimmed);
    }, 150);
    return () => clearTimeout(id);
  }, [text, chip.param, chip.type, setParam]);

  return (
    <div className="k-chip-group k-value-chip" data-on={text.trim() !== "" || undefined}>
      <input
        type={chip.type === "number" ? "number" : "search"}
        className="k-chip-input"
        value={text}
        aria-label={chip.label}
        placeholder={chip.placeholder ?? chip.label}
        inputMode={chip.type === "number" ? "decimal" : undefined}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
      />
      {text !== "" ? (
        <button
          type="button"
          className="k-chip-x-button"
          aria-label={t({ message: `Clear ${filter}`, comment: "Empties a filter's search box" })}
          onClick={() => {
            typed.current = true;
            setText("");
          }}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

// The same switch a form's boolean is (#97), at chip scale: "Open now" on a list and a boolean in
// a form look like the same thing, because they are.
function BooleanChip({ chip, params, setParam }: Omit<ChipProps, "entity" | "runtime">) {
  const on = Boolean(params[chip.param]);
  return (
    <div className="k-chip-group">
      <button type="button" role="switch" aria-checked={on} className="k-chip k-chip-switch" data-on={on} data-k-wording onClick={() => setParam(chip.param, on ? undefined : true)}>
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
    ? (runtime.definition.entities[entity]?.fields[chip.from] as { options?: string[]; labels?: Record<string, string> } | undefined)
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
      <span className="k-chrome-label" data-k-wording>
        {chip.label}:
      </span>
      <div className="k-chips">
        {options.map((opt) => (
          <button key={opt} type="button" className="k-chip" data-on={isSelected(opt)} onClick={() => toggle(opt)}>
            {optionLabel(field, opt)}
          </button>
        ))}
      </div>
    </div>
  );
}

function GeoChip({ chip, runtime, params, setParam }: Omit<ChipProps, "entity">) {
  const { t } = useLingui();
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
      runtime.ctx.ui.toast(e instanceof Error ? e.message : t`Could not get your location`);
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
        {active ? `${chip.label} ✓` : busy ? t`Locating…` : chip.label}
      </button>
    </div>
  );
}
