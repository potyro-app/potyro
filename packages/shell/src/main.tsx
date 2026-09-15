// Shell entry / composition root wiring. Every app — the seeded examples included (#152) — is a
// saved source: trusted ones run direct, untrusted ones in the QuickJS-WASM isolate. `pnpm
// dev:sandbox` (mode "sandbox") seeds the examples untrusted, which is what exercises the isolate.

import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { KartaRecord } from "karta";
import { copyStoreData, createMemorySqliteStore, packBundle, unpackBundle, type Store } from "@karta/store";
import { openStore } from "./open-store.js";
import { guardedStore } from "./read-only-store.js";
import { AppLock } from "./app-lock.js";
import { migrateOnLoad } from "./migrate-on-load.js";
import { getLaunchUrl, onUrlOpen } from "@karta/native";
import { createWebCapabilities, type Capabilities } from "@karta/capabilities";
import { maybeCreateNativeCapabilities, maybeCreateNativeVault } from "@karta/native";
import { browserVault, deferredVault, secureIdentitySecrets, setSecretVault } from "@karta/identity";
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
import { setRouteHandler } from "./router.js";

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

/**
 * Replace an app's records with a bundle's (KA-04), in whatever store the app uses.
 *
 * This used to hand the bundle's SQLite file to OPFS directly, which is only there where OPFS SQLite
 * is — everywhere else (Firefox, the LocalStore fallback, a locked-down browser) the app failed to
 * boot with "Missing required OPFS APIs". The file is now opened as an in-memory database, which
 * works anywhere, and its rows are copied into the app's own store with their ids, dates, photos and
 * app storage intact. The records it replaces are removed first, so what you import is what you have.
 */
