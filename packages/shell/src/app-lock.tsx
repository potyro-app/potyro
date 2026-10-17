// "This copy may not write" — the visible half of the KA-22 version gate (#63).
//
// The store half is `guardedStore`: it refuses writes while a lock is set. This is what the person
// sees while it does — a banner that says why and offers the way out, and the app's own add/delete
// buttons drawn inactive, so a locked app does not look like a broken one.
//
// Two reasons to lock, and they need different ways out:
//
//   version  someone published a newer schema; this copy is older → take their version
//   data     this copy is the newer one, but the shared data has not been changed to match yet,
//            and the person said "not now" to changing it → change it
//
// A small external store rather than React state: the lock is decided by boot and by a live watch
// on the space, both outside the tree, and the store wrapper reads it on every write.

import { useSyncExternalStore } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { i18n } from "@potyro/i18n";

export type LockKind = "version" | "data";

export interface LockState {
  kind: LockKind;
  /** Takes the way out: installs the newer version, or updates the shared data. */
  resolve: () => Promise<void>;
}

// Descriptors, read when shown: the words must follow a language switch.
const REFUSAL: Record<LockKind, MessageDescriptor> = {
  version: msg`Read-only: this app has a newer version. Update to keep making changes.`,
  data: msg`Read-only: your data still uses the previous version. Update it to keep making changes.`,
};

const BANNER: Record<LockKind, { body: MessageDescriptor; action: MessageDescriptor }> = {
  version: {
    body: msg`This app has a newer version. Update to keep making changes.`,
    action: msg({ message: "Update", comment: "Lock banner button: install the newer version of the app" }),
  },
  data: { body: msg`Your data still uses the previous version. Update it to keep making changes.`, action: msg`Update data` },
};

export class AppLock {
  private state: LockState | null = null;
  private listeners = new Set<() => void>();

  get = (): LockState | null => this.state;

  set(state: LockState | null): void {
    this.state = state;
    for (const l of this.listeners) l();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  /** Why a write is refused right now, or `null` when it is not. What `guardedStore` asks. */
  refusal = (): string | null => (this.state ? i18n._(REFUSAL[this.state.kind]) : null);
}

export function useAppLock(lock: AppLock | undefined): LockState | null {
  return useSyncExternalStore(lock?.subscribe ?? noSubscribe, lock?.get ?? noState);
}
const noSubscribe = (): (() => void) => () => {};
const noState = (): null => null;

/**
 * The controls that write. Drawn inactive while locked, and a tap on one explains instead of acting.
 *
 * Class names rather than a prop threaded through every view: views are the app's, and the lock is
 * the shell's business. A write control this misses still cannot write — the store refuses it and
 * the refusal says the same thing — it just does not look inactive first.
 */
export const WRITE_CONTROLS = ".k-quick, .k-action";

export function LockBanner({ state }: { state: LockState }) {
  const { t } = useLingui();
  const words = BANNER[state.kind];
  return (
    <div className="k-lock-banner" role="status">
      <span className="k-lock-icon" aria-hidden="true">
        🔒
      </span>
      <div className="k-lock-text">
        <strong>
          <Trans>Read-only</Trans>
        </strong>
        <span>{t(words.body)}</span>
      </div>
      <button type="button" className="k-add k-primary-action" onClick={() => void state.resolve()}>
        {t(words.action)}
      </button>
    </div>
  );
}

export function lockRefusal(kind: LockKind): string {
  return i18n._(REFUSAL[kind]);
}
