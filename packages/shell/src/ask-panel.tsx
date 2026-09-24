// Ask (#213): say what you want added, look it over, add it.
//
// Four moments, one dialog: the request, the wait, the review, and what was added. The review is the
// point: nothing a model proposes is saved until the person ticks it and taps Add. Rows the person
// already has (by name, checked on this device) come unticked and say so.
//
// The dialog also says, before anyone types, what leaves the device: how the app is organised and the
// request, never what is in it. And it holds the one switch that makes Ask go away for this app.

import { useEffect, useMemo, useRef, useState } from "react";
import { humanizeKey, type AppDefinition, type Field } from "karta";
import type { KartaRuntime } from "@karta/runtime";
import type { AskStep, Proposal } from "@karta/generator/agent";
import { applyProposal, markDuplicates, type ReviewRow } from "./ask-apply.js";
import { setAskEnabled } from "./ask-setting.js";
import { engineLabel, type EngineConfig } from "./engines.js";
import { askRefusal, startAsk, type StartAskOutcome } from "./start-ask.js";

type Phase =
  | { kind: "compose" }
  | { kind: "working" }
  | { kind: "review"; summary: string; rows: ReviewRow[] }
  | { kind: "saving" }
  | { kind: "added"; count: number }
  | { kind: "note"; head: string; text: string };

export interface AskPanelProps {
  appId: string;
  runtime: KartaRuntime;
  engine: EngineConfig;
  onClose: () => void;
}

/** What a proposed row is called: its display field, else its first text value. */
function titleOf(def: AppDefinition, row: ReviewRow): string {
  const entity = def.entities[row.entity];
  const by = entity?.displayField;
  const v = by ? row.values[by] : Object.values(row.values).find((x) => typeof x === "string");
  return typeof v === "string" && v.trim() ? v : entity?.label ?? row.entity;
}

function showValue(field: Field, value: unknown, refs: Map<string, string>): string | null {
  if (value == null || value === "") return null;
  switch (field.type) {
    case "geo": {
      const g = value as { lat: number; lng: number; label?: string };
      return g.label ? `📍 ${g.label}` : `📍 ${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`;
    }
    case "relation": {
      const list = Array.isArray(value) ? value : [value];
      return list.map((v) => refs.get(String(v).slice(1)) ?? "").filter(Boolean).join(", ") || null;
    }
    case "list":
      return Array.isArray(value) ? `${value.length} ${field.label ?? "item"}${value.length === 1 ? "" : "s"}` : null;
    case "tags":
      return Array.isArray(value) ? value.join(", ") : null;
    case "boolean":
      return value ? field.label ?? "yes" : null;
    case "number":
      return `${String(value)}${field.unit ? ` ${field.unit}` : ""}`;
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : null;
  }
}

/** A few of the row's other values, so the person can judge it without opening anything. */
function detailsOf(def: AppDefinition, row: ReviewRow, refs: Map<string, string>): string[] {
  const entity = def.entities[row.entity];
  if (!entity) return [];
  const out: string[] = [];
  for (const [key, field] of Object.entries(entity.fields)) {
    if (key === entity.displayField || out.length >= 4) continue;
    const shown = showValue(field, row.values[key], refs);
    if (shown) out.push(field.type === "text" && shown.length > 90 ? `${shown.slice(0, 88)}…` : shown);
  }
  return out;
}

