// Edit mode: change the app's own words where you see them.
//
// With edit mode on, every piece of text on screen that is written literally in the app's source is
// highlighted — tab names, field labels, a custom view's buttons and headings, group titles. Tap
// one and it becomes editable right there; saving splices that literal in the source (no model),
// validates, and records a version, exactly like any other change. Field labels also move and hide,
// and tabs move, from the same spot.
//
// What is NOT highlighted is simply not offered: text an app computes, a record's own data, the
// shell's menus. That is the point — the old edit mode put a ✎ on whole regions and then, for most
// of them, opened a panel with nothing in it but a box to ask the agent. Anything beyond words and
// order belongs to the Studio, and the bar says so.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { humanizeKey } from "@potyro/views";
import { applyEdit, fieldStep, inspect, textSites, type AppShape, type Edit, type TextSite } from "./app-source.js";
import { appRoots, collectTargets, sameThing, type InlineTarget } from "./inline-targets.js";
import { pointFromInline, type PointRef } from "./point-target.js";

export interface InlineEditProps {
  /** The app's source as last saved. Sites are re-read from it after every change. */
  source: string;
  /** Where you are, in words — `the "Recipes" page` — for what the Studio is told. */
  where: string;
  /** Validate and save `next` as a version. Resolves to why it wasn't saved, or null. */
  save: (next: string, note: string) => Promise<string | null>;
  /** After a change the page can't show without re-running the app (a move, hiding a field). */
  rerun: () => void;
  /** `point`: the part the person was changing, so the Studio's next message is about it (#284). */
  askStudio: (prefill: string, point?: PointRef) => void;
  done: () => void;
}

