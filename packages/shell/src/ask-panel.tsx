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
import { ApplyError, applyProposal, markDuplicates, type ReviewRow } from "./ask-apply.js";
import { setAskEnabled } from "./ask-setting.js";
import { engineLabel, type EngineConfig } from "./engines.js";
import { askRefusal, startAsk, type StartAskOutcome } from "./start-ask.js";
import { currentVault } from "@karta/identity";
import { allowOrigin, approveAppSource, keyStore, listMySources, makeSourceFetcher, resolveSources, type KeyStore, type ResolvedSource } from "./ask-sources.js";
import { SourcesSection, type SourcesState } from "./ask-sources-panel.js";

/** One key store for the page, so a key kept in memory (no vault here) outlives the dialog. */
let pageKeys: KeyStore | null = null;
const keysForPage = (): KeyStore => (pageKeys ??= keyStore(currentVault()));

/** The model wants a source's request to go somewhere the person has not allowed yet. */
interface OriginQuestion {
  source: ResolvedSource;
  origin: string;
  sendsKey: boolean;
  answer: (yes: boolean) => void;
}

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
  const [reading, setReading] = useState<string | null>(null);
  const [question, setQuestion] = useState<OriginQuestion | null>(null);
  /** Every URL Ask read in this run, shown with the proposal: nothing it looked at is hidden. */
  const [fetched, setFetched] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const refused = askRefusal(engine);
  const keys = keysForPage();
  const [sources, setSources] = useState<SourcesState>({ usable: [], needKey: [], place: "vault" });
  const loadSources = (): void => {
    void Promise.all([resolveSources(def, appId, listMySources(), keys), keys.place()]).then(([r, place]) => setSources({ ...r, place }));
  };
  useEffect(loadSources, [def, appId, keys]);

  useEffect(() => () => abort.current?.abort(), []);
  const closeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeRef.current();
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  }, []);

  const close = (): void => {
    abort.current?.abort();
    question?.answer(false);
    onClose();
  };
  closeRef.current = close;

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
    setReading(null);
    setFetched([]);
    setPhase({ kind: "working" });
    const labels = new Map(sources.usable.map((s) => [s.ask.id, s.ask.label]));
    const onStep = (s: AskStep): void => {
      if (s.kind === "proposal" && !s.ok) setTries((n) => n + 1);
      if (s.kind === "fetch") setReading(labels.get(s.source) ?? s.source);
    };
    const fetchSource = makeSourceFetcher({
      sources: sources.usable,
      keys,
      fetch: (input, init) => globalThis.fetch(input, init),
      confirmOrigin: (source, origin, sendsKey) =>
        controller.signal.aborted
          ? Promise.resolve(false)
          : new Promise<boolean>((resolve) =>
              setQuestion({
                source,
                origin,
                sendsKey,
                answer: (yes) => {
                  setQuestion(null);
                  resolve(yes);
                },
              }),
            ),
      onAllowed: (id, origin) => (id.startsWith("app:") ? approveAppSource(appId, id.slice("app:".length), origin) : allowOrigin(id.slice("mine:".length), origin)),
      onFetched: (_id, url) => setFetched((prev) => [...prev, url]),
    });
    void startAsk({ definition: def, request: text, engine, sources: sources.usable.map((s) => s.ask), fetchSource, onStep, signal: controller.signal }).then((o) => {
      loadSources(); // an origin allowed during the run is remembered from now on
      if (abort.current === controller) void land(o);
    });
  };

  const add = (rows: ReviewRow[]): void => {
    setPhase({ kind: "saving" });
    void applyProposal(runtime, def, rows).then(
      (count) => setPhase({ kind: "added", count }),
      (e: unknown) => {
        const saved = e instanceof ApplyError ? e.created : 0;
        const why = e instanceof Error ? e.message : String(e);
        setPhase({
          kind: "note",
          head: saved ? `Added ${saved} of ${rows.length}, then it stopped` : "Nothing was added",
          text: `${why}${saved ? " The ones already added are in the app; asking again will mark them as already there." : ""}`,
        });
      },
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
            <SourcesSection state={sources} keys={keys} onChange={loadSources} />
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
            <p>
              {phase.kind === "saving"
                ? "Adding…"
                : tries
                  ? `Fitting it to ${def.name}’s fields (try ${tries + 1})…`
                  : reading
                    ? `Reading ${reading}…`
                    : "Working on it…"}
            </p>
            {phase.kind === "working" ? (
              <button
                type="button"
                className="k-add"
                onClick={() => {
                  abort.current?.abort();
                  question?.answer(false);
                }}
              >
                Stop
              </button>
            ) : null}
          </div>
        ) : null}

        {phase.kind === "working" && question ? (
          <div className="k-ask-question" role="alertdialog" aria-label="Allow this address?">
            <p className="k-ask-note-head">
              {question.sendsKey ? `Send your ${question.source.ask.label} key to ${new URL(question.origin).host}?` : `Let Ask read from ${new URL(question.origin).host}?`}
            </p>
            <p className="k-ask-privacy">
              For {question.source.ask.label}
              {question.source.pin === "endpoint" ? ", which this app names" : ""}. {question.sendsKey ? "Only allow an address that belongs to that service." : "What you asked for may go there; nothing already in the app does."} Your answer is remembered for this source.
            </p>
            <div className="k-ask-actions">
              <button type="button" className="k-add" onClick={() => question.answer(false)}>
                Don’t allow
              </button>
              <button type="button" className="k-add k-primary-action" onClick={() => question.answer(true)}>
                Allow
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "review" ? (
          <>
            <Review def={def} summary={phase.summary} rows={phase.rows} onAdd={add} onDiscard={() => setPhase({ kind: "compose" })} />
            {fetched.length ? (
              <details className="k-ask-fetched">
                <summary>
                  Read from {fetched.length} {fetched.length === 1 ? "address" : "addresses"}
                </summary>
                <ul>
                  {fetched.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
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
