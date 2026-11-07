// Making a record's link (docs/24 §12), and joining one.
//
// A record's invite is minted by the store with peers, so the app must sync first: turning it on
// is a copy and a page load (toggle-sync.ts, the launcher's share), after which the app opens again
// on the synced store and asks for the same link — held across the load (record-link.ts).
import { t } from "@lingui/core/macro";
import type { Store } from "@potyro/store";
import type { ShownShare } from "@potyro/host";
import { withAppTarget, lineFor, type AppTarget } from "./app-link.js";
import { demoLinkFor, siteRoot } from "./app-link-make.js";
import { holdRecordShare, withRecordLink, type HeldShare, type RecordLinkPayload } from "./record-link.js";
import { shellDialogs } from "./dialog.js";
import { getUserApp, type UserApp } from "./user-apps.js";

export class SyncDeclined extends Error {
  constructor() {
    super(t`The link needs the app to sync, and that was not allowed.`);
  }
}

/**
 * Turn sync on for `app` so a record's link can be minted — with the person's say-so — and reload,
 * holding what the app asked to share so the link is offered again on the synced copy. Resolves
 * `false` when the app already syncs (nothing to do); never resolves `true`: a reload follows.
 */
export async function syncForRecordShare(app: UserApp, share: HeldShare): Promise<false> {
  if (app.sync) return false;
  const [{ canSync, cannotSyncMessage }, { askToSync }, { toggleAppSync }, { inspect }, { askNameIfUnnamed }] = await Promise.all([
    import("./open-store.js"),
    import("./sync-consent.js"),
    import("./toggle-sync.js"),
    import("./app-source.js"),
    import("./identity-panel.js"),
  ]);
  if (!canSync()) {
    await shellDialogs.confirm(cannotSyncMessage());
    throw new SyncDeclined();
  }
  if (!(await askToSync(app))) throw new SyncDeclined();
  const name = app.name;
  const ok = await shellDialogs.confirm(t`Share one of “${name}”'s records? This turns on sync for the app and copies its data into the synced store. Only the record you share leaves this device.`, {
    ok: t({ message: "Turn on sync", comment: "Button: turn sync on so a record can be shared" }),
    cancel: t`Not now`,
  });
  if (!ok) throw new SyncDeclined();
  const shape = await inspect(app.source);
  await toggleAppSync(app.id, shape.entities.map((e) => e.key), true, new Date().toISOString(), app.source);
  await askNameIfUnnamed();
  holdRecordShare(app.id, share);
  location.reload();
  // The page is going away; whoever awaits this never sees an answer.
  return new Promise<false>(() => {});
}

/**
 * A record's link, from the app as it is saved now: the app's demo link (so a stranger gets the
 * app), where to land, and the record's invite. The store must be the synced one, open.
 */
export async function makeRecordLink(app: UserApp, declaredId: string | undefined, store: Store, record: NonNullable<ShownShare["record"]>): Promise<string> {
  const line = lineFor(app, declaredId);
  if (!line) throw new Error("This app has no id to make a link to it with");
  const demo = await demoLinkFor(app);
  return recordLinkOn(demo ?? siteRoot(), { line, name: app.name, declaredId }, store, record);
}

/**
 * A record's link on a given app link: `base` is the app's demo link (a stranger gets the app from it)
 * or the site's root; `app` says where the record is and what the app is called. Also the way a
 * viewer opened from a record's link (demo.tsx) invites others to a record of its own: its base is
 * the link it arrived by, its store the synced one the record lives in.
 */
export async function recordLinkOn(base: string, app: { line: string; name: string; declaredId?: string }, store: Store, record: NonNullable<ShownShare["record"]>): Promise<string> {
  if (!store.createRecordInvite) throw new Error(t`This app does not sync yet, so a record of it cannot be shared on its own.`);
  const invite = await store.createRecordInvite(record.entity, record.id, record.role);
  const target: AppTarget = { line: app.line, ...(record.page ? { page: record.page } : {}), params: record.page && record.param ? { [record.param]: record.id } : {} };
  const payload: RecordLinkPayload = { ...invite, role: record.role, ...(app.declaredId ? { appId: app.declaredId } : {}), name: app.name };
  return withRecordLink(withAppTarget(base, target), payload);
}

/**
 * Before the share dialog opens for `ctx.ui.share({ record })` on the open app `id`: nothing to do on
 * a synced copy (`true`); on one that does not sync yet, sync is turned on first — asked, and then a
 * reload, after which the app comes back with the same request (`syncForRecordShare`) — or the
 * person said not now (`false`), and no dialog opens.
 */
export async function prepareRecordShare(id: string, share: HeldShare): Promise<boolean> {
  const app = getUserApp(id);
  if (!app) throw new Error("app not found");
  if (app.sync) return true;
  try {
    await syncForRecordShare(app, share);
    return true;
  } catch (e) {
    if (e instanceof SyncDeclined) return false;
    throw e;
  }
}

/** The link maker `ctx.ui.share({ record })` ends in, for the open app `id`, on its synced store. */
export async function recordLinkFor(id: string, store: Store, share: HeldShare): Promise<string> {
  const app = getUserApp(id);
  if (!app) throw new Error("app not found");
  const { declaredAppId } = await import("./source-declared.js");
  return makeRecordLink(app, await declaredAppId(app.source), store, share.record);
}

/** Join a record from its link into `store` (the app's, synced). Words for the person when it cannot. */
export async function joinRecordInto(store: Store, payload: RecordLinkPayload): Promise<void> {
  if (!store.joinRecord) throw new Error(t`This copy of the app does not sync, so a shared record cannot reach it.`);
  await store.joinRecord(payload);
}