// CSS Custom Highlights: the text is marked without touching the DOM React owns. Not in every
// engine yet (Firefox < 140); there, tapping still works, the marks just don't show.
interface HighlightRegistry {
  set(name: string, h: unknown): void;
  delete(name: string): void;
}
const registry = (): HighlightRegistry | undefined => (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
const HighlightCtor = (): (new (...r: Range[]) => unknown) | undefined =>
  (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

const MARK = "k-editable";
const MARK_ACTIVE = "k-editable-active";
/** Taps a few pixels off a word still count — a label is a small target on a phone. */
const SLACK = 4;

interface Located {
  target: InlineTarget;
  range: Range;
}

function locate(targets: readonly InlineTarget[]): Located[] {
  return targets.map((target) => {
    const range = document.createRange();
    range.selectNodeContents(target.node);
    return { target, range };
  });
}

function hit(located: readonly Located[], x: number, y: number): Located | undefined {
  for (const l of located) {
    for (const r of l.range.getClientRects()) {
      if (x >= r.left - SLACK && x <= r.right + SLACK && y >= r.top - SLACK && y <= r.bottom + SLACK) return l;
    }
  }
  return undefined;
}

/** Put `value` where the text was, keeping the whitespace around it (JSX leaves spaces there). */
function patchText(node: Text, value: string): void {
  const lead = /^\s*/.exec(node.data)![0];
  const trail = /\s*$/.exec(node.data)![0];
  node.data = `${lead}${value}${trail}`;
}

const kindWord = (t: InlineTarget): string => (t.kind === "field" ? "Field name" : t.kind === "page" ? "Page name" : "Text");

export function InlineEdit({ source, where, save, rerun, askStudio, done }: InlineEditProps) {
  const [model, setModel] = useState<{ sites: TextSite[]; shape: AppShape } | null>(null);
  const [located, setLocated] = useState<Located[]>([]);
  const [open, setOpen] = useState<Located | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([textSites(source), inspect(source)]).then(([sites, shape]) => {
      if (live) setModel({ sites, shape });
    });
    return () => {
      live = false;
    };
  }, [source]);

  // Re-pair whenever the page changes under us: navigation, a sheet opening, records loading.
  useEffect(() => {
    if (!model) return;
    let frame = 0;
    const scan = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLocated(locate(collectTargets(appRoots(), model.sites, model.shape))));
    };
    scan();
    const observer = new MutationObserver((records) => {
      // Our own bar and popover change as you type; they are never targets, so they never rescan.
      if (records.every((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest("[data-k-noedit]"))) return;
      scan();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [model]);

  useEffect(() => {
    const reg = registry();
    const Ctor = HighlightCtor();
    if (!reg || !Ctor) return;
    reg.set(MARK, new Ctor(...located.map((l) => l.range)));
    if (open) reg.set(MARK_ACTIVE, new Ctor(...located.filter((l) => sameThing(l.target, open.target)).map((l) => l.range)));
    else reg.delete(MARK_ACTIVE);
    return () => {
      reg.delete(MARK);
      reg.delete(MARK_ACTIVE);
    };
  }, [located, open]);

  // Taps on highlighted text edit it instead of doing what the element does. Captured at the window,
  // before React's own listeners, so a button whose label you are renaming doesn't also fire.
  const locatedRef = useRef(located);
  locatedRef.current = located;
  useEffect(() => {
    const onPointer = (e: PointerEvent | MouseEvent): void => {
      if ((e.target as Element | null)?.closest?.("[data-k-noedit]")) return;
      const found = hit(locatedRef.current, e.clientX, e.clientY);
      if (!found) return;
      e.stopPropagation();
      if (e.type === "click") {
        e.preventDefault();
        setOpen(found);
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("click", onPointer, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("click", onPointer, true);
    };
  }, []);

  const things = useMemo(() => {
    const distinct: InlineTarget[] = [];
    for (const { target } of located) if (!distinct.some((d) => sameThing(d, target))) distinct.push(target);
    return distinct.length;
  }, [located]);

  const patchAll = useCallback(
    (target: InlineTarget, value: string) => {
      for (const l of located) if (sameThing(l.target, target)) patchText(l.target.node, value);
    },
    [located],
  );

  return (
    <div data-k-noedit>
      <div className="k-inline-bar" role="status">
        <span className="k-inline-bar-mark" aria-hidden>
          ✎
        </span>
        <span className="k-inline-bar-text">
          {!model
            ? "Reading this app…"
            : model.shape.blocked
              ? "This app isn't written in a way that can be changed in place."
              : things
                ? "Tap highlighted text to change it."
                : "Nothing on this screen is written as plain text in the app."}
        </span>
        <button type="button" className="k-inline-bar-btn" onClick={() => askStudio(`On ${where}: `)}>
          Ask the Studio
        </button>
        <button type="button" className="k-inline-bar-btn k-inline-bar-done" onClick={done}>
          Done
        </button>
      </div>
      {open && model ? (
        <Popover
          key={`${open.target.kind}:${open.target.text}`}
          at={open}
          source={source}
          shape={model.shape}
          save={save}
          rerun={rerun}
          patch={patchAll}
          close={() => setOpen(null)}
          ask={(text) => {
            setOpen(null);
            // What the label belongs to goes as a point — the Studio says it on its box, the model
            // reads it with the lines that declare it. Without one, the words carry it as before.
            const point = pointFromInline(open.target);
            askStudio(point ? "" : `On ${where}, about "${text}": `, point ?? undefined);
          }}
        />
      ) : null}
    </div>
  );
}

interface PopoverProps {
  at: Located;
  source: string;
  shape: AppShape;
  save: InlineEditProps["save"];
  rerun: () => void;
  patch: (target: InlineTarget, value: string) => void;
  close: () => void;
  ask: (text: string) => void;
}

function Popover({ at, source, shape, save, rerun, patch, close, ask }: PopoverProps) {
  const { target } = at;
  const initial = target.kind === "field" ? target.field.label ?? "" : target.text;
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The checkbox reflects the SOURCE, which only changes once the save lands and the app re-runs.
  // Held here meanwhile, or ticking it visibly snaps back and reads as a control that doesn't work.
  const [hidden, setHidden] = useState(target.kind === "field" && target.field.hidden);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Under the text, or over it when there's no room below; always inside the screen.
  const place = useCallback(() => {
    const box = at.range.getBoundingClientRect();
    const el = ref.current;
    if (!el) return;
    const gutter = 16;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const below = box.bottom + 8;
    const top = below + h <= innerHeight - gutter ? below : Math.max(gutter, box.top - 8 - h);
    const left = Math.min(Math.max(gutter, box.left), Math.max(gutter, innerWidth - w - gutter));
    setPos({ top, left });
  }, [at]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    return () => {
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
    };
  }, [place]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !busy) close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [busy, close]);

  /** Apply an edit to the source and save it. Resolves to whether it was saved. */
  const run = async (edit: Edit): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const result = await applyEdit(source, edit);
    const problem = result.ok ? await save(result.source, result.note) : result.reason;
    setBusy(false);
    if (problem) setError(problem);
    return !problem;
  };

  const rename = async (): Promise<void> => {
    const next = value.trim();
    if (next === initial.trim()) return close();
    const edit: Edit =
      target.kind === "text"
        ? { kind: "text", from: target.text, sites: target.sites, value: next }
        : target.kind === "field"
          ? { kind: "field-label", entity: target.entity.key, field: target.field.key, value: next }
          : { kind: "page-title", page: target.page.id, value: next };
    if (!(await run(edit))) return;
    // Shown at once, in every place it appears; the rest of the app catches up when edit mode ends.
    patch(target, next || (target.kind === "field" ? humanizeKey(target.field.key) : next));
    close();
  };

  /** Resolves to whether it was saved; the app then re-runs to show it. */
  const structural = async (edit: Edit | null): Promise<boolean> => {
    if (!edit || !(await run(edit))) return false;
    rerun();
    return true;
  };

  // Moves: a field one step through the form's order, a tab one place along the tab bar.
  const tabs = shape.pages.filter((p) => !p.hidden && p.viewType !== "detail");
  const pageMove = (dir: -1 | 1): Edit | null => {
    if (target.kind !== "page") return null;
    const i = tabs.findIndex((p) => p.id === target.page.id);
    const other = i < 0 ? undefined : tabs[i + dir];
    if (!other) return null;
    const order = shape.pages.map((p) => (p.id === target.page.id ? other.id : p.id === other.id ? target.page.id : p.id));
    return { kind: "page-order", order };
  };
  const earlier = target.kind === "field" ? fieldStep(target.entity, target.field.key, -1) : pageMove(-1);
  const later = target.kind === "field" ? fieldStep(target.entity, target.field.key, 1) : pageMove(1);
  const canMove = target.kind === "field" || (target.kind === "page" && tabs.some((p) => p.id === target.page.id));
  const repeats = target.kind === "text" ? target.sites.length : 1;

  return (
    <div
      ref={ref}
      className="k-inline-pop"
      role="dialog"
      aria-label={`Change ${kindWord(target).toLowerCase()}`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void rename();
        }}
      >
        <label className="k-inline-pop-label">
          <span>{kindWord(target)}</span>
          <input
            className="k-input"
            value={value}
            autoFocus
            disabled={busy}
            placeholder={target.kind === "field" ? humanizeKey(target.field.key) : undefined}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {repeats > 1 ? <p className="k-inline-pop-note">This text is written {repeats} times in the app — all of them change.</p> : null}
        {target.kind === "field" && !target.field.label ? <p className="k-inline-pop-note">Leave it empty to keep the default.</p> : null}

        {canMove ? (
          <div className="k-inline-pop-moves">
            <button type="button" className="k-inline-pop-move" disabled={busy || !earlier} onClick={() => void structural(earlier)}>
              {target.kind === "page" ? "← Earlier" : "↑ Earlier"}
            </button>
            <button type="button" className="k-inline-pop-move" disabled={busy || !later} onClick={() => void structural(later)}>
              {target.kind === "page" ? "Later →" : "↓ Later"}
            </button>
            {target.kind === "field" ? (
              <label className="k-inline-pop-hide">
                <input
                  type="checkbox"
                  checked={hidden}
                  disabled={busy}
                  onChange={(e) => {
                    const value = e.target.checked;
                    setHidden(value);
                    void structural({ kind: "field-hidden", entity: target.entity.key, field: target.field.key, value }).then((saved) => {
                      if (!saved) setHidden(!value);
                    });
                  }}
                />
                Hide from the form
              </label>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="k-form-error">{error}</p> : null}
        <div className="k-inline-pop-actions">
          <button type="button" className="k-inline-pop-ask" onClick={() => ask(target.text)}>
            More changes…
          </button>
          <button type="button" className="k-add" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="k-add k-primary-action" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
