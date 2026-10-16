// Keeping one live connection open for as long as the person wants it (docs/28 §5): open it, say
// hello, hand every text message on, and when it ends work out whether and when to try again.
//
//   - dropped or closed by the server → try again after 1 s, 2 s, 4 s … at most 30 s apart;
//   - Potyro was in the background (`"hidden"`) → try every few seconds: nothing opens while Potyro
//     is hidden (the try is refused with `"hidden"` at once, at no cost), so the first try after the
//     person comes back is the one that opens;
//   - the person left the app, the box was stopped, or they said Not now → stop, and say so;
//   - unreachable or offline → say so in plain words and keep trying, more slowly each time.
//
// The same file sits in each of the live hero apps (earthquakes, word-watch, ticker) so that each
// stays one folder that can move on its own. It knows nothing about any service: `hello` and
// `onText` are the app's.

import type { Ctx, Socket } from "potyro";

/** What the person is told about the feed. */
export type LiveState =
  | "off" // not started, or stopped
  | "connecting"
  | "live"
  | "retrying" // dropped; trying again
  | "paused" // Potyro was in the background; picks up when the person is back
  | "offline" // this device has no connection
  | "unreachable" // the service does not answer
  | "denied" // the person said Not now
  | "blocked"; // this copy of the app may not reach the service (a sealed app without the host)

export interface LiveOptions {
  /** The address; a function is asked again on every try (to move to another server of the service). */
  url: string | (() => string);
  /** Messages the server must hear after every (re)connect: subscriptions. */
  hello?: (ctx: Ctx) => string[];
  onText: (text: string, ctx: Ctx) => void;
  /** Every change of state, for the status line. `retryInMs` when a retry is waiting. */
  onState?: (state: LiveState, ctx: Ctx, retryInMs?: number) => void;
}

export const FIRST_WAIT_MS = 1000;
export const MAX_WAIT_MS = 30_000;
/** How often to try again while Potyro is in the background. */
export const HIDDEN_RETRY_MS = 3000;

type Timer = (fn: () => void, ms: number) => unknown;
type Clear = (t: unknown) => void;

export interface Live {
  readonly state: LiveState;
  /** Open it (again), unless it is open or opening. */
  start(ctx: Ctx): void;
  /** Close it and stop trying. */
  stop(): void;
  /** Send on the open connection (a new subscription); false when there is none. */
  send(text: string): Promise<boolean>;
}

const codeOf = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? "");

/**
 * `timers` is for tests; the app uses the global ones. Where there are none (the QuickJS fallback has
 * no timers), a dropped connection is not retried by itself: the status says so and the person starts
 * it again.
 */
export function createLive(o: LiveOptions, timers?: { set: Timer | null; clear: Clear }): Live {
  const set: Timer | undefined = timers ? (timers.set ?? undefined) : typeof setTimeout === "function" ? (fn, ms) => setTimeout(fn, ms) : undefined;
  const clear: Clear = timers?.clear ?? ((t) => (typeof clearTimeout === "function" ? clearTimeout(t as ReturnType<typeof setTimeout>) : undefined));
  let state: LiveState = "off";
  let sock: Socket | null = null;
  let wanted = false;
  /** The round an open is on its way for, or null: one open at a time per round. */
  let opening: number | null = null;
  let wait = FIRST_WAIT_MS;
  let timer: unknown = null;
  /** Bumped by stop(): an open that finishes after it is closed at once. */
  let round = 0;

  const say = (next: LiveState, ctx: Ctx, retryInMs?: number): void => {
    if (next === state && retryInMs === undefined) return;
    state = next;
    o.onState?.(next, ctx, retryInMs);
  };
  const cancel = (): void => {
    if (timer !== null) clear(timer);
    timer = null;
  };
  /** Try again in `ms`; without timers, stay in `state` until the person starts it again. */
  const later = (ctx: Ctx, ms: number, next: LiveState): void => {
    cancel();
    if (!set) {
      wanted = false;
      say(next, ctx);
      return;
    }
    say(next, ctx, ms);
    timer = set(() => {
      timer = null;
      void open(ctx);
    }, ms);
  };
  /** The next wait, with a little jitter so a crowd that dropped together does not come back together. */
  const backoff = (): number => {
    const ms = Math.min(wait, MAX_WAIT_MS);
    wait = Math.min(wait * 2, MAX_WAIT_MS);
    return Math.round(ms * (0.85 + Math.random() * 0.3));
  };

  async function open(ctx: Ctx): Promise<void> {
    if (!wanted || sock || opening === round) return;
    const mine = round;
    opening = mine;
    // A retry while hidden stays "paused": no flicker of "connecting" every few seconds.
    if (state !== "paused") say("connecting", ctx);
    let s: Socket;
    try {
      const network = ctx.caps.network;
      if (!network?.socket) throw Object.assign(new Error("no live connections here"), { code: "refused" });
      s = await network.socket(typeof o.url === "function" ? o.url() : o.url);
    } catch (e) {
      if (opening === mine) opening = null;
      // Stopped while it was opening: a start since then opens its own.
      if (mine !== round || !wanted) return;
      const code = codeOf(e);
      if (code === "hidden") return later(ctx, HIDDEN_RETRY_MS, "paused");
      if (code === "denied") {
        wanted = false;
        return say("denied", ctx);
      }
      if (code === "not-allowed-host" || code === "insecure") {
        wanted = false;
        return say("blocked", ctx);
      }
      return later(ctx, backoff(), code === "offline" ? "offline" : "unreachable");
    }
    if (opening === mine) opening = null;
    if (mine !== round || !wanted) {
      s.close();
      return;
    }
    sock = s;
    wait = FIRST_WAIT_MS;
    s.onClose(({ why }) => {
      if (sock !== s) return;
      sock = null;
      if (!wanted) return;
      if (why === "hidden") return later(ctx, HIDDEN_RETRY_MS, "paused");
      if (why === "left" || why === "stopped" || why === "app") {
        // The person left (or the box was stopped): it is theirs to start again. `ctx` may already be
        // gone with the app, so only the state changes — the status line reads it from here.
        wanted = false;
        state = "off";
        return;
      }
      later(ctx, backoff(), "retrying");
    });
    s.onMessage((d) => {
      if (typeof d === "string") o.onText(d, ctx);
    });
    try {
      for (const m of o.hello?.(ctx) ?? []) await s.send(m);
    } catch {
      // It closed while saying hello: onClose has it.
      return;
    }
    say("live", ctx);
  }

  return {
    get state() {
      return state;
    },
    start(ctx) {
      wanted = true;
      cancel();
      wait = FIRST_WAIT_MS;
      if (state === "paused" || state === "retrying" || state === "offline" || state === "unreachable") state = "off";
      void open(ctx);
    },
    stop() {
      wanted = false;
      round++;
      cancel();
      const s = sock;
      sock = null;
      opening = null;
      state = "off";
      s?.close();
    },
    async send(text) {
      if (!sock || state !== "live") return false;
      try {
        await sock.send(text);
        return true;
      } catch {
        return false;
      }
    },
  };
}
