// "What changed while I was away" (KA-36).
//
// Derived from the CRDT log, never posted by the app: `activitySince` folds `Store.editHistory`
// into lines. Nothing is written to make this work, so it is retroactive — it reports edits made
// long before this panel existed — and the author cannot be forged, because it comes from the
// signing session rather than from a field (KA-18).
//
// ## The watermark is LOCAL
//
// Decided 2026-08-09: "what I have seen" lives in `localStorage` on this device. It is the cheapest
// and most private option — nobody learns whether you read anything, and nothing extra crosses the
// wire. The cost is that unread does not follow you to a second device, which is a fair trade until
// someone actually wants it.
//
// ## Two things this must not do
//
// It must not appear for an app that CANNOT answer. Only a CRDT store keeps history, so a local-only
// app has no activity — and an empty panel there would claim "nothing happened" when the truth is
// "this app does not record that".
//
// And it must not be a hover-only control. `docs/15` D1: the per-app buttons in the launcher are
// `opacity: 0` until `:hover`, which means they do not exist on a phone. This one is always visible.

import { useEffect, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import { activitySince, activitySupported, type ActivityItem } from "@potyro/runtime";

/** Where this device remembers what it has already shown you. Local by design — see the header. */
const seenKey = (appId: string): string => `potyro:seen:${appId}`;

export function lastSeen(appId: string): Date | undefined {
  const raw = globalThis.localStorage?.getItem(seenKey(appId));
  if (!raw) return undefined;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

export function markSeen(appId: string, at: Date = new Date()): void {
  globalThis.localStorage?.setItem(seenKey(appId), at.toISOString());
}

/**
 * Load what has changed since this device last looked.
 *
 * Returns `null` when the store cannot answer, which the caller must treat differently from an empty
 * list: one means "nothing happened", the other means "this app does not keep that".
 */
export async function loadActivity(runtime: PotyroRuntime, appId: string): Promise<ActivityItem[] | null> {
  const store = runtime.core.store;
  if (!activitySupported(store)) return null;
  const ctx = runtime.ctx;

  // Membership is read FRESH, not taken from `ctx.space`.
  //
  // `ctx.space` is a snapshot built once at boot, so a page opened before someone joined lists only
  // the people who were there then — and every later edit of theirs renders as a truncated account
  // id, which is precisely the case this panel exists to report. Whoever changed something is by
  // definition in the space now, so the list has to be current.
  const { currentSpace } = await import("./open-store.js");
  const space = await currentSpace().catch(() => null);

  return activitySince(
    {
      store,
      definition: runtime.definition,
      me: ctx.me,
      members: space?.members ?? ctx.space?.members,
    },
    lastSeen(appId),
    { limit: 100 },
  );
}

/** "2 minutes ago" — precise enough for a feed, and it never says "in -3 seconds". */
function ago(at: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return at.toLocaleDateString();
}

export function ActivityPanel({
  runtime,
  appId,
  items,
  onClose,
}: {
  runtime: PotyroRuntime;
  appId: string;
  items: ActivityItem[];
  onClose: () => void;
}) {
  const now = Date.now();

  // Reading the panel IS having seen it, so the watermark moves on close rather than on open —
  // closing it without reading would otherwise silently discard everything it was showing.
  const close = (): void => {
    markSeen(appId);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  });

  return (
    <div className="k-modal-scrim" onClick={close}>
      <div
        className="k-modal k-activity"
        role="dialog"
        aria-modal="true"
        aria-label="What changed"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="k-activity-head">
          <h2>What changed</h2>
          <button type="button" className="k-add" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>

        {items.length === 0 ? (
          <p className="k-muted">
            Nothing since you last looked. Changes made by anyone you share {runtime.definition.name} with
            will show up here.
          </p>
        ) : (
          <ul className="k-activity-list">
            {items.map((item) => (
              <li key={`${item.recordId}:${item.field}:${item.at.getTime()}`} className="k-activity-item">
                <span className="k-activity-text">{item.text}</span>
                <time className="k-activity-when" dateTime={item.at.toISOString()}>
                  {ago(item.at, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
