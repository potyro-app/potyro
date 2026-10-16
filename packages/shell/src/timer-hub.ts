// `ctx.ui.timer` (docs/04 §Timers): the countdowns the shell keeps for apps.
//
// The shell, not the app, because the app is the thing that goes away: a page change unmounts its
// view, leaving the app disposes its runtime, and a locked phone stops the page. A rest timer that
// lived in a custom view's state was gone the moment the person looked at the previous set. Kept
// here, a timer is in this device's storage (it survives a reload), on a chip on every page and on
// the home screen, and — where the device can — in a notification scheduled for its end, which rings
// with the screen locked and Potyro closed (the same exact scheduling reminders use).
//
// On the web there is no way to ring a closed tab at a time, so it rings when it can: on time while
// Potyro is open (with a system notification if the person allowed them and the tab is behind
// another), else the moment Potyro is in front again. docs/04 says so.

import { t } from "@lingui/core/macro";
import type { TimerBridge, TimerData, TimerVerb } from "@potyro/host";
import { TIMER_LIMITS } from "@potyro/host";

/** One countdown, as this device keeps it. Times in ms. */
export interface KeptTimer {
  app: string;
  appName: string;
  id: string;
  label: string;
  seconds: number;
  /** When it ends; `null` while paused. */
  endsAt: number | null;
  /** Milliseconds left, frozen while paused. */
  leftMs: number;
  /** It ended and nobody has dismissed it yet. */
  ringing?: boolean;
}

/** The slice of the device's notifications the hub uses (`Capabilities.notifications`). */
export interface TimerNotifier {
  schedule(n: { id: string; at: string; title: string; body?: string }): Promise<void>;
  cancel(id: string): Promise<void>;
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY = "potyro:timers";
/** A rung timer nobody dismissed goes quiet after this. */
const RING_FOR_MS = 10 * 60_000;
/** The most `setTimeout` waits; a longer wait is checked again then. */
const MAX_WAIT = 2 ** 31 - 1;

const notificationId = (k: KeptTimer): string => `timer:${k.app}:${k.id}`;

function readKept(storage: StorageLike | undefined): KeptTimer[] {
  try {
    const raw = storage?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((k): k is KeptTimer => !!k && typeof k === "object" && typeof (k as KeptTimer).app === "string" && typeof (k as KeptTimer).id === "string");
  } catch {
    return [];
  }
}

export interface TimerHubDeps {
  storage?: StorageLike;
  now?: () => number;
  /** The device's notifications, read when needed: native on a device, none on the web. */
  notifier?: () => TimerNotifier | null;
  /** It ended: sound, buzz, a system notification when the page is behind. */
  ring?: (k: KeptTimer) => void;
}

export class TimerHub {
  private kept: KeptTimer[];
  private readonly listeners = new Set<() => void>();
  private wake: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: TimerHubDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.kept = readKept(deps.storage);
    this.check();
  }

  // ---- what apps ask, through ctx.ui ----

  /** `ctx.ui.timer` for one app: the app knows nothing of other apps' timers. */
  bridgeFor(app: string, appName: string): TimerBridge {
    return {
      start: async (o) => this.data(this.start(app, appName, o)),
      list: async () => this.running(app).map((k) => this.data(k)),
      control: async (id, verb) => this.control(app, id, verb),
    };
  }

  start(app: string, appName: string, o: { label: string; seconds: number; id?: string }): KeptTimer {
    const seconds = Math.max(1, Math.min(TIMER_LIMITS.maxSeconds, Math.round(o.seconds)));
    const id = o.id ?? `t${this.now().toString(36)}${(++this.seq).toString(36)}`;
    const old = this.kept.find((k) => k.app === app && k.id === id);
    if (old) this.unschedule(old);
    const k: KeptTimer = { app, appName, id, label: o.label, seconds, endsAt: this.now() + seconds * 1000, leftMs: seconds * 1000 };
    this.kept = [...this.kept.filter((x) => x !== old), k];
    this.schedule(k);
    this.changed();
    return k;
  }

  control(app: string, id: string, verb: TimerVerb | "dismiss"): void {
    const k = this.kept.find((x) => x.app === app && x.id === id);
    if (!k) return;
    if (verb === "cancel" || verb === "dismiss") {
      this.unschedule(k);
      this.kept = this.kept.filter((x) => x !== k);
    } else if (verb === "pause") {
      if (k.endsAt === null || k.ringing) return;
      this.unschedule(k);
      this.replace(k, { ...k, endsAt: null, leftMs: Math.max(0, k.endsAt - this.now()) });
    } else if (verb === "resume") {
      if (k.endsAt !== null || k.ringing) return;
      const next = { ...k, endsAt: this.now() + k.leftMs };
      this.replace(k, next);
      this.schedule(next);
    }
    this.changed();
  }

  /** This app's timers that are counting or paused, soonest first. A rung one is not running. */
  running(app: string): KeptTimer[] {
    return this.kept.filter((k) => k.app === app && !k.ringing).sort((a, b) => this.leftOf(a) - this.leftOf(b));
  }

  /** Every timer the chips show: ringing first, then soonest. */
  all(): KeptTimer[] {
    return [...this.kept].sort((a, b) => Number(!!b.ringing) - Number(!!a.ringing) || this.leftOf(a) - this.leftOf(b));
  }

