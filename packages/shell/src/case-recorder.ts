// Records what someone did in their own app, by observing the ONE place navigation goes through.
//
// `createNavBridge` is the choke point for every built-in view and every custom view alike, so a
// recorder wrapped around it needs no per-view instrumentation and picks up view types that do not
// exist yet. It OBSERVES: the app navigates exactly as it would have, recording or not — a recorder
// that changed behaviour would be recording a different app than the one that misbehaved.

import { addStep, newCase, type Case } from "@karta/runtime";

type Nav = (page: string, params?: Record<string, string>) => void;

export class CaseRecorder {
  private current: Case | null = null;

  get recording(): boolean {
    return this.current !== null;
  }

  start(appId: string, title: string): void {
    this.current = newCase(appId, title);
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
      // navigation proceed unconditionally.
      try {
        if (this.current) {
          this.current = addStep(this.current, params ? { kind: "open", page, params } : { kind: "open", page });
        }
      } catch (error) {
        // Recording failed, but the app must still navigate.
      }
      nav(page, params);
    };
  }
}
