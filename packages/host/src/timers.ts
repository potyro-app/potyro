// `ctx.ui.timer` (docs/04 §Timers): a countdown the SHELL keeps, so it outlives the page, the app and
// a locked screen. App code only asks; what crosses — into the sealed box and back — is plain data,
// and the handle's methods are rebuilt on each side from it.

import type { UiTimer, Words } from "potyro";

/** A timer as plain data: what the shell keeps and what crosses a sealed box's boundary. */
export interface TimerData {
  id: string;
  label: string;
  seconds: number;
  /** ISO time it ends; `null` while paused. */
  endsAt: string | null;
  /** Seconds left when this was read. */
  left: number;
  paused: boolean;
}

export type TimerVerb = "cancel" | "pause" | "resume";

/** What the shell provides for `ctx.ui.timer`. Per app: the shell knows whose timers they are. */
export interface TimerBridge {
  start(opts: { label: string; seconds: number; id?: string }): Promise<TimerData>;
  list(): Promise<TimerData[]>;
  control(id: string, verb: TimerVerb): Promise<void>;
}

export const TIMER_LIMITS = {
  /** A day: a countdown longer than that is a reminder, and reminders exist. */
  maxSeconds: 86_400,
  /** At once, per app: a stack of chips nobody can read is not a feature. */
  perApp: 10,
  /** Characters of label. */
  label: 80,
  /** Characters of id. */
  id: 64,
} as const;

/** `ui.timer`'s options, checked, with the label in the language the app is shown in. */
export function checkTimer(opts: unknown, say: (w: Words | undefined) => string): { label: string; seconds: number; id?: string } {
  if (opts == null || typeof opts !== "object") throw new Error("ui.timer needs { label, seconds }");
  const o = opts as { label?: Words; seconds?: unknown; id?: unknown };
  const seconds = Number(o.seconds);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > TIMER_LIMITS.maxSeconds) throw new Error(`ui.timer: \`seconds\` is a number from 1 to ${TIMER_LIMITS.maxSeconds}`);
  const label = o.label == null ? "" : say(o.label).trim();
  if (!label) throw new Error("ui.timer needs a `label`: what it is for");
  let id: string | undefined;
  if (o.id != null) {
    id = String(o.id);
    if (!id || id.length > TIMER_LIMITS.id) throw new Error(`ui.timer: \`id\` is 1 to ${TIMER_LIMITS.id} characters`);
  }
  return { label: label.slice(0, TIMER_LIMITS.label), seconds: Math.round(seconds), ...(id ? { id } : {}) };
}

/** Untrusted data from the shell or a box, as a TimerData: every field its type. */
export function plainTimer(d: unknown): TimerData {
  const o = (d ?? {}) as Record<string, unknown>;
  return {
    id: String(o.id ?? ""),
    label: String(o.label ?? ""),
    seconds: Number(o.seconds) || 0,
    endsAt: typeof o.endsAt === "string" ? o.endsAt : null,
    left: Math.max(0, Number(o.left) || 0),
    paused: o.paused === true,
  };
}

/** The handle app code holds: the data, frozen, and the three things a person can do on the chip. */
export function timerHandle(d: TimerData, control: (id: string, verb: TimerVerb) => Promise<void>): UiTimer {
  return Object.freeze({
    id: d.id,
    label: d.label,
    seconds: d.seconds,
    endsAt: d.endsAt ? new Date(d.endsAt) : null,
    left: d.left,
    paused: d.paused,
    cancel: () => control(d.id, "cancel"),
    pause: () => control(d.id, "pause"),
    resume: () => control(d.id, "resume"),
  });
}

/**
 * A timer nobody keeps, for a headless bridge (validation, tests): it answers like one that started,
 * so an action that starts one still runs to its end, and nothing rings.
 */
export function unkeptTimer(o: { label: string; seconds: number; id?: string }, now: Date): TimerData {
  return { id: o.id ?? `t${now.getTime()}`, label: o.label, seconds: o.seconds, endsAt: new Date(now.getTime() + o.seconds * 1000).toISOString(), left: o.seconds, paused: false };
}
