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
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";

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

/** A value, short: the runtime's rules (activity.ts `show`), said in the person's language. */
function shown(v: unknown): string {
  if (v == null || v === "") return t({ message: "nothing", comment: "Activity feed: a field that has no value" });
  if (v instanceof Date) return fmt.date(v);
  if (typeof v === "boolean") return v ? t({ message: "yes", comment: "Activity feed: a ticked box" }) : t({ message: "no", comment: "Activity feed: an unticked box" });
  if (typeof v === "number") return fmt.number(v);
  if (Array.isArray(v)) return v.length ? v.map(shown).join(", ") : t({ message: "nothing", comment: "Activity feed: a field that has no value" });
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "title", "label"]) if (typeof o[k] === "string") return o[k] as string;
    return t({ message: "something", comment: "Activity feed: a value that cannot be shown in words" });
  }
  return String(v);
}

/**
 * The line for one change. The runtime assembles an English one (`item.text`, kept for its tests and
 * its other readers); the feed says it in the person's language from the same parts. Yourself and
 * someone else are separate sentences, because many languages conjugate them differently.
 */
function sentence(item: ActivityItem, me: boolean): string {
  const who = item.byName;
  const field = item.fieldLabel;
  const to = shown(item.to);
  const record = item.recordLabel;
  if (item.from === undefined) {
    if (me) return record ? t`You set ${field} to ${to} on ${record}` : t`You set ${field} to ${to}`;
    return record ? t`${who} set ${field} to ${to} on ${record}` : t`${who} set ${field} to ${to}`;
  }
  const from = shown(item.from);
  if (me) return record ? t`You changed ${field} from ${from} to ${to} on ${record}` : t`You changed ${field} from ${from} to ${to}`;
  return record ? t`${who} changed ${field} from ${from} to ${to} on ${record}` : t`${who} changed ${field} from ${from} to ${to}`;
}

/** "2 minutes ago" — precise enough for a feed, and it never says "in -3 seconds". */
function ago(at: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (seconds < 60) return t({ message: "just now", comment: "Activity feed: when a change was made, under a minute ago" });
  // "5m ago", "2h ago" in English; each language's own short form elsewhere.
  if (seconds < 24 * 3600) return fmt.relative(at, now, { numeric: "auto", style: "narrow" });
  return fmt.date(at, { dateStyle: "short" });
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
  const { t } = useLingui();
  const now = Date.now();
  const appName = runtime.definition.name;
  const me = runtime.ctx.me?.id;

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
        aria-label={t`What changed`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="k-activity-head">
          <h2>
            <Trans>What changed</Trans>
          </h2>
          <button type="button" className="k-add" onClick={close} aria-label={t`Close`}>
            ✕
          </button>
        </header>

        {items.length === 0 ? (
          <p className="k-muted">
            <Trans>Nothing since you last looked. Changes made by anyone you share {appName} with will show up here.</Trans>
          </p>
        ) : (
          <ul className="k-activity-list">
            {items.map((item) => (
              <li key={`${item.recordId}:${item.field}:${item.at.getTime()}`} className="k-activity-item">
                <span className="k-activity-text">{sentence(item, item.by === me)}</span>
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
