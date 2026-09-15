// Shell entry / composition root wiring. Every app — the seeded examples included (#152) — is a
// saved source: trusted ones run direct, untrusted ones in the QuickJS-WASM isolate. `pnpm
// dev:sandbox` (mode "sandbox") seeds the examples untrusted, which is what exercises the isolate.

import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { KartaRecord } from "karta";
import { createMemorySqliteStore, importSqliteStore, packBundle, unpackBundle, type Store } from "@karta/store";
import { openStore } from "./open-store.js";
import { readOnlyStore } from "./read-only-store.js";
import { migrateOnLoad } from "./migrate-on-load.js";
import { getLaunchUrl, onUrlOpen } from "@karta/native";
import { createWebCapabilities, type Capabilities } from "@karta/capabilities";
import { maybeCreateNativeCapabilities } from "@karta/native";
import type { Provenance } from "@karta/host";
import type { KartaRuntime } from "@karta/runtime";
import { App } from "./App.js";
import { Studio } from "./studio.js";
import { Launcher, openInstalledApp } from "./launcher.js";
import { appKey, recordOpen, recordSignals } from "./launcher-store.js";
import { seedExamples } from "./examples.js";
import { restoreScope } from "./scope.js";
import { getUserApp } from "./user-apps.js";
import { Toaster } from "./toaster.js";
import { compose, type Composed } from "./compose.js";
import { createNavBridge, createUiBridge } from "./ui-bridge.js";
import { NavHost } from "./nav-host.js";
import { Dialogs, shellDialogs } from "./dialog.js";
import { UiHost } from "./ui-host.js";
import { PickerHost } from "./picker.js";
import { seedIfEmpty } from "./seed.js";
import { startReminderSync, watchReminderTimes } from "./reminder-sync.js";

const SANDBOX = import.meta.env.MODE === "sandbox";

// Route from the URL: a saved app (?user=, or the older ?app= that named an example) or the home.
// The examples are ordinary apps (#152), so `?app=recipes` is the same app as `?user=recipes`.
type Route = { kind: "user"; id: string } | { kind: "home" };
function route(): Route {
  const p = new URLSearchParams(location.search);
  const id = p.get("user") ?? p.get("app");
  if (id && getUserApp(id)) return { kind: "user", id };
  return { kind: "home" };
}

// Export the current app as a portable `.karta.zip` bundle (KA-04): logic + a real SQLite data file
// + manifest + CSV/JSON, saved via the filesystem cap. The current data is snapshotted into a fresh
// in-memory SQLite so a genuine `data.sqlite` is produced from ANY durable store (even the LocalStore
// fallback) — the export never depends on the browser having OPFS.
async function exportApp(
  runtime: KartaRuntime,
  store: Store,
  caps: Capabilities,
  provenance: Provenance,
  appSource: string | undefined,
  toaster: Toaster,
): Promise<void> {
  const def = runtime.definition;
  const rowsByEntity: Record<string, KartaRecord[]> = {};
  for (const entity of Object.keys(def.entities)) rowsByEntity[entity] = await store.all(entity);

  const snapshot = await createMemorySqliteStore(def.id);
  try {
    for (const [entity, rows] of Object.entries(rowsByEntity)) {
      for (const row of rows) await snapshot.store.insert(entity, row);
    }
    const zip = packBundle({
      sqlite: snapshot.export(),
      manifest: {
        format: "karta-bundle/1",
        appId: def.id,
        appVersion: def.version,
        schemaVersion: def.schemaVersion,
        provenance,
        grantedCaps: Object.keys(def.permissions ?? {}),
        mode: "snapshot",
        exportedAt: new Date().toISOString(),
        entities: Object.keys(def.entities),
      },
      appSource,
      rowsByEntity,
    });
    await caps.filesystem.save(`${def.id}.karta.zip`, new Blob([zip as BlobPart], { type: "application/zip" }));
    toaster.push(`Exported ${def.id}.karta.zip`);
  } finally {
    snapshot.destroy();
  }
}