async function replaceWithBundle(target: Store, pending: string, appId: string): Promise<void> {
  let stash: { sqlite: string; entities?: string[] };
  try {
    stash = JSON.parse(pending) as { sqlite: string; entities?: string[] };
  } catch {
    stash = { sqlite: pending }; // stashed by a build that kept only the bytes
  }
  const entities = stash.entities?.length
    ? stash.entities
    : (await (await import("./app-source.js")).inspect(getUserApp(appId)?.source ?? "")).entities.map((e) => e.key);
  const bundle = await createMemorySqliteStore(appId, { bytes: base64ToBytes(stash.sqlite) });
  try {
    for (const entity of entities) {
      for (const row of await target.all(entity)) await target.delete(entity, row.id);
    }
    await copyStoreData(bundle.store, target, { entities });
  } finally {
    bundle.destroy();
  }
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
  let entities: string[];
  try {
    const bundle = unpackBundle(zip);
    appId = bundle.manifest.appId;
    sqlite = bundle.sqlite;
    entities = bundle.manifest.entities ?? [];
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
  sessionStorage.setItem(IMPORT_KEY, JSON.stringify({ sqlite: bytesToBase64(sqlite), entities }));
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

/** How many apps are open and not yet put away — exposed in dev so a spec can see switching leaks nothing. */
function liveApps(delta: number): void {
  if (!import.meta.env.DEV) return;
  const g = globalThis as unknown as { __kartaLiveApps?: number };
  g.__kartaLiveApps = (g.__kartaLiveApps ?? 0) + delta;
}

/** An open app, and how to put it away when another route takes the screen (#89). */
interface Opened {
  sync: boolean;
  dispose: () => Promise<void>;
}

async function bootUserApp(id: string, root: HTMLElement, toaster: Toaster, caps: Capabilities, isCurrent: () => boolean = () => true): Promise<Opened | null> {
  const saved = getUserApp(id);
  if (!saved) {
    mount(root, <Home />); // deleted out from under us → home
    return null;
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
    rawStore = await openStore(`user:${id}`, { sync: false });
    try {
      await replaceWithBundle(rawStore, pending, id);
      toaster.push(`Imported data into ${saved.name}.`);
    } catch (e) {
      toaster.push(`Could not import that data: ${e instanceof Error ? e.message : String(e)}`);
    }
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
  // each other's records). Whether this copy may write is the version gate's call (KA-22, #63), and
  // it can change while the app is open — so the store is guarded by a lock read on every write.
  const lock = new AppLock();
  let store = rawStore;
  let gate: import("./version-gate.js").GateResult | undefined;
  const canWrite = space ? space().role !== "reader" : true;
  if (saved.sync) {
    const { openVersionGate } = await import("./version-gate.js");
    gate = await openVersionGate({ id, saved, rawStore, lock, canWrite });
    if (!gate.proceed) return null;
    store = guardedStore(rawStore, lock.refusal);
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

  if (gate) {
    const { migrateShared } = await import("./version-gate.js");
    const current = space?.();
    await migrateShared({
      definition: composed!.runtime.definition,
      rawStore,
      lock,
      gate,
      canWrite,
      others: (current?.members ?? []).filter((m) => m.id !== me.id).map((m) => m.name),
      toast: toaster,
      refresh: () => composed!.runtime.core.invalidate(),
    });
  } else {
    await runMigrationsIfPossible(composed!.runtime.definition, store, toaster);
  }
  // Everything this app started that outlives a render, so switching away can stop it (#89). The
  // page dying used to do this for free.
  const stops: Array<() => void> = gate ? [gate.stop] : [];
  stops.push(startReminderSync(composed!.runtime, store));
  // The launcher badge's reminders (#86): due times, so one that falls due while the app is closed counts.
  stops.push(watchReminderTimes(composed!.runtime, store, (due) => recordSignals(appKey("user", id), { due })));
  await restoreScope(composed!.runtime, id);

  let open = true;
  liveApps(+1);
  const opened: Opened = {
    sync: Boolean(saved.sync),
    dispose: async () => {
      if (!open) return;
      open = false;
      liveApps(-1);
      for (const stop of stops.splice(0)) stop();
      composed!.loaded.dispose();
      await rawStore.close();
    },
  };
  // Superseded while it was opening (another tap, Back): put it away without showing it.
  if (!isCurrent()) {
    await opened.dispose();
    return null;
  }

  mount(
    root,
    <App
      key={`${id}:${routeSeq}`}
      navHost={navHost}
      picker={picker}
      questions={questions}
      sync={saved.sync}
      runtime={composed!.runtime}
      provenance={provenance}
      toaster={toaster}
      appId={id}
      currentKind="user"
      lock={saved.sync ? lock : undefined}
      onExport={() => void exportApp(composed!.runtime, store, caps, provenance, appSource, toaster)}
      onImport={() => void importApp(caps, toaster)}
      generator
    />,
  );
  return opened;
}

// What is on screen now, and the route counter that tells a slow open it has been superseded.
let current: Opened | null = null;
let routeSeq = 0;

/**
 * Put a route on screen (#89). The new surface is mounted FIRST — the previous app's tree unmounts
 * with it, so nothing reads a store that is about to close — and only then is the previous app's
 * runtime, isolate, store and watchers put away.
 */
async function show(r: Route, root: HTMLElement, caps: Capabilities): Promise<void> {
  const seq = ++routeSeq;
  const isCurrent = (): boolean => seq === routeSeq;
  const prev = current;
  current = null;

  if (r.kind === "home") {
    mount(root, <Home key={`home:${seq}`} />);
    await prev?.dispose().catch((e: unknown) => console.warn("[karta] closing the previous app failed:", e));
    return;
  }

  const saved = getUserApp(r.id);
  mount(
    root,
    <div className="k-joining" key={`opening:${seq}`}>
      <p>Opening “{saved?.name ?? r.id}”…</p>
    </div>,
  );
  await prev?.dispose().catch((e: unknown) => console.warn("[karta] closing the previous app failed:", e));
  if (!isCurrent()) return;

  // An open is an open however it came about — a tile, a deep link, a reload, Back — so it is
  // counted here, where every route to an app passes, not on the tile click (#81).
  recordOpen(appKey(r.kind, r.id), new Date().toISOString());
  const opened = await bootUserApp(r.id, root, new Toaster(), caps, isCurrent);
  if (isCurrent()) current = opened;
  else await opened?.dispose();
}

/**
 * Whether a route can replace what is on screen without a page load. Synced apps cannot, yet: the
 * space they read (`open-store.ts`) is module state that is set up once per page, and a pending data
 * import is restored on boot. Those keep the full navigation, which is always correct.
 */
function canSwitchInPlace(next: Route): boolean {
  if (current?.sync) return false;
  if (sessionStorage.getItem(IMPORT_KEY)) return false;
  return next.kind === "home" || !getUserApp(next.id)?.sync;
}

// Where the identity's secrets live (#57): the platform keystore on a device, else this browser's
// encrypted vault, else — where neither exists — plain storage as before. Registered at module load,
// before anything below can read identity; which one is decided on first use.
setSecretVault(deferredVault(async () => (await maybeCreateNativeVault()) ?? browserVault()));

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  // Move secrets an older build left in plain storage into the vault. Not awaited: nothing on screen
  // waits on it, and every read of a secret performs the same move if this has not finished.
  void secureIdentitySecrets().catch((e: unknown) => console.warn("[karta] could not secure identity keys:", e));

  // The examples are ordinary apps (#152): seeded into the registry once, then yours to edit,
  // share or delete. Under `dev:sandbox` they are seeded untrusted, which is what exercises the
  // isolate. Before routing, because routing asks the registry whether an app exists.
  await seedExamples({ trusted: !SANDBOX, now: new Date().toISOString() });

  // A shared link is handled before routing: it creates the local app, so the route it should land
  // on does not exist until the invite has been accepted.
  const joined = await bootInviteIfPresent(root);

  // Native (Capacitor) capabilities on a device — chiefly EXACT offline notifications — else web.
  // Only imported when actually on a device (web bundle stays Capacitor-free). Sole target-selection.
  const caps = (await maybeCreateNativeCapabilities()) ?? createWebCapabilities();

  // Opening an app, going home and Back switch in place from here on (#89).
  setRouteHandler((next) => {
    if (!canSwitchInPlace(next)) return false;
    void show(next, root, caps);
    return true;
  });
  globalThis.addEventListener("popstate", () => {
    const next = route();
    if (canSwitchInPlace(next)) void show(next, root, caps);
    else location.reload();
  });

  await show(joined ? { kind: "user", id: joined } : route(), root, caps);
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
