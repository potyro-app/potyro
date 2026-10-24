// The chips of `ctx.ui.timer` (docs/04 §Timers): every running countdown, on every page of every app
// and on the home screen, so a timer started on one page is in sight on the next.
//
// Mounted once, around every route (main.tsx `mount`). The open app's timers come first; another
// app's chip names that app and opens it when tapped. A chip that has rung stays, loud, until the
// person says Done — a kitchen timer that rang while you were at the sink is no use if it has gone.
// A page that draws a countdown itself says so (`ctx.ui.drawsTimer`), and while it is on screen that
// timer's chip is left out: the rest is not shown twice, a line apart (timer-hub.ts `chips`).

import { Glyph } from "@potyro/views";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import { secondsLeft } from "@potyro/host";
import { timerHub, type KeptTimer } from "./timer-hub.js";
import { getUserApp } from "./user-apps.js";

/** "1:05", "12:00", "1:02:03" — how a countdown reads, in the one rounding every countdown uses. */
export function clock(ms: number): string {
  const total = secondsLeft(ms);
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

/** A few ms past the change: a timeout may fire a hair early, and then it would draw the old second. */
const TICK_SLACK_MS = 4;

/**
 * Re-render the moment a countdown's second changes (`timerHub.nextChangeIn`), not on a free-running
 * second of its own: a chip on its own beat lagged up to a second behind a page drawing the same
 * timer. Not at all while nothing counts.
 */
function useTick(): number {
  const [now, setNow] = useState(() => Date.now());
  const wait = timerHub.nextChangeIn();
  useEffect(() => {
    if (wait === null) return;
    const id = setTimeout(() => setNow(Date.now()), wait + TICK_SLACK_MS);
    return () => clearTimeout(id);
  }, [now, wait]);
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
  useSyncExternalStore(timerHub.subscribe, timerHub.snapshot, timerHub.snapshot);
  useSyncExternalStore(timerHub.subscribe, timerHub.drawnSnapshot, timerHub.drawnSnapshot);
  const app = useSyncExternalStore(subscribeFocus, () => focused, () => focused);
  useTick();
  const dock = useRef<HTMLDivElement | null>(null);
  const ordered = timerHub.chips(app);
  // Room only for chips that show: with the page drawing its one timer, its own bar comes back down.
  useTimerRoom(dock, app !== null, ordered.length > 0);
  if (!ordered.length) return null;
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
        <Glyph icon={paused ? "play" : "pause"} size={20} />
      </button>
      <button type="button" className="k-timer-btn" aria-label={t({ message: "Stop timer", comment: "Button: cancel a running countdown" })} onClick={() => timerHub.control(k.app, k.id, "cancel")}>
        ✕
      </button>
    </div>
  );
}
