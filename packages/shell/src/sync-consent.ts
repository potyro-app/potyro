// Asking before a sandboxed app's data leaves this device (KA-23, #64).
//
// An app someone else wrote runs in the isolate precisely because its code is not yours to vouch
// for. Sync changes what that code can do: anything it writes goes into a document other people
// receive, so a shared app is a way OUT for data as surely as `ctx.caps.network` is — and network
// has asked since the day it existed (docs/07). This is the same question for the same reason.
//
// Your own apps are not asked about. You wrote them, they already run directly, and a prompt there
// would be a click to dismiss rather than a decision to make.
//
// The app's manifest (`permissions: { sync: true }`) does not decide anything on its own — it only
// changes what the question says. An app that never asked to sync can still be shared, with a
// blunter prompt and the safe answer first: refusing outright would stop people sharing apps that
// work, to enforce a declaration most authors have never heard of.

import { t } from "@lingui/core/macro";
import { shellDialogs } from "./dialog.js";
import { declaredSync } from "./app-source.js";
import type { UserApp } from "./user-apps.js";

const KEY = "potyro:sync-consent";

function granted(): Record<string, boolean> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Has this device already agreed to let `appId`'s code write into data that leaves it? */
export function syncConsented(appId: string): boolean {
  return granted()[appId] === true;
}

/** Remember the answer. Recorded per app, because it is a statement about that app's code. */
export function rememberSyncConsent(appId: string, allowed: boolean): void {
  const all = { ...granted(), [appId]: allowed };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // A device that cannot remember the answer asks again next time. Annoying, never unsafe.
  }
}

/**
 * Ask, unless this app is yours or the answer is already in.
 *
 * `true` means sync may be turned on. `false` means it must not be — the caller leaves the app
 * working on this device only, which is the point of the permission: denied is local-only, never
 * broken (KA-23).
 */
export async function askToSync(app: UserApp): Promise<boolean> {
  if (app.trusted) return true; // your own app, running directly already
  if (syncConsented(app.id)) return true;

  const asked = await declaredSync(app.source);
  const name = app.name;
  const ok = await shellDialogs.confirm(
    asked === true ? t`“${name}” was made by someone else, so it runs in a sandbox.` : t`“${name}” never asked to sync.`,
    asked === true
      ? {
          detail: t`Sharing it turns on sync: from then on its own code writes into data that leaves this device, where the people you share with can read it. The app asks for this. Share it?`,
          ok: t({ message: "Share", comment: "Button: share the app (turns sync on)" }),
          cancel: t`Not now`,
        }
      : {
          detail: t`It was made by someone else and runs in a sandbox. Sharing it would let its code write into data that leaves this device — something it does not say it needs. You can share it anyway.`,
          ok: t`Share anyway`,
          cancel: t`Don't share`,
          destructive: true,
        },
  );
  rememberSyncConsent(app.id, ok);
  return ok;
}
