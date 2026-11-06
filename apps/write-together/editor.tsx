// The document, as several people write it at once (docs/04 "Writing together").
//
// The text is a `text` field with `collaborative: true`, so the editor never saves the whole text:
// what changed (diff.ts) goes to `ctx.text(...).edit`, which merges it with everyone else's. The
// loop is a differential sync: `base` is the text the host last confirmed, the edits are the
// difference between it and the screen, counted in it and sent with it, and what comes back —
// everyone's text now — is merged with what was typed meanwhile (merge3) and becomes the next base.
// A change that arrives through `useRecord` while nothing is in flight is taken the same way, and
// the caret stays on its words (mapIndex).
//
// Colours: a transparent textarea sits over a backdrop that draws the same text, each run tinted
// with its writer's colour (`runs()`, from the signing account — nothing the app could claim). While
// the person types, their own keys are tinted at once from the edits (applyEditsToRuns), and the
// store's answer replaces that a moment later.
//
// Comments are records anchored to characters (`anchor`/`index`), so they stay on their words
// through everyone's edits, and read as "the words are gone" once those are deleted.
import type { Resolved, TextRun, ViewProps } from "potyro";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { applyEditsToRuns, diffEdits, fitRuns, freeColor, hashColor, initials, mapIndex, merge3, resolveColors, segments, strokeOf, tintOf, type Placed } from "./diff.js";
import { renderMarkdown } from "./markdown.js";
import { applyMark, markForKey, TOOLS, type Mark } from "./marks.js";
import { SyncLoop } from "./loop.js";
import { CSS } from "./styles.js";
import { W } from "./words.js";

const personId = (v: unknown): string => (typeof v === "string" ? v : String((v as { id?: unknown } | null)?.id ?? ""));
const docIdOf = (c: Resolved): string => personId(c.doc);

/** The text as the store has it, followed as everyone types, with this person's keys sent as edits. */
function useSharedText(props: ViewProps, docId: string, body: string, ready: boolean, me: string) {
  const ctx = props.runtime.ctx; // a fresh ctx per access (docs/05): kept by ref, never as a dependency
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const [text, setText] = useState(body);
  /** The text the host last confirmed: what comment positions and runs were read against. */
  const [confirmed, setConfirmed] = useState(body);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(body);
  const runsAsked = useRef(0);

  /** Put `next` on screen, keeping the caret on the same words. */
  const reconcile = (next: string): void => {
    if (next === textRef.current) return;
    const el = area.current;
    const focused = el && document.activeElement === el;
    const start = focused ? mapIndex(textRef.current, next, el.selectionStart) : null;
    const end = focused ? mapIndex(textRef.current, next, el.selectionEnd) : null;
    textRef.current = next;
    setText(next);
    // Words that arrived from someone else are drawn at once, uncoloured until the next answer names
    // their writer; everything already coloured stays coloured.
    setRuns((r) => fitRuns(r, next, null));
    if (el && focused && start !== null && end !== null) requestAnimationFrame(() => el.setSelectionRange(start, end));
  };

  const askRuns = (): void => {
    const n = ++runsAsked.current;
    void ctxRef.current
      .text("doc", docId, "body")
      .runs()
      .then(
        (r) => {
          // The answer spells the text as the host had it; the screen may be keystrokes ahead by now.
          if (n === runsAsked.current) setRuns(fitRuns(r, textRef.current, me));
        },
        () => undefined,
      );
  };

  // The loop (loop.ts) lives as long as the document is open; everything it calls goes by ref.
  const loop = useMemo(
    () =>
      new SyncLoop(
        {
          edit: async (edits, base) => String((await ctxRef.current.text("doc", docId, "body").edit(edits, { base })).body ?? ""),
          show: (t) => reconcile(t),
          settled: () => {
            setConfirmed(loop.base);
            askRuns();
          },
          failed: (e) => ctxRef.current.ui.toast(ctxRef.current.t(W.couldNotWrite, { reason: e instanceof Error ? e.message : String(e) })),
        },
        "",
      ),
    [docId],
  );

  // The store says the record changed: a cue to ask, through the same path the edits take.
  useEffect(() => {
    if (ready) loop.notified();
  }, [body, ready, loop]);

  const change = (next: string): void => {
    const edits = diffEdits(textRef.current, next);
    textRef.current = next;
    setText(next);
    if (!edits.length) return;
    setRuns((r) => applyEditsToRuns(r, edits, me));
    loop.typed(next);
  };

  return { text, confirmed, runs, area, change, handle: ctx.text("doc", docId, "body") };
}

