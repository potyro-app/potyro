// `ctx.ui.sheet`, `menu`, `form` and `progress` (#112): the structured questions an action can ask.
//
// Shape mirrors `PickerHost` and `DialogHost`: a small store the bridge pushes requests to and the App
// renders. Each call returns a promise that settles on an answer or a dismissal, so app code keeps
// awaiting a value and never learns there is a React tree involved.
//
// A menu hangs under the button that ran the action. App code has no element to point at — it only
// has `ctx` — so the host remembers the last control a person pressed and anchors to that, if it is
// still on the page. Without one (a keyboard shortcut, a timer) the menu is a centred panel.

import { useSyncExternalStore } from "react";
import type { Field, UiItem, UiProgress } from "potyro";
import type { PotyroRuntime } from "@potyro/runtime";
import { ChoicePanel, ValuesForm } from "@potyro/views";

type Choice = { kind: "sheet" | "menu"; title?: string; items: UiItem<unknown>[]; anchor: DOMRect | null; settle: (v: unknown) => void };
type FormAsk = { kind: "form"; title: string; fields: Record<string, Field>; initial?: Record<string, unknown>; submit?: string; settle: (v: Record<string, unknown> | null) => void };
export type UiRequest = Choice | FormAsk;
export interface ProgressBar {
  id: number;
  label: string;
  fraction: number;
  detail?: string;
}

/** How long a press still counts as "the button that ran this action". */
const PRESS_MS = 4000;

// One listener per document, however many hosts there are (the Studio makes one per preview build).
let pressed: { el: Element; at: number } | null = null;
let listening = false;
function listenForPresses(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  const press = (target: EventTarget | null): void => {
    const el = target instanceof Element ? target.closest("button, [role=button], a") : null;
    if (el) pressed = { el, at: Date.now() };
  };
  document.addEventListener("pointerdown", (e) => press(e.target), true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") press(e.target);
  }, true);
}

/** The control a person pressed a moment ago, if it is still on the page. */
function pressedRect(): DOMRect | null {
  const p = pressed;
  if (!p || Date.now() - p.at > PRESS_MS || !p.el.isConnected) return null;
  const r = p.el.getBoundingClientRect();
  return r.width || r.height ? r : null;
}

export class UiHost {
  private current: UiRequest | null = null;
  private bars: ProgressBar[] = [];
  private listeners = new Set<() => void>();
  private seq = 0;

  constructor() {
    listenForPresses();
  }

  private ask(req: UiRequest): void {
    // A second question while one is open would strand the first: it is answered as dismissed.
    this.current?.settle(null as never);
    this.current = req;
    this.emit();
  }

  private settleWith<T>(resolve: (v: T) => void) {
    return (v: T): void => {
      this.current = null;
      this.emit();
      resolve(v);
    };
  }

  sheet = <T,>(opts: { title?: string; items: UiItem<T>[] }): Promise<T | null> =>
    new Promise((resolve) => this.ask({ kind: "sheet", title: opts.title, items: opts.items, anchor: null, settle: this.settleWith(resolve as (v: unknown) => void) }));

  menu = <T,>(opts: { title?: string; items: UiItem<T>[] }): Promise<T | null> =>
    new Promise((resolve) => this.ask({ kind: "menu", title: opts.title, items: opts.items, anchor: pressedRect(), settle: this.settleWith(resolve as (v: unknown) => void) }));

  form = (opts: { title: string; fields: Record<string, Field>; initial?: Record<string, unknown>; submit?: string }): Promise<Record<string, unknown> | null> =>
    new Promise((resolve) => this.ask({ kind: "form", ...opts, settle: this.settleWith(resolve) }));

  progress = (label: string): UiProgress => {
    const bar: ProgressBar = { id: ++this.seq, label, fraction: 0 };
    this.bars = [...this.bars, bar];
    this.emit();
    const replace = (next: ProgressBar | null): void => {
      this.bars = this.bars.flatMap((b) => (b.id !== bar.id ? [b] : next ? [next] : []));
      this.emit();
    };
    let latest = bar;
    return {
      update: (fraction, detail) => {
        if (!this.bars.some((b) => b.id === bar.id)) return;
        latest = { ...latest, fraction: Math.max(0, Math.min(1, Number(fraction) || 0)), detail };
        replace(latest);
      },
      done: () => replace(null),
    };
  };

  get = (): UiRequest | null => this.current;
  getBars = (): ProgressBar[] => this.bars;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

/** The questions and progress bars, rendered. Mounted inside the App, which has the runtime a form's relation pickers need. */
export function UiSurfaces({ host, runtime }: { host: UiHost; runtime: PotyroRuntime }) {
  const request = useSyncExternalStore(host.subscribe, host.get, host.get);
  const bars = useSyncExternalStore(host.subscribe, host.getBars, host.getBars);

  let panel = null;
  if (request?.kind === "form") {
    panel = (
      <ValuesForm
        key={request.title}
        runtime={runtime}
        title={request.title}
        fields={request.fields}
        initial={request.initial}
        submit={request.submit}
        onSubmit={(v) => request.settle(v)}
        onCancel={() => request.settle(null)}
      />
    );
  } else if (request) {
    // Items are keyed by position: an id may be any value an app chose, not only a string.
    panel = (
      <ChoicePanel
        title={request.title}
        items={request.items.map((it, i) => ({ key: String(i), label: it.label, detail: it.detail, icon: it.icon, destructive: it.destructive }))}
        anchor={request.kind === "menu" ? request.anchor : null}
        onChoose={(key) => request.settle(request.items[Number(key)]!.id)}
        onDismiss={() => request.settle(null)}
      />
    );
  }

  return (
    <>
      {panel}
      {bars.length ? (
        <div className="k-progress-stack">
          {bars.map((b) => (
            <div key={b.id} className="k-progress" role="status">
              <div className="k-progress-row">
                <span>{b.label}</span>
                <span>{b.detail ?? `${Math.round(b.fraction * 100)}%`}</span>
              </div>
              <div className="k-progress-bar" role="progressbar" aria-label={b.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.fraction * 100)}>
                <i style={{ width: `${b.fraction * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
