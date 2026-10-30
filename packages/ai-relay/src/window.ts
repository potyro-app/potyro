// What one key (a device, an address) did in the last 24 hours, in memory: the day limits of
// `/complete` and the chat route, and the counts' once-a-day check.
//
// A request looks at its own key only. The rest of the map is swept now and then (at most once an
// hour, on whichever request comes), so a key nobody sends again is forgotten within a day and an
// hour, and no request pays for the whole map. The map holds at most `maxKeys` keys: past it, the
// key first seen longest ago is let go. That can only let an old key start its day again, never
// hold back a new one; the service's own daily and monthly caps still hold whatever happens here.

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_MS = 60 * 60 * 1000;
export const MAX_KEYS = 100_000;

export interface DayWindow<T> {
  /** What `key` did in the last 24 hours, oldest first. */
  get(key: string): T[];
  add(key: string, value: T): void;
  /** How many keys are held. */
  size(): number;
}

export function dayWindow<T>(now: () => number, opts: { maxKeys?: number } = {}): DayWindow<T> {
  const maxKeys = opts.maxKeys ?? MAX_KEYS;
  const seen = new Map<string, Array<{ at: number; value: T }>>();
  let swept = now();

  const fresh = (key: string, since: number): Array<{ at: number; value: T }> => {
    const kept = (seen.get(key) ?? []).filter((e) => e.at > since);
    if (kept.length) seen.set(key, kept);
    else seen.delete(key);
    return kept;
  };
  const sweep = (): void => {
    const t = now();
    if (t - swept < SWEEP_MS) return;
    swept = t;
    for (const key of [...seen.keys()]) fresh(key, t - DAY_MS);
  };

  return {
    get(key) {
      sweep();
      return fresh(key, now() - DAY_MS).map((e) => e.value);
    },
    add(key, value) {
      sweep();
      const list = seen.get(key);
      if (list) return void list.push({ at: now(), value });
      if (seen.size >= maxKeys) seen.delete(seen.keys().next().value!);
      seen.set(key, [{ at: now(), value }]);
    },
    size: () => seen.size,
  };
}
