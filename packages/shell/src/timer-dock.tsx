// The chips of `ctx.ui.timer` (docs/04 §Timers): every running countdown, on every page of every app
// and on the home screen, so a timer started on one page is in sight on the next.
//
// Mounted once, around every route (main.tsx `mount`). The open app's timers come first; another
// app's chip names that app and opens it when tapped. A chip that has rung stays, loud, until the
// person says Done — a kitchen timer that rang while you were at the sink is no use if it has gone.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLingui } from "@lingui/react/macro";
import { timerHub, type KeptTimer } from "./timer-hub.js";
import { getUserApp } from "./user-apps.js";

/** "1:05", "12:00", "1:02:03" — how a countdown reads. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

let focused: string | null = null;
const focusListeners = new Set<() => void>();

/** The app on screen now (or none, at home): its timers go first. Set by main.tsx as apps open. */
export function setTimerFocus(app: string | null): void {
  focused = app;
  for (const cb of [...focusListeners]) cb();
}
/** `app` was put away. Only if it is still the one on screen: the next app may already be open. */
export function clearTimerFocus(app: string): void {
  if (focused === app) setTimerFocus(null);
}
const subscribeFocus = (cb: () => void): (() => void) => {
  focusListeners.add(cb);
  return () => focusListeners.delete(cb);
};

/** Re-render once a second while something counts down; not at all otherwise. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

export function TimerDock({ onOpenApp }: { onOpenApp: (app: string) => void }) {
  const kept = useSyncExternalStore(timerHub.subscribe, timerHub.snapshot, timerHub.snapshot);
  const app = useSyncExternalStore(subscribeFocus, () => focused, () => focused);
  useTick(kept.some((k) => k.endsAt !== null && !k.ringing));
  if (!kept.length) return null;
  const ordered = timerHub.all().sort((a, b) => Number(b.app === app) - Number(a.app === app));
  return (
    <div className="k-timer-dock" data-home={app === null || undefined}>
      {ordered.map((k) => (
        <TimerChip key={`${k.app}\u0000${k.id}`} k={k} here={k.app === app} onOpenApp={onOpenApp} />
      ))}
    </div>
  );
}

function TimerChip({ k, here, onOpenApp }: { k: KeptTimer; here: boolean; onOpenApp: (app: string) => void }) {
  const { t } = useLingui();
  const left = timerHub.leftOf(k);
  const paused = k.endsAt === null && !k.ringing;
  const fraction = k.seconds > 0 ? Math.min(1, left / (k.seconds * 1000)) : 0;
  const label = here ? k.label : `${k.appName} · ${k.label}`;
  const time = clock(left);
  // Another installed app's chip opens it; a preview's or a demo's has nowhere to go.
  const open = here || !getUserApp(k.app) ? undefined : () => onOpenApp(k.app);

  if (k.ringing) {
    return (
      <div className="k-timer-chip" data-ringing role="alert">
        <span className="k-timer-bell" aria-hidden>
          ⏰
        </span>
        <button type="button" className="k-timer-what" onClick={open} disabled={!open}>
          <b>{label}</b>
          <span>{t({ message: "Time’s up", comment: "A countdown timer has reached zero" })}</span>
        </button>
        <button type="button" className="k-timer-done" onClick={() => timerHub.control(k.app, k.id, "dismiss")}>
          {t({ message: "Done", comment: "Button: silence a timer that has rung" })}
        </button>
      </div>
    );
  }
  return (
    <div className="k-timer-chip" data-paused={paused || undefined} aria-label={paused ? t`${label}: paused, ${time} left` : t`${label}: ${time} left`} role="group">
      <svg className="k-timer-ring" viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={RING_R} className="k-timer-ring-track" />
        <circle cx="18" cy="18" r={RING_R} className="k-timer-ring-left" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - fraction)} />
      </svg>
      <button type="button" className="k-timer-what" onClick={open} disabled={!open}>
        <b>{label}</b>
        <span role="timer" className="k-timer-time">
          {time}
        </span>
      </button>
      <button
        type="button"
        className="k-timer-btn"
        aria-label={paused ? t({ message: "Resume", comment: "Button: let a paused timer count down again" }) : t({ message: "Pause", comment: "Button: stop a timer counting down for now" })}
        onClick={() => timerHub.control(k.app, k.id, paused ? "resume" : "pause")}
      >
        {paused ? "▶" : "❚❚"}
      </button>
      <button type="button" className="k-timer-btn" aria-label={t({ message: "Stop timer", comment: "Button: cancel a running countdown" })} onClick={() => timerHub.control(k.app, k.id, "cancel")}>
        ✕
      </button>
    </div>
  );
}
