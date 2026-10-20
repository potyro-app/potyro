// The care plan's arithmetic: how often to water, when the next check-up photo is due, what a
// finding means for the plant's health, and when to remind. Plain functions the tests run without a
// browser. Every date the person sees is a calendar DAY: "water in 3 days" counts midnights, so a
// clock change cannot move it, and a reminder comes at a morning hour on that day.

export const LIGHTS = ["low", "medium", "bright", "sun"] as const;
export type Light = (typeof LIGHTS)[number];

export const KINDS = ["none", "overwatering", "underwatering", "light", "pests", "nutrients", "disease", "temperature", "unsure"] as const;
export type Kind = (typeof KINDS)[number];

export const SURE = ["low", "medium", "high"] as const;
export type Sure = (typeof SURE)[number];

export const HEALTH = ["thriving", "okay", "struggling", "serious"] as const;
export type Health = (typeof HEALTH)[number];

export const TRENDS = ["first", "better", "same", "worse", "unsure"] as const;
export type Trend = (typeof TRENDS)[number];
/** What a check-up can say against the earlier photo ("first" is the app's, for the first look). */
export const COMPARED = ["better", "same", "worse", "unsure"] as const;

/** A record as these functions read it: any fields, each read with care. */
export type Row = { readonly [field: string]: unknown };

const DAY = 86_400_000;

export const isLight = (v: unknown): v is Light => (LIGHTS as readonly unknown[]).includes(v);
export const isKind = (v: unknown): v is Kind => (KINDS as readonly unknown[]).includes(v);
export const isSure = (v: unknown): v is Sure => (SURE as readonly unknown[]).includes(v);
export const isHealth = (v: unknown): v is Health => (HEALTH as readonly unknown[]).includes(v);

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** A record's date as a Date, whatever form it crossed in. A bare YYYY-MM-DD is a local day. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim()) {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  return null;
}

/** Whole days from `today` to `day`, counted in midnights: tomorrow is 1, yesterday −1. */
export function daysBetween(today: Date, day: Date): number {
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  return Math.round((b - a) / DAY);
}

// ---- watering ----

/** How often a plant in this light usually wants water, when nobody has said: more light, more thirst. */
export const WATER_DAYS: Record<Light, number> = { low: 10, medium: 7, bright: 5, sun: 4 };
export const MIN_WATER_DAYS = 1;
export const MAX_WATER_DAYS = 30;

/** A watering interval the app will schedule: a whole number of days in range, or the light's default. */
export function waterEvery(suggested: unknown, light: Light): number {
  const n = typeof suggested === "number" ? suggested : Number(suggested);
  if (!Number.isFinite(n) || n <= 0) return WATER_DAYS[light];
  return Math.min(MAX_WATER_DAYS, Math.max(MIN_WATER_DAYS, Math.round(n)));
}

/** The day the plant next wants water: the last watering plus the interval; never watered, today. */
export function nextWatering(plant: Row, today: Date): Date {
  const last = toDate(plant.lastWatered);
  const every = waterEvery(plant.waterEvery, isLight(plant.light) ? plant.light : "medium");
  return last ? addDays(startOfDay(last), every) : startOfDay(today);
}

/** Days until it wants water: 0 today, negative when it is overdue. */
export const waterIn = (plant: Row, today: Date): number => daysBetween(today, nextWatering(plant, today));

// ---- check-ups ----

/** How soon to look again, by how the plant is doing: a serious problem in three days, a happy plant in a month. */
export const CHECK_DAYS: Record<Health, number> = { serious: 3, struggling: 7, okay: 14, thriving: 30 };

/** What a finding says about the plant: a problem the model thought serious, any problem, or none. */
export function healthOf(kind: Kind, sure: Sure, serious: boolean, trend: Trend = "first"): Health {
  if (serious) return "serious";
  if (kind === "none") return sure === "low" ? "okay" : "thriving";
  if (kind === "unsure") return "okay";
  // A problem on the mend is still a problem, but not one to look at every week.
  return trend === "better" ? "okay" : "struggling";
}

/**
 * Serious is the model's word, plus the app's own rule: a disease can spread to the other plants, so
 * it is treated as serious whatever the model said. The app errs towards "ask someone".
 */
export const isSerious = (kind: Kind, modelSays: boolean): boolean => modelSays || kind === "disease";

/** The day of the next check-up photo, counted from the check just made. */
export function nextCheckup(health: Health, checkedOn: Date): Date {
  return addDays(startOfDay(checkedOn), CHECK_DAYS[health]);
}

// ---- reminders ----

/** The hour a reminder comes: a morning, before the plant has had a hot day. */
export const REMIND_HOUR = 9;

const atMorning = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), REMIND_HOUR);

/** 9:00 on the day it next wants water, while that is still ahead. Overdue plants show as due in the app instead. */
export function waterRemindAt(plant: Row, now: Date): Date | null {
  if (!toDate(plant.lastWatered)) return null;
  const at = atMorning(nextWatering(plant, now));
  return at.getTime() > now.getTime() ? at : null;
}

/** 9:00 on the day the next check-up photo is due, while that is still ahead. */
export function checkRemindAt(plant: Row, now: Date): Date | null {
  const day = toDate(plant.nextCheck);
  if (!day) return null;
  const at = atMorning(day);
  return at.getTime() > now.getTime() ? at : null;
}

/** Due today or overdue: what the Plants page counts. */
export const needsWater = (plant: Row, today: Date): boolean => waterIn(plant, today) <= 0;
export const checkupDue = (plant: Row, today: Date): boolean => {
  const day = toDate(plant.nextCheck);
  return day !== null && daysBetween(today, day) <= 0;
};
