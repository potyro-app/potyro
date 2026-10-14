// A page's layout (#105): several views on one page, each rendered by the ordinary view registry
// under a page ref of its own (`today#1`), so filters, bindings and queries work per item and every
// item renders for an untrusted app exactly as a lone view does.
//
//   stack — a column; a `collapsible` item folds behind its title, remembered per device.
//   grid  — bento columns by `span`: three on a wide page, two on a tablet, one on a phone.
//   split — a list on the left whose rows fill the detail on the right (its `param` is set from
//           the row's `onOpen` param) instead of navigating; on a narrow page the rows navigate.
//   tabs  — one item at a time, chosen by a segmented control from the items' titles.
//
// `ctx.params` are the page's, shared by every item, so one chip row can drive two views and the
// split's selection is just a param.

import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Localized, PageLayout, View } from "potyro";
import type { ShownLayoutItem as LayoutItem } from "./shown.js";
import { layoutItemId } from "potyro";
import type { BuiltinViewProps } from "./types.js";
import { ViewHost } from "./host.js";

export interface LayoutHostProps extends BuiltinViewProps {
  layout: Localized<PageLayout>;
  registry?: Partial<Record<View["type"], ComponentType<BuiltinViewProps>>>;
}

const WIDE_FROM = 760;

/** Is the page wide enough for a split to show both panes? Measured on the page, not the window. */
function useWide(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [wide, setWide] = useState<boolean>(() => (typeof window === "undefined" ? true : window.innerWidth >= WIDE_FROM));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return;
    // A width of 0 is "not laid out yet" (a hidden tab, a test DOM), not "narrow": keep the last answer.
    const read = (): void => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWide(w >= WIDE_FROM);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return wide;
}

const foldKey = (appId: string, pageId: string, index: number): string => `potyro:layout:${appId}:${pageId}:${index}`;

function readFold(key: string): boolean | null {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return v === null || v === undefined ? null : v === "open";
  } catch {
    return null;
  }
}

export function LayoutHost(props: LayoutHostProps) {
  const { runtime, pageId, params, navigate, layout, registry } = props;
  const ref = useRef<HTMLDivElement>(null);
  const wide = useWide(ref);
  const [tab, setTab] = useState(0);

  const item = (_it: LayoutItem, i: number, extra: Partial<BuiltinViewProps> = {}): ReactNode => (
    <ViewHost {...props} {...extra} pageId={layoutItemId(pageId, i)} registry={registry} />
  );
  const titled = (it: LayoutItem, i: number, body: ReactNode, span?: number): ReactNode => (
    <section key={i} className="k-layout-item" data-span={span} aria-label={it.title || undefined}>
      {it.title ? <h3 className="k-layout-title" data-k-wording>{it.title}</h3> : null}
      {body}
    </section>
  );

  if (layout.type === "split") {
    const [left, right] = layout.items as [LayoutItem, LayoutItem];
    const rightView = right.view as { param?: string };
    const param = rightView.param ?? "id";
    const selected = params[param];
    // On a wide page a row fills the right pane: its `onOpen` params become THIS page's params —
    // through `navigate`, to this same page, so the case recorder sees the step like any other
    // navigation — and the detail reads its own param from there. Narrow, the row navigates where
    // the app said.
    const fill = (page: string, p?: Record<string, string>): void => {
      if (!wide) return navigate(page, p);
      const next = { ...(p ?? {}) };
      if (p && !(param in p)) next[param] = Object.values(p)[0] ?? "";
      navigate(pageId, next);
    };
    return (
      <div ref={ref} className="k-layout k-layout-split" data-wide={wide || undefined}>
        {titled(left, 0, item(left, 0, { navigate: fill }))}
        {wide
          ? titled(
              right,
              1,
              selected ? item(right, 1) : <p className="k-layout-empty">Choose one on the left.</p>,
            )
          : null}
      </div>
    );
  }

  if (layout.type === "tabs") {
    const current = layout.items[Math.min(tab, layout.items.length - 1)]!;
    return (
      <div ref={ref} className="k-layout k-layout-tabs">
        <div className="k-segments" role="tablist" aria-label="Sections">
          {layout.items.map((it, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === tab} className="k-segment" onClick={() => setTab(i)}>
              {it.title ?? `Tab ${i + 1}`}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="k-layout-panel">
          {item(current, layout.items.indexOf(current))}
        </div>
      </div>
    );
  }

  if (layout.type === "stack") {
    return (
      <div ref={ref} className="k-layout k-layout-stack">
        {layout.items.map((it, i) =>
          it.collapsible ? (
            <Fold key={i} appId={runtime.definition.id} pageId={pageId} index={i} title={it.title ?? `Section ${i + 1}`}>
              {item(it, i)}
            </Fold>
          ) : (
            titled(it, i, item(it, i))
          ),
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="k-layout k-layout-grid">
      {layout.items.map((it, i) => titled(it, i, item(it, i), it.span ?? 1))}
    </div>
  );
}

/** A stack item that folds behind its title; whether it is open is remembered on this device. */
function Fold({ appId, pageId, index, title, children }: { appId: string; pageId: string; index: number; title: string; children: ReactNode }) {
  const key = foldKey(appId, pageId, index);
  const [open, setOpen] = useState<boolean>(() => readFold(key) ?? true);
  return (
    <details
      className="k-layout-item k-layout-fold"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        try {
          globalThis.localStorage?.setItem(key, next ? "open" : "closed");
        } catch {
          /* a browser that blocks storage forgets the fold; nothing else is lost */
        }
      }}
    >
      <summary className="k-layout-title" data-k-wording>{title}</summary>
      {children}
    </details>
  );
}
