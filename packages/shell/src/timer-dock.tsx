// The chips of `ctx.ui.timer` (docs/04 §Timers): every running countdown, on every page of every app
// and on the home screen, so a timer started on one page is in sight on the next.
//
// Mounted once, around every route (main.tsx `mount`). The open app's timers come first; another
// app's chip names that app and opens it when tapped. A chip that has rung stays, loud, until the
// person says Done — a kitchen timer that rang while you were at the sink is no use if it has gone.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
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

/** Set on the root while chips show in an app: how much of the bottom of the screen they take. */
const ROOM_VAR = "--k-timer-room";
/** Room left above the chips before an app's own things. */
const CLEARANCE_PX = 8;
/** Looked at again this often while chips show: the dock moves when the tab bar comes or goes. */
const RECHECK_MS = 700;

/**
 * Say how much of the bottom of the screen the chips take — from the bottom edge to just above the
 * top one — as `--k-timer-room`, which `--k-chrome-bottom` takes in (styles.css, chrome.tsx). Like
 * `--k-chrome-top` for the camera sign: an app's own bottom bar or floating button keeps clear of
 * it, so a rest running never covers the workout's Finish. Nothing at home: there is no app there.
 */
function useTimerRoom(dock: RefObject<HTMLDivElement | null>, inApp: boolean, shown: boolean): void {
  const measure = (): void => {
    const root = document.documentElement;
    const el = dock.current;
    const top = el && inApp && shown ? el.getBoundingClientRect().top : null;
    const room = top === null ? null : `${Math.max(0, Math.round(window.innerHeight - top + CLEARANCE_PX))}px`;
    if (room === null) {
      if (root.style.getPropertyValue(ROOM_VAR)) root.style.removeProperty(ROOM_VAR);
    } else if (root.style.getPropertyValue(ROOM_VAR) !== room) root.style.setProperty(ROOM_VAR, room);
  };
  // Every render: a chip came, went or rang.
  useLayoutEffect(measure);
  useEffect(() => {
    if (!inApp || !shown) return;
    const el = dock.current;
    const size = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (el) size?.observe(el);
    window.addEventListener("resize", measure);
    const again = setInterval(measure, RECHECK_MS);
    return () => {
      size?.disconnect();
      window.removeEventListener("resize", measure);
      clearInterval(again);
      document.documentElement.style.removeProperty(ROOM_VAR);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `measure` reads the ref and these two only
  }, [inApp, shown]);
}

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

export function TimerDock({ onOpenApp }: { onOpenApp: (app: string) => void }) {
  const kept = useSyncExternalStore(timerHub.subscribe, timerHub.snapshot, timerHub.snapshot);
  const app = useSyncExternalStore(subscribeFocus, () => focused, () => focused);
  useTick(kept.some((k) => k.endsAt !== null && !k.ringing));
  const dock = useRef<HTMLDivElement | null>(null);
  useTimerRoom(dock, app !== null, kept.length > 0);
  if (!kept.length) return null;
  const ordered = timerHub.all().sort((a, b) => Number(b.app === app) - Number(a.app === app));
  return (
    <div ref={dock} className="k-timer-dock" data-home={app === null || undefined}>
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
