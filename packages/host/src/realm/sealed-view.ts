// A sealed app's custom view, on screen (#267, docs/22 §11): its own sandboxed frame in the place the
// shell gave it, its ops answered through the app's mediated ctx (realm-host.ts `answer`, the same
// table its logic uses), and a watchdog and a crash-loop guard around it.
//
// The shell owns the chrome, the navigation and the page; the frame fills the view's place, as wide
// as it is and at least as tall as the room below it, and taller when the view's document is (the
// page then scrolls, the frame never does). The page's theme crosses as custom properties.

import type { Ctx, ViewProps } from "potyro";
import type { SealedView, SealedViewEvents } from "../types.js";
import { SocketBridge } from "../socket-bridge.js";
import type { Channel } from "./channel.js";
import { spawnViewFrame, type ViewFrameHandle } from "./frame.js";
import type { CtxBase, Op, ViewOp, ViewToHost } from "./protocol.js";
import { ViewGuard } from "./view-guard.js";
import { VIEW_CHECK_MS, VIEW_PING_MS, ViewWatchdog, type ViewVerdict, type ViewWatchdogOptions } from "./view-watchdog.js";

/** The least room a view gets, and the most a view's document may ask for. */
export const VIEW_MIN_HEIGHT = 320;
export const VIEW_MAX_HEIGHT = 20_000;
/** Watched queries a view may hold at once. */
const MAX_WATCHES = 256;
/** Messages a view may send between two checks (100 ms): more is a loop posting, stopped like a silent one. */
const MAX_BURST = 4000;

export interface SealedViewDeps {
  /** Which app, for the guard: the shell's id for it. */
  appKey: string;
  pageRef: string;
  /** The frame's accessible name. */
  title: string;
  guard: ViewGuard;
  /** The view bundle, built once per app when its first view mounts. */
  viewCode(): Promise<string>;
  /** The bundled view runtime. */
  runtimeSource(): Promise<string>;
  /** A ctx id for this view, unique in its app. */
  newCtxId(): number;
  /** The plain-data half of a ctx, as the logic gets it. */
  baseOf(ctx: Ctx, ctxId: number): CtxBase;
  /** Answer one op through the app's op table (realm-host.ts). */
  answer(m: Extract<ViewToHost, { t: "op" }>, ch: Channel): void;
  /** The watchdog stopped the view: `kind` says how it knew (realm-host.ts escalates on "silent"). */
  stopped?(kind: Extract<ViewVerdict, { stop: true }>["kind"], reason: string): void;
  watchdog?: ViewWatchdogOptions;
  now?: () => number;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The theme where the view sits: every custom property, the colour scheme, the font and the ink. */
export function readTokens(el: Element): Record<string, string> {
  const win = el.ownerDocument.defaultView!;
  const cs = win.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i]!;
    if (name.startsWith("--")) out[name] = cs.getPropertyValue(name).trim();
  }
  if (!Object.keys(out).length) {
    // An engine that does not list custom properties in a computed style: the names the page's own
    // stylesheets declare, read through the computed style all the same (so they are this element's).
    for (const sheet of Array.from(el.ownerDocument.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        const style = (rule as CSSStyleRule).style;
        if (!style) continue;
        for (let i = 0; i < style.length; i++) {
          const name = style[i]!;
          if (name.startsWith("--") && !(name in out)) out[name] = cs.getPropertyValue(name).trim();
        }
      }
    }
  }
  out["color-scheme"] = cs.colorScheme || "normal";
  out["font-family"] = cs.fontFamily;
  out.color = cs.color;
  return out;
}

/** The definition as data: what a view reads of it (labels, fields); functions stay with the app. */
function definitionJson(def: unknown): string {
  try {
    return JSON.stringify(def, (_k, v: unknown) => (typeof v === "function" ? undefined : v)) ?? "{}";
  } catch {
    return "{}";
  }
}

export class SealedViewController implements SealedView {
  constructor(private readonly d: SealedViewDeps) {}

  state(): "ready" | "off" {
    return this.d.guard.isOff(this.d.appKey) ? "off" : "ready";
  }

  retry(): void {
    this.d.guard.retry(this.d.appKey);
  }