  leftOf(k: KeptTimer): number {
    if (k.ringing) return 0;
    return k.endsAt === null ? k.leftMs : Math.max(0, k.endsAt - this.now());
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  /** A stable snapshot for `useSyncExternalStore`: the same array until something changes. */
  snapshot = (): readonly KeptTimer[] => this.kept;

  /** Ring whatever has ended — on load, on a wake-up, and when Potyro is in front again. */
  check(): void {
    const now = this.now();
    let changed = false;
    this.kept = this.kept.flatMap((k) => {
      if (k.ringing) {
        if (k.endsAt !== null && now - k.endsAt > RING_FOR_MS) {
          changed = true;
          return [];
        }
        return [k];
      }
      if (k.endsAt === null || k.endsAt > now) return [k];
      changed = true;
      // Ended long ago (Potyro was closed): the notification said it; ringing now would be noise.
      if (now - k.endsAt > RING_FOR_MS) return [];
      const rung = { ...k, ringing: true, leftMs: 0 };
      // The notification has done its job (or the page beat it to it): it must not ring again.
      void this.deps.notifier?.()?.cancel(notificationId(k)).catch(() => {});
      try {
        this.deps.ring?.(rung);
      } catch {
        // A sound that will not play is no reason to lose the timer.
      }
      return [rung];
    });
    if (changed) this.changed();
    else this.arm();
  }

  /** Schedule every running timer's notification again: the device's notifications just arrived. */
  rescheduleAll(): void {
    for (const k of this.kept) if (!k.ringing) this.schedule(k);
  }

  // ---- inside ----

  private data(k: KeptTimer): TimerData {
    return { id: k.id, label: k.label, seconds: k.seconds, endsAt: k.endsAt === null ? null : new Date(k.endsAt).toISOString(), left: Math.ceil(this.leftOf(k) / 1000), paused: k.endsAt === null };
  }

  private replace(k: KeptTimer, next: KeptTimer): void {
    this.kept = this.kept.map((x) => (x === k ? next : x));
  }

  /** At its end, on the lock screen too, where the device can. */
  private schedule(k: KeptTimer): void {
    if (k.endsAt === null) return;
    const notifier = this.deps.notifier?.();
    if (!notifier) return;
    const appName = k.appName;
    void notifier.schedule({ id: notificationId(k), at: new Date(k.endsAt).toISOString(), title: k.label, body: t`Time’s up · ${appName}` }).catch(() => {});
  }

  private unschedule(k: KeptTimer): void {
    void this.deps.notifier?.()?.cancel(notificationId(k)).catch(() => {});
  }

  private changed(): void {
    try {
      this.deps.storage?.setItem(KEY, JSON.stringify(this.kept));
    } catch {
      // Storage full or blocked: the timers still run while Potyro is open.
    }
    this.arm();
    for (const cb of [...this.listeners]) cb();
  }

  /** Wake up at the next end. */
  private arm(): void {
    if (this.wake) clearTimeout(this.wake);
    this.wake = null;
    const next = Math.min(...this.kept.filter((k) => !k.ringing && k.endsAt !== null).map((k) => k.endsAt!));
    const ringing = this.kept.some((k) => k.ringing);
    if (!Number.isFinite(next) && !ringing) return;
    const wait = Number.isFinite(next) ? Math.max(0, next - this.now()) : RING_FOR_MS;
    this.wake = setTimeout(() => this.check(), Math.min(wait + 15, MAX_WAIT));
  }
}

// ---- the shell's one hub ----

let audio: AudioContext | null = null;

/** Three short tones: a kitchen timer, not an alarm clock. */
function chime(): void {
  const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  audio ??= new Ctor();
  const ctx = audio;
  void ctx.resume?.().catch(() => {});
  for (let i = 0; i < 3; i++) {
    const at = ctx.currentTime + i * 0.32;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.27);
  }
}

/** The web's way to say it while Potyro is behind another tab: a system notification, if allowed. */
async function notifyBehind(k: KeptTimer): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
  const N = (globalThis as unknown as { Notification?: { permission: string; new (title: string, o?: NotificationOptions): unknown } }).Notification;
  if (!N || N.permission !== "granted") return;
  const appName = k.appName;
  const body = t`Time’s up · ${appName}`;
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined);
  if (reg) await reg.showNotification(k.label, { body, tag: notificationId(k) });
  else new N(k.label, { body, tag: notificationId(k) });
}

function ring(k: KeptTimer): void {
  try {
    chime();
  } catch {
    // no sound on this device
  }
  try {
    navigator.vibrate?.([200, 100, 200, 100, 400]);
  } catch {
    // no buzz either
  }
  void notifyBehind(k).catch(() => {});
}

/** The device's notifications, once boot has picked them (native: exact; web: none). */
let notifier: TimerNotifier | null = null;

/** Boot hands the hub the device's notifications; timers already running are scheduled with them. */
export function setTimerNotifier(n: TimerNotifier | null): void {
  notifier = n;
  if (n) timerHub.rescheduleAll();
}

function safeStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // blocked site data: timers last as long as the page
  }
}

export const timerHub = new TimerHub({ storage: safeStorage(), notifier: () => notifier, ring });

if (typeof document !== "undefined") {
  // Back in front: a timer that ended meanwhile rings now (the web could not ring a hidden page).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") timerHub.check();
  });
}