// Session-storage handoff for an import: the picked bundle's data.sqlite bytes (base64) survive the
// reload so the OPFS pool VFS is installed exactly once — on the fresh page — before the store opens.
const IMPORT_KEY = "karta:import";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Import a `.karta.zip` bundle's data into the matching app (KA-04): pick → unpack → stash the
// SQLite bytes → reload into that app, where boot() restores them into the durable store.
async function importApp(caps: Capabilities, toaster: Toaster): Promise<void> {
  let blob: Blob;
  try {
    blob = await caps.filesystem.pick();
  } catch {
    return; // cancelled
  }
  const zip = new Uint8Array(await blob.arrayBuffer());
  let appId: string;
  let sqlite: Uint8Array;
  try {
    const bundle = unpackBundle(zip);
    appId = bundle.manifest.appId;
    sqlite = bundle.sqlite;
  } catch {
    toaster.push("Not a valid Karta export bundle.");
    return;
  }
  const target = getUserApp(appId);
  if (!target) {
    toaster.push(`No app "${appId}" installed to import into.`);
    return;
  }
  if (target.sync) {
    toaster.push(`"${target.name}" is synced; a data import would overwrite what others share.`);
    return;
  }
  sessionStorage.setItem(IMPORT_KEY, bytesToBase64(sqlite));
  location.search = `?user=${encodeURIComponent(appId)}`; // reload → boot() detects the pending import
}

// The launcher home — first surface when no app is selected. A tile launches (reload → ?user=);
// "New app" opens the Studio in place.
function Home() {
  const [studio, setStudio] = useState<{ prefill?: string } | null>(null);
  return (
    <>
      <Launcher variant="home" onOpen={openInstalledApp} onNewApp={(prefill) => setStudio({ prefill })} />
      {studio ? <Studio onClose={() => setStudio(null)} initialDescription={studio.prefill} /> : null}
    </>
  );
}

// One React root per document, reused.
//
// `mount` is called from several boot paths, and some of them run in sequence — a user app that has
// been deleted mounts the launcher after boot has already mounted something. Calling `createRoot` a
// second time on the same element makes React warn and leaves the first root orphaned, still
// subscribed to the store.
let reactRoot: ReturnType<typeof createRoot> | null = null;

function mount(root: HTMLElement, node: ReactNode): void {
  reactRoot ??= createRoot(root);
  reactRoot.render(
    <StrictMode>
      {node}
      {/* Once, around every route — home, a built-in, or a saved app. */}
      <Dialogs host={shellDialogs} />
    </StrictMode>,
  );
  registerServiceWorker();
  registerDeepLinks();
}

// A saved user app. UNTRUSTED by default (isolate); if the user promoted it, TRUSTED (direct) — the
// source runs as a real module. A trusted load that fails (e.g. an edited, invalid version) falls
// back to untrusted so the app still opens. Either way it has its own durable store.
/** A `#join=…` link means someone shared a synced app. Accept it, then open it as a normal app. */
async function bootInviteIfPresent(root: HTMLElement): Promise<string | null> {
  const { pendingInvite, acceptInvite, usesCustomViews } = await import("./share-sync.js");
  // Web: the address bar. Device COLD start: the app was launched by the link, so nothing has
  // listened yet and the URL must be fetched. (Warm starts are handled by the listener below.)
  const invite = pendingInvite() ?? pendingInvite((await getLaunchUrl()) ?? undefined);
  if (!invite) return null;

  // Ask BEFORE opening. A shared app runs sandboxed by default, and a sandboxed app whose screens
  // are its own code renders nothing — so opening first and asking later meant landing in an empty
  // app with a message about a control you had not found yet.
  // `shellDialogs` renders through a mounted host; at this point in boot nothing is on screen yet,
  // so the prompt would resolve into a void. Mount SOMETHING first — `mount` brings the dialog host
  // with it — plus a line of context so the page is not blank behind the question.
  // Modern links state this outright; legacy ones still carry the source to inspect.
  const custom = invite.custom ?? (invite.source ? usesCustomViews(invite.source) : false);
  mount(
    root,
    <div className="k-joining">
      <p>Joining “{invite.name}”…</p>
    </div>,
  );
  const trust = await shellDialogs.confirm(
    `"${invite.name}" was shared with you.\n\n` +
      (custom
        ? "Its screens are built with its own code, so it needs to run trusted to display them. Trust this app?"
        : "Apps from other people run sandboxed by default. Trust this app so it runs directly?") +
      "\n\nYou can change this later from the app header.",
  );

  // Asked after trust and before joining. After, because "do you trust this app?" is the question
  // the user opened the link to answer and nothing should come between them and it. Before, because
  // joining is what materialises your account for the people already in the space — answer later and
  // the person who invited you watches "Me" arrive.
  const { askNameIfUnnamed } = await import("./identity-panel.js");
  await askNameIfUnnamed();

  try {
    const id = await acceptInvite(invite, trust);
    // Drop the fragment so a reload does not re-accept, and so the secret stops sitting in the bar.
    history.replaceState(null, "", `${location.pathname}?user=${encodeURIComponent(id)}`);
    return id;
  } catch (e) {
    root.textContent = `Could not join: ${e instanceof Error ? e.message : String(e)}`;
    return null;
  }
}

