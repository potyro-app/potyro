// A real `ctx.ui.pick` — a modal list instead of the numbered text prompt the bridge shipped with.
//
// The prompt version was unusable for its actual job: choosing an exercise mid-set means reading a
// numbered list and typing a digit, one-handed, with a rest clock running. This is a searchable list
// of large tap targets.
//
// Shape mirrors `Toaster`: a tiny store the bridge pushes to and the App subscribes to. `pick()`
// returns a promise that settles when the user chooses or dismisses — so app code keeps awaiting a
// value and never learns there is a React tree involved.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export interface PickRequest {
  items: readonly unknown[];
  label: (item: unknown) => string;
  multi: boolean;
  settle: (value: unknown) => void;
}

export class PickerHost {
  private current: PickRequest | null = null;
  private listeners = new Set<() => void>();

  /** Backs `ctx.ui.pick`. Resolves with the chosen item(s), or null if dismissed. */
  pick = <T,>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null> =>
    new Promise((resolve) => {
      // A second request while one is open would strand the first promise: settle it as cancelled.
      this.current?.settle(null);
      this.current = {
        items,
        label: (item) => (opts?.label ? opts.label(item as T) : String(item)),
        multi: Boolean(opts?.multi),
        settle: (value) => {
          this.current = null;
          this.emit();
          resolve(value as T | T[] | null);
        },
      };
      this.emit();
    });

  get = (): PickRequest | null => this.current;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

export function Picker({ host }: { host: PickerHost }) {
  const request = useSyncExternalStore(host.subscribe, host.get, host.get);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Fresh query/selection per request, and focus the search box so typing filters immediately.
  useEffect(() => {
    if (!request) return;
    setQuery("");
    setChosen(new Set());
    searchRef.current?.focus();
  }, [request]);

  const rows = useMemo(() => {
    if (!request) return [];
    const q = query.trim().toLowerCase();
    return request.items
      .map((item, index) => ({ item, index, text: request.label(item) }))
      .filter((r) => !q || r.text.toLowerCase().includes(q));
  }, [request, query]);

  if (!request) return null;

  const cancel = (): void => request.settle(null);
  const commit = (): void =>
    request.settle(request.items.filter((_, i) => chosen.has(i)));
  const choose = (index: number): void => {
    if (!request.multi) {
      request.settle(request.items[index]);
      return;
    }
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div
      className="k-modal-scrim"
      onClick={cancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <div className="k-modal k-picker" role="dialog" aria-label="Choose" onClick={(e) => e.stopPropagation()}>
        <input
          ref={searchRef}
          className="k-input"
          type="search"
          placeholder="Search…"
          aria-label="Filter the list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            // Type a few letters, hit Enter, keep training.
            if (e.key === "Enter" && !request.multi && rows[0]) choose(rows[0].index);
          }}
        />

        <ul className="k-picker-list">
          {rows.length === 0 ? (
            <li className="k-muted k-picker-empty">Nothing matches “{query}”.</li>
          ) : (
            rows.map((r) => (
              <li key={r.index}>
                <button
                  type="button"
                  className={`k-picker-row${chosen.has(r.index) ? " is-chosen" : ""}`}
                  aria-pressed={request.multi ? chosen.has(r.index) : undefined}
                  onClick={() => choose(r.index)}
                >
                  <span>{r.text}</span>
                  {request.multi ? <span aria-hidden>{chosen.has(r.index) ? "✓" : ""}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="k-form-actions">
          <button type="button" className="k-add" onClick={cancel}>Cancel</button>
          {request.multi ? (
            <button type="button" className="k-add k-primary-action" onClick={commit}>
              Add {chosen.size || ""}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