export function Editor(props: ViewProps) {
  const { runtime, param, navigate } = props;
  const ctx = runtime.ctx;
  const docId = param?.docId ?? "";
  const me = ctx.me.id;
  const { record, loading } = runtime.useRecord("doc", docId);
  const body = typeof record?.body === "string" ? record.body : "";
  const ready = !loading && !!record;
  const { text, confirmed, runs, area, change, handle } = useSharedText(props, docId, body, ready, me);
  const { rows: writers } = runtime.useQuery("writer");
  const commentSpec = useMemo(() => ({ filter: (c: Resolved) => docIdOf(c) === docId, sort: (a: Resolved, b: Resolved) => String(a.createdAt).localeCompare(String(b.createdAt)) }), [docId]);
  const { rows: comments } = runtime.useQuery("comment", commentSpec);

  const [preview, setPreview] = useState(false);
  const [panel, setPanel] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [placed, setPlaced] = useState<Map<string, Placed | null>>(new Map());
  const [composing, setComposing] = useState<{ from: string; to: string; quote: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const backdrop = useRef<HTMLDivElement>(null);
  const claimed = useRef(false);
  const placedAsked = useRef(0);

  // ---- who writes in which colour ----
  const mine = writers.find((w) => personId(w.person) === me);
  useEffect(() => {
    if (!ready || mine || claimed.current || !writers) return;
    claimed.current = true;
    void ctx.create("writer", { person: me, color: freeColor(writers.map((w) => Number(w.color))) }).catch(() => undefined);
  }, [ready, mine, writers.length]);
  const colors = useMemo(() => resolveColors(writers.map((w) => ({ person: personId(w.person), color: Number(w.color) || 0, createdAt: String(w.createdAt) }))), [writers]);
  const colorOf = (by: string | null): number => (by === null ? hashColor("") : (colors.get(by) ?? hashColor(by)));
  const nameOf = (by: string | null): string => {
    if (by === me) return ctx.me.name || ctx.t(W.you);
    const p = ctx.people.find((x) => x.id === by);
    if (p?.name) return p.name;
    const w = writers.find((x) => personId(x.person) === by);
    const named = (w?.person as { name?: string } | null)?.name;
    return named || ctx.t(W.someone);
  };
  const authors = useMemo(() => {
    const seen = new Set<string>([me]);
    for (const r of runs) if (r.by) seen.add(r.by);
    return [...seen];
  }, [runs, me]);
  // Alone, a document is just a document: the colours appear once a second person has written in it.
  const tinted = authors.length > 1;
  const cycleColor = (): void => {
    if (!mine) return;
    void ctx.patch("writer", mine.id, { color: (Number(mine.color) + 1) % 8 }).catch(() => undefined);
  };

  // ---- the title ----
  useEffect(() => {
    if (record && typeof record.title === "string" && document.activeElement?.className !== "wt-title") setTitle(record.title);
  }, [record?.title]);
  const saveTitle = (): void => {
    const t = title.trim() || ctx.t(W.untitled);
    if (record && t !== record.title) void ctx.patch("doc", docId, { title: t }).catch(() => undefined);
  };

  // ---- where each comment is now: read against the confirmed text, after every round ----
  useEffect(() => {
    if (!ready) return;
    const n = ++placedAsked.current;
    const open = comments.filter((c) => typeof c.from === "string" && typeof c.to === "string");
    void Promise.all(
      open.map(async (c) => {
        const [from, to] = await Promise.all([handle.index(String(c.from)), handle.index(String(c.to))]);
        const at = from ?? to;
        if (at === null) return [String(c.id), null] as const;
        return [String(c.id), { id: String(c.id), from: at, to: Math.max(at, to ?? at) }] as const;
      }),
    ).then(
      (pairs) => {
        if (n === placedAsked.current) setPlaced(new Map(pairs));
      },
      () => undefined,
    );
  }, [ready, confirmed, comments]);

  // ---- marks and keys ----
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => {
    const sel = pendingSel.current;
    const el = area.current;
    if (!sel || !el) return;
    pendingSel.current = null;
    el.focus();
    el.setSelectionRange(sel.start, sel.end);
  }, [text]);
  const mark = (m: Mark): void => {
    const el = area.current;
    if (!el) return;
    const next = applyMark({ text, start: el.selectionStart, end: el.selectionEnd }, m);
    pendingSel.current = { start: next.start, end: next.end };
    change(next.text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const what = markForKey(e.key, e.ctrlKey || e.metaKey);
    if (!what) return;
    e.preventDefault();
    if (what === "save") ctx.ui.toast(ctx.t(W.savedAsYouType));
    else mark(what);
  };

  // ---- comments ----
  const startComment = async (): Promise<void> => {
    const el = area.current;
    const start = el ? Math.min(el.selectionStart, el.selectionEnd) : text.length;
    const end = el ? Math.max(el.selectionStart, el.selectionEnd) : text.length;
    const [from, to] = await Promise.all([handle.anchor(start), handle.anchor(end)]);
    setComposing({ from, to, quote: text.slice(start, end) });
    setDraft("");
    setPanel(true);
  };
  const addComment = async (): Promise<void> => {
    if (!composing || !draft.trim()) return;
    await ctx.create("comment", { doc: docId, from: composing.from, to: composing.to, quote: composing.quote.slice(0, 200), text: draft.trim(), done: false });
    setComposing(null);
    setDraft("");
  };
  const goTo = (id: string): void => {
    setCurrent(id);
    const p = placed.get(id);
    const el = area.current;
    if (!p || !el) return;
    setPreview(false);
    el.focus();
    el.setSelectionRange(p.from, p.to);
    const span = backdrop.current?.querySelector<HTMLElement>(`[data-comments~="${id}"]`);
    if (span) el.scrollTop = Math.max(0, span.offsetTop - el.clientHeight / 3);
  };
  const resolve = (c: Resolved, done: boolean): void => void ctx.patch("comment", c.id, { done }).catch(() => undefined);
  const remove = async (c: Resolved): Promise<void> => {
    if (await ctx.ui.confirm(ctx.t(W.removeAsk), { ok: ctx.t(W.remove), destructive: true })) await ctx.delete("comment", c.id);
  };
  const open = comments.filter((c) => !c.done);
  const done = comments.filter((c) => !!c.done);

  // Sharing one document on its own is a platform feature in the making (a record in a group of
  // its own, with its own link). Until it lands, the app's menu shares the whole app, and this
  // screen offers no button that would share more than it says.

  if (loading) return <p className="wt-wait">{ctx.t(W.opening)}</p>;
  if (!record) return <p className="wt-wait">{ctx.t(W.missing)}</p>;

  // Positions were read in the confirmed text; the screen may be a few keystrokes ahead of it.
  const pieces = segments(
    text,
    runs,
    [...placed.values()]
      .filter((p): p is Placed => p !== null && open.some((c) => String(c.id) === p.id))
      .map((p) => ({ id: p.id, from: mapIndex(confirmed, text, p.from), to: mapIndex(confirmed, text, p.to) })),
  );
  const swatch = (by: string, isMe: boolean): ReactNode => {
    const color = colorOf(by);
    const name = nameOf(by);
    return (
      <button
        key={by}
        type="button"
        className={`wt-swatch${isMe ? " wt-me" : ""}`}
        style={{ "--wt-tint": tintOf(color), "--wt-stroke": strokeOf(color) } as React.CSSProperties}
        title={isMe ? ctx.t(W.yourColor) : ctx.t(W.wroteHere, { name })}
        aria-label={isMe ? ctx.t(W.yourColor) : ctx.t(W.wroteHere, { name })}
        onClick={isMe ? cycleColor : undefined}
        data-person={by}
      >
        {initials(name)}
      </button>
    );
  };

  const note = (c: Resolved): ReactNode => {
    const by = personId(c.createdBy ?? "");
    const p = placed.get(String(c.id));
    const gone = p === null;
    return (
      <article key={c.id} className={`wt-note${c.done ? " wt-done" : ""}`} aria-current={current === c.id} style={{ "--wt-stroke": strokeOf(colorOf(by)) } as React.CSSProperties} onClick={() => goTo(String(c.id))} data-testid="comment">
        <div className="wt-note-who">
          <b>{nameOf(by)}</b>
          <time dateTime={String(c.createdAt)}>{ctx.format.relative(new Date(String(c.createdAt)))}</time>
        </div>
        {c.quote ? <div className={`wt-quote${gone ? " wt-gone" : ""}`}>{gone ? ctx.t(W.gone) : `“${String(c.quote)}”`}</div> : null}
        <p>{String(c.text)}</p>
        <div className="wt-note-acts" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => resolve(c, !c.done)}>
            {c.done ? ctx.t(W.reopen) : ctx.t(W.resolve)}
          </button>
          <button type="button" onClick={() => void remove(c)}>
            {ctx.t(W.remove)}
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="wt">
      <style>{CSS}</style>
      <div className="wt-head">
        <div className="wt-row wt-top">
          <button type="button" onClick={() => navigate("docs")} aria-label={ctx.t(W.back)}>
            ‹<span className="wt-wide"> {ctx.t(W.back)}</span>
          </button>
          <input className="wt-title" value={title} placeholder={ctx.t(W.titlePlaceholder)} aria-label={ctx.t(W.titlePlaceholder)} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
          <button type="button" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            {ctx.t(W.preview)}
          </button>
          <button type="button" aria-pressed={panel} onClick={() => setPanel((p) => !p)} aria-label={ctx.t(W.comments)}>
            <span className="wt-wide">{ctx.t(W.comments)}</span>
            <span className="wt-narrow" aria-hidden="true">
              💬
            </span>
            {open.length ? <span className="wt-count">{open.length}</span> : null}
          </button>
        </div>
        <div className="wt-row" role="toolbar" aria-label="Markdown">
          {TOOLS.map((t) => (
            <button key={t.mark} type="button" title={t.title} aria-label={t.title} className={t.mark === "italic" ? "wt-i" : t.mark === "code" ? "wt-code" : undefined} disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(t.mark)}>
              {t.label}
            </button>
          ))}
          <button type="button" disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={() => void startComment()}>
            + {ctx.t(W.comment)}
          </button>
          <span className="wt-gap" />
          <div className="wt-people" aria-label="Writers">
            {authors.map((by) => swatch(by, by === me))}
          </div>
        </div>
      </div>
      <div className="wt-body">
        {preview ? (
          <div className="wt-preview">{text.trim() ? renderMarkdown(text) : <p className="wt-empty">{ctx.t(W.placeholder)}</p>}</div>
        ) : (
          <div className="wt-editor">
            <div className="wt-backdrop" ref={backdrop} aria-hidden="true">
              {pieces.map((s, i) => (
                <span
                  key={i}
                  className={s.comments.length ? `wt-c${s.text === "" ? " wt-point" : ""}` : undefined}
                  style={tinted && s.by ? { background: tintOf(colorOf(s.by)) } : undefined}
                  data-by={s.by ?? undefined}
                  data-comments={s.comments.length ? s.comments.join(" ") : undefined}
                >
                  {s.text}
                </span>
              ))}
              {"\n"}
            </div>
            <textarea
              ref={area}
              className="wt-text"
              value={text}
              placeholder={ctx.t(W.placeholder)}
              aria-label={ctx.t(W.write)}
              spellCheck
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKey}
              onScroll={(e) => {
                if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
              }}
            />
          </div>
        )}
        {panel ? (
          <aside className="wt-panel" aria-label={ctx.t(W.comments)}>
            <div className="wt-panel-head">
              {ctx.t(W.comments)}
              <span className="wt-gap" />
              {done.length ? (
                <button type="button" onClick={() => setShowDone((s) => !s)} aria-pressed={showDone}>
                  {ctx.t(W.resolved, { n: done.length })}
                </button>
              ) : null}
              <button type="button" onClick={() => setPanel(false)} aria-label={ctx.t(W.cancel)}>
                ✕
              </button>
            </div>
            <div className="wt-list">
              {open.length === 0 && !composing ? <p className="wt-empty">{ctx.t(W.noComments)}</p> : null}
              {open.map(note)}
              {showDone ? done.map(note) : null}
            </div>
            {composing ? (
              <div className="wt-compose">
                <div className="wt-quote">{composing.quote ? `${ctx.t(W.commentOn)} “${composing.quote.slice(0, 80)}”` : ctx.t(W.commentHere)}</div>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={ctx.t(W.commentPlaceholder)} aria-label={ctx.t(W.comment)} autoFocus />
                <div className="wt-compose-acts">
                  <button type="button" onClick={() => setComposing(null)}>
                    {ctx.t(W.cancel)}
                  </button>
                  <button type="button" className="wt-primary" disabled={!draft.trim()} onClick={() => void addComment()}>
                    {ctx.t(W.add)}
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
