// Ask (#213): say what you want added, look it over, add it.
//
// Four moments, one dialog: the request, the wait, the review, and what was added. The review is the
// point: nothing a model proposes is saved until the person ticks it and taps Add. Rows the person
// already has (by name, checked on this device) come unticked and say so.
//
// The dialog also says, before anyone types, what leaves the device: how the app is organised and the
// request, never what is in it. And it holds the one switch that makes Ask go away for this app.

import { fmt } from "@potyro/i18n";
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { AskContext, AskStep, ChatMessage, Citation, Proposal } from "@potyro/generator/agent";
import { mapArea, subscribeMapArea, Glyph } from "@potyro/views";
import { ApplyError, applyEdits, applyProposal, entitiesToLoad, prepareReview, runActions, type Review, type ReviewRow } from "./ask-apply.js";
import { doneText, ReviewPanel, type AcceptedEdit, type AcceptedRun } from "./ask-review.js";
import { placeByAddress } from "./ask-geocode.js";
import { MaterialField, type Material } from "./ask-material.js";
import { addSpend, formatSpend, spentIn } from "./ask-spend.js";
import { setAskEnabled } from "./ask-setting.js";
import { engineLabel, type EngineConfig } from "./engines.js";
import { askRefusal, startAsk, type StartAskOutcome } from "./start-ask.js";
import { currentLocale } from "./locale.js";
import { currentVault } from "@potyro/identity";
import { allowOrigin, approveAppSource, keyStore, sourceHttp, listMySources, makeSourceFetcher, resolveSources, type KeyStore, type ResolvedSource } from "./ask-sources.js";
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
  | { kind: "review"; review: Review; names: Map<string, string>; citations: Citation[] }
  /** The model needs one thing from the person; their reply carries the conversation on. */
  | { kind: "question"; text: string; transcript: ChatMessage[] }
  | { kind: "saving" }
  | { kind: "added"; created: number; ran: number; changed: number }
  | { kind: "note"; head: string; text: string };

export interface AskPanelProps {
  appId: string;
  runtime: PotyroRuntime;
  engine: EngineConfig;
  /** Something brought from elsewhere — text shared into Potyro — to start with (#213). */
  initialMaterial?: Material;
  onClose: () => void;
}

/** Web search is a person's choice, per device: it costs a few cents a request on their own key. */
const WEB_KEY = "potyro:ask-web";
function webPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(WEB_KEY) !== "0";
  } catch {
    return true;
  }
}
function rememberWeb(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(WEB_KEY, on ? "1" : "0");
  } catch {
    // remembered for this dialog only
  }
}

/** Today in the person's own calendar, not UTC's. */
function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const NOTE_HEAD: Record<string, MessageDescriptor> = {
  refused: msg`Ask can’t run yet`,
  failed: msg`It couldn’t make this fit`,
  stopped: msg({ message: "Stopped", comment: "Ask: the person stopped the request" }),
};

/** What leaves the device, said before anything is typed. One sentence per case, so each reads whole. */
function privacyLine(engine: string, pasted: boolean, area: boolean): string {
  if (pasted && area) return t`${engine} sees how this app is organised, what you type and paste, and the area on your map. Nothing already in the app is sent. You choose what gets added.`;
  if (pasted) return t`${engine} sees how this app is organised, what you type and paste. Nothing already in the app is sent. You choose what gets added.`;
  if (area) return t`${engine} sees how this app is organised, what you type, and the area on your map. Nothing already in the app is sent. You choose what gets added.`;
  return t`${engine} sees how this app is organised, what you type. Nothing already in the app is sent. You choose what gets added.`;
}

