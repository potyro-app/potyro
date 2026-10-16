// `ctx.ui.keepAwake` (docs/04 §Keeping the screen on): the screen held on while an app asks, and let
// go when it stops asking or the person leaves it.
//
// One holder for the whole shell, counting holds per app: two pages of one app asking at once are one
// lock, and leaving the app drops every hold it had, whether or not it remembered to release them.
//
// The web's Screen Wake Lock is given up by the browser whenever the page is hidden — switching tabs,
// locking the phone — and has to be asked for again when the page is back, or the screen sleeps for
// good after the first glance away. The Android app uses the window's keep-screen-on flag instead
// (native/keep-awake.ts), which the system already drops and restores with visibility.

interface Sentinel {
  release(): Promise<void>;
  readonly released?: boolean;
}

interface WakeLockLike {
  request(type: "screen"): Promise<Sentinel>;
}

/** What `document.documentElement` says while the screen is held: for the shell's own checks and tests. */
export const AWAKE_ATTR = "data-k-awake";

export class ScreenAwake {
  private readonly holds = new Map<string, number>();
  private sentinel: Sentinel | null = null;
  private nativeOn = false;
  private busy: Promise<void> = Promise.resolve();
  private listening = false;

  constructor(
    private readonly native: (on: boolean) => Promise<boolean> = async () => false,
    private readonly doc: Document | undefined = typeof document === "undefined" ? undefined : document,
  ) {}

  private get wanted(): boolean {
    for (const n of this.holds.values()) if (n > 0) return true;
    return false;
  }

  /** Hold the screen on for `app`. The returned function lets go of this one hold, once. */
  hold(app: string): () => void {
    this.holds.set(app, (this.holds.get(app) ?? 0) + 1);
    this.listen();
    this.sync();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (this.holds.get(app) ?? 1) - 1;
      if (n > 0) this.holds.set(app, n);
      else this.holds.delete(app);
      this.sync();
    };
  }

  /** The person left `app`: every hold it had goes, remembered to be released or not. */
  releaseApp(app: string): void {
    if (!this.holds.delete(app)) return;
    this.sync();
  }

  /** Whether the screen is being held on now. */
  get held(): boolean {
    return this.wanted;
  }

  private listen(): void {
    if (this.listening || !this.doc) return;
    this.listening = true;
    // Back in front: the browser dropped the lock while hidden, so ask again.
    this.doc.addEventListener("visibilitychange", () => {
      if (this.doc?.visibilityState === "visible") this.sync();
    });
  }

  /** Bring the lock in line with the holds, one change at a time. */
  private sync(): void {
    this.busy = this.busy.then(() => this.apply()).catch(() => {});
  }

  private async apply(): Promise<void> {
    const want = this.wanted;
    this.doc?.documentElement.toggleAttribute(AWAKE_ATTR, want);
    if (want) {
      if (this.nativeOn) return;
      if (await this.native(true)) {
        this.nativeOn = true;
        return;
      }
      if (this.sentinel && !this.sentinel.released) return;
      if (this.doc?.visibilityState === "hidden") return; // asked again on return
      const wakeLock = (globalThis.navigator as unknown as { wakeLock?: WakeLockLike } | undefined)?.wakeLock;
      if (!wakeLock) return; // an older browser: the screen dims as it always did
      try {
        this.sentinel = await wakeLock.request("screen");
        // Released meanwhile (the app was left while the request was out): let go at once.
        if (!this.wanted) await this.drop();
      } catch {
        // Refused — a low battery, a browser that wants a tap first. Nothing to tell the person.
        this.sentinel = null;
      }
      return;
    }
    await this.drop();
  }

  private async drop(): Promise<void> {
    if (this.nativeOn) {
      this.nativeOn = false;
      await this.native(false);
    }
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) await s.release().catch(() => {});
  }

  /** Settles once every change asked for so far has been made (tests). */
  settled(): Promise<void> {
    return this.busy;
  }
}

/** The shell's one holder: native on a device, the web's wake lock elsewhere. */
export const screenAwake = new ScreenAwake(async (on) => {
  try {
    const { keepScreenOn } = await import("@potyro/native");
    return await keepScreenOn(on);
  } catch {
    return false;
  }
});