  mount(el: HTMLElement, props: ViewProps, events: SealedViewEvents, label?: string): () => void {
    const d = this.d;
    const doc = el.ownerDocument;
    const win = doc.defaultView!;
    const now = d.now ?? (() => performance.now());
    // Before any of the view's code exists anywhere: if this tab does not come back, the next start knows.
    const mark = d.guard.mounting(d.appKey, d.pageRef);
    // Made when the frame exists: the time bundling the view takes is the shell's, not the view's.
    let dog: ViewWatchdog | null = null;
    const healthy = (): boolean => dog?.healthy() ?? true;
    const viewCtxId = d.newCtxId();
    const watches = new Map<number, () => void>();
    const pinnedBy = new Map<number, number>();
    let frame: ViewFrameHandle | null = null;
    let over = false;
    let burst = 0;
    let wanted = 0;
    const timers: Array<ReturnType<typeof setInterval>> = [];
    const offs: Array<() => void> = [];

    const post = (m: unknown): void => {
      if (!frame || over) return;
      frame.port.postMessage(m);
    };
    const sockets = new SocketBridge(
      (ev) => {
        if (!frame || over) return true;
        frame.port.postMessage({ t: "sock", ev });
        return ev.kind !== "message";
      },
      (sid) => pinnedBy.delete(sid),
    );

    const end = (): void => {
      over = true;
      for (const t of timers.splice(0)) clearInterval(t);
      for (const off of offs.splice(0)) off();
      for (const unwatch of watches.values()) unwatch();
      watches.clear();
      sockets.endAll("left", "the screen was closed");
      frame?.kill();
      frame = null;
      // The place is the shell's again: the height this view asked for goes with it.
      el.style.height = "";
    };
    const stop = (kind: Extract<ViewVerdict, { stop: true }>["kind"], reason: string): void => {
      if (over) return;
      end();
      d.guard.turnOff(d.appKey, d.pageRef, reason);
      mark.done();
      console.warn(`[potyro] a sealed app's screen was stopped (${d.appKey}, ${d.pageRef}): ${reason}`);
      events.onStopped({ reason });
      d.stopped?.(kind, reason);
    };
    const fail = (why: string): void => {
      if (over) return;
      end();
      mark.done();
      events.onFailed?.(why);
    };

    // ---- size: as wide as its place, at least the room below it, taller if its document is ----
    const room = (): number => {
      const top = el.getBoundingClientRect().top + win.scrollY;
      const bottom = parseFloat(win.getComputedStyle(el).getPropertyValue("--k-chrome-bottom")) || 0;
      return Math.max(VIEW_MIN_HEIGHT, Math.floor(win.innerHeight - top - bottom));
    };
    const size = (): void => {
      el.style.height = `${Math.min(VIEW_MAX_HEIGHT, Math.max(room(), wanted))}px`;
    };
    size();
    win.addEventListener("resize", size);
    offs.push(() => win.removeEventListener("resize", size));

    // ---- the theme, again whenever it changes ----
    const retheme = (): void => post({ t: "tokens", tokens: readTokens(el) });
    const dark = win.matchMedia?.("(prefers-color-scheme: dark)");
    dark?.addEventListener?.("change", retheme);
    offs.push(() => dark?.removeEventListener?.("change", retheme));
    const themed = new MutationObserver(retheme);
    themed.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    const app = el.closest(".k-app");
    if (app) themed.observe(app, { attributes: true, attributeFilter: ["style", "class"] });
    offs.push(() => themed.disconnect());

    // ---- page visibility: a tab put away healthy is not a crash ----
    const onVisibility = (): void => {
      if (doc.hidden) {
        if (healthy()) mark.pause();
      } else mark.resume();
    };
    doc.addEventListener("visibilitychange", onVisibility);
    offs.push(() => doc.removeEventListener("visibilitychange", onVisibility));
    // Leaving the page with the view stuck keeps the marker: the next start then opens the plain version.
    const onPageHide = (): void => {
      if (healthy()) mark.done();
    };
    win.addEventListener("pagehide", onPageHide);
    offs.push(() => win.removeEventListener("pagehide", onPageHide));

    const viewOp = async (op: ViewOp, a: unknown[]): Promise<unknown> => {
      const s = (i: number) => String(a[i]);
      switch (op) {
        case "runtime.watchQuery":
        case "runtime.watchRecord": {
          const wid = Number(a[0]);
          if (!Number.isInteger(wid) || watches.has(wid)) throw new Error("bad watch id");
          if (watches.size >= MAX_WATCHES) throw new Error(`a screen may watch at most ${MAX_WATCHES} queries at once`);
          const send = (state: unknown): void => {
            if (!watches.has(wid)) return;
            try {
              post({ t: "watch", wid, state });
            } catch (e) {
              post({ t: "watch", wid, state: { rows: [], record: null, loading: false, error: `the rows cannot be sent into the app: ${message(e)}` } });
            }
          };
          // Registered before subscribing: a watcher that answers at once must find itself.
          watches.set(wid, () => {});
          const unwatch = op === "runtime.watchQuery" ? props.runtime.watchQuery(s(1), undefined, send) : props.runtime.watchRecord(s(1), s(2), send);
          if (over) unwatch();
          else watches.set(wid, unwatch);
          return null;
        }
        case "runtime.unwatch": {
          const wid = Number(a[0]);
          watches.get(wid)?.();
          watches.delete(wid);
          return null;
        }
        case "runtime.runAction":
          return props.runtime.runAction(s(0), s(1), s(2), a[3]);
        case "runtime.reconcileReminders":
          return props.runtime.reconcileReminders();
        case "view.navigate": {
          const params = a[1] && typeof a[1] === "object" ? Object.fromEntries(Object.entries(a[1] as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : undefined;
          props.navigate(s(0), params);
          return null;
        }
      }
    };
    // The shell's `blob:` URLs do not load in the view's origin: the bytes cross, the frame makes its own.
    const adapt = async (op: Op, value: unknown): Promise<unknown> => {
      if ((op === "media.url" || op === "files.url") && typeof value === "string" && /^(blob|data):/.test(value)) {
        return await (await fetch(value)).blob();
      }
      return value;
    };

    const channel: Channel = {
      post,
      alive: () => !over && frame !== null,
      // The view's ctx id names a fresh ctx per op, as `runtime.ctx` is fresh per access for a trusted
      // view; nothing else is nameable from this port.
      ctx: (id) => (id === viewCtxId ? props.runtime.ctx : undefined),
      sockets,
      pinnedBy,
      progress: `v${viewCtxId}:`,
      viewOp,
      adapt,
    };

    const onMessage = (m: ViewToHost): void => {
      if (over || !m || typeof m !== "object") return;
      if (++burst > MAX_BURST) return stop("silent", `its screen sent more than ${MAX_BURST} messages in ${VIEW_CHECK_MS} ms`);
      switch (m.t) {
        case "pong":
          dog?.pong(Number(m.n));
          mark.alive();
          return;
        case "mounted":
          dog?.mounted();
          events.onMounted?.();
          return;
        case "failed":
          return fail(String(m.error).slice(0, 500));
        case "height":
          wanted = Math.max(0, Math.min(VIEW_MAX_HEIGHT, Number(m.px) || 0));
          return size();
        case "op":
          return d.answer(m, channel);
        case "sockack":
          return sockets.ack(Number(m.sid), Number(m.n), Number(m.bytes));
      }
    };

    void (async () => {
      const [code, runtimeSource] = await Promise.all([d.viewCode(), d.runtimeSource()]);
      if (over) return;
      const ctx = props.runtime.ctx;
      const language = props.runtime.language;
      const spawned = await spawnViewFrame({
        el,
        runtimeSource,
        title: label ?? d.title,
        init: {
          code,
          pageRef: d.pageRef,
          base: d.baseOf(ctx, viewCtxId),
          definition: definitionJson(props.runtime.definition),
          language: { current: language?.current, default: language?.default, available: [...(language?.available ?? [])] },
          entity: props.entity,
          param: { ...(props.param ?? {}) },
          tokens: readTokens(el),
        },
        onLost: (why) => stop("silent", why),
      });
      if (over) return spawned.kill();
      frame = spawned;
      const watchdog = new ViewWatchdog(now, d.watchdog);
      dog = watchdog;
      frame.port.onmessage = (e: MessageEvent) => onMessage(e.data as ViewToHost);
      timers.push(
        setInterval(() => {
          burst = 0;
          const verdict = watchdog.check(!doc.hidden);
          if (verdict.stop) stop(verdict.kind, verdict.reason);
        }, VIEW_CHECK_MS),
        setInterval(() => {
          if (!doc.hidden) post({ t: "ping", n: watchdog.ping() });
        }, VIEW_PING_MS),
      );
    })().catch((e: unknown) => fail(message(e)));

    return () => {
      if (over) return;
      end();
      mark.done();
    };
  }
}