/** "Area on your map · 44.385, 7.543 · 2 km". */
function mapChip(area: { lat: number; lng: number; radiusKm: number }): string {
  const lat = fmt.number(area.lat, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const lng = fmt.number(area.lng, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  if (area.radiusKm < 1) return t`Area on your map · ${lat}, ${lng} · <1 km`;
  const km = fmt.number(Math.round(area.radiusKm));
  return t`Area on your map · ${lat}, ${lng} · ${km} km`;
}

/** Where the web search looked: the sites, then every page, so a person can check a place is real. */
function Found({ citations }: { citations: Citation[] }) {
  const { t } = useLingui();
  const hosts = [...new Set(citations.map((c) => { try { return new URL(c.url).host.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean))];
  const sites = hosts.slice(0, 3).join(", ");
  const more = hosts.length - 3;
  return (
    <details className="k-ask-found">
      <summary>
        {more > 0 ? plural(more, { one: `Found on ${sites} and # more`, other: `Found on ${sites} and # more` }) : t`Found on ${sites}`}
      </summary>
      <ul>
        {citations.map((c) => (
          <li key={c.url}>
            <a href={c.url} target="_blank" rel="noreferrer noopener">
              {c.title || c.url}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AskPanel({ appId, runtime, engine, initialMaterial, onClose }: AskPanelProps) {
  const { t } = useLingui();
  const def = runtime.definition;
  const name = def.name;
  const [request, setRequest] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [tries, setTries] = useState(0);
  const [reading, setReading] = useState<string | null>(null);
  const [question, setQuestion] = useState<OriginQuestion | null>(null);
  /** Every URL Ask read in this run, shown with the proposal: nothing it looked at is hidden. */
  const [fetched, setFetched] = useState<string[]>([]);
  // What goes with the request besides the app's structure, shown before sending and removable.
  const area = useSyncExternalStore(subscribeMapArea, mapArea);
  const [sendArea, setSendArea] = useState(true);
  const [web, setWeb] = useState(webPreference);
  const [searchDown, setSearchDown] = useState(false);
  const [reply, setReply] = useState("");
  /** Something the person brought — a paste or a file another AI made — to turn into records. */
  const [material, setMaterial] = useState<Material | null>(initialMaterial ?? null);
  const [placing, setPlacing] = useState<{ done: number; of: number } | null>(null);
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

  /** What the last request cost, when the engine said. */
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [appSpent, setAppSpent] = useState(() => spentIn(appId));

  const land = async (outcome: StartAskOutcome): Promise<void> => {
    const spent = "spent" in outcome ? outcome.spent : undefined;
    if (typeof spent === "number") {
      addSpend(appId, spent);
      setAppSpent(spentIn(appId));
      setLastCost((c) => (c ?? 0) + spent);
    }
    if (outcome.kind === "proposal") {
      const r = await review(outcome.proposal);
      // Addresses become pins at the real address (ask-geocode.ts) — an online lookup, so only when
      // the person allowed web search.
      if (web) {
        r.review = { ...r.review, rows: await placeByAddress(def, r.review.rows, { http: sourceHttp, area: context().area, onProgress: (done, of) => setPlacing({ done, of }) }) };
        setPlacing(null);
      }
      setPhase({ kind: "review", ...r, citations: outcome.proposal.citations ?? [] });
      return;
    }
    if (outcome.kind === "answer") {
      setReply("");
      setPhase({ kind: "question", text: outcome.text, transcript: outcome.transcript });
      return;
    }
    const text = outcome.kind === "refused" ? outcome.text : outcome.kind === "failed" ? outcome.reason : t`You stopped it before it finished.`;
    setPhase({ kind: "note", head: t(NOTE_HEAD[outcome.kind]!), text });
  };

  /** Names, links and duplicates are judged here, against this device's records — the model never saw them. */
  const review = async (proposal: Proposal): Promise<{ review: Review; names: Map<string, string> }> => {
    const existing: Record<string, Array<Record<string, unknown>>> = {};
    const names = new Map<string, string>();
    for (const e of entitiesToLoad(def, proposal)) {
      existing[e] = (await runtime.ctx.query(e)) as Array<Record<string, unknown>>;
      const by = def.entities[e]?.displayField;
      for (const r of existing[e]!) if (by && typeof r[by] === "string") names.set(String(r.id), r[by] as string);
    }
    return { review: prepareReview(def, proposal, existing, { area: context().area }), names };
  };

  const context = (): AskContext => ({
    today: localDay(),
    // The person's language (#301): the saved choice, else the device's — shown in the dialog, and Ask replies in it.
    language: currentLocale(),
    // i18n-ignore — told to the model, which reads English (#297)
    ...(area && sendArea ? { area: { ...area, label: "the map on the person's screen" } } : {}),
  });

  const hasMaterial = Boolean(material?.text.trim());
  const ask = (resumeFrom?: ChatMessage[]): void => {
    const text = request.trim() || (hasMaterial ? "Add what's in this." : "");
    if (!text && !resumeFrom) return;
    const controller = new AbortController();
    abort.current = controller;
    setTries(0);
    setReading(null);
    if (!resumeFrom) {
      setFetched([]);
      setLastCost(null);
    }
    setSearchDown(false);
    setPhase({ kind: "working" });
    const labels = new Map(sources.usable.map((s) => [s.ask.id, s.ask.label]));
    const onStep = (s: AskStep): void => {
      if (s.kind === "proposal" && !s.ok) setTries((n) => n + 1);
      if (s.kind === "fetch") setReading(labels.get(s.source) ?? s.source);
      if (s.kind === "search-unavailable") setSearchDown(true);
    };
    const fetchSource = makeSourceFetcher({
      sources: sources.usable,
      keys,
      fetch: sourceHttp,
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
    void startAsk({
      definition: def,
      request: text,
      ...(hasMaterial ? { material: { label: material!.label, text: material!.text } } : {}),
      engine,
      sources: sources.usable.map((s) => s.ask),
      fetchSource,
      context: context(),
      webSearch: web,
      resumeFrom,
      onStep,
      signal: controller.signal,
    }).then((o) => {
      loadSources(); // an origin allowed during the run is remembered from now on
      if (abort.current === controller) void land(o);
    });
  };

  const add = async (rows: ReviewRow[], runs: AcceptedRun[], edits: AcceptedEdit[]): Promise<void> => {
    setPhase({ kind: "saving" });
    let created = 0;
    let changed = 0;
    let stage: "rows" | "edits" | "actions" = "rows";
    try {
      const saved = await applyProposal(runtime, def, rows);
      created = saved.created;
      stage = "edits";
      // After the rows, so a change that links to one of them gets its id.
      changed = await applyEdits(runtime, def, edits, saved.ids, new Set(rows.map((r) => r.ref)));
      stage = "actions";
      // Actions run after the rows exist, through the same path as a button: checked input, the
      // sandbox for a shared app. `core`, not `runtime.runAction`, so a failure reaches this dialog
      // instead of becoming a toast behind it.
      const ran = await runActions(
        { runAction: (entity, action, id, input) => runtime.core.runAction(entity, action, id, input) },
        runs.flatMap((r) => {
          const id = r.target.kind === "new" ? saved.ids.get(r.target.ref) : r.target.id;
          return id ? [{ entity: r.entity, action: r.action, id, input: r.input }] : [];
        }),
      );
      setPhase({ kind: "added", created, ran, changed });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      const partial = e instanceof ApplyError ? e.created : 0;
      const doneRows = stage === "rows" ? partial : created;
      const doneEdits = stage === "edits" ? partial : changed;
      const doneRuns = stage === "actions" ? partial : 0;
      const done = doneRows || doneRuns || doneEdits ? doneText(doneRows, doneRuns, doneEdits).replace(/\.$/, "") : "";
      setPhase({
        kind: "note",
        head: done ? t({ message: `${done}, then it stopped`, comment: "done is e.g. “Added 3 places”" }) : t`Nothing was done`,
        text: done ? t`${why} What was already done is in the app; asking again will mark what is already there.` : why,
      });
    }
  };

  const spentHere = formatSpend(appSpent);
  const lastSpent = lastCost === null ? "" : formatSpend(lastCost);
  const placedNow = placing ? fmt.number(placing.done + 1) : "";
  const placedOf = placing ? fmt.number(placing.of) : "";
  const attempt = fmt.number(tries + 1);
  const sourceLabel = question?.source.ask.label ?? "";
  const host = question ? new URL(question.origin).host : "";

  const turnOff = (): void => {
    setAskEnabled(appId, false);
    close();
  };

  return (
    <div className="k-modal-scrim" onClick={close}>
      <div className="k-modal k-ask" role="dialog" aria-modal="true" aria-label={t({ message: `Ask ${name}`, comment: "The Ask dialog of an app; Ask is the feature's name" })} onClick={(e) => e.stopPropagation()} data-phase={phase.kind}>
        <header className="k-modal-head k-ask-head">
          <div>
            <p className="k-ask-eyebrow">
              <Trans comment="The name of the feature that adds records with AI">Ask</Trans>
            </p>
            <h2 className="k-ask-title">{phase.kind === "review" ? t`Look it over` : t`What should go into ${name}?`}</h2>
          </div>
          <button type="button" className="k-add" onClick={close} aria-label={t`Close`}>
            ✕
          </button>
        </header>

        {phase.kind === "compose" ? (
          <>
            <textarea
              className="k-input k-ask-input"
              aria-label={t`What to add`}
              rows={3}
              autoFocus
              placeholder={t`e.g. five dog-friendly cafés near the river`}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
              }}
            />
            <MaterialField material={material} onChange={setMaterial} />
            {refused ? (
              <p className="k-ask-refused" role="note">
                {refused}
              </p>
            ) : (
              <p className="k-ask-privacy">
                {privacyLine(engineLabel(engine), hasMaterial, Boolean(area && sendArea))}
              </p>
            )}
            {appSpent > 0 ? <p className="k-ask-cost">{t`Ask has used ${spentHere} of your OpenRouter credit in this app, on this device.`}</p> : null}
            <div className="k-ask-context" aria-label={t`Sent with your request`}>
              {area && sendArea ? (
                <span className="k-ask-chip">
                  <span aria-hidden><Glyph icon="map-pin" size={16} /></span> {mapChip(area)}
                  <button type="button" className="k-ask-chip-x" aria-label={t`Don’t send the map area`} onClick={() => setSendArea(false)}>
                    ✕
                  </button>
                </span>
              ) : null}
              <label className="k-ask-chip k-ask-chip-toggle" data-on={web || undefined}>
                <input
                  type="checkbox"
                  checked={web}
                  onChange={(e) => {
                    setWeb(e.target.checked);
                    rememberWeb(e.target.checked);
                  }}
                />
                <span aria-hidden><Glyph icon="search" size={16} /></span> <Trans>Search the web when needed · about 2¢</Trans>
              </label>
            </div>
            <SourcesSection state={sources} keys={keys} onChange={loadSources} />
            <footer className="k-ask-actions">
              <button type="button" className="k-ask-off" onClick={turnOff}>
                <Trans>Turn off Ask for this app</Trans>
              </button>
              <button type="button" className="k-add k-primary-action" disabled={(!request.trim() && !hasMaterial) || Boolean(refused)} onClick={() => ask()}>
                <Trans comment="Button: send the request to Ask">Ask</Trans>
              </button>
            </footer>
          </>
        ) : null}

        {phase.kind === "working" || phase.kind === "saving" ? (
          <div className="k-ask-working" role="status">
            <span className="k-ask-pulse" aria-hidden />
            <p>
              {phase.kind === "saving"
                ? t`Adding`
                : placing
                  ? t`Putting places at their address (${placedNow} of ${placedOf})`
                : tries
                  ? t`Fitting it to ${name}’s fields (try ${attempt})`
                  : reading
                    ? t`Reading ${reading}`
                    : t`Working on it`}
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
                <Trans comment="Ask: stop the request">Stop</Trans>
              </button>
            ) : null}
          </div>
        ) : null}

        {phase.kind === "working" && question ? (
          <div className="k-ask-question" role="alertdialog" aria-label={t`Allow this address?`}>
            <p className="k-ask-note-head">
              {question.sendsKey ? t`Send your ${sourceLabel} key to ${host}?` : t`Let Ask read from ${host}?`}
            </p>
            <p className="k-ask-privacy">
              {question.source.pin === "endpoint" ? t`For ${sourceLabel}, which this app names.` : t`For ${sourceLabel}.`}{" "}
              {question.sendsKey ? t`Only allow an address that belongs to that service.` : t`What you asked for may go there; nothing already in the app does.`}{" "}
              {t`Your answer is remembered for this source.`}
            </p>
            <div className="k-ask-actions">
              <button type="button" className="k-add" onClick={() => question.answer(false)}>
                <Trans>Don’t allow</Trans>
              </button>
              <button type="button" className="k-add k-primary-action" onClick={() => question.answer(true)}>
                <Trans>Allow</Trans>
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "question" ? (
          <div className="k-ask-note k-ask-asks">
            <p className="k-ask-note-head">
              <Trans>It needs to know one thing</Trans>
            </p>
            <p>{phase.text}</p>
            <textarea className="k-input" aria-label={t`Your answer`} rows={2} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} />
            <footer className="k-ask-actions">
              <button type="button" className="k-add" onClick={() => setPhase({ kind: "compose" })}>
                <Trans>Start over</Trans>
              </button>
              <button
                type="button"
                className="k-add k-primary-action"
                disabled={!reply.trim()}
                onClick={() => ask([...phase.transcript, { role: "user", content: reply.trim() }])}
              >
                <Trans comment="Ask: send the answer to its question">Send</Trans>
              </button>
            </footer>
          </div>
        ) : null}

        {phase.kind === "review" ? (
          <>
            {searchDown ? (
              <p className="k-ask-note" role="note">
                <Trans>The web search was unavailable, so this comes from the model’s memory. Check it before you rely on it.</Trans>
              </p>
            ) : null}
            {phase.citations.length ? <Found citations={phase.citations} /> : null}
            <ReviewPanel def={def} review={phase.review} names={phase.names} onAccept={(rows, runs, edits) => void add(rows, runs, edits)} onDiscard={() => setPhase({ kind: "compose" })} />
            {fetched.length ? (
              <details className="k-ask-fetched">
                <summary>
                  {plural(fetched.length, { one: "Read from # address", other: "Read from # addresses" })}
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
            <p className="k-ask-done-count">{doneText(phase.created, phase.ran, phase.changed)}</p>
            <footer className="k-ask-actions">
              <button type="button" className="k-add" onClick={() => setPhase({ kind: "compose" })}>
                <Trans>Ask for more</Trans>
              </button>
              <button type="button" className="k-add k-primary-action" onClick={close}>
                <Trans>Done</Trans>
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
                <Trans>Back</Trans>
              </button>
            </footer>
          </div>
        ) : null}

        {lastCost !== null && phase.kind !== "compose" && phase.kind !== "working" && phase.kind !== "saving" ? (
          <p className="k-ask-cost">{t`This request cost ${lastSpent} of your OpenRouter credit.`}</p>
        ) : null}
      </div>
    </div>
  );
}
