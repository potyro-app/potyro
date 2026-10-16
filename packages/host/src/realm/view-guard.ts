// The crash-loop guard for sealed custom views (#267, docs/22 §11).
//
// Where a view's frame shares the shell's thread (every engine but desktop Chromium, as measured), an
// endless loop in a view hangs the whole tab, and nothing in the tab can stop it. The person reloads
// or closes it. Without this, Potyro would open the same app, mount the same view and hang again —
// every time. So before a sealed view mounts, a marker goes into localStorage, synchronously; while
// the view answers it is kept fresh; when the view goes away cleanly, it is removed. A marker that is
// found STALE — its tab stopped refreshing it: the tab froze, or died — means that view took a tab
// down, and that app's custom views are not mounted again on this device until the person chooses
// "Try its screen again". An endless loop can therefore freeze Potyro at most once per app.
//
// A watchdog stop (the view stopped answering, or blocked the page for seconds) turns the app's views
// off the same way: a screen that froze Potyro once does not get to do it again by itself.
//
// Storage is injected (the shell passes `localStorage`) and every access is guarded: where storage is
// blocked the guard still works for the tab it is in, from memory.

/** What the guard needs of `Storage`. */
export interface GuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export const MARK_PREFIX = "potyro:sealed-view:mounting:";
export const OFF_KEY = "potyro:sealed-view:off";
/** A live tab refreshes its markers this often while its view answers. */
export const MARK_REFRESH_MS = 1000;
/** A marker not refreshed for this long belongs to a tab that froze or died. */
export const MARK_STALE_MS = 3000;

export interface OffEntry {
  page: string;
  at: number;
  /** Why, in English, for the console and for whoever reads storage; the shell's notice has its own words. */
  why: string;
}

interface Marker {
  app: string;
  page: string;
  at: number;
}

/** One mounted view's marker. */
export interface MountMark {
  /** The view answered: keep the marker fresh (throttled). */
  alive(): void;
  /** The page is hidden and the view healthy: a tab killed in the background is not a crash. */
  pause(): void;
  /** The page is shown again. */
  resume(): void;
  /** The view went away cleanly (or was stopped and recorded): remove the marker. */
  done(): void;
}

function memoryStorage(): GuardStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

export interface ViewGuardOptions {
  /** Default: `globalThis.localStorage`, or memory where there is none or it is blocked. */
  storage?: GuardStorage | null;
  now?: () => number;
  /** This page load's own id: its markers are its own watchdog's business, never "stale". */
  loadId?: string;
}

export class ViewGuard {
  private readonly storage: GuardStorage;
  private readonly fallback = memoryStorage();
  private readonly now: () => number;
  private readonly loadId: string;
  private seq = 0;

  constructor(opts: ViewGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.loadId = opts.loadId ?? Math.random().toString(36).slice(2, 10);
    let storage = opts.storage;
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage ?? null;
      } catch {
        storage = null; // blocked: reading the property itself throws in some engines
      }
    }
    this.storage = storage ?? this.fallback;
  }

  private get(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return this.fallback.getItem(key);
    }
  }
  private set(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      this.fallback.setItem(key, value);
    }
  }
  private remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      /* nothing to remove where nothing could be written */
    }
    this.fallback.removeItem(key);
  }
  private keys(): string[] {
    const out: string[] = [];
    for (const s of [this.storage, this.fallback]) {
      try {
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k && k.startsWith(MARK_PREFIX)) out.push(k);
        }
      } catch {
        /* unreadable storage has no markers */
      }
    }
    return [...new Set(out)];
  }

  /** Every app whose views are off on this device, by app. */
  offList(): Record<string, OffEntry> {
    try {
      const raw = this.get(OFF_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, OffEntry>) : {};
    } catch {
      return {};
    }
  }

  /**
   * Turn markers left by tabs that froze or died into "off" for their apps. Cheap; called before
   * every mount and when Potyro starts. Returns the apps it turned off.
   */
  recover(): string[] {
    const turned: string[] = [];
    const t = this.now();
    for (const key of this.keys()) {
      if (key.startsWith(`${MARK_PREFIX}${this.loadId}:`)) continue;
      let mark: Marker | null = null;
      try {
        mark = JSON.parse(this.get(key) ?? "null") as Marker | null;
      } catch {
        mark = null;
      }
      if (!mark || typeof mark.app !== "string") {
        this.remove(key);
        continue;
      }
      if (t - Number(mark.at) <= MARK_STALE_MS) continue; // another tab, alive
      this.remove(key);
      this.turnOff(mark.app, String(mark.page), "a tab stopped responding, or closed, while this app's screen was showing");
      turned.push(mark.app);
    }
    return turned;
  }

  isOff(app: string): boolean {
    this.recover();
    return Object.prototype.hasOwnProperty.call(this.offList(), app);
  }

  turnOff(app: string, page: string, why: string): void {
    const off = this.offList();
    off[app] = { page, at: this.now(), why };
    this.set(OFF_KEY, JSON.stringify(off));
  }

  /** "Try its screen again": the person asked, so the next mount goes ahead. */
  retry(app: string): void {
    const off = this.offList();
    if (!(app in off)) return;
    delete off[app];
    if (Object.keys(off).length) this.set(OFF_KEY, JSON.stringify(off));
    else this.remove(OFF_KEY);
  }

  /** A view of `app` is about to mount: the marker is written now, before any of its code runs. */
  mounting(app: string, page: string): MountMark {
    const key = `${MARK_PREFIX}${this.loadId}:${++this.seq}`;
    let written = 0;
    let state: "live" | "paused" | "done" = "live";
    const write = () => {
      written = this.now();
      this.set(key, JSON.stringify({ app, page, at: written } satisfies Marker));
    };
    write();
    return {
      alive: () => {
        if (state === "live" && this.now() - written >= MARK_REFRESH_MS) write();
      },
      pause: () => {
        if (state !== "live") return;
        state = "paused";
        this.remove(key);
      },
      resume: () => {
        if (state !== "paused") return;
        state = "live";
        write();
      },
      done: () => {
        state = "done";
        this.remove(key);
      },
    };
  }
}