/** Run pending migrations, reporting rather than crashing the app if they fail. */
async function runMigrationsIfPossible(
  definition: Parameters<typeof migrateOnLoad>[1],
  store: Parameters<typeof migrateOnLoad>[0],
  toaster: Toaster,
): Promise<void> {
  try {
    const { ran, from } = await migrateOnLoad(store, definition);
    if (ran.length) toaster.push(`Updated your data from ${from} to ${definition.version}.`);
  } catch (e) {
    // A failed migration must not leave the user staring at a blank screen with no explanation.
    // The app still opens; the data is simply not migrated yet.
    console.warn("[karta] migration failed:", e);
    toaster.push(`Could not update your data: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function bootUserApp(id: string, root: HTMLElement, toaster: Toaster, caps: Capabilities): Promise<void> {
  const saved = getUserApp(id);
  if (!saved) {
    mount(root, <Home />); // deleted out from under us → home
    return;
  }

  // Mount BEFORE anything that can ask a question. This is load-bearing, not cosmetic.
  //
  // `shellDialogs.confirm` returns a promise that settles only when a `<Dialogs>` host renders the
  // request and someone answers it. Boot awaits one of those — "this app was updated by someone you
  // share it with" — seventy lines before the app was mounted, so on a device that had an update
  // waiting the promise could never settle: boot stopped there and the page stayed WHITE. Forever,
  // through every reload, because the same update was still pending on the next boot.
  //
  // It needed two devices and an edit on one of them to happen at all, which is why it survived: the
  // update path has no unit coverage that can see a React tree, and every browser spec that shared
  // an app either never edited it afterwards or never reopened the other device.
  //
  // `mount` brings the dialog host with it, so mounting anything is enough. A line of text is also
  // the honest thing to show while a CRDT store, an identity and a space are being opened.
  mount(
    root,
    <div className="k-joining">
      <p>Opening “{saved.name}”…</p>
    </div>,
  );

  // Sync is per app (ADR 0001 D3): a Jazz-backed CRDT store when the user opted in, otherwise
  // exactly the previous SqliteStore/LocalStore path.
  // A data import (KA-04) lands here after the reload it triggers. Otherwise the store opens, and
  // an empty one gets its first-run rows from `seedIfEmpty` — keyed by app id, so the examples are
  // filled the way they always were, now as ordinary apps (#152).
  let rawStore: Store;
  const pending = sessionStorage.getItem(IMPORT_KEY);
  if (pending && !saved.sync) {
    sessionStorage.removeItem(IMPORT_KEY);
    rawStore = await importSqliteStore(`user:${id}`, base64ToBytes(pending));
    toaster.push(`Imported data into ${saved.name}.`);
  } else {
    rawStore = await openStore(`user:${id}`, { sync: saved.sync });
    await seedIfEmpty(rawStore, id);
  }

  // Who this device is (KA-18). Minted on first run with crypto alone — no database, no network —
  // so it is the same person whether or not this app has ever synced. `ctx.me` is always present,
  // which is what lets app code stop branching on whether identity exists.
  const { ensureIdentity } = await import("@karta/identity");
  const me = await ensureIdentity();

  // The space, for `ctx.space` — only for a synced app. Solo stays `undefined` rather than becoming
  // a one-member space object, so `ctx.space?.members ?? [ctx.me]` reads correctly and app code
  // never has to ask whether sync is on.
  const space = saved.sync
    ? await (async () => {
        const { currentSpace, liveSpace, watchSpace } = await import("./open-store.js");
        const s = await currentSpace();
        if (!s) return undefined;
        // Keep it current from here on: membership changes when someone joins, and a snapshot would
        // leave every later edit of theirs attributed to an account id.
        await watchSpace();
        // The tile remembers who is here (#87): the launcher cannot open every store to ask.
        const { onSpaceChange } = await import("./open-store.js");
        const { updateEntry } = await import("./launcher-store.js");
        const remember = (): void => {
          const members = (liveSpace() ?? s).members.map((m) => ({ id: m.id, name: m.name }));
          updateEntry(appKey("user", id), { people: members });
        };
        remember();
        onSpaceChange(remember);
        return () => ({
          ...(liveSpace() ?? s),
          // Host-mediated: the shell owns the UI and the admin check, so an app cannot hand its
          // space to a stranger without the user seeing it happen.
          invite: async (): Promise<string> => {
            const { createShareLink } = await import("./share-sync.js");
            return createShareLink(id);
          },
        });
      })()
    : undefined;

  // A synced app shares its SOURCE through the space too, so an edit by one person reaches the
  // others instead of silently diverging (and, if the edit changed the schema, silently misreading
  // each other's records).
  let store = rawStore;
  if (saved.sync) {
    const appSync = await import("./app-sync.js");
    // The newest version's own record of WHY this source looks like this, so it travels with it.
    // Read from history rather than kept on `UserApp`: history is already the one place that answers
    // "what was asked for", and duplicating it onto the app record would give it two answers to
    // disagree about.
    const { listVersions } = await import("./app-history.js");
    const latest = (await listVersions(id))[0];
    const mine = {
      source: saved.source,
      name: saved.name,
      updatedAt: saved.updatedAt,
      schemaVersion: appSync.schemaVersionOf(saved.source),
      // Only when they describe THIS source. A stale note from an older version would be worse than
      // none: it would explain a change that is not the one you are looking at.
      ...(latest?.source === saved.source ? { note: latest.note, rationale: latest.rationale } : {}),
    };
    const update = await appSync.pendingAppUpdate(store, mine);
    // A newer SCHEMA is not merely a nicer version — writing with the old one puts records into the
    // shared document in a shape the current app does not expect, and every peer replicates them.
    const behind = appSync.isSchemaBehind(mine, await appSync.readPublishedApp(store));
    if (update) {
      const take = await shellDialogs.confirm(
        behind
          ? `“${update.name}” has been updated to a newer version.\n\nUpdate to keep making changes. Until you do, the app opens read-only so an old version cannot corrupt the shared data.\n\nUpdate now?`
          : `“${update.name}” was updated by someone you share it with.\n\nUpdate your copy? Your version is kept in History, so you can go back.`,
      );
      if (take) {
        const { saveUserApp } = await import("./user-apps.js");
        await saveUserApp(
          {
            id,
            name: update.name,
            source: update.source,
            origin: "imported",
            // What they asked for, when they published it. The bare "updated by a collaborator" is
            // the fallback for a copy published before notes travelled, not the normal case.
            note: update.note ? `${update.note} — from a collaborator` : "updated by a collaborator",
            ...(update.rationale ? { rationale: update.rationale } : {}),
          },
          new Date().toISOString(),
        );
        location.reload();
        return;
      }
      if (behind) {
        // Declined while behind: readable, not writable, and it says why rather than failing
        // mysteriously at the first tap.
        store = readOnlyStore(store, `This app has been updated. Your copy is an older version, so it is read-only until you update.`);
        toaster.push("Read-only: this app has a newer version. Reload to update.");
      }
    } else {
      // Only publishes when this copy is strictly newer, so declining an update above does not
      // push the older source back over the newer one.
      void appSync.publishAppSource(store, mine);
    }
  }
  const picker = new PickerHost();
  const questions = new UiHost();
  const ui = createUiBridge(toaster.push, picker, shellDialogs, questions);
  const navHost = new NavHost();
  const nav = createNavBridge((pageId, param) => navHost.navigate(pageId, param));

  let composed: Composed;
  let provenance: Provenance = "untrusted";
  let appSource: string | undefined;

  if (saved.trusted) {
    try {
      const { loadTrustedModule } = await import("./trusted-loader.js");
      const app = await loadTrustedModule(saved.source); // real defineApp validates or throws
      composed = await compose({ provenance: "trusted", app, store, caps, ui, nav, me, space });
      provenance = "trusted";
    } catch (e) {
      toaster.push(`Couldn't run "${saved.name}" trusted; opening safely. ${e instanceof Error ? e.message : ""}`.trim());
    }
  }
  if (provenance === "untrusted") {
    const [{ createAppBundler }, { createSandboxLoader }] = await Promise.all([
      import("./app-bundler.js"),
      import("./isolate-bridge.js"),
    ]);
    appSource = await (await createAppBundler())(saved.source);
    composed = await compose({ provenance: "untrusted", bundleCode: appSource, store, caps, ui, nav, me, space, loadIsolated: await createSandboxLoader(store) });
  }
  // Membership changes re-render the app. Wired here because the runtime does not exist when the
  // space is first read, and a view showing "who is in this list" is otherwise stale until some
  // unrelated write happens to refresh it.
  if (saved.sync) {
    const { onSpaceChange } = await import("./open-store.js");
    onSpaceChange(() => composed!.runtime.core.invalidate());
  }

  await runMigrationsIfPossible(composed!.runtime.definition, store, toaster);
  startReminderSync(composed!.runtime, store);
  // The launcher badge's reminders (#86): due times, so one that falls due while the app is closed counts.
  watchReminderTimes(composed!.runtime, store, (due) => recordSignals(appKey("user", id), { due }));
  await restoreScope(composed!.runtime, id);

  mount(
    root,
    <App
      navHost={navHost}
      picker={picker}
      questions={questions}
      sync={saved.sync}
      runtime={composed!.runtime}
      provenance={provenance}
      toaster={toaster}
      appId={id}
      currentKind="user"
      onExport={() => void exportApp(composed!.runtime, store, caps, provenance, appSource, toaster)}
      onImport={() => void importApp(caps, toaster)}
      generator
    />,
  );
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  // The examples are ordinary apps (#152): seeded into the registry once, then yours to edit,
  // share or delete. Under `dev:sandbox` they are seeded untrusted, which is what exercises the
  // isolate. Before routing, because routing asks the registry whether an app exists.
  await seedExamples({ trusted: !SANDBOX, now: new Date().toISOString() });

  // A shared link is handled before routing: it creates the local app, so the route it should land
  // on does not exist until the invite has been accepted.
  const joined = await bootInviteIfPresent(root);
  if (joined) {
    const toaster = new Toaster();
    const caps = (await maybeCreateNativeCapabilities()) ?? createWebCapabilities();
    await bootUserApp(joined, root, toaster, caps);
    return;
  }

  const r = route();
  if (r.kind === "home") {
    mount(root, <Home />);
    return;
  }
  // An open is an open however it came about — a tile, a deep link, a reload — so it is counted
  // here, where every route to an app passes, not on the tile click (#81).
  recordOpen(appKey(r.kind, r.id), new Date().toISOString());

  const toaster = new Toaster();
  // Native (Capacitor) capabilities on a device — chiefly EXACT offline notifications — else web.
  // Only imported when actually on a device (web bundle stays Capacitor-free). Sole target-selection.
  const caps = (await maybeCreateNativeCapabilities()) ?? createWebCapabilities();

  await bootUserApp(r.id, root, toaster, caps);
}

