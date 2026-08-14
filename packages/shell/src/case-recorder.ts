// Records what someone did in their own app, by observing the ONE place navigation goes through.
//
// `App.tsx`'s `navigate` (not `createNavBridge`) is the choke point: a tap on a list row or a map
// pin is passed the `navigate` prop directly and never touches the bridge, while `ctx.navigate`
// from app code goes through `createNavBridge` → `navHost` → `navigate` via a ref. Wrapping the
// bridge would see only the second path and miss every human interaction — a recording that looked
// plausible while capturing nothing a person actually did. Wrapping `navigate` itself is the only
// point both paths funnel through. It OBSERVES: the app navigates exactly as it would have,
// recording or not — a recorder that changed behaviour would be recording a different app than the
// one that misbehaved.

import { addStep, newCase, type Case } from "@karta/runtime";

type Nav = (page: string, params?: Record<string, string>) => void;

export class CaseRecorder {
  private current: Case | null = null;
  // How many steps `wrapNav` dropped during the CURRENT (or most recently stopped) recording.
  // A dropped step is the one false success this feature cannot let through silently: replay
  // only ever sees the steps that made it into the case, so a lost step means the report it
  // eventually shows is for a shorter path than the person actually walked — clean-looking, but
  // incomplete. `lost` lets a caller tell the two apart.
  private lostCount = 0;

  get recording(): boolean {
    return this.current !== null;
  }

  /** Steps dropped by `wrapNav` during the current or most recently stopped recording. Reset by
   *  the next `start`, so a caller must read it right after `stop()` if it wants to know about
   *  the recording that just ended. */
  get lost(): number {
    return this.lostCount;
  }

  start(appId: string, title: string): void {
    this.current = newCase(appId, title);
    this.lostCount = 0;
  }

  stop(): Case | null {
    const done = this.current;
    this.current = null;
    return done;
  }

  note(text: string): void {
    if (this.current) this.current = addStep(this.current, { kind: "expect", note: text });
  }

  wrapNav(nav: Nav): Nav {
    return (page, params) => {
      // Recording is best-effort. A bug in the recorder or a corruption of the current case
      // must never stop someone from navigating their app—swallow recording errors and let
      // navigation proceed unconditionally. But swallowing silently would produce exactly the
      // false success this whole feature exists to remove: a report that reads clean while a
      // step never made it into the recording. So the drop is counted and logged, even though it
      // is not re-thrown.
      try {
        if (this.current) {
          this.current = addStep(this.current, params ? { kind: "open", page, params } : { kind: "open", page });
        }
      } catch (error) {
        this.lostCount += 1;
        console.warn("[karta] case recorder dropped a step:", error);
      }
      nav(page, params);
    };
  }
}
