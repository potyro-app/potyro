// The watchdog of one sealed custom view (#267, docs/22 §11). Pure: the clock and the page's
// visibility are handed in, so the unit tests drive it without a browser.
//
// A view runs on its frame's main thread. Where the engine puts that frame in another process
// (desktop Chromium with site isolation), a view stuck in a loop simply stops answering, and the
// shell — still alive — sees its pings go unanswered. Everywhere else (Firefox, WebKit, Chromium
// without site isolation, so far every WebView we know of) the frame SHARES the shell's thread: while
// the view spins, nothing of the shell runs, this watchdog included. It cannot pre-empt the loop; it
// notices the moment the loop yields, because its own check then runs seconds late, and the view goes.
// A loop that never yields hangs the tab — that is what the crash-loop guard (view-guard.ts) is for.

/** How often the host pings the view, and checks. */
export const VIEW_PING_MS = 250;
export const VIEW_CHECK_MS = 100;
/** An unanswered ping this old stops the view (its frame runs apart from the shell and is stuck). */
export const VIEW_SILENCE_MS = 2000;
/** The shell's own check ran this late while a view was on screen: the view blocked the page's thread. */
export const VIEW_BLOCKED_MS = 2000;
/** From making the frame to the view's `mount` returning: its bundle evaluated and its first render. */
export const VIEW_MOUNT_MS = 10_000;

export interface ViewWatchdogOptions {
  silenceMs?: number;
  blockedMs?: number;
  mountMs?: number;
  checkMs?: number;
}

export type ViewVerdict = { stop: false } | { stop: true; kind: "silent" | "blocked" | "mount"; reason: string };

const OK: ViewVerdict = { stop: false };

export class ViewWatchdog {
  private readonly silenceMs: number;
  private readonly blockedMs: number;
  private readonly mountMs: number;
  private readonly checkMs: number;
  private startedAt: number;
  private lastCheck: number;
  /** Whether the last check saw the page on screen. */
  private wasVisible = true;
  private mountedAt: number | null = null;
  private seq = 0;
  /** Pings not answered yet, by number, with when they count from. */
  private readonly unanswered = new Map<number, number>();
  private lastPong: number;

  constructor(
    private readonly now: () => number,
    opts: ViewWatchdogOptions = {},
  ) {
    this.silenceMs = opts.silenceMs ?? VIEW_SILENCE_MS;
    this.blockedMs = opts.blockedMs ?? VIEW_BLOCKED_MS;
    this.mountMs = opts.mountMs ?? VIEW_MOUNT_MS;
    this.checkMs = opts.checkMs ?? VIEW_CHECK_MS;
    this.startedAt = this.lastCheck = this.lastPong = now();
  }

  /** The view's `mount` returned. From now on a blocked thread or a silent frame stops it. */
  mounted(): void {
    this.mountedAt ??= this.now();
  }

  get isMounted(): boolean {
    return this.mountedAt !== null;
  }

  /** A ping is being sent: its number. */
  ping(): number {
    const n = ++this.seq;
    this.unanswered.set(n, this.now());
    return n;
  }

  /** The view answered ping `n` — and so every ping before it, which it read first. */
  pong(n: number): void {
    for (const k of [...this.unanswered.keys()]) if (k <= n) this.unanswered.delete(k);
    this.lastPong = this.now();
  }

  /**
   * Healthy: the view answered recently and nothing is overdue. What `pagehide` asks before it clears
   * the crash-loop marker — a page put away while its view was stuck keeps the marker.
   */
  healthy(withinMs = 1000): boolean {
    const t = this.now();
    if (t - this.lastPong > withinMs + VIEW_PING_MS) return false;
    for (const sent of this.unanswered.values()) if (t - sent > withinMs) return false;
    return true;
  }

  /** Forget how long pings have waited: time the page could not have measured (hidden, throttled). */
  private forgive(t: number): void {
    for (const k of this.unanswered.keys()) this.unanswered.set(k, t);
    this.lastPong = t;
  }

  /**
   * The page went off screen (`visibilitychange`), told the moment it happens. A check cannot be
   * relied on to see the page hidden: on Android a tab put behind the camera runs no timer at all,
   * so the first check after it comes back is late by the whole absence — and read that as the view
   * blocking the thread (the owner's Firefox, 2026-10-20: every camera photo ended the sealed Palette
   * Catcher, while a photo from the library, a sheet over a running page, was fine).
   */
  hidden(): void {
    this.wasVisible = false;
    this.forgive(this.now());
  }

  /** Called every `checkMs`. `visible`: the page is on screen (a hidden tab's timers are throttled). */
  check(visible: boolean): ViewVerdict {
    const t = this.now();
    const late = t - this.lastCheck - this.checkMs;
    const since = t - this.lastCheck;
    this.lastCheck = t;
    const back = visible && !this.wasVisible;
    this.wasVisible = visible;
    if (!visible) {
      // Time hidden is not the view's: its mount budget pauses (a link opened in a background tab).
      if (this.mountedAt === null) this.startedAt += since;
      this.forgive(t);
      return OK;
    }
    if (back) {
      // The first check after the page came back: the throttled timer that runs it can fire seconds
      // late (a background tab, a sleeping laptop). That wait was the page's, not the view's.
      if (this.mountedAt === null) this.startedAt += Math.max(0, late);
      this.forgive(t);
      return OK;
    }
    if (this.mountedAt === null) {
      // Mounting: evaluating the bundle and the first render may hold a shared thread for a while on a
      // slow phone; only the whole mount has a budget.
      if (t - this.startedAt > this.mountMs) return { stop: true, kind: "mount", reason: `its screen did not appear within ${Math.round(this.mountMs / 1000)} s` };
      this.forgive(t);
      return OK;
    }
    if (late > this.blockedMs) {
      this.forgive(t);
      return { stop: true, kind: "blocked", reason: `the page's thread was blocked for ${Math.round(late)} ms while its screen was showing` };
    }
    // A check a little late (the shell busy with its own work): the pings' waiting does not count it,
    // their answers may be queued behind that work.
    if (late > 0) for (const [k, sent] of this.unanswered) this.unanswered.set(k, sent + late);
    for (const sent of this.unanswered.values()) {
      if (t - sent > this.silenceMs) return { stop: true, kind: "silent", reason: `its screen stopped answering for ${Math.round(t - sent)} ms` };
    }
    return OK;
  }
}