/**
 * A link opening the app while it is ALREADY running (device warm start).
 *
 * Reloading onto the invite is deliberate: joining rebuilds the store, the identity and the
 * runtime, and doing that underneath a mounted app is far more failure-prone than starting clean.
 */
let deepLinksRegistered = false;

function registerDeepLinks(): void {
  // `mount` runs on every route, so without this each navigation would add another listener and a
  // single incoming link would fire the join path several times over.
  if (deepLinksRegistered) return;
  deepLinksRegistered = true;
  void onUrlOpen((url) => {
    if (!/[#&]join=/.test(url)) return;
    const hash = url.slice(url.indexOf("#"));
    location.replace(`${location.pathname}${hash}`);
  });
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  // NEVER in dev. The SW is cache-first, so in dev it serves stale modules indefinitely: an edit is
  // invisible until the cache happens to miss, and a route change (which is a real navigation —
  // `location.search = ...`) reliably replays the OLD bundle. Actively tear down any SW + caches a
  // previous dev session installed, otherwise it keeps serving this page forever.
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister())));
    if ("caches" in globalThis) void caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))));
    return;
  }

  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* offline SW is best-effort */
  });
}

boot().catch((err: unknown) => {
  const root = document.getElementById("root");
  if (root) root.textContent = `Boot error: ${err instanceof Error ? err.message : String(err)}`;
  // eslint-disable-next-line no-console
  console.error(err);
});