function Review({
  def,
  summary,
  rows,
  onAdd,
  onDiscard,
}: {
  def: AppDefinition;
  summary: string;
  rows: ReviewRow[];
  onAdd: (rows: ReviewRow[]) => void;
  onDiscard: () => void;
}) {
  const [ticked, setTicked] = useState(() => new Set(rows.filter((r) => !r.duplicate).map((r) => r.ref)));
  const refs = useMemo(() => new Map(rows.map((r) => [r.ref, titleOf(def, r)])), [def, rows]);
  const groups = useMemo(() => {
    const by = new Map<string, ReviewRow[]>();
    for (const r of rows) by.set(r.entity, [...(by.get(r.entity) ?? []), r]);
    return [...by];
  }, [rows]);
  const toggle = (ref: string): void =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  const count = ticked.size;

  return (
    <>
      {summary ? <p className="k-ask-summary">{summary}</p> : null}
      <div className="k-ask-review">
        {groups.map(([entity, list]) => (
          <section key={entity} className="k-ask-group" aria-label={def.entities[entity]?.label ?? humanizeKey(entity)}>
            <h3 className="k-ask-group-head">
              {def.entities[entity]?.icon ? <span aria-hidden>{def.entities[entity]!.icon} </span> : null}
              {def.entities[entity]?.label ?? humanizeKey(entity)}
              <span className="k-ask-group-count">{list.length}</span>
            </h3>
            <ul className="k-ask-rows">
              {list.map((row) => {
                const details = detailsOf(def, row, refs);
                return (
                  <li key={row.ref} className="k-ask-row" data-duplicate={row.duplicate || undefined} data-ticked={ticked.has(row.ref) || undefined}>
                    <label>
                      <input type="checkbox" checked={ticked.has(row.ref)} onChange={() => toggle(row.ref)} />
                      <span className="k-ask-row-body">
                        <span className="k-ask-row-title">{titleOf(def, row)}</span>
                        {row.duplicate ? <span className="k-ask-row-dup">already in your app</span> : null}
                        {details.length ? <span className="k-ask-row-details">{details.join(" · ")}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <footer className="k-ask-actions">
        <button type="button" className="k-add" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" className="k-add k-primary-action" disabled={count === 0} onClick={() => onAdd(rows.filter((r) => ticked.has(r.ref)))}>
          {count === 0 ? "Nothing ticked" : `Add ${count}`}
        </button>
      </footer>
    </>
  );
}

const NOTE_HEAD: Record<string, string> = {
  answer: "It replied",
  refused: "Ask can’t run yet",
  failed: "It couldn’t make this fit",
  stopped: "Stopped",
};

export function AskPanel({ appId, runtime, engine, onClose }: AskPanelProps) {
  const def = runtime.definition;
  const [request, setRequest] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [tries, setTries] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const refused = askRefusal(engine);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  });

  const close = (): void => {
    abort.current?.abort();
    onClose();
  };

  const land = async (outcome: StartAskOutcome): Promise<void> => {
    if (outcome.kind === "proposal") {
      setPhase({ kind: "review", summary: outcome.proposal.summary, rows: await review(outcome.proposal) });
      return;
    }
    const text = outcome.kind === "answer" || outcome.kind === "refused" ? outcome.text : outcome.kind === "failed" ? outcome.reason : "You stopped it before it finished.";
    setPhase({ kind: "note", head: NOTE_HEAD[outcome.kind]!, text });
  };

  /** Duplicates are judged here, against this device's records — the model never saw them. */
  const review = async (proposal: Proposal): Promise<ReviewRow[]> => {
    const entities = [...new Set(proposal.rows.map((r) => r.entity))];
    const existing: Record<string, Array<Record<string, unknown>>> = {};
    for (const e of entities) existing[e] = (await runtime.ctx.query(e)) as Array<Record<string, unknown>>;
    return markDuplicates(def, proposal.rows, existing);
  };

  const ask = (): void => {
    const text = request.trim();
    if (!text) return;
    const controller = new AbortController();
    abort.current = controller;
    setTries(0);
    setPhase({ kind: "working" });
    const onStep = (s: AskStep): void => {
      if (s.kind === "proposal" && !s.ok) setTries((n) => n + 1);
    };
    void startAsk({ definition: def, request: text, engine, onStep, signal: controller.signal }).then((o) => {
      if (abort.current === controller) void land(o);
    });
  };

  const add = (rows: ReviewRow[]): void => {
    setPhase({ kind: "saving" });
    void applyProposal(runtime, def, rows).then(
      (count) => setPhase({ kind: "added", count }),
      (e: unknown) => setPhase({ kind: "note", head: "Not everything was added", text: e instanceof Error ? e.message : String(e) }),
    );
  };

  const turnOff = (): void => {
    setAskEnabled(appId, false);
    close();
  };

  return (
    <div className="k-modal-scrim" onClick={close}>
      <div className="k-modal k-ask" role="dialog" aria-modal="true" aria-label={`Ask ${def.name}`} onClick={(e) => e.stopPropagation()} data-phase={phase.kind}>
        <header className="k-modal-head k-ask-head">
          <div>
            <p className="k-ask-eyebrow">Ask</p>
            <h2 className="k-ask-title">{phase.kind === "review" ? "Look it over" : `What should go into ${def.name}?`}</h2>
          </div>
          <button type="button" className="k-add" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>

        {phase.kind === "compose" ? (
          <>
            <textarea
              className="k-input k-ask-input"
              aria-label="What to add"
              rows={3}
              autoFocus
              placeholder="e.g. five dog-friendly cafés near the river"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
              }}
            />
            {refused ? (
              <p className="k-ask-refused" role="note">
                {refused}
              </p>
            ) : (
              <p className="k-ask-privacy">
                {engineLabel(engine)} sees how this app is organised and what you type here. Nothing already in the app is sent. You choose what gets added.
              </p>
            )}
            <footer className="k-ask-actions">
              <button type="button" className="k-ask-off" onClick={turnOff}>
                Turn off Ask for this app
              </button>
              <button type="button" className="k-add k-primary-action" disabled={!request.trim() || Boolean(refused)} onClick={ask}>
                Ask
              </button>
            </footer>
          </>
        ) : null}

        {phase.kind === "working" || phase.kind === "saving" ? (
          <div className="k-ask-working" role="status">
            <span className="k-ask-pulse" aria-hidden />
            <p>{phase.kind === "saving" ? "Adding…" : tries ? `Fitting it to ${def.name}’s fields (try ${tries + 1})…` : "Working on it…"}</p>
            {phase.kind === "working" ? (
              <button type="button" className="k-add" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : null}
          </div>
        ) : null}

        {phase.kind === "review" ? (
          <Review def={def} summary={phase.summary} rows={phase.rows} onAdd={add} onDiscard={() => setPhase({ kind: "compose" })} />
        ) : null}

        {phase.kind === "added" ? (
          <div className="k-ask-done" role="status">
            <p className="k-ask-done-count">
              Added {phase.count} {phase.count === 1 ? "record" : "records"}.
            </p>
            <footer className="k-ask-actions">
              <button type="button" className="k-add" onClick={() => setPhase({ kind: "compose" })}>
                Ask for more
              </button>
              <button type="button" className="k-add k-primary-action" onClick={close}>
                Done
              </button>
            </footer>
          </div>
        ) : null}

        {phase.kind === "note" ? (
          <div className="k-ask-note" role="note">
            <p className="k-ask-note-head">{phase.head}</p>
            <p>{phase.text}</p>
            <footer className="k-ask-actions">
              <button type="button" className="k-add k-primary-action" onClick={() => setPhase({ kind: "compose" })}>
                Back
              </button>
            </footer>
          </div>
        ) : null}
      </div>
    </div>
  );
}
